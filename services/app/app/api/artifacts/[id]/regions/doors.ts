/**
 * The region routes' composition and doors (lib/region-sessions holds the behaviour): one RegionSessions per process
 * over the app database, the shared LISTEN registry and the live doors' heartbeat; and who may call.
 *
 * Open, updates and the stream are the BROWSER's: an account session, same-origin (an Origin naming another origin
 * is refused, as the presence door does). A bearer token, an agent cookie or nobody gets the uniform 404 there, as
 * anyone without edit access does. Flush also admits a bearer token (an agent saving before it comments).
 */
import { createRegionSessions, type RegionAnswer, type RegionSessions } from '@/lib/region-sessions';
import { subscribeChannel } from '@/lib/publish';
import { baseUrl, json, liveKeepaliveFrame } from '@/lib/http';
import { requestOrSessionActor, sessionActor } from '@/lib/authentication';
import { getDb } from '@/lib/platform';
import type { RequestIdentity } from '@/lib/accounts';

let sessions: RegionSessions | undefined;
export const regionSessions = (): RegionSessions =>
  sessions ??= createRegionSessions({ db: getDb, subscribe: subscribeChannel, keepaliveFrame: liveKeepaliveFrame });

export const notFound = (): Response => json({ error: 'not_found' }, 404);

/** An Origin header, when present, must be the app's own. */
function sameOrigin(request: Request): boolean {
  const origin = request.headers.get('origin');
  if (!origin) return true;
  try { return origin === new URL(baseUrl(request)).origin; } catch { return false; }
}

/** The signed-in browser editor, or the Response to answer with. */
export async function browserEditor(request: Request): Promise<RequestIdentity | Response> {
  if (!sameOrigin(request)) return new Response('forbidden', { status: 403 });
  if (request.headers.has('authorization')) return notFound();
  const actor = await sessionActor(request);
  return actor.credential === 'session' && actor.userId ? actor : notFound();
}

/** A browser editor or a bearer token (flush), or the Response to answer with. */
export async function editorOrAgent(request: Request): Promise<RequestIdentity | Response> {
  const actor = await requestOrSessionActor(request);
  if (actor.credential === 'bearer' && actor.tokenId) return actor;
  if (!sameOrigin(request)) return new Response('forbidden', { status: 403 });
  return actor.credential === 'session' && actor.userId ? actor : notFound();
}

/** A store answer as HTTP. */
export function answer<T>(result: RegionAnswer<T>): Response {
  if (result.status === 200) return Response.json(result.body);
  return result.body ? json(result.body, result.status) : notFound();
}
