/**
 * THE TRASH — deleting an artifact stamps `deleted_at` and nothing else, and
 * that is the END of it. NOTHING IN THIS PRODUCT ERASES A ROW: there is no
 * retention, no purge and no sweep, so `deleted_at` set is a terminal state
 * that only `restoreArtifactFor` clears. The consequences are stated rather
 * than hidden — a deleted document still counts against its owner's quota
 * (lib/asset-quota, `artifactQuotaExceeded`), and erasing something for a
 * legal request is an administrative act on the database, outside the product.
 *
 * The whole design is ONE GATE and one exception to it. The gate is
 * `LIVE_ARTIFACT_SQL`, composed into the row-loading seam (lib/artifacts: the
 * `Scope` constructors and the unscoped row reads) and imported by name in the
 * few readers that do not come through it, so a trashed row is the uniform 404
 * everywhere without a single caller remembering to say so. The exception is
 * THIS MODULE, which reads past the gate through `ownerPredicate`, because the
 * trash listing and restore are the readers the rows are kept for.
 *
 * A delete acts on a SUBTREE in one statement (placement is `ancestor_ids`), and restore reverses
 * the ACT rather than the containment: one delete stamps one `now()`, and restore takes back only
 * the rows carrying that stamp. The queries below state the rest.
 */
import { trackEvent } from '@/lib/analytics';
import { LIVE_ARTIFACT_SQL, ownerPredicate, type TokenActor } from '@/lib/artifacts';
import { getDb } from '@/lib/db';
import { actorSubject, emit } from '@/lib/events';
import { ancestorsForMove, notifyParent, parentOf } from '@/lib/folders';

/** The row and everything under it — a document matches only itself. */
const SUBTREE = '(id = $1 OR ancestor_ids @> ARRAY[$1])';

/**
 * The pre-read that authorizes a delete or a restore BEFORE an idempotency
 * receipt is claimed — the third reader these trashed rows are kept for.
 *
 * It reads past `LIVE_ARTIFACT_SQL` for the same reason the trash listing does:
 * the state an authorization check sees flips as the operation runs (delete
 * makes the row trashed, restore makes it live), so a check that only saw live
 * rows would refuse exactly the retry it exists to let through. Ownership, not
 * liveness, is the question; null means unknown or foreign.
 */
export async function ownedArtifactState(actor: TokenActor, id: string): Promise<{ deleted: boolean } | null> {
  const db = await getDb();
  const scope = ownerPredicate(actor);
  const found = await db.query<{ deleted_at: string | null }>(
    `SELECT deleted_at FROM artifacts WHERE id = $1 AND (${scope.where('$2')})`,
    [id, scope.val],
  );
  const row = found.rows[0];
  return row ? { deleted: row.deleted_at !== null } : null;
}

/**
 * `SET deleted_at = now()` on the row — and, for a folder, over its whole
 * subtree in ONE statement, which is what makes deleting a folder full of
 * documents an ordinary write rather than a refusal to be forced past.
 *
 * The owner predicate is in the same WHERE as the containment, so the subtree
 * this takes is only ever the caller's own; null means the NAMED row is unknown or foreign. Repeating an owned delete
 * returns its still-deleted identities without stamping another deletion.
 */
export async function trashArtifactFor(actor: TokenActor, id: string): Promise<string[] | null> {
  const db = await getDb();
  const scope = ownerPredicate(actor);
  const r = await db.query<{id:string;format:string;ancestor_ids:string[];newly_deleted:boolean}>(
    `WITH target AS (
      SELECT deleted_at AS stamp FROM artifacts WHERE id=$1 AND (${scope.where('$2')})
    ), removed AS (
      UPDATE artifacts SET deleted_at=now()
      WHERE ${SUBTREE} AND ${LIVE_ARTIFACT_SQL} AND (${scope.where('$2')})
        AND EXISTS (SELECT 1 FROM target WHERE stamp IS NULL)
      RETURNING id,format,ancestor_ids
    )
    SELECT id,format,ancestor_ids,true AS newly_deleted FROM removed
    UNION ALL
    SELECT id,format,ancestor_ids,false AS newly_deleted FROM artifacts,target
    WHERE ${SUBTREE} AND (${scope.where('$2')}) AND target.stamp IS NOT NULL AND deleted_at=target.stamp`,
    [id,scope.val],
  );
  const named = r.rows.find((row) => row.id === id);
  if (!named) return null;
  /*
   * `deleted`, said HERE, because this is the only delete there is. The count
   * is what the statement above actually took, so a folder's sentence says how
   * much went with it and a document's says nothing went — and the legacy
   * `analytics_events` row rides on the same call, which is why it is
   * trackEvent rather than a bare emit.
   *
   * Fire-and-forget, and never inside a transaction (PGLite deadlock).
   */
  if(named.newly_deleted){
    void trackEvent('delete', id, { userId: actor.userId, format: named.format, subtree: r.rows.length - 1 });
    await notifyParent(parentOf(named));
  }
  return r.rows.map(row=>row.id);
}

