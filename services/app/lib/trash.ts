/**
 * THE TRASH — deleting an artifact stamps `deleted_at` and nothing else.
 *
 * The whole design is ONE GATE and one exception to it. The gate is
 * `LIVE_ARTIFACT_SQL`, composed into the row-loading seam (lib/artifacts: the
 * `Scope` constructors and the unscoped row reads) and imported by name in the
 * few readers that do not come through it, so a trashed row is the uniform 404
 * everywhere without a single caller remembering to say so. The exception is
 * THIS MODULE, which reads past the gate through `ownerPredicate`, because the
 * trash listing, restore and the purge are the readers the rows are kept for.
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
import { getDb, type Queryable } from '@/lib/db';
import { actorSubject, emit } from '@/lib/events';
import { ancestorsForMove, notifyParent, parentOf } from '@/lib/folders';

/** Days a row sits in the trash before the purge hard-deletes it. */
export const TRASH_RETENTION_DAYS = 30;

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
   * `trashed`, NEVER `deleted`. The log keeps `deleted` for the purge, where
   * it means what it has always meant — erased, nothing to come back to — and
   * saying it here would tell an operator a document was destroyed while it is
   * sitting in its owner's trash, restorable for thirty days. The count is what
   * the statement above actually took, so a folder's sentence says how much
   * went with it and a document's says nothing went.
   *
   * Fire-and-forget, and never inside a transaction (PGLite deadlock).
   */
  void emit(actorSubject(actor), 'trashed', { kind: 'artifact', id }, { format: named.format, subtree: r.rows.length - 1 });
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

/**
 * The HARD delete — the transaction that used to be `deleteArtifactScoped`,
 * moved here whole because the purge is now the only thing in the product that
 * performs one. Every table that names the artifact goes with it: the edit log
 * stores full text (its genesis row holds the whole document), so leaving it
 * would leave the content behind a delete that promised to be permanent.
 */
async function hardDelete(tx: Queryable, id: string): Promise<void> {
  await tx.query('DELETE FROM artifact_versions WHERE artifact_id = $1', [id]);
  await tx.query('DELETE FROM artifact_edits WHERE artifact_id = $1', [id]);
  await tx.query('DELETE FROM artifact_shares WHERE artifact_id = $1', [id]);
  await tx.query('DELETE FROM annotations WHERE artifact_id = $1', [id]);
  await tx.query('DELETE FROM artifacts WHERE id = $1', [id]);
}

/**
 * Hard-delete everything that has sat in the trash longer than the retention.
 * Returns the ids purged.
 *
 * Ordered DEEPEST FIRST, the way the forced folder delete was: a subtree
 * trashed together shares one stamp and so purges together, and taking the
 * rows from the bottom means nothing is ever orphaned mid-sweep. Bounded by
 * the trash rather than by the table, so it stays a sweep and never a scan.
 */
export async function purgeTrash(opts: { olderThanDays?: number; now?: Date } = {}): Promise<string[]> {
  const days = opts.olderThanDays ?? TRASH_RETENTION_DAYS;
  const cutoff = new Date((opts.now ?? new Date()).getTime() - days * 86_400_000).toISOString();
  const db = await getDb();
  const due = await db.query<{ id: string; user_id: string | null }>(
    `SELECT id, user_id FROM artifacts WHERE deleted_at IS NOT NULL AND deleted_at < $1::timestamptz
      ORDER BY cardinality(ancestor_ids) DESC`,
    [cutoff],
  );
  const ids = due.rows.map((r) => r.id);
  if (!ids.length) return ids;
  await db.transaction(async (tx) => {
    for (const id of ids) await hardDelete(tx, id);
  });
  /*
   * THE ONE PLACE THAT SAYS `deleted`. The verb kept its meaning when the
   * delete door stopped erasing anything, so it moved here with the erasure —
   * one sentence per row, after the transaction (lib/analytics is
   * fire-and-forget and may not run inside one), with no subject: a sweep is
   * the product's own housekeeping and nobody asked for it.
   */
  for (const row of due.rows) void trackEvent('delete', row.id, { userId: row.user_id });
  return ids;
}

/**
 * THE LAZY SWEEP — the purge, run at most once an hour from whatever request
 * happens to arrive after the interval, plus once at boot (server.ts).
 *
 * A timestamp in module scope rather than a scheduler, because this product is
 * one process and a cron job is a second deployment artefact to keep in step
 * with it. It never throws and is never awaited by a request: the caller is
 * someone reading a document, and their answer must not wait on — or fail with
 * — a housekeeping sweep.
 */
const SWEEP_INTERVAL_MS = 60 * 60 * 1000;
let lastSweep = 0;
export function sweepTrashSoon(): void {
  const now = Date.now();
  if (now - lastSweep < SWEEP_INTERVAL_MS) return;
  lastSweep = now;
  void purgeTrash().catch(() => { /* housekeeping never fails a request */ });
}

/** Boot: run the sweep now, and count it as this hour's. Never throws. */
export async function sweepTrashAtBoot(): Promise<string[]> {
  lastSweep = Date.now();
  try {
    return await purgeTrash();
  } catch {
    return [];
  }
}
