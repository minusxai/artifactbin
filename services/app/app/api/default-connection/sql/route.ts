import { requestOrSessionActor, refusesCrossSite } from '@/lib/authentication';
import { agentConnectionSql, defaultConnectionSchema } from '@/lib/connections';
import { json, readJson, unauthorized } from '@/lib/http';
/**
 * POST `{sql, params?, namespace?}`: one read-only statement on the default connection, as the signed-in caller (the
 * skill's `sql.mjs query default:DB`), its text passed through in the database's dialect, `$name` bound from
 * `params`; `namespace` is what follows `default:` (the database). Without `sql`: the tables and columns the caller
 * can read there (`sql.mjs schema default:DB`).
 */
export async function POST(request: Request) {
  const actor = await requestOrSessionActor(request);
  if (refusesCrossSite(request, actor)) return json({ error: 'forbidden' }, 403);
  if (!actor.userId) return unauthorized(request);
  const body = await readJson(request).catch(() => null);
  if (!body || typeof body !== 'object') return json({ error: 'validation_failed', message: 'send {sql, params?, namespace?}' }, 400);
  const call = body as { sql?: unknown; params?: unknown; namespace?: unknown };
  const reply = call.sql === undefined || call.sql === null
    ? await defaultConnectionSchema(actor, typeof call.namespace === 'string' && call.namespace ? call.namespace : undefined, request.signal)
    : await agentConnectionSql(actor, call, request.signal);
  return json(reply.body, reply.status, { 'Cache-Control': 'no-store' });
}
