import { sessionActor, refusesCrossSite } from '@/lib/authentication';
import { connectionTestRateLimited } from '@/lib/allowances';
import { testDefaultConnection } from '@/lib/connections';
import { json, unauthorized } from '@/lib/http';
/**
 * POST: "Test connection" on the settings page. A signed-in person's browser session only, same-site, within their
 * hourly allowance (lib/allowances): opens a session and runs `SELECT 1` as that person. `{ok, latencyMs}` or `{ok:false, error}`.
 */
export async function POST(request: Request) {
  const actor = await sessionActor(request);
  if (actor.credential !== 'session' || !actor.userId) return unauthorized(request);
  if (refusesCrossSite(request, actor)) return json({ error: 'forbidden' }, 403);
  if (connectionTestRateLimited(actor.userId)) return json({ error: 'rate_limited', message: 'Too many connection tests this hour; try again later.' }, 429);
  return json(await testDefaultConnection({ ...actor, userId: actor.userId }), 200, { 'Cache-Control': 'no-store' });
}
