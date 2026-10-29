import type { AccessActor } from '@/lib/accounts';
import type { Queryable } from '@artifactbin/contracts';
import { editorScope, notifyArtifactSql, type ArtifactRow } from '../table';

/**
 * Store a validated dataset policy on the head `row` the caller read: only while the row is still exactly
 * that head (version, edit id, sharing revision), its policy revision is still `revision`, and the actor
 * still reaches it as an editor. Bumps the policy revision, audits the actor and notifies the row's channel;
 * null when any of that no longer holds (a conflict for the caller to answer).
 */
export async function commitDatasetPolicy(q: Queryable, actor: AccessActor, row: ArtifactRow, policy: unknown, revision: number): Promise<number | null> {
  const scope = editorScope(actor);
  const result = await q.query<{ policy_revision: number }>(
    `WITH updated AS (
 UPDATE artifacts SET dataset_policy=$3::jsonb,policy_revision=policy_revision+1
 WHERE id=$1 AND ${scope.where('$2')} AND policy_revision=$4 AND deleted_at IS NULL
 AND version=$7 AND edit_id=$8 AND sharing_revision=$9
 RETURNING *), audit AS (
 INSERT INTO dataset_policy_audit(dataset_id,revision,policy,actor_user_id,actor_token_id)
 SELECT id,policy_revision,dataset_policy,$5,$6 FROM updated)
 SELECT policy_revision,${notifyArtifactSql('id', 'edit_id')} FROM updated`,
    [row.id, scope.val, JSON.stringify(policy), revision, actor.userId, actor.tokenId, row.version, row.edit_id, row.sharing_revision ?? 0],
  );
  return result.rows[0]?.policy_revision ?? null;
}
