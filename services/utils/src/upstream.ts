import type { Actor, Part, Upstream } from '@artifactbin/contracts';
import { ACTOR_HEADER } from '@artifactbin/contracts';
import type { Hono } from 'hono';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { Readable } from 'node:stream';
import { signActor, verifyActor } from './actor-sign';

/** The actor travels WITH the Request object — a property of the value, invisible to headers and to anyone holding a different Request. */
const actors = new WeakMap<Request, Actor>();
export function attachActor<R extends Request>(request: R, actor: Actor): R { actors.set(request, actor); return request; }
export function actorOf(request: Request): Actor | null { return actors.get(request) ?? null; }

/** In-process: the app's fetch handler, the same Request, no header, no socket. */
export const inProcess = (app: Pick<Hono, 'fetch'>): Upstream => (request, actor) => Promise.resolve(app.fetch(attachActor(request, actor)));

/** Headers that describe THIS hop, never forwarded. */
const HOP_BY_HOP = ['connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization', 'te', 'trailer', 'transfer-encoding', 'upgrade', 'host', 'content-length'];
/** Statuses that carry no body whatever their headers say. */
const NULL_BODY = new Set([101, 103, 204, 205, 304]);

/**
 * THE OLD CLIENT'S BOUNDS. Node's fetch (undici 6.24.1 in Node 22.22.3, the
 * repo's and the image's runtime) bounded every call with `headersTimeout` and
 * `bodyTimeout` of 300 s each; the node:http hop below keeps both, so a hung
 * app is still a failure the caller sees rather than a socket held forever.
 */
export const UPSTREAM_TIMEOUTS = { headersTimeoutMs: 300_000, bodyTimeoutMs: 300_000 } as const;
export interface UpstreamTimeouts { headersTimeoutMs?: number; bodyTimeoutMs?: number }

/** A bound the upstream exceeded: `UPSTREAM_HEADERS_TIMEOUT` or `UPSTREAM_BODY_TIMEOUT`. */
export class UpstreamTimeoutError extends Error {
  constructor(readonly code: 'UPSTREAM_HEADERS_TIMEOUT' | 'UPSTREAM_BODY_TIMEOUT', ms: number) {
    super(code === 'UPSTREAM_HEADERS_TIMEOUT'
      ? `upstream sent no response headers within ${ms} ms`
      : `upstream response body was idle for ${ms} ms`);
    this.name = 'UpstreamTimeoutError';
  }
}

/**
 * Over HTTP: the actor as a signed header, the body as a STREAM in both
 * directions, and the client's abort forwarded — a reader that leaves an SSE
 * stream must cancel the app's, or every departed tab is a leaked generator.
 *
 * The hop carries BYTES, not meanings: `node:http`, not `fetch`, because fetch
 * always decodes a `content-encoding` it recognises (and adds an
 * `accept-encoding` the client never sent). A precompressed asset or a brotli
 * page therefore reaches the client exactly as the app encoded it, with its
 * `content-encoding` and `content-length` — the same Response `inProcess` hands
 * over. Redirects are returned, never followed.
 *
 * Bounded as fetch was (UPSTREAM_TIMEOUTS): no headers within
 * `headersTimeoutMs` rejects the call; no body bytes for `bodyTimeoutMs` while
 * the reader is waiting errors the stream. Either destroys the socket to the app.
 */
export const overHttp = (url: string, secret: string, timeouts: UpstreamTimeouts = {}): Upstream => (request, actor) => new Promise<Response>((resolve, reject) => {
  const { headersTimeoutMs, bodyTimeoutMs } = { ...UPSTREAM_TIMEOUTS, ...timeouts };
  const from = new URL(request.url);
  const target = new URL(`${url}${from.pathname}${from.search}`);
  const headers: Record<string, string> = {};
  request.headers.forEach((value, name) => { if (!HOP_BY_HOP.includes(name)) headers[name] = value; });
  headers[ACTOR_HEADER] = signActor(actor, secret);
  const hasBody = request.method !== 'GET' && request.method !== 'HEAD' && request.body !== null;
  if (!hasBody && request.method !== 'GET' && request.method !== 'HEAD') headers['content-length'] = '0';
  const outgoing = (target.protocol === 'https:' ? httpsRequest : httpRequest)(target, { method: request.method, headers, signal: request.signal }, (incoming) => {
    clearTimeout(headersTimer);
    const status = incoming.statusCode ?? 502;
    const out = new Headers();
    const raw = incoming.rawHeaders;
    for (let i = 0; i + 1 < raw.length; i += 2) {
      const name = raw[i]!.toLowerCase();
      if (name !== 'content-length' && HOP_BY_HOP.includes(name)) continue;
      out.append(name, raw[i + 1]!);
    }
    if (request.method === 'HEAD' || NULL_BODY.has(status)) {
      incoming.resume();
      resolve(new Response(null, { status, statusText: incoming.statusMessage ?? '', headers: out }));
      return;
    }
    // Idle = no bytes while the reader waits; a paused (back-pressured) stream is the reader's time, not the app's.
    let bodyTimer: ReturnType<typeof setTimeout> | undefined;
    const idle = () => {
      clearTimeout(bodyTimer);
      bodyTimer = setTimeout(() => incoming.destroy(new UpstreamTimeoutError('UPSTREAM_BODY_TIMEOUT', bodyTimeoutMs)), bodyTimeoutMs);
    };
    const stop = () => { clearTimeout(bodyTimer); bodyTimer = undefined; };
    incoming.on('data', idle).on('resume', idle).on('pause', stop).on('end', stop).on('close', stop);
    idle();
    // Cancelling the web stream destroys `incoming`, which closes the socket the app is writing to.
    resolve(new Response(Readable.toWeb(incoming) as ReadableStream<Uint8Array>, { status, statusText: incoming.statusMessage ?? '', headers: out }));
  });
  const headersTimer = setTimeout(() => outgoing.destroy(new UpstreamTimeoutError('UPSTREAM_HEADERS_TIMEOUT', headersTimeoutMs)), headersTimeoutMs);
  outgoing.on('error', (error) => { clearTimeout(headersTimer); reject(error); });
  outgoing.on('close', () => clearTimeout(headersTimer));
  if (!hasBody) { outgoing.end(); return; }
  const body = Readable.fromWeb(request.body as import('node:stream/web').ReadableStream<Uint8Array>);
  body.on('error', (error) => outgoing.destroy(error));
  body.pipe(outgoing);
});

/** The app-side half of overHttp, mounted ONLY in the split shape: a valid signature attaches the actor; anything else is nobody. */
export const actorReceiver = (secret: string): Part => ({
  name: 'actorReceiver',
  mount: (app) => app.use('*', async (c, next) => {
    const actor = verifyActor(c.req.header(ACTOR_HEADER), secret);
    if (actor) attachActor(c.req.raw, actor);
    await next();
  }),
});
