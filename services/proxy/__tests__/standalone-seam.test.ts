/**
 * lean-2 seed — the standalone seam a deployment composes against, instead of re-implementing the boot.
 *
 * Six red pins: config refuses with EVERY missing required name; the handshake deadline lives in the OSS
 * forwarder (refused → 502, hung → 502 inside the deadline, a stream is never cut); `createStandaloneProxy`
 * exposes the assembled literal to a `parts` hook that replaces by name; `runStandalone` boots and closes;
 * and the package root exports all of it. Nothing here names any deployment.
 */
import { afterAll, describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import type { Part } from '@artifactbin/contracts';
import { assemble, overHttp, serve } from '@artifactbin/utils';
import { forward } from '../src/parts';
import { loadConfig } from '../src/config';
import { createStandaloneProxy, runStandalone } from '../src/standalone';
import { testProxyOptions } from './helpers';

const SECRET = 's'.repeat(32);
const BASE = { APP__UPSTREAM_URL: 'http://artifactbin-app:3000', CONTRACT__ACTOR_SECRET: SECRET };

/** Accepts the connection and answers nothing — the deadline's subject. */
const blackHole = new Hono();
blackHole.all('*', () => new Promise<Response>(() => {}));
/** An upstream that streams a ping every 40 ms — five of them outlast a 100 ms deadline. */
const streamer = new Hono();
streamer.get('/events', (c) => {
  let n = 0; let t: ReturnType<typeof setInterval>;
  const body = new ReadableStream({
    start(ctrl) { t = setInterval(() => ctrl.enqueue(new TextEncoder().encode(`data: ping ${n++}\n\n`)), 40); },
    cancel() { clearInterval(t); },
  });
  return c.body(body, { headers: { 'content-type': 'text/event-stream' } });
});
streamer.get('/health', (c) => c.json({ from: 'upstream' }));
const hung = serve(blackHole, 0);
const live = serve(streamer, 0);
afterAll(async () => { await hung.close(); await live.close(); });

const refusedPort = async (): Promise<number> => { const s = serve(new Hono(), 0); await s.ready; const port = s.port; await s.close(); return port; };

describe('loadConfig({ required })', () => {
  it('1. refuses to boot naming EVERY missing required name at once, and passes when they are set', () => {
    const required = ['DATABASE_URL', 'APP__PUBLIC_BASE_URL', 'AUTH__SECRET'];
    let message = '';
    try { loadConfig({ ...BASE, AUTH__SECRET: SECRET }, { required }); } catch (e) { message = String(e); }
    expect(message).toContain('DATABASE_URL');
    expect(message).toContain('APP__PUBLIC_BASE_URL');
    expect(message).not.toContain('AUTH__SECRET');
    expect(() => loadConfig({ ...BASE, AUTH__SECRET: SECRET, DATABASE_URL: '' }, { required })).toThrow('DATABASE_URL');
    const ok = loadConfig({ ...BASE, AUTH__SECRET: SECRET, DATABASE_URL: 'postgres://x/y', APP__PUBLIC_BASE_URL: 'https://proxy' }, { required });
    expect(ok.databaseUrl).toBe('postgres://x/y');
    expect(loadConfig(BASE).upstreamDeadlineMs).toBe(30_000);
    expect(loadConfig({ ...BASE, UPSTREAM__DEADLINE_MS: '250' }).upstreamDeadlineMs).toBe(250);
    expect(loadConfig({ ...BASE, UPSTREAM__DEADLINE_MS: 'soon' }).upstreamDeadlineMs).toBe(30_000);
    expect(loadConfig({ ...BASE, UPSTREAM__DEADLINE_MS: '250' }).unknownNames).toEqual([]);
  });
});

describe('forward with a handshake deadline', () => {
  it('2. answers 502 upstream_unavailable for a refused connection, never a hang or a 500', async () => {
    const proxy = assemble([forward(overHttp(`http://127.0.0.1:${await refusedPort()}`, SECRET), await testProxyOptions({ upstreamDeadlineMs: 5_000 }))]);
    const started = Date.now();
    const res = await proxy.request('http://proxy/anything');
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: 'upstream_unavailable' });
    expect(Date.now() - started).toBeLessThan(1_000);
  });
  it('3. answers 502 upstream_unavailable when the upstream accepts and never replies, inside the deadline', async () => {
    await hung.ready;
    const proxy = assemble([forward(overHttp(hung.url, SECRET), await testProxyOptions({ upstreamDeadlineMs: 300 }))]);
    const started = Date.now();
    const res = await proxy.request('http://proxy/anything');
    const elapsed = Date.now() - started;
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: 'upstream_unavailable' });
    expect(elapsed).toBeGreaterThanOrEqual(250);
    expect(elapsed).toBeLessThan(2_000);
  }, 4_000);
  it('4. keeps a stream running long past the deadline — the clock covers the handshake only', async () => {
    await live.ready;
    const proxy = assemble([forward(overHttp(live.url, SECRET), await testProxyOptions({ upstreamDeadlineMs: 100 }))]);
    const res = await proxy.request('http://proxy/events');
    expect(res.status).toBe(200);
    const reader = res.body!.getReader();
    let text = '';
    while (!text.includes('ping 4')) { const { value, done } = await reader.read(); if (done) break; text += new TextDecoder().decode(value); }
    await reader.cancel();
    expect(text).toContain('ping 4');
  }, 4_000);
});

