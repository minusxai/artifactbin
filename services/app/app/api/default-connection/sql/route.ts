import { requestOrSessionActor, refusesCrossSite } from '@/lib/authentication';
import { agentConnectionSql, defaultConnectionSchema } from '@/lib/connections';
import { json, readJson, unauthorized } from '@/lib/http';
/**
 * POST `{sql, params?, namespace?, limit?}`: one read-only statement on the default connection, as the signed-in caller (the
 * skill's `sql.mjs query default:DB`), its text passed through in the database's dialect, `$name` bound from
 * `params`; `namespace` is what follows `default:` (the database). Without `sql`: the tables and columns the caller
 * can read there (`sql.mjs schema default:DB`). Reads return at most `limit` rows (1–10,000, default 1,000).
 */
export async function POST(request: Request) {
  const actor = await requestOrSessionActor(request);
  if (refusesCrossSite(request, actor)) return json({ error: 'forbidden' }, 403);
  // A person, or an agent signed in as a group (it reads as its group: lib/connections `connectorViewer`).
  if (!actor.userId && !actor.principalGroup) return unauthorized(request);
  const body = await readJson(request).catch(() => null);
  if (!body || typeof body !== 'object') return json({ error: 'validation_failed', message: 'send {sql, params?, namespace?, limit?}' }, 400);
  const call = body as { sql?: unknown; params?: unknown; namespace?: unknown; limit?: unknown };
  const reply = call.sql === undefined || call.sql === null
    ? await defaultConnectionSchema(actor, typeof call.namespace === 'string' && call.namespace ? call.namespace : undefined, request.signal)
    : await agentConnectionSql(actor, call, request.signal);
  return json(reply.body, reply.status, { 'Cache-Control': 'no-store' });
}
