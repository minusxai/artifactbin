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
import type { EventEnvelope } from '@artifactbin/contracts';
// The trash gate as a VALUE, the way lib/users takes it: every query here
// builds its own SQL against `artifacts` rather than coming through the
// row-loading seam, so each one has to name the gate itself. `git grep
// LIVE_ARTIFACT_SQL` is still the whole audit.
import { LIVE_ARTIFACT_SQL } from '@/lib/artifacts';
import { EVENTS_SCHEMA } from '@/lib/config';
import { getDb } from '@/lib/db';
import type { FeedItem } from '@/lib/feed-wire';
import { linked } from '@/lib/relations';

export type { FeedItem };

export const FEED_DEFAULT_LIMIT = 50;

/**
 * The schema name is interpolated (a parameter cannot name a schema), so it is
 * validated ONCE, at import, against the identifier grammar — the same shape
 * the proxy demands of `APP__SCHEMA`. A deployment with a bad name fails to
 * boot rather than reaching a query builder with it.
 */
if (!/^[a-z_][a-z0-9_]*$/.test(EVENTS_SCHEMA)) {
  throw new Error(`EVENTS__SCHEMA is not an identifier: ${EVENTS_SCHEMA}`);
}

/** The row as postgres hands it back: `at` is a Date on pg and a string on PGLite, `payload` either an object or its text. */
interface EventRow extends Omit<EventEnvelope, 'at' | 'payload'> {
  at: string | Date;
  payload: Record<string, unknown> | string;
}

const envelopeOf = (row: EventRow): EventEnvelope => ({
  ...row,
  at: typeof row.at === 'string' ? row.at : row.at.toISOString(),
  payload: typeof row.payload === 'string' ? (JSON.parse(row.payload) as Record<string, unknown>) : row.payload,
});

/** Is there an events table to read? Cheap (`to_regclass`), asked per read; false is a documented state, not a fault. */
export async function eventsTablePresent(): Promise<boolean> {
  const db = await getDb();
  const r = await db.query<{ present: boolean }>('SELECT to_regclass($1) IS NOT NULL AS present', [`${EVENTS_SCHEMA}.events`]);
  return r.rows[0]?.present === true;
}

/**
 * "What happened to what I own": every event whose object is one of the
 * user's artifacts, newest first — a view, a fork of it (the object IS the
 * original), a comment on it. Empty when the table is absent.
 */
export async function ownerFeed(userId: string, opts: { limit?: number } = {}): Promise<EventEnvelope[]> {
  if (!(await eventsTablePresent())) return [];
  const db = await getDb();
  // `at` alone is not a total order — a batch lands on one timestamp — so the
  // id breaks the tie and the page is stable.
  const r = await db.query<EventRow>(
    `SELECT e.* FROM ${EVENTS_SCHEMA}.events e
       JOIN artifacts a ON a.id = e.object_id
      WHERE a.user_id = $1 AND e.object_kind = 'artifact' AND a.${LIVE_ARTIFACT_SQL}
      ORDER BY e.at DESC, e.id DESC
      LIMIT $2`,
    [userId, opts.limit ?? FEED_DEFAULT_LIMIT],
  );
  return r.rows.map(envelopeOf);
}

/** How many days of history the dashboard splines show. */
export const VIEW_SERIES_DAYS = 30;

export interface DailyViews {
  /** UTC calendar day, 'YYYY-MM-DD'. */
  day: string;
  views: number;
}

