import type { Actor, Part, Upstream } from '@artifactbin/contracts';
import { ACTOR_HEADER } from '@artifactbin/contracts';
import type { Hono } from 'hono';
import { signActor, verifyActor } from './actor-sign';

/** The actor travels WITH the Request object — a property of the value, invisible to headers and to anyone holding a different Request. */
const actors = new WeakMap<Request, Actor>();
export function attachActor<R extends Request>(request: R, actor: Actor): R { actors.set(request, actor); return request; }
export function actorOf(request: Request): Actor | null { return actors.get(request) ?? null; }

/** In-process: the app's fetch handler, the same Request, no header, no socket. */
export const inProcess = (app: Pick<Hono, 'fetch'>): Upstream => (request, actor) => Promise.resolve(app.fetch(attachActor(request, actor)));

/** Headers that describe THIS hop, never forwarded. */
const HOP_BY_HOP = ['connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization', 'te', 'trailer', 'transfer-encoding', 'upgrade', 'host', 'content-length'];
/** fetch() has already undone these on the way in; passing them on would describe bytes the client is not getting. */
const DECODED = ['content-encoding', 'content-length', 'transfer-encoding'];

/**
 * Over HTTP: the actor as a signed header, the body as a STREAM in both
 * directions, and the client's abort forwarded — a reader that leaves an SSE
 * stream must cancel the app's, or every departed tab is a leaked generator.
 */
export const overHttp = (url: string, secret: string): Upstream => async (request, actor) => {
  const from = new URL(request.url);
  const headers = new Headers(request.headers);
  for (const h of HOP_BY_HOP) headers.delete(h);
  headers.set(ACTOR_HEADER, signActor(actor, secret));
  const hasBody = request.method !== 'GET' && request.method !== 'HEAD';
  const res = await fetch(`${url}${from.pathname}${from.search}`, {
    method: request.method,
    headers,
    ...(hasBody ? { body: request.body, duplex: 'half' } : {}),
    signal: request.signal,
    redirect: 'manual',
  } as RequestInit);
  const out = new Headers(res.headers);
  for (const h of DECODED) out.delete(h);
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers: out });
};

/** The app-side half of overHttp, mounted ONLY in the split shape: a valid signature attaches the actor; anything else is nobody. */
export const actorReceiver = (secret: string): Part => ({
  name: 'actorReceiver',
  mount: (app) => app.use('*', async (c, next) => {
    const actor = verifyActor(c.req.header(ACTOR_HEADER), secret);
    if (actor) attachActor(c.req.raw, actor);
    await next();
  }),
});
