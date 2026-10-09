/**
 * `auth()` — the account session, as the app sees it: the signed actor header
 * the PROXY, which owns login, stamps on every request
 * (`@artifactbin/contracts`), read from the request scope. No JWT of our own
 * and no cookie decoded here. Off a request (a build, a direct handler call in
 * a test) there is no header and therefore no session — unless a test says who
 * is signed in (`overrideSession`).
 */
import { sessionActor } from '@/lib/accounts/viewer';

export interface Session {
  user: { id: string; email?: string | null; name?: string | null };
}

/** Who a test says is signed in; undefined is the request's own answer. */
let override: (() => Session | null) | undefined;

/**
 * THE TEST SEAM: the route tests call handlers directly, with no proxy to stamp a session, so the harness
 * (`setSession` in services/app/__tests__/harness.ts) names one here and clears it before every test and after
 * every file. Nothing in the app calls it; undefined restores the request's own answer.
 */
export function overrideSession(session: (() => Session | null) | undefined): void {
  override = session;
}

export async function auth(): Promise<Session | null> {
  if (override) return override();
  const actor = await sessionActor(undefined, { headerOnly: true });
  if (actor.credential !== 'session' || !actor.viewer?.userId) return null;
  return { user: { id: actor.viewer.userId, email: actor.viewer.email ?? null } };
}
