import { randomUUID } from 'node:crypto';
import type { GenerationRequest, DatasetPolicy } from '@artifactbin/contracts';
import { parseDatasetPolicy } from '@artifactbin/utils';
import { getDb } from '@/lib/db';
import { GENERATION_PUBLIC_POOLS } from '@/lib/config';
import { type ArtifactRow, type RoleActor } from '@/lib/artifacts';
import { recheckMutation, type MutationDocument } from './index';

export function generationGrant(
  policy: DatasetPolicy,
  request: GenerationRequest,
  document?: MutationDocument,
) {
  const grant = policy.execution?.generation;
  const functions = policy.execution?.functions;
  if (
    !grant ||
    functions?.deny?.some((x) =>
      ['llm', 'main.llm'].includes(x.toLowerCase()),
    ) ||
    (functions?.allow &&
      !functions.allow.some((x) =>
        ['llm', 'main.llm'].includes(x.toLowerCase()),
      ))
  )
    throw new Error('Generation is not permitted');
  if (
    !grant.models.includes(request.model) ||
    (grant.documents && (!document || !grant.documents.includes(document.id)))
  )
    throw new Error('Generation model or document is not approved');
  if (
    !request.options?.maxTokens ||
    request.options.maxTokens > grant.max_tokens
  )
    throw new Error(
      'Generation must specify maxTokens within the dataset allowance',
    );
  return grant;
}
/** Reserve before dispatch. Failed/timed-out calls remain charged; CAS replay
 * reuses the invocation cache. A new user request is a new invocation. */
export function generationAuthorization(
  dataset: ArtifactRow,
  actor: RoleActor,
  document?: MutationDocument,
) {
  const requestId = randomUUID();
  return async (request: GenerationRequest) => {
    await recheckMutation(dataset, actor, document);
    if (!dataset.dataset_policy) return;
    const policy = parseDatasetPolicy(dataset.dataset_policy),
      grant = generationGrant(policy, request, document);
    const pool = GENERATION_PUBLIC_POOLS[dataset.id];
    if (
      !pool ||
      !pool.models.includes(request.model) ||
      request.options!.maxTokens! > pool.maxTokens
    )
      throw new Error(
        'The operator has not authorized this generation allowance',
      );
    const db = await getDb();
    await db.transaction(async (tx) => {
      const updated = await tx.query(
        `UPDATE artifacts SET generation_calls=generation_calls+1 WHERE id=$1 AND policy_revision=$2 AND access='readwrite' AND deleted_at IS NULL AND generation_calls<$3 RETURNING id`,
        [dataset.id, dataset.policy_revision ?? 0, grant.max_calls],
      );
      if (!updated.rows.length)
        throw new Error('Generation allowance exhausted or revoked');
      const bucket = `generation:${dataset.id}:${new Date().toISOString().slice(0, 10)}`;
      const reserved = await tx.query(
        `INSERT INTO dataset_usage(bucket,calls) VALUES($1,1) ON CONFLICT(bucket) DO UPDATE SET calls=dataset_usage.calls+1 WHERE dataset_usage.calls<$2 RETURNING calls`,
        [bucket, pool.callsPerDay],
      );
      if (!reserved.rows.length)
        throw new Error('Daily generation allowance exhausted');
      await tx.query(`INSERT INTO dataset_usage(bucket,calls) VALUES($1,1)`, [
        `request:${requestId}:${request.key}`,
      ]);
    });
    await recheckMutation(dataset, actor, document);
  };
}
export async function throttlePublicMutation(datasetId: string) {
  const db = await getDb();
  const bucket = `mutation:${datasetId}:${Math.floor(Date.now() / 60000)}`;
  const result = await db.query(
    `INSERT INTO dataset_usage(bucket,calls) VALUES($1,1) ON CONFLICT(bucket) DO UPDATE SET calls=dataset_usage.calls+1 WHERE dataset_usage.calls<30 RETURNING calls`,
    [bucket],
  );
  if (!result.rows.length)
    throw new Error('Public mutation limit reached; try again in a minute.');
}
export async function generationUnavailable(
  dataset: ArtifactRow,
  documentId: string,
): Promise<string | null> {
  const policy = parseDatasetPolicy(dataset.dataset_policy),
    grant = policy.execution?.generation,
    pool = GENERATION_PUBLIC_POOLS[dataset.id];
  if (!grant) return 'Model generation requires a separate dataset grant.';
  if (grant.documents && !grant.documents.includes(documentId))
    return 'This document is not approved for generation.';
  if (!pool || !grant.models.some((m) => pool.models.includes(m)))
    return 'A server-authorized generation allowance is required.';
  if ((dataset.generation_calls ?? 0) >= grant.max_calls)
    return 'The dataset generation allowance is exhausted.';
  const db = await getDb();
  const used = await db.query<{ calls: number }>(
    'SELECT calls FROM dataset_usage WHERE bucket=$1',
    [`generation:${dataset.id}:${new Date().toISOString().slice(0, 10)}`],
  );
  if ((used.rows[0]?.calls ?? 0) >= pool.callsPerDay)
    return 'The daily generation allowance is exhausted.';
  return null;
}
