/**
 * THE UPSTREAM SEAM, both adapters, same app. In-process the actor rides on
 * the Request object — no header, no signing; over HTTP it is a signed header
 * a receiver part verifies. The app code is identical, and a forged header
 * reaching the app directly is worth nothing either way.
 */
import { afterAll, describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import type { Actor, Part } from '@artifactbin/contracts';
import { ACTOR_HEADER } from '@artifactbin/contracts';
import { actorOf, actorReceiver, assemble, attachActor, inProcess, overHttp, serve, signActor } from '@artifactbin/utils';

const SECRET = 's'.repeat(32);
const alice: Actor = { credential: 'bearer', userId: 'usr_alice', tokenId: 'tok_1' };

function createApp(): Hono {
  const app = new Hono();
  app.get('/whoami', (c) => c.json({ actor: actorOf(c.req.raw) }));
  app.get('/events', (c) => {
    let n = 0; let timer: ReturnType<typeof setInterval>;
    const body = new ReadableStream({
      start(ctrl) { timer = setInterval(() => ctrl.enqueue(new TextEncoder().encode(`data: ping ${n++}\n\n`)), 10); },
      cancel() { clearInterval(timer); cancelled.push('events'); },
    });
    return new Response(body, { headers: { 'content-type': 'text/event-stream' } });
  });
  return app;
}
const cancelled: string[] = [];
const forward = (upstream: (r: Request, a: Actor) => Promise<Response>, actor: Actor): Part => ({ name: 'forward', mount: (h) => h.all('*', (c) => upstream(c.req.raw, actor)) });
const readPings = async (res: Response, n: number) => { const reader = res.body!.getReader(); let text = ''; while ((text.match(/ping/g) ?? []).length < n) text += new TextDecoder().decode((await reader.read()).value); return reader; };

describe('attachActor / actorOf', () => {
  it('is a property of the Request object, not a header', async () => {
    const req = attachActor(new Request('http://x/whoami'), alice);
    expect(actorOf(req)).toEqual(alice);
    expect(req.headers.get(ACTOR_HEADER)).toBeNull();
    expect(actorOf(new Request('http://x/whoami'))).toBeNull();
  });
});

describe('inProcess', () => {
  const app = createApp();
  const proxy = assemble([forward(inProcess(app), alice)]);
  it('hands the actor to the app by reference', async () => {
    expect(await (await proxy.request('/whoami')).json()).toEqual({ actor: alice });
  });
  it('ignores a forged header when the app is called directly', async () => {
    expect(await (await app.request('/whoami', { headers: { [ACTOR_HEADER]: signActor(alice, SECRET) } })).json()).toEqual({ actor: null });
  });
  it('streams a response body and propagates cancel', async () => {
    const reader = await readPings(await proxy.request('/events'), 3);
    await reader.cancel();
    await new Promise((r) => setTimeout(r, 30));
    expect(cancelled).toContain('events');
  });
});

describe('overHttp', () => {
  const app = assemble([actorReceiver(SECRET), { name: 'app', mount: (h) => h.route('/', createApp()) }]);
  const appServer = serve(app, 0);
  const proxy = assemble([forward(overHttp(`http://127.0.0.1:${appServer.port}`, SECRET), alice)]);
  const proxyServer = serve(proxy, 0);
  afterAll(async () => { await proxyServer.close(); await appServer.close(); });

  it('carries the actor as a signed header the receiver verifies', async () => {
    expect(await (await fetch(`http://127.0.0.1:${proxyServer.port}/whoami`)).json()).toEqual({ actor: alice });
  });
  it('rejects a header signed with the wrong secret', async () => {
    const r = await fetch(`http://127.0.0.1:${appServer.port}/whoami`, { headers: { [ACTOR_HEADER]: signActor(alice, 'x'.repeat(32)) } });
    expect(await r.json()).toEqual({ actor: null });
  });
  it('streams SSE through the hop and cancels the app stream when the client leaves', async () => {
    cancelled.length = 0;
    const ac = new AbortController();
    const res = await fetch(`http://127.0.0.1:${proxyServer.port}/events`, { signal: ac.signal });
    await readPings(res, 3);
    ac.abort();
    await new Promise((r) => setTimeout(r, 200));
    expect(cancelled).toContain('events');
  });
});
