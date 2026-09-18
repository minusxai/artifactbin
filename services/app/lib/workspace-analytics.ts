import { dailySeries } from './daily-series';
/**
 * THE READER — every query the app makes against the events schema, and the
 * only module that names it. All of them are SELECTs joining the app's own
 * tables: the schema is `EVENTS_SCHEMA` (env), the table name is a literal,
 * the way the proxy reads `${APP__SCHEMA}.tokens`. The app role holds SELECT
 * on it and nothing more.
 *
 * A split deployment that runs no events service has no table: every read
 * here checks `to_regclass` first and answers EMPTY, never an error — the
 * home page must not break because telemetry is off.
 */
// The trash gate as a VALUE, the way lib/users takes it: every query here
// builds its own SQL against `artifacts` rather than coming through the
// row-loading seam, so each one has to name the gate itself. `git grep
// LIVE_ARTIFACT_SQL` is still the whole audit.
import { LIVE_ARTIFACT_SQL } from '@/lib/artifacts';
import { EVENTS_SCHEMA } from '@/lib/config';
import { getDb } from '@/lib/db';



/**
 * The schema name is interpolated (a parameter cannot name a schema), so it is
 * validated ONCE, at import, against the identifier grammar — the same shape
 * the proxy demands of `APP__SCHEMA`. A deployment with a bad name fails to
 * boot rather than reaching a query builder with it.
 */
if (!/^[a-z_][a-z0-9_]*$/.test(EVENTS_SCHEMA)) {
  throw new Error(`EVENTS__SCHEMA is not an identifier: ${EVENTS_SCHEMA}`);
}

/** Is there an events table to read? Cheap (`to_regclass`), asked per read; false is a documented state, not a fault. */
export async function eventsTablePresent(): Promise<boolean> {
  const db = await getDb();
  const r = await db.query<{ present: boolean }>('SELECT to_regclass($1) IS NOT NULL AS present', [`${EVENTS_SCHEMA}.events`]);
  return r.rows[0]?.present === true;
}

/** How many days of history the dashboard splines show. */
export const VIEW_SERIES_DAYS = 30;

interface DailyViews {
  /** UTC calendar day, 'YYYY-MM-DD'. */
  day: string;
  views: number;
}

/*
 * THE TWO VIEW QUERIES, AND THEIR TWO SOURCES. Both read the same shape — one
 * row per (artifact, UTC day) with the unique-visitor count — so the zero-fill
 * below is written once and the only thing that changes is WHERE the rows come
 * from.
 *
 * `to_char` pins the bucket key to a plain UTC date string: TIMESTAMPTZ
 * round-trips as driver-dependent Date/string shapes, a text key doesn't. AT
 * TIME ZONE 'UTC' pins the DAY itself — bare date_trunc cuts in the session
 * timezone (PGLite inherits the machine's) while the JS zero-fill counts UTC
 * days, and on a PDT laptop the two disagreed from 5pm to midnight and "today"
 * came back empty.
 *
 * The dedupe key is the SUBJECT, coalesced to the row's own id: one person
 * refreshing is one view, and a row with no subject (a legacy visitor-less
 * open) has nothing to dedupe on and counts once, exactly as `COALESCE(visitor,
 * seq::text)` treated it before.
 */
const LOG_SERIES = `SELECT e.object_id AS artifact_id, to_char(date_trunc('day', e.at AT TIME ZONE 'UTC'), 'YYYY-MM-DD') AS day,
     COUNT(DISTINCT COALESCE(e.subject_id, e.id))::int AS n
   FROM ${EVENTS_SCHEMA}.events e
   JOIN artifacts a ON a.id = e.object_id
  WHERE a.user_id = $1 AND e.object_kind = 'artifact' AND e.verb = 'viewed' AND a.${LIVE_ARTIFACT_SQL}
    AND e.at > now() - ($2::int * interval '1 day')
    AND ($3::text IS NULL OR a.format = $3)
  GROUP BY e.object_id, day`;

const LOG_DAILY = `SELECT to_char(date_trunc('day', e.at AT TIME ZONE 'UTC'), 'YYYY-MM-DD') AS day,
     COUNT(DISTINCT COALESCE(e.subject_id, e.id))::int AS views
   FROM ${EVENTS_SCHEMA}.events e
   JOIN artifacts a ON a.id = e.object_id
  WHERE a.user_id = $1 AND e.object_kind = 'artifact' AND e.verb = 'viewed' AND a.${LIVE_ARTIFACT_SQL}
  GROUP BY day
  ORDER BY day`;

/*
 * THE FALLBACK. A split self-host that runs no events service has no
 * `events.events` to read, and its dashboard must not go blank while
 * `analytics_events` is still being written (the dual-write). These two mirror
 * the log queries above against that table.
 */
const LEGACY_SERIES = `SELECT e.artifact_id, to_char(date_trunc('day', e.created_at AT TIME ZONE 'UTC'), 'YYYY-MM-DD') AS day,
     COUNT(DISTINCT COALESCE(e.visitor, e.seq::text))::int AS n
   FROM analytics_events e
   JOIN artifacts a ON a.id = e.artifact_id
  WHERE a.user_id = $1 AND e.event = 'view' AND a.${LIVE_ARTIFACT_SQL}
    AND e.created_at > now() - ($2::int * interval '1 day')
    AND ($3::text IS NULL OR a.format = $3)
  GROUP BY e.artifact_id, day`;

