import { withAgentOrBrowserAuth } from '@/lib/authentication';
import { connectionTestRateLimited } from '@/lib/allowances';
import { json } from '@/lib/http';
import { testLiveConnection } from '@/lib/live-datasets';
/** POST: "Test connection" on a saved live dataset (owner and editors), within the person's hourly allowance. */
export const POST = withAgentOrBrowserAuth(async (_request, { actor, params }) => {
  if (!actor.userId) return json({ error: 'unauthorized', message: 'sign in to test a connection' }, 401);
  if (connectionTestRateLimited(actor.userId)) return json({ error: 'rate_limited', message: 'Too many connection tests this hour; try again later.' }, 429);
  const reply = await testLiveConnection(actor, params.id!);
  return json(reply.body, reply.status, { 'Cache-Control': 'no-store' });
});
