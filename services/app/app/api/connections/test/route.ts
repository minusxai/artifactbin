import { withAgentOrBrowserAuth } from '@/lib/authentication';
import { connectionTestRateLimited } from '@/lib/allowances';
import { json, readJson } from '@/lib/http';
import { testConnectionConfig } from '@/lib/live-datasets';
/**
 * POST `{connection}`: "Test connection" on the new-dataset form, before anything is saved: the configuration is
 * checked (address and TLS rules included), a session opened and `SELECT 1` run as the signed-in person, within their
 * hourly allowance. `{ok, latencyMs}` or `{ok:false, error}`; the secret is used once and kept nowhere.
 */
export const POST = withAgentOrBrowserAuth(async (request, { actor }) => {
  if (!actor.userId) return json({ error: 'unauthorized', message: 'sign in to test a connection' }, 401);
  if (connectionTestRateLimited(actor.userId)) return json({ error: 'rate_limited', message: 'Too many connection tests this hour; try again later.' }, 429);
  const body = await readJson(request).catch(() => null);
  if (!body) return json({ error: 'invalid_json' }, 400);
  const reply = await testConnectionConfig(actor, (body as { connection?: unknown }).connection);
  return json(reply.body, reply.status, { 'Cache-Control': 'no-store' });
});
