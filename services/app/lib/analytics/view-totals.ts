/**
 * Canonical viewed/UTC-v1 totals. Each artifact has a source/version cursor and a durable set of
 * (UTC day, visitor) memberships. A fold reads only events above its ingestion position, inserts
 * unseen memberships, and increments the total in the same transaction. Backdated deliveries are
 * ordinary new positions; the membership key still dedupes them against previously folded days.
 *
 * Sorted cursor upserts lock rows and serialize overlapping folds, including across processes. The fold's
 * statement snapshot is taken AFTER those locks: a waiting reader must see its predecessor's
 * memberships and cursor together. Committed event positions cannot arrive behind that cursor.
 * All queries inside a transaction use tx (never an events-service call or getDb query).
 *
 * History starts at retained canonical events on first read. Legacy analytics/cache rows are never
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

/** Unique visitors per artifact and UTC day, incrementally folded from the canonical log. */
export async function viewTotalsFor(ids: readonly string[]): Promise<Map<string, number>> {
  const totals = new Map(ids.map(id => [id, 0]));
  if (!ids.length || !(await eventsTablePresent())) return totals;
  return canonicalViewTotals(await getDb(), ids);
}

/** Internal aggregation seam for real multi-connection database verification. */
export async function canonicalViewTotals(db: Pick<Db, 'query' | 'transaction'>, ids: readonly string[]): Promise<Map<string, number>> {
  const totals = new Map(ids.map(id => [id, 0]));
  const requested = [...totals.keys()];
  // One snapshot is enough for an unchanged listing. A commit after this snapshot belongs to the
  // next read; an in-flight fold leaves its old cursor and memberships visible together.
  const cached = await db.query<{ id: string; views: string | null; pending: boolean }>(`
    SELECT requested.artifact_id AS id,c.views::text AS views,
      c.position IS NULL OR EXISTS (
        SELECT 1 FROM ${EVENTS_SCHEMA}.events e
        WHERE e.object_id=requested.artifact_id AND e.position>c.position
      ) AS pending
    FROM unnest($2::text[]) requested(artifact_id)
    LEFT JOIN canonical_view_totals c ON c.source=$1 AND c.artifact_id=requested.artifact_id`, [SOURCE, requested]);
  if (cached.rows.every(row => !row.pending)) {
    for (const row of cached.rows) totals.set(row.id, Number(row.views));
    return totals;
  }
  const rows = await db.transaction(async tx => {
    // Both admission and locking use the same bytewise order to avoid overlapping-batch deadlocks.
    await tx.query(`INSERT INTO canonical_view_totals AS c (source, artifact_id)
      SELECT $1, id FROM unnest($2::text[]) id ORDER BY id COLLATE "C"
      ON CONFLICT (source,artifact_id) DO UPDATE SET position=c.position`, [SOURCE, requested]);
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
      RETURNING c.artifact_id AS id,c.views::text AS views`, [SOURCE, requested])).rows;
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