/**
 * `SET deleted_at = NULL` over the act this row was trashed in (see the header
 * for why the stamp and not the containment), re-rooting the row when the
 * parent it names is not there to go back to.
 *
 * Answers the row's placement AFTER the restore, so a caller can say where it
 * landed; null when the id is unknown, foreign, or not in the trash.
 */
export async function restoreArtifactFor(actor: TokenActor, id: string): Promise<{ id: string; ancestor_ids: string[] } | null> {
  const db = await getDb();
  const scope = ownerPredicate(actor);
  const placement = await db.transaction(async (tx) => {
    const found = await tx.query<{ ancestor_ids: string[]; deleted_at: string }>(
      `SELECT ancestor_ids, deleted_at FROM artifacts
        WHERE id = $1 AND deleted_at IS NOT NULL AND (${scope.where('$2')})`,
      [id, scope.val],
    );
    const row = found.rows[0];
    if (!row) return null;
    await tx.query(
      `UPDATE artifacts SET deleted_at = NULL
        WHERE (id = $1 OR (ancestor_ids @> ARRAY[$1] AND deleted_at = $3))
          AND deleted_at IS NOT NULL AND (${scope.where('$2')})`,
      [id, scope.val, row.deleted_at],
    );
    const trail = row.ancestor_ids ?? [];
    if (!trail.length) return trail;
    // A trail is only a placement while every id in it is still there to hold
    // it: an ancestor still in the trash (or purged out of existence) makes
    // this row's address a chain of nothing, so it comes back at the root.
    const live = await tx.query<{ n: number }>(
      `SELECT COUNT(*)::int AS n FROM artifacts WHERE id = ANY($1::text[]) AND ${LIVE_ARTIFACT_SQL}`,
      [trail],
    );
    if ((live.rows[0]?.n ?? 0) === trail.length) return trail;
    // The descendants FIRST, while they still carry the old prefix — the same
    // one-statement swap a move runs, so the trail invariant holds all the way
    // down rather than only on the row somebody asked about.
    const swap = ancestorsForMove({ id, ancestor_ids: trail }, []);
    await tx.query(swap.sql, swap.params);
    await tx.query(`UPDATE artifacts SET ancestor_ids = '{}'::text[] WHERE id = $1`, [id]);
    return [] as string[];
  });
  if (!placement) return null;
  await notifyParent(placement.length ? placement[placement.length - 1] : null);
  // Where it LANDED, which is the one thing a restore can surprise someone
  // with: a row whose folder is still in the trash comes back at the root.
  void emit(actorSubject(actor), 'restored', { kind: 'artifact', id }, { landed_at_root: placement.length === 0 });
  return { id, ancestor_ids: placement };
}

/** One row of the owner's trash. */
interface TrashEntry {
  id: string;
  title: string | null;
  format: string;
  version: number;
  deleted_at: string;
}

/** The owner's trash, newest first — what the trash page lists. */
export async function listTrashFor(actor: TokenActor): Promise<TrashEntry[]> {
  const db = await getDb();
  const scope = ownerPredicate(actor);
  const r = await db.query<TrashEntry>(
    `SELECT id, title, format, version, deleted_at FROM artifacts
      WHERE deleted_at IS NOT NULL AND (${scope.where('$1')})
      ORDER BY deleted_at DESC, updated_at DESC LIMIT 200`,
    [scope.val],
  );
  return r.rows;
}
