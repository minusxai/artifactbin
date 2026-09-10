import type {
  DatasetPolicy,
  DatasetMutationPolicy,
  Scalar,
} from '@artifactbin/contracts';
import { parseDatasetPolicy, compilePolicyPredicate } from '@artifactbin/utils';
import { getDb } from '@/lib/db';
import {
  getOwnedArtifactFor,
  ownerPredicate,
  effectiveRole,
  canWriteDataset,
  getArtifactById,
  getArtifactFor,
  writerFor,
  canReadArtifact,
  type ArtifactRow,
  type TokenActor,
  type RoleActor,
} from '@/lib/artifacts';
import { catalogOf } from '@/lib/datasets/catalog';
import { canEdit } from '@/lib/share-roles';

export function publicMutationGrant(dataset: ArtifactRow): boolean {
  try {
    return (
      !!dataset.dataset_policy &&
      !!parseDatasetPolicy(dataset.dataset_policy).delegated_mutations
    );
  } catch {
    return false;
  }
}
export async function setDatasetPolicy(
  actor: TokenActor,
  id: string,
  value: unknown,
  revision: number,
): Promise<
  { revision: number; policy: DatasetPolicy | null } | { conflict: true } | null
> {
  const row = await getOwnedArtifactFor(actor, id);
  if (!row || row.format !== 'dataset' || catalogOf(row)?.kind === 'postgres')
    return null;
  if (!Number.isSafeInteger(revision) || revision < 0)
    throw new Error('expectedPolicyRevision must be a nonnegative integer');
  const policy = value === null ? null : parseDatasetPolicy(value);
  if (policy) {
    const tables = catalogOf(row)?.tables ?? [
      {
        schema: 'public',
        name: 'rows',
        columns: (row.meta.columns ?? []) as Array<{ name: string }>,
      },
    ];
    for (const t of policy.tables) {
      const target = tables.find(
        (x) => x.schema === t.table.schema && x.name === t.table.name,
      );
      if (!target) throw new Error('Policy table is not in this dataset');
      const columns = target.columns.map((c) => c.name);
      for (const entry of [
        ...(t.insert_permissions ?? []),
        ...(t.update_permissions ?? []),
        ...(t.delete_permissions ?? []),
      ]) {
        const p = entry.permission;
        if (
          'columns' in p &&
          p.columns !== undefined &&
          p.columns !== '*' &&
          p.columns.some((c) => !columns.includes(c))
        )
          throw new Error('Unknown permission column');
        for (const field of ['filter', 'check'] as const)
          if (field in p && p[field as keyof typeof p]) {
            // Validate field names now; trusted session values are available only at execution.
            const session: Record<string, Scalar> = {
              'x-hasura-user-id': 'validation',
              'x-hasura-role': entry.role,
            };
            compilePolicyPredicate(
              (
                p as {
                  filter?: Record<string, unknown>;
                  check?: Record<string, unknown>;
                }
              )[field]!,
              columns,
              session,
            );
          }
        if (
          'set' in p &&
          p.set &&
          Object.keys(p.set).some((c) => !columns.includes(c))
        )
          throw new Error('Unknown preset column');
      }
    }
  }
  const db = await getDb(),
    scope = ownerPredicate(actor);
  const result = await db.query<{ policy_revision: number }>(
    `WITH updated AS (
 UPDATE artifacts SET dataset_policy=$3::jsonb,policy_revision=policy_revision+1
 WHERE id=$1 AND ${scope.where('$2')} AND policy_revision=$4 AND deleted_at IS NULL
 RETURNING *), audit AS (
 INSERT INTO dataset_policy_audit(dataset_id,revision,policy,actor_user_id,actor_token_id)
 SELECT id,policy_revision,dataset_policy,$5,$6 FROM updated)
 SELECT policy_revision,pg_notify('artifact_' || lower(id),edit_id) FROM updated`,
    [
      id,
      scope.val,
      JSON.stringify(policy),
      revision,
      actor.userId,
      actor.tokenId,
    ],
  );
  return result.rows[0]
    ? { revision: result.rows[0].policy_revision, policy }
    : { conflict: true };
}
export async function mutationPolicy(
  dataset: ArtifactRow,
  actor: RoleActor,
  table: { schema: string; name: string },
  declared: boolean,
): Promise<DatasetMutationPolicy | undefined> {
  if (!dataset.dataset_policy) return undefined;
  const policy = parseDatasetPolicy(dataset.dataset_policy);
  const role = canEdit(await effectiveRole(dataset, actor))
    ? 'editor'
    : 'visitor';
  if (role === 'visitor' && (!declared || !policy.delegated_mutations))
    throw new Error('Public mutation permission is required');
  const selected = policy.tables.find(
    (t) => t.table.schema === table.schema && t.table.name === table.name,
  );
  if (!selected) throw new Error('No policy permits writes to this table');
  return {
    table: selected,
    role,
    session: {
      'x-hasura-role': role,
      ...(actor.userId ? { 'x-hasura-user-id': actor.userId } : {}),
    },
    operations:
      role === 'visitor'
        ? policy.delegated_mutations!.operations
        : ['insert', 'update', 'delete'],
    execution: policy.execution,
  };
}
export interface MutationDocument {
  id: string;
  editId: string;
}
export async function recheckMutation(
  dataset: ArtifactRow,
  actor: RoleActor,
  document?: MutationDocument,
): Promise<ArtifactRow> {
  const current = await getArtifactById(dataset.id);
  if (
    !current ||
    (current.policy_revision ?? 0) !== (dataset.policy_revision ?? 0) ||
    (await canWriteDataset(current, actor, !!document))
  )
    throw new Error('Mutation permission changed');
  if (document) {
    const doc = await getArtifactById(document.id);
    if (
      !doc ||
      doc.edit_id !== document.editId ||
      !(await canReadArtifact(
        doc,
        actor.userId
          ? { userId: actor.userId, email: actor.email ?? null }
          : null,
      ))
    )
      throw new Error('Document access or mutation changed');
    if (!(await getArtifactFor(writerFor(doc), dataset.id)))
      throw new Error('Document no longer has dataset access');
  }
  return current;
}
