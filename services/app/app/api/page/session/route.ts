/**
 * Who is looking, for the app's chrome: the account (or none), how the browser
 * is authenticated (`account` | `anon` | `none`, the top bar's session
 * control), and whether this person has been through the welcome page.
 *
 * `user` carries what the bar draws the person with: their current handle
 * (`username`, null until one is assigned) and their picture's address
 * (`image`, `avatarUrl` — null draws the generated initial). The row is READ
 * here, never repaired: this is a hot `no-store` payload, so a handle-less row
 * stays handle-less (no `ensureUsername`) and the route performs no write.
 *
 * `onboarded` is FALSE for exactly one kind of visitor: an account whose row
 * still has `welcome_pending`. Everybody else — a guest, a test user, an
 * anonymous browser, nobody at all — is true, because the shell's gate reads
 * this bit to redirect and a `false` nobody can resolve would be a loop.
 * Together with the row read these are two lookups on a payload that is
 * already `no-store`; the welcome rule stays in lib/profiles.
 */
import { avatarUrl } from '@/lib/avatars';
import { json } from '@/lib/http';
import { welcomePending } from '@/lib/profiles';
import { getUserById } from '@/lib/users';
import { browserSessionKind, sessionActor } from '@/lib/viewer';

export async function GET(request: Request) {
  const actor = await sessionActor(request);
  const kind = await browserSessionKind(request);
  const userId = actor.credential === 'session' ? actor.viewer?.userId : undefined;
  const row = userId ? await getUserById(userId) : null;
  const user = userId
    ? { id: userId, email: actor.viewer?.email ?? null, username: row?.username ?? null, image: row ? avatarUrl(row) : null }
    : null;
  const onboarded = userId ? !(await welcomePending(userId)) : true;
  return json({ user, kind, onboarded }, 200, { 'Cache-Control': 'no-store' });
}
