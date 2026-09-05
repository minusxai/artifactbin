/** The account page's data: the handle (assigned on sight if missing) and the daily-views chart. */
import { dailyViewsByUser } from '@/lib/feed';
import { json, unauthorized } from '@/lib/http';
import { ensureUsername, getUserById } from '@/lib/users';
import { sessionActor } from '@/lib/viewer';
import { renderDailyViewsSvg } from '@/lib/viz/sparkline';

export async function GET(request: Request) {
  const actor = await sessionActor(request);
  if (actor.credential !== 'session' || !actor.viewer?.userId) return unauthorized(request);
  const [user, daily] = await Promise.all([getUserById(actor.viewer.userId), dailyViewsByUser(actor.viewer.userId)]);
  const username = user ? (await ensureUsername(user)).username : null;
  const viewsChart = daily.length > 0 ? await renderDailyViewsSvg(daily) : null;
  return json({ username, viewsChart }, 200, { 'Cache-Control': 'no-store' });
}
