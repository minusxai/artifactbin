/**
 * A DATASET WRITE'S COMMIT — the one guarded statement behind lib/document-data/dataset-mutate, which has
 * already run the author's DML and stored the rows it produced. Inside the caller's transaction (or as its
 * single statement), it:
 *  - swaps the head to `meta` if and only if the rows the caller read are still the head (`edit_id`), the
 *    policy revision is unchanged, and the actor may still write: the editor scope, or the dataset policy's
 *    viewer role, or (with `granted`) grants the caller already checked inside this transaction; and a
 *    declared document still at its attested edit can still reach the dataset;
 *  - archives the previous state, coalesced on the edit protocol's window;
 *  - notifies the dataset's live channel with the new edit id.
 * No row is a lost compare-and-swap or revoked access, both of which the caller handles by re-reading.
 */
import type { AccessActor } from '@/lib/accounts';
import type { Queryable } from '@artifactbin/contracts';
import { newEditId } from '../document';
import { artifactQuery } from './document';
import { LIVE_ARTIFACT_SQL, editorScope, groupMemberPredicate, headBumpSql, notifyArtifactSql, policyReaderSql, type ArtifactRow } from './table';

/** How long after the last archived version a write reuses that snapshot (matches the edit protocol). */
const WRITE_SNAPSHOT_WINDOW_MS = 120_000;

export interface DatasetCommit {
  /** The head the caller read and computed `meta` from. */
  current: ArtifactRow;
  actor: AccessActor;
  meta: Record<string, unknown>;
  /** The document a declared mutation runs through, at the edit the caller attested. */
  document?: { id: string; editId: string };
  /** The dataset policy's role for this write (`viewer` admits a policy reader), null for an editor's write. */
  policyRole: string | null;
  /** A declared (document or native) write that a policy admitted: a policy viewer needs no editor scope. */
  policyDeclared: boolean;
  /** Grants (policy version 2) were checked inside this transaction: access and editor scope are not re-asked. */
  granted: boolean;
}

export async function commitDatasetWrite(q: Queryable, commit: DatasetCommit): Promise<ArtifactRow | undefined> {
  const { current, actor, meta, document } = commit;
  const scope = editorScope(actor);
  const result = await artifactQuery<ArtifactRow>(q,
    `WITH updated AS (
       UPDATE artifacts
          SET meta = $3::jsonb, ${headBumpSql('$4', '$12', '$13')}
        WHERE id = $1 AND edit_id = $2 AND ($20::boolean OR access = 'readwrite') AND ${LIVE_ARTIFACT_SQL}
          AND policy_revision=$15 AND ($20::boolean OR (
            ($19::text IS NULL AND (${scope.where('$14')})) OR
            ($19='viewer' AND (${policyReaderSql('$12', '$13')}) AND ($18::boolean OR (${scope.where('$14')})))
          )
          ) AND ($20::boolean OR $16::text IS NULL OR EXISTS (
            SELECT 1 FROM artifacts d WHERE d.id=$16 AND d.edit_id=$17 AND d.deleted_at IS NULL
            AND (
              (d.group_id IS NOT NULL AND artifacts.group_id=d.group_id) OR
              (d.group_id IS NULL AND d.user_id IS NULL AND artifacts.group_id IS NULL AND artifacts.user_id IS NULL AND artifacts.token_id=d.token_id) OR
              (d.group_id IS NULL AND d.user_id IS NOT NULL AND ((artifacts.group_id IS NULL AND artifacts.user_id=d.user_id) OR
                (artifacts.visibility<>'private' AND artifacts.link_role='editor') OR EXISTS (
                  SELECT 1 FROM artifact_shares writer_share WHERE writer_share.artifact_id=artifacts.id
                  AND writer_share.role='editor' AND (writer_share.user_id=d.user_id OR
                    (writer_share.user_id IS NULL AND writer_share.email=(SELECT email FROM users WHERE id=d.user_id)))
                )))
            )
            AND (d.visibility <> 'private' OR (d.group_id IS NULL AND (d.user_id=$12 OR (d.user_id IS NULL AND d.token_id=$13))) OR ${groupMemberPredicate('$12',undefined,'d')} OR EXISTS (
              SELECT 1 FROM artifact_shares s WHERE s.artifact_id=d.id AND
              (s.user_id=$12 OR (s.user_id IS NULL AND s.email=(SELECT email FROM users WHERE id=$12)))
            ))
          ))
        RETURNING *
     ), archived AS (
       INSERT INTO artifact_versions (artifact_id, version, title, description, format, source, meta)
       SELECT $1, $5, $6, $7, $8, $9, $10::jsonb
        WHERE EXISTS (SELECT 1 FROM updated)
          AND NOT EXISTS (
            SELECT 1 FROM artifact_versions
             WHERE artifact_id = $1 AND created_at > now() - ($11::int * interval '1 millisecond')
          )
       ON CONFLICT DO NOTHING
     )
     SELECT u.*, ${notifyArtifactSql('u.id', 'u.edit_id')} FROM updated u`,
    [
      current.id, current.edit_id, JSON.stringify(meta), newEditId(),
      current.version, current.title, current.description, current.format, current.source,
      JSON.stringify(current.meta), WRITE_SNAPSHOT_WINDOW_MS,
      actor.userId, actor.tokenId, scope.val, current.policy_revision??0, document?.id??null, document?.editId??null, commit.policyDeclared, commit.policyRole, commit.granted,
    ],
  );
  return result.rows[0];
}
