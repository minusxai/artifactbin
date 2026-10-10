import { grantMutationPolicy } from '@artifactbin/utils';
import { grantsOf, grantContext, grantsPermitWrite, type GrantDocument } from '@/lib/artifacts';
import {validateDatasetPolicyForRow} from '@/lib/datasets/policy/validation';
import { policySession, viewerMutationPolicy } from '@/lib/datasets/policy/viewer-policy';
import { canEdit, type DatasetAccessPolicy as DatasetPolicy, type DatasetMutationPolicy } from '@artifactbin/contracts';
import { parseDatasetAccessPolicy } from '@artifactbin/utils';
import { getDb } from '@/lib/platform/db';
import { canReadArtifact, effectiveRole } from '@/lib/artifacts';
import { editorScope, writerFor, type ArtifactRow } from '@/lib/artifacts';
import { groupMemberPredicate } from '@/lib/artifacts/table';
import type { TokenActor, RoleActor } from '@/lib/accounts';
import { getArtifactById, getArtifactFor } from '@/lib/artifacts';
import { catalogOf } from '@/lib/datasets/catalog';

/** One read-access fence for policy actions: sharing remains the only audience.
 * Identifiers/placeholders are owned by this module and its caller. */
export function policyReaderSql(user = '$13', token = '$14'): string {
  return `(artifacts.visibility<>'private' OR (artifacts.group_id IS NULL AND (artifacts.user_id=${user} OR (artifacts.user_id IS NULL AND artifacts.token_id=${token}))) OR ${groupMemberPredicate(user)}
   OR EXISTS (SELECT 1 FROM artifact_shares policy_reader WHERE policy_reader.artifact_id=artifacts.id
     AND (policy_reader.user_id=${user} OR (policy_reader.user_id IS NULL AND
       policy_reader.email=(SELECT email FROM users WHERE id=${user})))))`;
}
export async function canUseDataPolicy(
  dataset: ArtifactRow,
  actor: RoleActor,
): Promise<boolean> {
  if (!dataset.dataset_policy) return false;
  try {
    parseDatasetAccessPolicy(dataset.dataset_policy);
  } catch {
    return false;
  }
  const db = await getDb();
  const result = await db.query(
    `SELECT id FROM artifacts WHERE id=$1 AND deleted_at IS NULL
   AND policy_revision=$4 AND (${policyReaderSql('$2', '$3')})`,
    [dataset.id, actor.userId, actor.tokenId, dataset.policy_revision ?? 0],
  );
  return result.rows.length > 0;
}
export async function setDatasetPolicy(
  actor: TokenActor,
  id: string,
  value: unknown,
  revision: number,
): Promise<
  { revision: number; policy: DatasetPolicy | null } | { conflict: true } | null
> {
  const row = await getArtifactFor(actor, id);
  if (!row || row.format !== 'dataset' || catalogOf(row)?.kind === 'postgres')
    return null;
  if (!Number.isSafeInteger(revision) || revision < 0)
    throw new Error('expectedPolicyRevision must be a nonnegative integer');
  const policy = validateDatasetPolicyForRow(row,value);
  const db = await getDb(),
    scope = editorScope(actor);
  const result = await db.query<{ policy_revision: number }>(
    `WITH updated AS (
 UPDATE artifacts SET dataset_policy=$3::jsonb,policy_revision=policy_revision+1
 WHERE id=$1 AND ${scope.where('$2')} AND policy_revision=$4 AND deleted_at IS NULL
 AND version=$7 AND edit_id=$8 AND sharing_revision=$9
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
      row.version,
      row.edit_id,
      row.sharing_revision ?? 0,
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
  declared: boolean | GrantDocument,
): Promise<DatasetMutationPolicy | undefined> {
  if (!dataset.dataset_policy) return undefined;
  const policy = parseDatasetAccessPolicy(dataset.dataset_policy);
  if(policy.version===2){
    const context=await grantContext(dataset,actor,typeof declared==='object'?declared:undefined);
    const selected=grantMutationPolicy(policy,context,table,policySession(actor.userId));
    if(!selected)throw new Error('No policy permits writes to this table');
    return selected;
  }
  if (
    !declared &&
    !(await getArtifactFor(
      { userId: actor.userId, tokenId: actor.tokenId ?? '' },
      dataset.id,
    ))
  )
    throw new Error('Direct SQL requires dataset edit access');
  if (!(await canUseDataPolicy(dataset, actor)))
    throw new Error('Dataset view access is required');
  const selected = viewerMutationPolicy(
    policy,
    table,
    policySession(actor.userId),
  );
  if (!selected) throw new Error('No policy permits writes to this table');
  return selected;
}
export async function recheckMutation(
  dataset: ArtifactRow,
  actor: RoleActor,
  document?: GrantDocument,
): Promise<ArtifactRow> {
  const current = await getArtifactById(dataset.id);
  if(current && grantsOf(current)){
    if((current.policy_revision??0)!==(dataset.policy_revision??0)||!(await grantsPermitWrite(current,actor,document)))throw new Error('Mutation permission changed');
    return current;
  }
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

// ── Writable datasets ────────────────────────────────────────────────────────

/** Why a write may not happen. Each names the fix; none is an existence oracle. */
export type WriteRefusal = 'not_a_dataset' | 'dataset_read_only';

/** The dataset must allow writes AND the current actor must hold its editor role. */
export async function canWriteDataset(dataset: ArtifactRow, actor: RoleActor, declared: boolean | GrantDocument = false): Promise<WriteRefusal | null> {
  if (dataset.format !== 'dataset') return 'not_a_dataset';
  if(catalogOf(dataset)?.kind==='postgres')return 'dataset_read_only';
  if(grantsOf(dataset))return await grantsPermitWrite(dataset,actor,typeof declared==='object'?declared:undefined)?null:'dataset_read_only';
  // An unreachable dataset is reported as read-only, never as "not yours":
  // the caller answers a uniform 404 for anything it could not resolve, and
  // this one it could — the document names it, so its existence is not news.
  if (!canEdit(await effectiveRole(dataset, actor)) && !(declared && await canUseDataPolicy(dataset, actor))) return 'dataset_read_only';
  return dataset.access === 'readwrite' ? null : 'dataset_read_only';
}
