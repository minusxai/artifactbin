/**
 * ALL-TIME VIEW COUNTS, read in time that does not follow the number of view events.
 *
 * A document's views are its unique daily visitors, summed over every day it was opened: one row per
 * (visitor, day), where the visitor key is a hash salted with the day (lib/analytics/events), and a
 * legacy row with no visitor counts once on its own `seq`. Counting that from analytics_events costs
 * every event the document ever received, on every read of every listing.
 *
 * A UTC day that has ended gains no more views, so its count is final. `artifact_view_totals` holds the
 * sum of the final days up to `closed_through`; a read adds the days after it, counted live from the
 * events (an index range on (artifact_id, created_at): today's views, not all of them), and then folds the
 * days that closed since into the row so the next read starts later. The fold is compare-and-set on
 * `closed_through`, so racing readers add a day once. The table is derived and disposable: with no row
 * the live range starts at the beginning of time and the answer is the same, only slower once.
 */
import { getDb } from '../platform';

const TODAY = "(now() AT TIME ZONE 'UTC')::date";

interface TotalRow {
  id: string;
  /** The day the stored total is final through, or null when none is stored. */
  prior: string | null;
  /** Stored total plus the live days after it. */
  views: number;
  /** Of the live days, the views on days that have ended: what the fold adds. */
  closed: number;
  /** Yesterday (UTC) as this statement saw it: the day the fold advances to. */
  through: string;
}

/**
 * Unique daily visitors, all time, per artifact. Every requested id is present in the answer (0 when
 * never viewed). Two statements: the read, and, only when a day has closed since an artifact's last
 * fold, one batched fold.
 */
export async function viewTotalsFor(ids: readonly string[]): Promise<Map<string, number>> {
  const totals = new Map<string, number>();
  if (ids.length === 0) return totals;
  const db = await getDb();
  const read = await db.query<TotalRow>(
    `SELECT i.id, t.closed_through::text AS prior,
       (COALESCE(t.views, 0) + COALESCE(SUM(d.n), 0))::int AS views,
       COALESCE(SUM(d.n) FILTER (WHERE d.day < ${TODAY}), 0)::int AS closed,
       (${TODAY} - 1)::text AS through
     FROM unnest($1::text[]) AS i(id)
     LEFT JOIN artifact_view_totals t ON t.artifact_id = i.id
     LEFT JOIN LATERAL (
       SELECT (e.created_at AT TIME ZONE 'UTC')::date AS day, COUNT(DISTINCT COALESCE(e.visitor, e.seq::text)) AS n
       FROM analytics_events e
       WHERE e.artifact_id = i.id AND e.event IS NOT DISTINCT FROM 'view'
         AND e.created_at >= COALESCE((t.closed_through + 1)::timestamp AT TIME ZONE 'UTC', '-infinity'::timestamptz)
       GROUP BY 1
     ) d ON true
     GROUP BY i.id, t.closed_through, t.views`,
    [[...ids]],
  );
  const stale = read.rows.filter((row) => row.prior === null || row.prior < row.through);
  for (const row of read.rows) totals.set(row.id, row.views);
  if (stale.length > 0) await foldClosedDays(stale);
  return totals;
}

/**
 * Advance each artifact's stored total to yesterday, adding the days that closed. Best effort: a fold
 * that fails (or loses the race) leaves the answer unchanged, so it never fails the read it rides on.
 */
async function foldClosedDays(rows: TotalRow[]): Promise<void> {
  try {
    const db = await getDb();
    await db.query(
      `WITH x AS (SELECT * FROM unnest($1::text[], $2::date[], $3::int[], $4::date[]) AS x(id, prior, closed, through)),
         advanced AS (
           UPDATE artifact_view_totals t SET closed_through = x.through, views = t.views + x.closed
           FROM x WHERE x.prior IS NOT NULL AND t.artifact_id = x.id AND t.closed_through = x.prior
           RETURNING t.artifact_id)
       INSERT INTO artifact_view_totals (artifact_id, closed_through, views)
       SELECT id, through, closed FROM x WHERE prior IS NULL
       ON CONFLICT (artifact_id) DO NOTHING`,
      [rows.map((row) => row.id), rows.map((row) => row.prior), rows.map((row) => row.closed), rows.map((row) => row.through)],
    );
  } catch {
    // A derived total that could not be advanced is recomputed by the next read.
  }
}
