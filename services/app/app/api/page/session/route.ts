/**
 * Who is looking, for the app's chrome: the account (or none), how the browser
 * is authenticated (`account` | `anon` | `none`, the top bar's session
 * control), and whether this person has been through the welcome page.
 *
 * `onboarded` is FALSE for exactly one kind of visitor: an account whose row
 * still has `welcome_pending`. Everybody else — a guest, a test user, an
 * anonymous browser, nobody at all — is true, because the shell's gate reads
 * this bit to redirect and a `false` nobody can resolve would be a loop. It
 * costs one extra row read on a payload that is already `no-store`.
 */
import { json } from '@/lib/http';
import { welcomePending } from '@/lib/profiles';
import { browserSessionKind, sessionActor } from '@/lib/viewer';

export async function GET(request: Request) {
  const actor = await sessionActor(request);
  const kind = await browserSessionKind(request);
  const user = actor.credential === 'session' && actor.viewer?.userId ? { id: actor.viewer.userId, email: actor.viewer.email } : null;
  const onboarded = user ? !(await welcomePending(user.id)) : true;
  return json({ user, kind, onboarded }, 200, { 'Cache-Control': 'no-store' });
}
