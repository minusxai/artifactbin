/**
 * THE TRASH'S WRITES, for lib/workspace's trash (which owns the delete/restore acts, their authorization
 * reads, events and wakeups). Each is scoped by `ownerPredicate(actor)` — the one scope that reads past the
 * trash gate — so a subtree is only ever the actor's own rows.
 */
import type { AccessActor } from '@/lib/accounts';
import type { Queryable } from '@artifactbin/contracts';
import { ancestorsForMove } from './placement';
import { LIVE_ARTIFACT_SQL, ownerPredicate } from './table';

/** The row and everything under it — a document matches only itself. */
const SUBTREE = '(id = $1 OR ancestor_ids @> ARRAY[$1])';

interface TrashedRow { id: string; format: string; ancestor_ids: string[]; newly_deleted: boolean }

/**
 * Stamp one `now()` on the live rows of `id`'s subtree, in one statement, unless `id` is already in the trash:
 * then answer the rows that its deletion stamped, `newly_deleted` false. Empty when `id` is not the actor's.
 */
export async function trashSubtree(q: Queryable, actor: AccessActor, id: string): Promise<TrashedRow[]> {
  const owner = ownerPredicate(actor);
  return (await q.query<TrashedRow>(
    `WITH target AS (
      SELECT deleted_at AS stamp FROM artifacts WHERE id=$1 AND (${owner.where('$2')})
    ), removed AS (
      UPDATE artifacts SET deleted_at=now()
      WHERE ${SUBTREE} AND ${LIVE_ARTIFACT_SQL} AND (${owner.where('$2')})
        AND EXISTS (SELECT 1 FROM target WHERE stamp IS NULL)
      RETURNING id,format,ancestor_ids
    )
    SELECT id,format,ancestor_ids,true AS newly_deleted FROM removed
    UNION ALL
    SELECT id,format,ancestor_ids,false AS newly_deleted FROM artifacts,target
    WHERE ${SUBTREE} AND (${owner.where('$2')}) AND target.stamp IS NOT NULL AND deleted_at=target.stamp`,
    [id, owner.val],
  )).rows;
}

/** Clear the trash stamp on `id` and on the descendants its deletion stamped (`stamp`), never on rows trashed by another act. */
export async function restoreTrashedSubtree(tx: Queryable, actor: AccessActor, id: string, stamp: string): Promise<void> {
  const owner = ownerPredicate(actor);
  await tx.query(
    `UPDATE artifacts SET deleted_at = NULL
      WHERE (id = $1 OR (ancestor_ids @> ARRAY[$1] AND deleted_at = $3))
        AND deleted_at IS NOT NULL AND (${owner.where('$2')})`,
    [id, owner.val, stamp],
  );
}

/** File `row` (and, by the same prefix swap a move runs, everything under it) at the root. */
export async function rerootArtifact(tx: Queryable, row: { id: string; ancestor_ids: string[] }): Promise<void> {
  // The descendants FIRST, while they still carry the old prefix, so the trail invariant holds all the way down.
  const swap = ancestorsForMove(row, []);
  await tx.query(swap.sql, swap.params);
  await tx.query(`UPDATE artifacts SET ancestor_ids = '{}'::text[] WHERE id = $1`, [row.id]);
}
