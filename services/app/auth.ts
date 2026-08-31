/**
 * `auth()` — the account session, as the app sees it now that the PROXY owns
 * login: the signed actor header the proxy stamps on every request
 * (`@artifactbin/contracts`), read from the request scope. No NextAuth, no JWT
 * of our own, no cookie decoded here. Off a request (a build, a direct
 * handler call in a test) there is no header and therefore no session.
 *
 * Kept as a module named `auth` with the same `auth()` shape so the pages and
 * routes that ask "who is signed in" did not have to change, and so the test
 * suite's `vi.mock('@/auth')` keeps meaning what it meant.
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
