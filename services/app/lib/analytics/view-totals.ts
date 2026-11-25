/**
 * Canonical viewed/UTC-v1 totals. Each artifact has a source/version cursor and a durable set of
 * (UTC day, visitor) memberships. A fold reads only events above its ingestion position, inserts
 * unseen memberships, and increments the total in the same transaction. Backdated deliveries are
 * ordinary new positions; the membership key still dedupes them against previously folded days.
 *
 * LIFECYCLE. Reading never writes: `viewTotalsFor` is one SELECT of the stored totals, with no transaction,
 * whatever is pending, so a never-folded artifact reads 0 until its first fold. Folds run where views are
 * written: `foldWrittenViews` after lib/analytics events has appended views (one fold of exactly that batch's
 * ids, after the append committed). A read that sees pending rows (events another process or path ingested,
 * history never folded, or an events service that acknowledges before it stores) schedules a catch-up fold of
 * only those ids: one per process at a time, never awaited by the reader, deferred past the reading call.
 * A fold failure is logged; it never fails a read or the request that recorded a view. `settleViewTotals`
 * awaits every fold this process started (tests before a database reset, shutdown).
 *
 * Sorted cursor upserts lock rows and serialize overlapping folds, including across processes. The fold's
 * statement snapshot is taken AFTER those locks: a waiting fold must see its predecessor's
 * memberships and cursor together. Committed event positions cannot arrive behind that cursor.
 * All queries inside a transaction use tx (never an events-service call or getDb query).
 *
 * History starts at retained canonical events on first fold. Legacy analytics/cache rows are never
 * read or changed. Once folded, memberships and totals survive log pruning; events pruned before
 * the first fold cannot be recovered. Series still show the retained log only. Exact arbitrary-late
 * deduplication requires keeping these derived memberships (one per unique visitor/day), so their
 * storage grows with observed unique visits. Resetting either derived table requires resetting both.
 *
 * Initial folds include pre-position rows for installations awaiting events-service boot. That boot
 * assigns every such row a position before appending; later manual NULL-position inserts are not
 * supported ingestion. A source reset/replacement must use a new source/version or reset both caches.
 */
import { EVENTS_SCHEMA, getDb, type Db } from '../platform';
import { dailySeries } from '../viz';
import { eventsTablePresent } from './log';

const SOURCE = `${EVENTS_SCHEMA}:artifact/viewed:utc-v1`;
type Folder = Pick<Db, 'query' | 'transaction'>;

/** Unique visitors per artifact and UTC day, as last folded. Read-only; pending ids are folded in the background. */
export async function viewTotalsFor(ids: readonly string[]): Promise<Map<string, number>> {
  const totals = new Map(ids.map(id => [id, 0]));
  if (!ids.length || !(await eventsTablePresent())) return totals;
  return canonicalViewTotals(await getDb(), ids);
}

/** The read on a given handle: stored totals now, a catch-up fold of the pending ids on that handle later. */
export async function canonicalViewTotals(db: Folder, ids: readonly string[]): Promise<Map<string, number>> {
  const totals = new Map(ids.map(id => [id, 0]));
  // One snapshot: a fold committing after it belongs to the next read; an in-flight fold leaves its old
  // cursor and memberships visible together.
  const stored = await db.query<{ id: string; views: string | null; pending: boolean }>(`
    SELECT requested.artifact_id AS id,c.views::text AS views,
      c.position IS NULL OR EXISTS (
        SELECT 1 FROM ${EVENTS_SCHEMA}.events e
        WHERE e.object_id=requested.artifact_id AND e.position>c.position
      ) AS pending
    FROM unnest($2::text[]) requested(artifact_id)
    LEFT JOIN canonical_view_totals c ON c.source=$1 AND c.artifact_id=requested.artifact_id`, [SOURCE, [...totals.keys()]]);
  const pending: string[] = [];
  for (const row of stored.rows) {
    totals.set(row.id, Number(row.views ?? 0));
    if (row.pending) pending.push(row.id);
  }
  if (pending.length) scheduleCatchUp(db, pending);
  return totals;
}

/** Every fold this process started and has not finished: write-time folds and the catch-up loop. */
const running = new Set<Promise<unknown>>();
const track = <T,>(work: Promise<T>): Promise<T> => {
  running.add(work);
  void work.finally(() => running.delete(work)).catch(() => {});
  return work;
};
const logged = (error: unknown) => { console.error('[view totals] fold failed:', error); };

/** Ids reads found pending, per handle, waiting for the one catch-up loop. */
const waiting = new Map<Folder, Set<string>>();
let catchUp: Promise<void> | undefined;
function scheduleCatchUp(db: Folder, ids: readonly string[]): void {
  const queued = waiting.get(db) ?? new Set<string>();
  waiting.set(db, queued);
  for (const id of ids) queued.add(id);
  catchUp ??= startCatchUp();
}
function startCatchUp(): Promise<void> {
  return track((async () => {
    // Past the reading call: the read itself never reaches the handle's transaction.
    await new Promise<void>(resolve => setImmediate(resolve));
    // A Map visits entries added while it is iterated, so ids queued during a fold are folded by this loop.
    for (const [handle, folding] of waiting) {
      waiting.delete(handle);
      await foldViewTotals(handle, [...folding]).catch(logged);
    }
  })().finally(() => {
    // Ids queued after the loop's last look start the next one.
    catchUp = waiting.size ? startCatchUp() : undefined;
  }));
}

