/**
 * Who is looking, for the app's chrome: the account (or none), how the browser
 * is authenticated (`account` | `anon` | `none`, the top bar's session
 * control), and the header's stats. What
 * the shell layout used to compute on the server, now answered as JSON.
 */
import { MIXPANEL_HOST, MIXPANEL_TOKEN } from '@/lib/config';
import { json } from '@/lib/http';
import { getUserById, listArtifactsByUser } from '@/lib/users';
import { browserSessionKind, sessionActor } from '@/lib/viewer';
import type { HeaderStats } from '@/components/HeaderBar';

export async function GET(request: Request) {
  const actor = await sessionActor(request);
  const kind = await browserSessionKind(request);
  const account = actor.credential === 'session' && actor.viewer?.userId ? await getUserById(actor.viewer.userId) : null;
  /*
   * THE HANDLE COMES DOWN WITH THE ACCOUNT, because the masthead is the one
   * piece of chrome on every page and `/@handle` is where everything this
   * account owns lives (components/HeaderBar).
   *
   * READ, never assigned. `ensureUsername` backfills lazily at LOGIN, which is
   * a write, and a GET that writes is a different thing — an account signed in
   * before its backfill ran simply has none here for a request, and the header
   * falls back to the email exactly as it always did.
   */
  const user = actor.credential === 'session' && actor.viewer?.userId
    ? { id: actor.viewer.userId, email: actor.viewer.email, username: account?.username ?? null }
    : null;
  let stats: HeaderStats | null = null;
  if (user) {
    const artifacts = await listArtifactsByUser(user.id);
    const formats: Record<string, number> = { markup: 0 };
    for (const a of artifacts) formats[a.format] = (formats[a.format] ?? 0) + 1;
    stats = { total: artifacts.length, formats };
  }
  return json({ user, kind, stats, mixpanel: { token: MIXPANEL_TOKEN ?? null, host: MIXPANEL_HOST } }, 200, { 'Cache-Control': 'no-store' });
}
