import {getDb} from '@/lib/db';
import {
  getArtifactFor,
  getSharingFor,
  type TokenActor,
} from '@/lib/artifacts';
import { catalogOf } from '@/lib/datasets/catalog';
import { json, readJson } from '@/lib/http';
import { setDatasetPolicy } from './index';

export async function readDatasetPolicy(
  actor: TokenActor,
  id: string,
): Promise<Response> {
  const row = await getArtifactFor(actor, id);
  if (!row || row.format !== 'dataset')
    return json({ error: 'not_found' }, 404);
  return json({
    people:(await (await getDb()).query<{user_id:string;username:string|null;name:string|null}>(`SELECT id AS user_id,username,name FROM users u WHERE id=$1 OR EXISTS(SELECT 1 FROM relations r WHERE r.verb='follow' AND r.subject_kind='user' AND r.object_kind='user' AND r.deleted_at IS NULL AND ((r.subject_id=u.id AND r.object_id=$1)OR(r.object_id=u.id AND r.subject_id=$1))) ORDER BY username LIMIT 100`,[actor.userId])).rows,
    canManage: true,
    policy: row.dataset_policy ?? null,
    revision: row.policy_revision ?? 0,
    tables: catalogOf(row)?.tables.map((t) => ({
      schema: t.schema,
      name: t.name,
      columns: t.columns,
    })) ?? [
      { schema: 'public', name: 'rows', columns: row.meta.columns ?? [] },
    ],
    writtenBy: (await getSharingFor(actor, id))?.writtenBy ?? [],
  });
}
export async function writeDatasetPolicy(
  actor: TokenActor,
  id: string,
  body: Record<string, unknown>,
): Promise<Response> {
  if (!Object.hasOwn(body, 'policy'))
    return json({ error: 'invalid_policy' }, 400);
  try {
    const result = await setDatasetPolicy(
      actor,
      id,
      body.policy,
      body.expectedPolicyRevision as number,
    );
    if (!result) return json({ error: 'not_found' }, 404);
    if ('conflict' in result)
      return json(
        {
          error: 'policy_changed',
          detail: 'Reload the current policy before saving.',
        },
        409,
      );
    return json(result);
  } catch (error) {
    return json(
      {
        error: 'invalid_policy',
        detail: error instanceof Error ? error.message : 'Invalid policy',
      },
      400,
    );
  }
}
export async function datasetPolicyRequest(
  request: Request,
  actor: TokenActor,
  id: string,
): Promise<Response> {
  if (request.method === 'GET') return readDatasetPolicy(actor, id);
  const body = await readJson(request);
  return body
    ? writeDatasetPolicy(actor, id, body)
    : json({ error: 'invalid_json' }, 400);
}
