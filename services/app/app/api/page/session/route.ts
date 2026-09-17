/**
 * Who is looking, for the app's chrome: the account (or none), how the browser
 * is authenticated (`account` | `anon` | `none`, the top bar's session
 * control). What
 * the shell layout used to compute on the server, now answered as JSON.
 */
import { json } from '@/lib/http';
import { browserSessionKind, sessionActor } from '@/lib/viewer';

export async function GET(request: Request) {
  const actor = await sessionActor(request);
  const kind = await browserSessionKind(request);
  const user = actor.credential === 'session' && actor.viewer?.userId ? { id: actor.viewer.userId, email: actor.viewer.email } : null;
  return json({ user, kind }, 200, { 'Cache-Control': 'no-store' });
}
