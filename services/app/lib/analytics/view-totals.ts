/**
 * Canonical retained-log view counts. Retired analytics_events and artifact_view_totals remain stored
 * but are never combined with this source: the old cache has no source/version marker. History begins
 * at the first retained canonical viewed event, including any history explicitly migrated by operators.
 * Earlier legacy-only opens require a separate, explicit migration; this module never backfills them.
 *
 * One batched aggregate, using the log's (object_id, at) index. Unlike the retired folded cache this
 * reads the requested artifacts' retained history, so late/backdated log deliveries are counted too.
 * A future persistent cache needs source metadata and an ingestion watermark, not just a closed day.
 */
import { EVENTS_SCHEMA, getDb } from '../platform';
import { dailySeries } from '../viz';
import { eventsTablePresent } from './log';

/** Unique visitors per artifact and UTC day, summed over retained canonical history. */
export async function viewTotalsFor(ids: readonly string[]): Promise<Map<string, number>> {
  const totals = new Map(ids.map(id => [id, 0]));
  if (!ids.length || !(await eventsTablePresent())) return totals;
  const db = await getDb();
  const read = await db.query<{ id: string; views: number }>(
    `SELECT d.id, SUM(d.n)::int AS views FROM (
       SELECT e.object_id AS id, (e.at AT TIME ZONE 'UTC')::date AS day,
         COUNT(DISTINCT COALESCE(e.subject_id, e.id)) AS n
       FROM ${EVENTS_SCHEMA}.events e
       WHERE e.object_id = ANY($1::text[]) AND e.object_kind = 'artifact' AND e.verb = 'viewed'
       GROUP BY e.object_id, day
     ) d GROUP BY d.id`, [[...ids]],
  );
  for (const row of read.rows) totals.set(row.id, row.views);
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
