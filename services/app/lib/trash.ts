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
 * Three consequences worth stating, each of which is why this is a module and
 * not three statements spread over the doors:
 *
 *  - A FOLDER IS ONE STATEMENT, not a walk. Placement is `ancestor_ids`, so
 *    "this row and everything under it" is `id = $1 OR ancestor_ids @> ARRAY[$1]`,
 *    and the owner predicate rides in the same WHERE — a stranger's document
 *    filed under this folder is left alone rather than deleted on the way past.
 *  - RESTORE REVERSES THE ACT, not the containment. One UPDATE stamps one
 *    `now()` across the subtree, so the rows of one delete share a timestamp
 *    exactly; restore takes back the rows carrying THAT stamp. A document
 *    trashed last week that happened to live in the folder stays in the trash,
 *    where its owner put it.
 *  - A RESTORED ROW WHOSE PARENT IS STILL TRASHED LANDS AT ROOT, and its own
 *    subtree comes with it (the same prefix swap a move runs), because
 *    `ancestor_ids = parent.ancestor_ids || parent.id` is an invariant a test
 *    pins and re-rooting only the named row would break it one level down.
 *
 * Plan: ~/projects/artifactbin-folders.md.
 */
import { trackEvent } from '@/lib/analytics';
import { LIVE_ARTIFACT_SQL, ownerPredicate, type TokenActor } from '@/lib/artifacts';
import { getDb } from '@/lib/db';
import { actorSubject, emit } from '@/lib/events';
import { ancestorsForMove, notifyParent, parentOf } from '@/lib/folders';

/** The row and everything under it — a document matches only itself. */
const SUBTREE = '(id = $1 OR ancestor_ids @> ARRAY[$1])';

/**
 * `SET deleted_at = now()` on the row — and, for a folder, over its whole
 * subtree in ONE statement, which is what makes deleting a folder full of
 * documents an ordinary write rather than a refusal to be forced past.
 *
 * The owner predicate is in the same WHERE as the containment, so the subtree
 * this takes is only ever the caller's own; false means the NAMED row was
 * unknown, foreign, or already in the trash.
 */
export async function trashArtifactFor(actor: TokenActor, id: string): Promise<boolean> {
  const db = await getDb();
  const scope = ownerPredicate(actor);
  const r = await db.query<{ id: string; format: string; ancestor_ids: string[] }>(
    `UPDATE artifacts SET deleted_at = now()
      WHERE ${SUBTREE} AND ${LIVE_ARTIFACT_SQL} AND (${scope.where('$2')})
      RETURNING id, format, ancestor_ids`,
    [id, scope.val],
  );
  const named = r.rows.find((row) => row.id === id);
  if (!named) return false;
  /*
   * `deleted`, said HERE, because this is the only delete there is. The count
   * is what the statement above actually took, so a folder's sentence says how
   * much went with it and a document's says nothing went — and the legacy
   * `analytics_events` row rides on the same call, which is why it is
   * trackEvent rather than a bare emit.
   *
   * Fire-and-forget, and never inside a transaction (PGLite deadlock).
   */
  void trackEvent('delete', id, { userId: actor.userId, format: named.format, subtree: r.rows.length - 1 });
  await notifyParent(parentOf(named));
  return true;
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
export interface TrashEntry {
  id: string;
  title: string | null;
  format: string;
  deleted_at: string;
}

/** The owner's trash, newest first — what the trash page lists. */
export async function listTrashFor(actor: TokenActor): Promise<TrashEntry[]> {
  const db = await getDb();
  const scope = ownerPredicate(actor);
  const r = await db.query<TrashEntry>(
    `SELECT id, title, format, deleted_at FROM artifacts
      WHERE deleted_at IS NOT NULL AND (${scope.where('$1')})
      ORDER BY deleted_at DESC, updated_at DESC LIMIT 200`,
    [scope.val],
  );
  return r.rows;
}
