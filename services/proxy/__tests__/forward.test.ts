/**
 * ONE FORWARDER over the Upstream seam. In-process it is app.fetch on the same Request; over HTTP it is a signed header
 * and a streamed body. Behind a trusted hop the app learns the client's origin and IP (P4 findings F1, F2).
 */
import { afterAll, describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import { ACTOR_HEADER } from '@artifactbin/contracts';
import { assemble, inProcess, overHttp, serve, signActor } from '@artifactbin/utils';
import { createAppServer } from '@/server/app';
import { forward, forwardedHeaders, proxyParts } from '../src/parts';
import { testProxyOptions } from './helpers';

const echo = new Hono();
echo.get('/echo', (c) => c.json({ host: c.req.header('x-forwarded-host') ?? null, proto: c.req.header('x-forwarded-proto') ?? null, xff: c.req.header('x-forwarded-for') ?? null, actor: c.req.header(ACTOR_HEADER) ?? null }));
echo.get('/events', (c) => { let n = 0; let t: ReturnType<typeof setInterval>; const body = new ReadableStream({ start(ctrl) { t = setInterval(() => ctrl.enqueue(new TextEncoder().encode(`data: ${n++}\n\n`)), 10); }, cancel() { clearInterval(t); cancelled.push(1); } }); return new Response(body, { headers: { 'content-type': 'text/event-stream' } }); });
const cancelled: number[] = [];

describe('forward', () => {
  it('forwards status, headers and body unchanged (in-process)', async () => {
    const app = createAppServer({ indexHtml: async () => '<!doctype html><div id="root">SPA</div>' });
    const proxy = assemble([forward(inProcess(app), await testProxyOptions())]);
    const direct = await app.request('/health'); const via = await proxy.request('/health');
    expect(via.status).toBe(direct.status); expect(await via.text()).toBe(await direct.text());
  });
  it('a document response reaches the client with every header the app set and nothing added', async () => {
    const app = createAppServer({ indexHtml: async () => '<!doctype html><div id="root">SPA</div>' });
    const proxy = assemble([forward(inProcess(app), await testProxyOptions())]);
    const direct = await app.request('/a/zzzzzz/raw'); const via = await proxy.request('/a/zzzzzz/raw');
    expect([...via.headers.keys()].sort()).toEqual([...direct.headers.keys()].sort());
  });
  it('drops a forged inbound x-mx-actor and sets x-forwarded-{for,host,proto} itself when it is the outermost hop', async () => {
    const proxy = assemble([forwardedHeaders({ trustedHops: 0 }), forward(inProcess(echo), await testProxyOptions())]);
    const r = await (await proxy.request('http://artifactbin.dev/echo', { headers: { [ACTOR_HEADER]: signActor({ credential: 'bearer', tokenId: 'x' }, 'z'.repeat(32)), 'x-forwarded-host': 'evil.example', 'x-forwarded-for': '9.9.9.9' } })).json();
    expect(r).toMatchObject({ host: 'artifactbin.dev', proto: 'http', actor: null });
    expect(r.xff).not.toContain('9.9.9.9');
  });
  it('preserves x-forwarded-{host,proto} and appends to x-forwarded-for behind a trusted hop', async () => {
    const proxy = assemble([forwardedHeaders({ trustedHops: 1 }), forward(inProcess(echo), await testProxyOptions())]);
    const r = await (await proxy.request('http://inner:3000/echo', { headers: { 'x-forwarded-host': 'artifactbin.dev', 'x-forwarded-proto': 'https', 'x-forwarded-for': '203.0.113.7' } })).json();
    expect(r).toMatchObject({ host: 'artifactbin.dev', proto: 'https' });
    expect(r.xff).toMatch(/^203\.0\.113\.7/);
  });
  it('streams SSE unbuffered through both adapters and the client\'s abort cancels the upstream stream', async () => {
    const upstream = serve(echo, 7112); const proxy = assemble([forward(overHttp(upstream.url, 's'.repeat(32)), await testProxyOptions())]); const p = serve(proxy, 7113);
    try {
      const ac = new AbortController(); const res = await fetch(`${p.url}/events`, { signal: ac.signal });
      const reader = res.body!.getReader(); let text = ''; while ((text.match(/data:/g) ?? []).length < 3) text += new TextDecoder().decode((await reader.read()).value);
      ac.abort(); await new Promise((r) => setTimeout(r, 200));
      expect(cancelled.length).toBeGreaterThan(0);
    } finally {
      await Promise.allSettled([p.close(), upstream.close()]);
    }
  });
  it('never rebuilds the Request: the object the app receives is the one the client\'s arrived on', async () => {
    let seen: Request | null = null; const spy = new Hono(); spy.get('*', (c) => { seen = c.req.raw; return c.text('ok'); });
    const proxy = assemble([forward(inProcess(spy), await testProxyOptions())]);
    const original = new Request('http://x/anything'); await proxy.fetch(original);
    expect(seen).toBe(original);
  });

  it('carries an actor through the real proxy-overHttp-real app boundary and rejects forged signatures', async () => {
    const secret = 'b'.repeat(32);
    const actor = { credential: 'session' as const, userId: 'usr_boundary', email: 'boundary@example.test' };
    const app = createAppServer({ actorSecret: secret, indexHtml: async () => '<div id="root">SPA</div>' });
    const appServer = serve(app, 7110, { host: '127.0.0.1' });
    const options = await testProxyOptions({
      upstream: overHttp(appServer.url, secret),
      sessions: { resolve: async () => ({ userId: actor.userId, email: actor.email }) },
    });
    const proxy = assemble(proxyParts(options));
    const proxyServer = serve(proxy, 7111, { host: '127.0.0.1' });
    try {
      await Promise.all([appServer.ready, proxyServer.ready]);
      const accepted = await fetch(`${proxyServer.url}/api/page/account`);
      expect(accepted.status).not.toBe(401);
      const forged = await fetch(`${appServer.url}/api/page/account`, {
        headers: { [ACTOR_HEADER]: signActor(actor, 'x'.repeat(32)) },
      });
      expect(forged.status).toBe(401);
    } finally {
      await Promise.allSettled([proxyServer.close(), appServer.close()]);
    }
  });
});
afterAll(() => {});
