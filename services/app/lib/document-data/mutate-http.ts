/**
 * THE DATASET WRITE DOOR over HTTP: the owner's direct statement against a dataset they may write, and
 * a document's declared mutation run by name (the bearer twin of the page door). Both answer the same
 * refusal shapes the routes and the CLI read.
 */
import type { TokenActor } from '@/lib/accounts';
import { canReadArtifact, getArtifactById, getArtifactFor, grantsOf, grantsPermitWrite, ownsArtifact, parseExpectedVersion, readableArtifact, type MutationReceipt } from '@/lib/artifacts';
import { bindParams, bindTypes, parseMutationRequest, platformValues, type Scalar } from '@/lib/dataflow';
import { rewriteBuiltinFields } from '@/lib/dataflow/server';
import { json } from '@/lib/http/http';
import { runDocumentMutation } from './dataflow';
import { canWriteDataset } from './dataset-policy';
import { isMutationRefused, mutateDataset } from './dataset-mutate';
import { adaptMutationOperationReply, documentMutationReply } from './mutation-operation';

const isScalar = (v: unknown): v is Scalar =>
  v === null || typeof v === 'string' || typeof v === 'boolean' || (typeof v === 'number' && Number.isFinite(v));

/** A document's declared mutation, run by name with its arguments — the bearer twin of the page door. */
async function respondToDeclaredMutation(actor: TokenActor, id: string, body: Record<string, unknown>, receipt?: MutationReceipt): Promise<Response> {
  const row = await getArtifactById(id);
  if (!row || row.deleted_at || !(ownsArtifact(row,actor) || (await canReadArtifact(row, actor.userId ? { userId: actor.userId, email: null } : null)))) return json({ error: 'not_found' }, 404);
  const { name, id: _id, ...rest } = body;
  const parsed = parseMutationRequest({ ...rest, mutation: name });
  if (parsed instanceof Response) return json(await parsed.json(), 400);
  const result = await runDocumentMutation(row, parsed, { userId: actor.userId, tokenId: actor.tokenId }, receipt);
  if (!result.ok) {
    switch (result.reason) {
      case 'operation_key_required': return json({error:'operation_key_required',detail:result.detail},400);
      case 'unknown_mutation': return json({ error: 'unknown_mutation', details: [`this document declares no <Mutation name="${String(body.name)}">`] }, 400);
      case 'invalid_row': return json({ error: 'invalid_row', details: [result.detail ?? ''] }, 400);
      case 'row_changed': case 'row_not_unique': return json({ error: result.reason, details: [result.detail ?? ''] }, 409);
      case 'dataset_full': return json({ error: 'dataset_full', details: [result.detail ?? ''] }, 409);
      case 'contended': return json({ error: 'dataset_busy', details: [result.detail ?? ''] }, 503, { 'Retry-After': '1' });
      case 'policy_denied': return json({ error: 'policy_denied', details: [result.detail ?? ''] }, 403);
      case 'invalid_sql': return json({ error: 'mutation_failed', details: [result.detail ?? ''] }, 400);
      default: return json({ error: 'dataset_read_only', details: ['You need edit access to a writable dataset to make this change.'] }, 403);
    }
  }
  if ('local' in result) return json({ ok: true, local: result.local });
  const reply=adaptMutationOperationReply(documentMutationReply({datasetId:result.dataset.id,datasetEditId:result.dataset.edit_id,version:result.dataset.version,affected:result.affected,rowCount:result.rowCount,...(result.mutationRunId?{mutationRunId:result.mutationRunId}:{})}),'api');
  return json(reply.body,reply.status);
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
  actor: TokenActor,
  id: string,
  body: Record<string, unknown> | null,
  receipt?:MutationReceipt,
): Promise<Response> {
  if (body && typeof body.name === 'string') return respondToDeclaredMutation(actor, id, body, receipt);
  const found = await getArtifactById(id);
  const dataset = found&&grantsOf(found)&&(await grantsPermitWrite(found,actor)||await readableArtifact(actor,id))?found:await getArtifactFor(actor,id);
  if (!dataset) return json({ error: 'not_found' }, 404);

  const refusal = await canWriteDataset(dataset, actor);
  if (refusal === 'not_a_dataset') {
    return json({ error: 'not_a_dataset', details: [`${id} is a ${dataset.format} artifact — only datasets hold rows to write`] }, 400);
  }
  if (refusal) {
    return json({
      error: 'dataset_read_only',
      details: [grantsOf(dataset)?'No grant allows this direct write. Use an allowed saved artifact action, or ask a dataset editor to add a user grant for this operation. See afbin help apps.':`${id} is read-only — publish it writable: afbin push <file> --type dataset --access readwrite (API: PUT here, or PATCH /api/my/artifacts/${id})`],
    }, 403);
  }

  if (!body) return json({ error: 'invalid_json' }, 400);
  if (typeof body.sql !== 'string' || body.sql.trim() === '') {
    return json({ error: 'sql_required', details: [`one INSERT, UPDATE or DELETE naming a catalog table, for example public.rows`] }, 400);
  }
  const expected=body.expectedState===undefined?undefined:parseExpectedVersion(body,false);
  if(expected instanceof Response)return expected;
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
  const result = await mutateDataset(dataset, actor, sql, { ...values, ...builtins }, { receipt, expectedState: expected?.expectedState, paramTypes: bindTypes([...fields.values(), '_now', '_tz'], {}) });
  if (isMutationRefused(result)) {
    if(result.reason==='row_changed')return json({error:'row_changed',details:[result.detail]},409);
    if (result.reason === 'dataset_read_only' || result.reason === 'policy_denied') return json({error:result.reason,details:[result.detail]},403);
    if (result.reason === 'dataset_full') return json({ error: 'dataset_full', details: [result.detail] }, 409);
    // Contention is retryable, not an author error — never a 400.
    if (result.reason === 'contended') return json({ error: 'dataset_busy', details: [result.detail] }, 503, { 'Retry-After': '1' });
    return json({ error: 'invalid_sql', details: [result.detail] }, 400);
  }
  return json({ id: result.row.id, version: result.row.version, affected: result.affected, rowCount: result.rowCount });
}