/**
 * Fold the artifacts an append just wrote views for, if the log already shows them. Never rejects.
 * Only pending ids open a transaction: behind the events service the append is acknowledged before its rows
 * are visible, so nothing is pending here and the next read's catch-up folds them.
 */
export async function foldWrittenViews(ids: readonly string[]): Promise<void> {
  if (!ids.length) return;
  await track((async () => {
    if (!(await eventsTablePresent())) return;
    const db = await getDb();
    const pending = (await db.query<{ id: string }>(`
      SELECT requested.artifact_id AS id FROM unnest($2::text[]) requested(artifact_id)
      LEFT JOIN canonical_view_totals c ON c.source=$1 AND c.artifact_id=requested.artifact_id
      WHERE c.position IS NULL OR EXISTS (
        SELECT 1 FROM ${EVENTS_SCHEMA}.events e WHERE e.object_id=requested.artifact_id AND e.position>c.position)`,
      [SOURCE, [...new Set(ids)]])).rows.map(row => row.id);
    if (pending.length) await foldViewTotals(db, pending);
  })().catch(logged));
}

/** Await every fold this process started, including ones started while waiting. Never rejects. */
export async function settleViewTotals(): Promise<void> {
  while (running.size) await Promise.allSettled([...running]);
}

/**
 * The fold, in one transaction on the given handle (the seam real multi-connection verification drives):
 * new events of exactly these ids into memberships and totals. Returns their totals after the fold.
 */
export async function foldViewTotals(db: Folder, ids: readonly string[]): Promise<Map<string, number>> {
  const totals = new Map(ids.map(id => [id, 0]));
  const folding = [...totals.keys()];
  const rows = await db.transaction(async tx => {
    // Both admission and locking use the same bytewise order to avoid overlapping-batch deadlocks.
    await tx.query(`INSERT INTO canonical_view_totals AS c (source, artifact_id)
      SELECT $1, id FROM unnest($2::text[]) id ORDER BY id COLLATE "C"
      ON CONFLICT (source,artifact_id) DO UPDATE SET position=c.position`, [SOURCE, folding]);
    return (await tx.query<{ id: string; views: string }>(`WITH incoming AS MATERIALIZED (
        SELECT c.artifact_id, e.position, e.at, e.verb, e.object_kind, COALESCE(e.subject_id,e.id) AS visitor
        FROM canonical_view_totals c CROSS JOIN LATERAL (
          SELECT position,at,verb,object_kind,subject_id,id FROM ${EVENTS_SCHEMA}.events
          WHERE object_id=c.artifact_id AND position>c.position
          UNION ALL
          SELECT position,at,verb,object_kind,subject_id,id FROM ${EVENTS_SCHEMA}.events
          WHERE object_id=c.artifact_id AND c.position IS NULL
        ) e
        WHERE c.source=$1 AND c.artifact_id=ANY($2::text[])
      ), added AS (
        INSERT INTO canonical_view_visitors (source,artifact_id,day,visitor)
        SELECT DISTINCT $1, artifact_id, (at AT TIME ZONE 'UTC')::date, visitor FROM incoming
        WHERE object_kind='artifact' AND verb='viewed'
        ON CONFLICT DO NOTHING RETURNING artifact_id
      ), counts AS (
        SELECT artifact_id, count(*) AS n FROM added GROUP BY artifact_id
      ), heads AS (
        SELECT artifact_id, max(position) AS position FROM incoming GROUP BY artifact_id
      ) UPDATE canonical_view_totals c
      SET views=c.views+COALESCE((SELECT n FROM counts WHERE artifact_id=c.artifact_id),0),
          position=GREATEST(COALESCE(c.position,0),COALESCE((SELECT position FROM heads WHERE artifact_id=c.artifact_id),0))
      WHERE c.source=$1 AND c.artifact_id=ANY($2::text[])
      RETURNING c.artifact_id AS id,c.views::text AS views`, [SOURCE, folding])).rows;
  });
  for (const row of rows) totals.set(row.id, Number(row.views));
  return totals;
}

/** Daily unique visitors, in one bounded-window query for the whole shelf. Missing series are zero. */
export async function viewSeriesFor(ids: readonly string[], days = 14): Promise<Map<string, number[]>> {
  if (!ids.length || !(await eventsTablePresent())) return new Map();
  const db = await getDb();
  const read = await db.query<{ artifact_id: string; day: string; n: number }>(
    `SELECT e.object_id AS artifact_id,
       to_char(e.at AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS day,
       COUNT(DISTINCT COALESCE(e.subject_id, e.id))::int AS n
     FROM ${EVENTS_SCHEMA}.events e
     WHERE e.object_id = ANY($1::text[]) AND e.object_kind = 'artifact' AND e.verb = 'viewed'
       AND e.at >= (((now() AT TIME ZONE 'UTC')::date - ($2::int - 1))::timestamp AT TIME ZONE 'UTC')
     GROUP BY e.object_id, day`, [[...ids], days],
  );
  return dailySeries(read.rows, days);
}
