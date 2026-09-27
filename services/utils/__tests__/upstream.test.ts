/**
 * THE UPSTREAM SEAM, both adapters, same app. In-process the actor rides on
 * the Request object — no header, no signing; over HTTP it is a signed header
 * a receiver part verifies. The app code is identical, and a forged header
 * reaching the app directly is worth nothing either way.
 */
import { afterAll, describe, expect, it } from 'vitest';
import { brotliCompressSync, brotliDecompressSync } from 'node:zlib';
import { Hono } from 'hono';
import { readRawResponse, withHttpServer } from '@artifactbin/test-support/net';
import type { Actor, Part } from '@artifactbin/contracts';
import { ACTOR_HEADER } from '@artifactbin/contracts';
import { actorOf, actorReceiver, assemble, attachActor, inProcess, overHttp, serve, signActor, UPSTREAM_TIMEOUTS } from '@artifactbin/utils';

const SECRET = 's'.repeat(32);
const alice: Actor = { credential: 'bearer', userId: 'usr_alice', tokenId: 'tok_1' };

function createApp(): Hono {
  const app = new Hono();
  app.get('/whoami', (c) => c.json({ actor: actorOf(c.req.raw) }));
  app.get('/events', (_c) => {
    let n = 0; let timer: ReturnType<typeof setInterval>;
    const body = new ReadableStream({
      start(ctrl) { timer = setInterval(() => ctrl.enqueue(new TextEncoder().encode(`data: ping ${n++}\n\n`)), 10); },
      cancel() { clearInterval(timer); cancelled.push('events'); },
    });
    return new Response(body, { headers: { 'content-type': 'text/event-stream' } });
  });
  // An already-encoded body: the bytes on the wire are the representation a client negotiated.
  app.get('/encoded', (c) => new Response(ENCODED, { headers: {
    'content-type': 'text/javascript', 'content-encoding': 'br', 'content-length': String(ENCODED.byteLength), vary: 'Accept-Encoding',
    'x-seen-accept-encoding': c.req.header('accept-encoding') ?? '',
  } }));
  app.post('/echo', async (c) => c.text(await c.req.text()));
  app.get('/cookies', () => {
    const headers = new Headers({ location: '/elsewhere' });
    headers.append('set-cookie', 'a=1; Path=/');
    headers.append('set-cookie', 'b=2; Path=/');
    return new Response(null, { status: 302, headers });
  });
  return app;
}
const cancelled: string[] = [];
const PLAIN = 'export const words = "' + 'the same sentence again, '.repeat(400) + '";';
const ENCODED = brotliCompressSync(Buffer.from(PLAIN));
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
  /*
   * THE HOP CARRIES BYTES, NOT MEANINGS. A body the app already encoded (a
   * precompressed asset, a brotli page) must reach the client as those bytes —
   * decoding here and dropping `content-encoding` throws the compression away
   * one hop before the client, and costs CPU on both sides of it.
   */
  it('passes an encoded body through untouched, with its encoding and length', async () => {
    const raw = await readRawResponse(proxyServer.port, '/encoded', { headers: { 'accept-encoding': 'br' } });
    expect(raw.status).toBe(200);
    expect(raw.headers['content-encoding']).toBe('br');
    expect(raw.headers['x-seen-accept-encoding']).toBe('br');
    expect(raw.headers.vary).toBe('Accept-Encoding');
    expect(raw.promised).toBe(ENCODED.byteLength);
    expect(Buffer.compare(raw.body, ENCODED)).toBe(0);
    expect(brotliDecompressSync(raw.body).toString()).toBe(PLAIN);
  });
  it('forwards no accept-encoding of its own when the client sent none', async () => {
    const raw = await readRawResponse(proxyServer.port, '/encoded');
    expect(raw.headers['x-seen-accept-encoding']).toBe('');
  });
  it('streams a request body, keeps every set-cookie and never follows a redirect', async () => {
    const echoed = await fetch(`http://127.0.0.1:${proxyServer.port}/echo`, { method: 'POST', body: 'hello body' });
    expect(await echoed.text()).toBe('hello body');
    const moved = await fetch(`http://127.0.0.1:${proxyServer.port}/cookies`, { redirect: 'manual' });
    expect(moved.status).toBe(302);
    expect(moved.headers.get('location')).toBe('/elsewhere');
    expect(moved.headers.getSetCookie()).toEqual(['a=1; Path=/', 'b=2; Path=/']);
  });
  it('answers HEAD with the length a GET would carry and no body', async () => {
    const raw = await readRawResponse(proxyServer.port, '/encoded', { method: 'HEAD', headers: { 'accept-encoding': 'br' } });
    expect(raw.status).toBe(200);
    expect(raw.body.byteLength).toBe(0);
    expect(raw.headers['content-encoding']).toBe('br');
  });
});

/*
 * THE OLD CLIENT'S BOUNDS, KEPT. Node's fetch (undici 6.24.1 in Node 22.22.3)
 * bounded every upstream call with headersTimeout and bodyTimeout of 300 s.
 * The node:http hop keeps both: a stalled header wait rejects, an idle body
 * errors the stream, and either closes the socket to the app. Injected tiny
 * values here; the defaults are the old ones.
 */
describe('overHttp bounds', () => {
  const closedAfter = () => { let resolve!: () => void; const closed = new Promise<void>(r => { resolve = r; }); return { closed, resolve }; };
  it('defaults to the old client\'s 300 s header and body bounds', () => {
    expect(UPSTREAM_TIMEOUTS).toEqual({ headersTimeoutMs: 300_000, bodyTimeoutMs: 300_000 });
  });
  it('rejects a response whose headers never come, and closes the upstream socket', async () => {
    const socket = closedAfter();
    const server = await withHttpServer((req) => { req.socket.on('close', socket.resolve); });
    try {
      const upstream = overHttp(server.base, SECRET, { headersTimeoutMs: 100, bodyTimeoutMs: 5_000 });
      const started = Date.now();
      await expect(upstream(new Request('http://proxy/stalled'), alice)).rejects.toMatchObject({ code: 'UPSTREAM_HEADERS_TIMEOUT' });
      expect(Date.now() - started).toBeLessThan(2_000);
      await socket.closed;
    } finally { await server.close(); }
  });
  it('errors a body that goes idle mid-stream, and closes the upstream socket', async () => {
    const socket = closedAfter();
    const server = await withHttpServer((req, res) => {
      req.socket.on('close', socket.resolve);
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.write('first chunk');
    });
    try {
      const upstream = overHttp(server.base, SECRET, { headersTimeoutMs: 5_000, bodyTimeoutMs: 100 });
      const res = await upstream(new Request('http://proxy/half'), alice);
      const reader = res.body!.getReader();
      expect(new TextDecoder().decode((await reader.read()).value)).toBe('first chunk');
      await expect(reader.read()).rejects.toMatchObject({ code: 'UPSTREAM_BODY_TIMEOUT' });
      await socket.closed;
    } finally { await server.close(); }
  });
  it('never cuts a body that keeps arriving, however long it runs', async () => {
    const app = assemble([actorReceiver(SECRET), { name: 'app', mount: (h) => h.route('/', createApp()) }]);
    const appServer = serve(app, 0);
    try {
      // Pings every 10 ms against a 60 ms idle bound, read for well past it.
      const res = await overHttp(`http://127.0.0.1:${appServer.port}`, SECRET, { headersTimeoutMs: 5_000, bodyTimeoutMs: 60 })(new Request('http://proxy/events'), alice);
      const reader = await readPings(res, 30);
      await reader.cancel();
    } finally { await appServer.close(); }
  });
});
