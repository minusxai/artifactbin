/**
 * `auth()` — the account session, as the app sees it: the signed actor header
 * the PROXY, which owns login, stamps on every request
 * (`@artifactbin/contracts`), read from the request scope. No JWT of our own
 * and no cookie decoded here. Off a request (a build, a direct handler call in
 * a test) there is no header and therefore no session.
 */
import { sessionActor } from '@/lib/viewer';

export interface Session {
  user: { id: string; email?: string | null; name?: string | null };
}

export async function auth(): Promise<Session | null> {
  const actor = await sessionActor(undefined, { headerOnly: true });
  if (actor.credential !== 'session' || !actor.viewer?.userId) return null;
  return { user: { id: actor.viewer.userId, email: actor.viewer.email ?? null } };
}