describe('createStandaloneProxy(config, deps, { parts })', () => {
  const teapot: Part = { name: 'forward', mount: (app) => app.all('*', (c) => c.text('composed', 418)) };
  const banner: Part = { name: 'banner', mount: (app) => app.get('/banner', (c) => c.text('inserted')) };
  const deps = { upstream: async () => Response.json({ from: 'upstream' }) };

  it('5. hands the hook the assembled literal in order and mounts exactly what it returns', async () => {
    const config = loadConfig(BASE);
    let seen: string[] = [];
    const replaced = createStandaloneProxy(config, deps, { parts: (assembled) => { seen = assembled.map((p) => p.name); return assembled.map((p) => (p.name === 'forward' ? teapot : p)); } });
    expect(seen).toEqual(['health', 'session', 'rateLimit', 'loginRoutes', 'oauthRoutes', 'forwardedHeaders', 'forward']);
    expect((await replaced.request('http://proxy/anything')).status).toBe(418);
    expect((await replaced.request('http://proxy/health')).status).toBe(200);
    const inserted = createStandaloneProxy(config, deps, { parts: (assembled) => [assembled[0]!, banner, ...assembled.slice(1)] });
    expect(await (await inserted.request('http://proxy/banner')).text()).toBe('inserted');
    expect(await (await inserted.request('http://proxy/anything')).json()).toEqual({ from: 'upstream' });
    expect(await (await createStandaloneProxy(config, deps).request('http://proxy/anything')).json()).toEqual({ from: 'upstream' });
  });
  it('6. runStandalone boots the composition on APP__PORT=0, honours the hook, and close() stops it', async () => {
    await live.ready;
    const config = loadConfig({ ...BASE, APP__UPSTREAM_URL: live.url, APP__PORT: '0' });
    const running = await runStandalone(config, { parts: (assembled) => [assembled[0]!, banner, ...assembled.slice(1)] });
    expect(new URL(running.url).port).not.toBe('3000');
    expect(await (await fetch(`${running.url}/health`)).json()).toEqual({ ok: true });
    expect(await (await fetch(`${running.url}/banner`)).text()).toBe('inserted');
    expect(await (await fetch(`${running.url}/anything`)).status).toBe(404);
    await running.close();
    await running.close();
    await expect(fetch(`${running.url}/health`)).rejects.toThrow();
  });
  it('7. the package root exports the whole seam — a deployment never imports a file path', async () => {
    const root = await import('../src/index');
    for (const name of ['loadConfig', 'loadProcessConfig', 'createStandaloneProxy', 'buildDeps', 'runStandalone']) {
      expect(typeof (root as Record<string, unknown>)[name], name).toBe('function');
    }
  });
});