const LEGACY_DAILY = `SELECT to_char(date_trunc('day', e.created_at AT TIME ZONE 'UTC'), 'YYYY-MM-DD') AS day,
     COUNT(DISTINCT COALESCE(e.visitor, e.seq::text))::int AS views
   FROM analytics_events e
   JOIN artifacts a ON a.id = e.artifact_id
  WHERE a.user_id = $1 AND e.event = 'view' AND a.${LIVE_ARTIFACT_SQL}
  GROUP BY day
  ORDER BY day`;

const LOG_FORK_COUNT = `SELECT COUNT(*)::int AS n
   FROM ${EVENTS_SCHEMA}.events e
   JOIN artifacts a ON a.id = e.object_id
  WHERE a.user_id = $1 AND e.object_kind = 'artifact' AND e.verb = 'forked'
    AND a.format = 'markup' AND a.${LIVE_ARTIFACT_SQL}`;

const LEGACY_FORK_COUNT = `SELECT COUNT(*)::int AS n
   FROM analytics_events e
   JOIN artifacts a ON a.id = e.artifact_id
  WHERE a.user_id = $1 AND e.event = 'fork'
    AND a.format = 'markup' AND a.${LIVE_ARTIFACT_SQL}`;

/**
 * Daily view counts per artifact across everything the user owns, zero-filled
 * to exactly `days` buckets (oldest → newest, last bucket = today UTC), read
 * from the log: one row per open, deduped per UTC day on the subject (the
 * daily visitor hash; a NULL subject counts once). Artifacts with no views in
 * the window are absent from the map. While `analytics_events` still exists
 * and the log's table does not, the legacy table answers instead.
 */
export async function viewSeriesByUser(userId: string, days: number = VIEW_SERIES_DAYS, format: 'markup' | null = null): Promise<Map<string, number[]>> {
  const db = await getDb();
  const r = await db.query<{ artifact_id: string; day: string; n: number }>(
    (await eventsTablePresent()) ? LOG_SERIES : LEGACY_SERIES,
    [userId, days, format],
  );
  return dailySeries(r.rows, days);
}

interface LikeSummary {
  /** Likes currently held by the user's live markup documents. */
  total: number;
  /** Those live likes grouped by the day the relation was first created. */
  series: number[];
}

/**
 * The dashboard's like readout follows the RELATIONS source of truth. Unlike
 * the legacy analytics stream, this excludes unliked edges and supporting
 * data files, so the headline total agrees with the like controls themselves.
 */
export async function likeSummaryByUser(userId: string, days: number = VIEW_SERIES_DAYS): Promise<LikeSummary> {
  const db = await getDb();
  const r = await db.query<{ day: string; n: number | string }>(
    `SELECT to_char(date_trunc('day', r.created_at AT TIME ZONE 'UTC'), 'YYYY-MM-DD') AS day,
       COUNT(*)::int AS n
     FROM relations r
     JOIN artifacts a ON a.id = r.object_id
     WHERE r.verb = 'like' AND r.object_kind = 'artifact' AND r.deleted_at IS NULL
       AND r.subject_id IS DISTINCT FROM a.user_id AND a.user_id = $1 AND a.format = 'markup' AND a.${LIVE_ARTIFACT_SQL}
     GROUP BY day
     ORDER BY day`,
    [userId],
  );
  const today = Date.parse(new Date().toISOString().slice(0, 10));
  const series = new Array<number>(days).fill(0);
  let total = 0;
  for (const row of r.rows) {
    const count = Number(row.n);
    total += count;
    const age = Math.round((today - Date.parse(row.day)) / 86_400_000);
    const index = days - 1 - age;
    if (index >= 0 && index < days) series[index] = count;
  }
  return { total, series };
}

/**
 * Forks made from the user's live markup artifacts. The canonical event log
 * records the fork against its source artifact; the analytics table remains
 * the fallback for split deployments that have not installed the log yet.
 */
export async function forkCountByUser(userId: string): Promise<number> {
  const db = await getDb();
  const r = await db.query<{ n: number | string }>(
    (await eventsTablePresent()) ? LOG_FORK_COUNT : LEGACY_FORK_COUNT,
    [userId],
  );
  return Number(r.rows[0]?.n ?? 0);
}

/**
 * All-time daily view totals pooled across everything the user owns,
 * zero-filled from the first viewed day through today (empty when no views).
 * Same source rule as `viewSeriesByUser`.
 */
export async function dailyViewsByUser(userId: string): Promise<DailyViews[]> {
  const db = await getDb();
  const r = await db.query<{ day: string; views: number }>((await eventsTablePresent()) ? LOG_DAILY : LEGACY_DAILY, [userId]);
  if (r.rows.length === 0) return [];
  const byDay = new Map(r.rows.map((row) => [row.day, row.views]));
  const out: DailyViews[] = [];
  const today = new Date().toISOString().slice(0, 10);
  for (let t = Date.parse(r.rows[0].day); ; t += 86_400_000) {
    const day = new Date(t).toISOString().slice(0, 10);
    out.push({ day, views: byDay.get(day) ?? 0 });
    if (day >= today) break;
  }
  return out;
}

