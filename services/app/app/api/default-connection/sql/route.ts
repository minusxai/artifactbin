import { requestOrSessionActor, refusesCrossSite } from '@/lib/authentication';
import { agentConnectionSql } from '@/lib/connections';
import { json, readJson, unauthorized } from '@/lib/http';
/**
 * POST `{sql, params?, namespace?}`: one read-only statement on the default connection, as the signed-in caller (the
 * skill's `sql.mjs query default:`), its text passed through in the database's dialect, `$name` bound from `params`.
 */
export async function POST(request: Request) {
  const actor = await requestOrSessionActor(request);
  if (refusesCrossSite(request, actor)) return json({ error: 'forbidden' }, 403);
  if (!actor.userId) return unauthorized(request);
  const body = await readJson(request).catch(() => null);
  if (!body || typeof body !== 'object') return json({ error: 'validation_failed', message: 'send {sql, params?, namespace?}' }, 400);
  const reply = await agentConnectionSql(actor, body as { sql?: unknown; params?: unknown; namespace?: unknown }, request.signal);
  return json(reply.body, reply.status, { 'Cache-Control': 'no-store' });
}
