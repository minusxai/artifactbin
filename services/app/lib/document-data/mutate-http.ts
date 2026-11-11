import { LIVE_DATASET_REFUSAL, liveConnectionOf } from '@/lib/datasets';
/**
 * THE DATASET WRITE DOOR over HTTP: the owner's direct statement against a dataset they may write, and
 * a document's declared mutation run by name (the bearer twin of the page door). Both answer the same
 * refusal shapes the routes and the CLI read.
 */
import type { AccessActor } from '@/lib/accounts';
import { canReadArtifact, getArtifactById, getArtifactFor, type MutationReceipt } from '@/lib/artifacts';
import { ownsArtifact } from '@/lib/artifact-access';
import { parseExpectedVersion } from '@/lib/artifact-wire';
import { bindParams, bindTypes, parseMutationRequest, platformValues, type Scalar } from '@/lib/dataflow';
import { rewriteBuiltinFields } from '@/lib/dataflow/server';
import { json } from '@/lib/http';
import { canWriteDataset } from './dataset-policy';
import { isMutationRefused, mutateDataset } from './dataset-mutate';

const isScalar = (v: unknown): v is Scalar =>
  v === null || typeof v === 'string' || typeof v === 'boolean' || (typeof v === 'number' && Number.isFinite(v));

/** A document's declared mutation, run by name with its arguments — the bearer twin of the page door. */
async function respondToDeclaredMutation(actor: AccessActor, id: string, body: Record<string, unknown>): Promise<Response> {
  const row = await getArtifactById(id);
  if (!row || row.deleted_at || !(ownsArtifact(row,actor) || (await canReadArtifact(row, actor)))) return json({ error: 'not_found' }, 404);
  const { name, id: _id, ...rest } = body;
  const parsed = parseMutationRequest({ ...rest, mutation: name });
  if (parsed instanceof Response) return json(await parsed.json(), 400);
  return json({error:'unknown_mutation'},400);
}

/**
 * The owner's dataset write door: one INSERT/UPDATE/DELETE against a dataset
 * they own, with no document in the picture — appending today's rows must not
 * cost re-sending the whole table. The caller writes the SQL, which is safe
 * for the same reason `POST /api/query` is: it is their own dataset, the
 * statement is guarded by TYPE in a throwaway instance holding only that
 * table, and `access` still governs (`readwrite` required even for the owner —
 * the toggle is the one place that says a dataset is writable).
 *
 * A body naming a `name` is the document's declared mutation instead.
 */
export async function respondToMutate(
  actor: AccessActor,
  id: string,
  body: Record<string, unknown> | null,
  receipt?:MutationReceipt,
): Promise<Response> {
  if (body && typeof body.name === 'string') return respondToDeclaredMutation(actor, id, body);
  const found = await getArtifactById(id);
  // A dataset the caller may write (owner, editor, or a v3 rule for its role) resolves; anything else the caller
  // does not edit is the uniform 404.
  const dataset = found&&await canWriteDataset(found,actor)===null?found:await getArtifactFor(actor,id);
  if (!dataset) return json({ error: 'not_found' }, 404);
  if (dataset.format === 'dataset' && liveConnectionOf(dataset.meta)) return json({ error: 'live_dataset', message: LIVE_DATASET_REFUSAL }, 400);

  const refusal = await canWriteDataset(dataset, actor);
  if (refusal === 'not_a_dataset') {
    return json({ error: 'not_a_dataset', details: [`${id} is a ${dataset.format} artifact — only datasets hold rows to write`] }, 400);
  }
  if (refusal) {
    return json({
      error: 'dataset_read_only',
      details: [`${id} is read-only — make it writable: PUT here, or PATCH /api/my/artifacts/${id} { "access": "readwrite" }`],
    }, 403);
  }

  if (!body) return json({ error: 'invalid_json' }, 400);
  if (typeof body.sql !== 'string' || body.sql.trim() === '') {
    return json({ error: 'sql_required', details: [`one INSERT, UPDATE or DELETE naming a catalog table, for example public.rows`] }, 400);
  }
  const expected=body.expectedState===undefined?undefined:parseExpectedVersion(body,false);
  if(expected instanceof Response)return expected;
  const policyRevision=body.expectedPolicyRevision;
  if(policyRevision!==undefined&&(!Number.isSafeInteger(policyRevision)||Number(policyRevision)<0))return json({error:'invalid_expected_policy_revision',details:['expectedPolicyRevision must be the nonnegative policy_revision the artifact read answered']},400);
  const values: Record<string, Scalar> = {};
  if (body.values !== undefined) {
    if (!body.values || typeof body.values !== 'object' || Array.isArray(body.values)) {
      return json({ error: 'invalid_values', details: ['values must be an object of scalars'] }, 400);
    }
    for (const [k, v] of Object.entries(body.values as Record<string, unknown>)) {
      if (!isScalar(v)) return json({ error: 'invalid_values', details: [`value "${k}" must be a string, number, boolean or null`] }, 400);
      values[k] = v;
    }
  }

  // The built-ins read as they do in a document: `$_me.id` is the caller, `$_now` the moment, `$_tz` UTC.
  const { sql, fields } = rewriteBuiltinFields(body.sql);
  const builtins = bindParams([...fields.values(), '_now', '_tz'], platformValues({ userId: actor.userId ?? null, now: new Date().toISOString(), tz: 'UTC' }));
  const result = await mutateDataset(dataset, actor, sql, { ...values, ...builtins }, { receipt, expectedState: expected?.expectedState, ...(policyRevision!==undefined?{expectedPolicyRevision:policyRevision as number}:{}), paramTypes: bindTypes([...fields.values(), '_now', '_tz'], {}) });
  if (isMutationRefused(result)) {
    if(result.reason==='row_changed')return json({error:'row_changed',details:[result.detail]},409);
    if (result.reason === 'dataset_read_only' || result.reason === 'policy_denied') return json({error:result.reason,details:[result.detail]},403);
    if (result.reason === 'dataset_full') return json({ error: 'dataset_full', details: [result.detail] }, 409);
    // Contention is retryable, not an author error — never a 400.
    if (result.reason === 'contended' || result.reason === 'conflict') return json({ error: 'dataset_busy', details: [result.detail] }, 503, { 'Retry-After': '1' });
    return json({ error: 'invalid_sql', details: [result.detail] }, 400);
  }
  return json({ id: result.row.id, version: result.row.version, affected: result.affected, rowCount: result.rowCount });
}
