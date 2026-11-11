import { withAgentOrBrowserAuth } from '@/lib/authentication';
import { json, readJson } from '@/lib/http';
import { runOperation } from '@/lib/operations';
/**
 * A LIVE DATASET'S CONNECTION (lib/live-datasets). GET `get_live_connection`: its connector and shown fields, the roles
 * its rules admit to declared queries and the pages declaring them; an owner or editor also gets the non-secret fields
 * and the names of the secrets stored, never a value. PATCH `update_live_connection` (owner and editors): `{connection}`.
 */
export const GET = withAgentOrBrowserAuth((request, { actor, params }) => runOperation('get_live_connection', request, actor, { id: params.id }));
export const PATCH = withAgentOrBrowserAuth(async (request, { actor, params }) => {
  const body = await readJson(request).catch(() => null);
  if (!body) return json({ error: 'invalid_json' }, 400);
  return runOperation('update_live_connection', request, actor, { id: params.id, connection: (body as { connection?: unknown }).connection ?? body });
});