/**
 * Daily view counts per artifact across everything the user owns, zero-filled
 * to exactly `days` buckets (oldest → newest, last bucket = today UTC), read
 * from the log: one row per open, deduped per UTC day on the subject (the
 * daily visitor hash; a NULL subject counts once). Artifacts with no views in
 * the window are absent from the map. While `analytics_events` still exists
 * and the log's table does not, the legacy table answers instead.
 */
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
  GROUP BY e.object_id, day`;

const LOG_DAILY = `SELECT to_char(date_trunc('day', e.at AT TIME ZONE 'UTC'), 'YYYY-MM-DD') AS day,
     COUNT(DISTINCT COALESCE(e.subject_id, e.id))::int AS views
   FROM ${EVENTS_SCHEMA}.events e
   JOIN artifacts a ON a.id = e.object_id
  WHERE a.user_id = $1 AND e.object_kind = 'artifact' AND e.verb = 'viewed' AND a.${LIVE_ARTIFACT_SQL}
  GROUP BY day
  ORDER BY day`;

/*
 * THE FALLBACK, for this release only. A split self-host that runs no events
 * service has no `events.events` to read, and its dashboard must not go blank
 * while `analytics_events` is still being written (the dual-write). These two
 * are the pre-log queries verbatim; they go when the legacy table does.
 */
const LEGACY_SERIES = `SELECT e.artifact_id, to_char(date_trunc('day', e.created_at AT TIME ZONE 'UTC'), 'YYYY-MM-DD') AS day,
     COUNT(DISTINCT COALESCE(e.visitor, e.seq::text))::int AS n
   FROM analytics_events e
   JOIN artifacts a ON a.id = e.artifact_id
  WHERE a.user_id = $1 AND e.event = 'view' AND a.${LIVE_ARTIFACT_SQL}
    AND e.created_at > now() - ($2::int * interval '1 day')
  GROUP BY e.artifact_id, day`;

const LEGACY_DAILY = `SELECT to_char(date_trunc('day', e.created_at AT TIME ZONE 'UTC'), 'YYYY-MM-DD') AS day,
     COUNT(DISTINCT COALESCE(e.visitor, e.seq::text))::int AS views
   FROM analytics_events e
   JOIN artifacts a ON a.id = e.artifact_id
  WHERE a.user_id = $1 AND e.event = 'view' AND a.${LIVE_ARTIFACT_SQL}
  GROUP BY day
  ORDER BY day`;

/**
 * Daily view counts per artifact across everything the user owns, zero-filled
 * to exactly `days` buckets (oldest → newest, last bucket = today UTC), read
 * from the log: one row per open, deduped per UTC day on the subject (the
 * daily visitor hash; a NULL subject counts once). Artifacts with no views in
 * the window are absent from the map. While `analytics_events` still exists
 * and the log's table does not, the legacy table answers instead.
 */
export async function viewSeriesByUser(userId: string, days: number = VIEW_SERIES_DAYS): Promise<Map<string, number[]>> {
  const db = await getDb();
  const r = await db.query<{ artifact_id: string; day: string; n: number }>(
    (await eventsTablePresent()) ? LOG_SERIES : LEGACY_SERIES,
    [userId, days],
  );
  const today = Date.parse(new Date().toISOString().slice(0, 10));
  const series = new Map<string, number[]>();
  for (const row of r.rows) {
    const age = Math.round((today - Date.parse(row.day)) / 86_400_000);
    const idx = days - 1 - age;
    if (idx < 0 || idx >= days) continue;
    const buckets = series.get(row.artifact_id) ?? new Array<number>(days).fill(0);
    buckets[idx] = row.n;
    series.set(row.artifact_id, buckets);
  }
  return series;
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

/**
 * The verbs a FOLLOWER cares about. Everything else an account does to its own
 * documents — an edit, a revert, an export — is its own business; these four
 * are the ones that read as news to somebody else.
 */
const FOLLOW_VERBS = ['created', 'forked', 'liked', 'annotated'];

/**
 * Decorate envelopes for a page: the subject's handle (users.username — null
 * for a visitor, a token, or an account without one) and the artifact's title.
 * TWO batched lookups for the whole list, never one per row.
 */
export async function decorateFeed(events: EventEnvelope[]): Promise<FeedItem[]> {
  // Also the guard that keeps the empty page free of queries entirely.
  if (events.length === 0) return [];
  const db = await getDb();
  /*
   * ONE query per NAME, not one per row: a 50-row feed is two statements
   * whatever it holds. The ids are deduped first because a feed is mostly the
   * same few people doing things to the same few documents.
   */
  const subjectIds = [...new Set(events.flatMap((e) => (e.subject_kind === 'user' && e.subject_id ? [e.subject_id] : [])))];
  const objectIds = [...new Set(events.flatMap((e) => (e.object_kind === 'artifact' ? [e.object_id] : [])))];
  const handles = new Map<string, string>();
  if (subjectIds.length > 0) {
    const r = await db.query<{ id: string; username: string | null }>('SELECT id, username FROM users WHERE id = ANY($1)', [subjectIds]);
    for (const row of r.rows) if (row.username) handles.set(row.id, row.username);
  }
  const titles = new Map<string, string>();
  if (objectIds.length > 0) {
    const r = await db.query<{ id: string; title: string | null }>(`SELECT id, title FROM artifacts WHERE id = ANY($1) AND ${LIVE_ARTIFACT_SQL}`, [objectIds]);
    for (const row of r.rows) if (row.title !== null) titles.set(row.id, row.title);
  }
  // A name we do not have is NULL, never a guess: a page that cannot say who
  // says "someone", and it needs the difference to do that.
  return events.map((e) => ({
    id: e.id,
    at: e.at,
    verb: e.verb,
    subject: { kind: e.subject_kind, id: e.subject_id, handle: (e.subject_id && handles.get(e.subject_id)) ?? null },
    object: { kind: e.object_kind, id: e.object_id, title: titles.get(e.object_id) ?? null },
    payload: e.payload,
  }));
}

/**
 * "What those I follow did": events said BY the users this one follows, ON
 * artifacts, for the verbs a follower cares about (created, forked, liked,
 * annotated) — and only on PUBLIC artifacts, so a followed user's private or
 * unlisted work never leaks through their follower's feed. Newest first, id
 * tie-break; empty when the table is absent or the user follows nobody.
 */
export async function followFeed(userId: string, opts: { limit?: number } = {}): Promise<EventEnvelope[]> {
  if (!(await eventsTablePresent())) return [];
  // The audience comes from `lib/relations`, the one module that touches the
  // edges — this reader never writes its own join against them.
  const audience = await linked(userId, 'follow');
  if (audience.length === 0) return [];
  const db = await getDb();
  /*
   * THE PUBLIC CUT. The join to `artifacts` is not decoration: without
   * `visibility = 'public'` a follower would read the titles and ids of the
   * private and unlisted work of everyone they follow, off a table whose rows
   * nobody thought of as an ACL. The same `at DESC, id DESC` total order as
   * `ownerFeed`, for the same reason. The trash gate rides beside it: a
   * document its owner deleted must stop being news to their followers the
   * moment they delete it, not thirty days later when the purge runs.
   */
  const r = await db.query<EventRow>(
    `SELECT e.* FROM ${EVENTS_SCHEMA}.events e
       JOIN artifacts a ON a.id = e.object_id
      WHERE e.object_kind = 'artifact' AND e.subject_kind = 'user'
        AND e.subject_id = ANY($1) AND e.verb = ANY($2)
        AND a.visibility = 'public' AND a.${LIVE_ARTIFACT_SQL}
      ORDER BY e.at DESC, e.id DESC
      LIMIT $3`,
    [audience, FOLLOW_VERBS, opts.limit ?? FEED_DEFAULT_LIMIT],
  );
  return r.rows.map(envelopeOf);
}
