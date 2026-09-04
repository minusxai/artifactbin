/**
 * The dashboard's two view queries read the LOG now (lib/feed.ts), and the
 * numbers do not move: over a synthetic 40-day history — refreshes, one
 * account on two devices, legacy rows with no visitor, another owner — the
 * new queries after the backfill equal the OLD queries over analytics_events,
 * kept verbatim below as the oracle. When the log's table is absent, the old
 * table still answers. And live: the real in-process writer, two opens by one
 * visitor today count once.
 *
 * The last describe is the pair of dashboard aggregate cases that lived in
 * analytics.test.ts before the queries moved here — the same assertions, over
 * the same analytics_events rows, now reached through the backfill.
 *
 * Seeded RED by the orchestrator.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Queryable } from '@artifactbin/contracts';
import { backfillAnalyticsEvents, createEvents, ensureEventsSchema } from '@artifactbin/events/local';
import { useAppHarness } from '@/__tests__/harness';
import { trackEvent } from '@/lib/analytics';
import { EVENTS_SCHEMA } from '@/lib/config';
import { dailyViewsByUser, eventsTablePresent, viewSeriesByUser, VIEW_SERIES_DAYS } from '@/lib/feed';
import { setServices } from '@/lib/services';

const harness = useAppHarness();

// The request the live test's views arrive on: a user-agent is what makes a visitor hash.
const requestHeaders = new Map<string, string>();
vi.mock('@/lib/request-context', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/request-context')>()),
  currentHeaders: async () => (requestHeaders.size === 0 ? null : { get: (k: string) => requestHeaders.get(k.toLowerCase()) ?? null }),
}));

/* ───────── THE ORACLE: lib/analytics.ts's two queries before P2, verbatim ───────── */
async function oracleSeries(db: Queryable, userId: string, days: number): Promise<Map<string, number[]>> {
  const r = await db.query<{ artifact_id: string; day: string; n: number }>(
    `SELECT e.artifact_id, to_char(date_trunc('day', e.created_at AT TIME ZONE 'UTC'), 'YYYY-MM-DD') AS day,
       COUNT(DISTINCT COALESCE(e.visitor, e.seq::text))::int AS n
     FROM analytics_events e
     JOIN artifacts a ON a.id = e.artifact_id
     WHERE a.user_id = $1 AND e.event = 'view' AND e.created_at > now() - ($2::int * interval '1 day')
     GROUP BY e.artifact_id, day`,
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
async function oracleDaily(db: Queryable, userId: string): Promise<Array<{ day: string; views: number }>> {
  const r = await db.query<{ day: string; views: number }>(
    `SELECT to_char(date_trunc('day', e.created_at AT TIME ZONE 'UTC'), 'YYYY-MM-DD') AS day,
       COUNT(DISTINCT COALESCE(e.visitor, e.seq::text))::int AS views
     FROM analytics_events e
     JOIN artifacts a ON a.id = e.artifact_id
     WHERE a.user_id = $1 AND e.event = 'view'
     GROUP BY day
     ORDER BY day`,
    [userId],
  );
  if (r.rows.length === 0) return [];
  const byDay = new Map(r.rows.map((row) => [row.day, row.views]));
  const out: Array<{ day: string; views: number }> = [];
  const today = new Date().toISOString().slice(0, 10);
  for (let t = Date.parse(r.rows[0]!.day); ; t += 86_400_000) {
    const day = new Date(t).toISOString().slice(0, 10);
    out.push({ day, views: byDay.get(day) ?? 0 });
    if (day >= today) break;
  }
  return out;
}
/* ─────────────────────────────────────────────────────────────────────────────── */

const at = (daysAgo: number, minute: number) => new Date(Date.now() - daysAgo * 86_400_000 + minute * 60_000).toISOString();

/** 40 days, deterministic: refreshes, one account on two devices, legacy NULL visitors, another owner, non-view rows. */
async function seedHistory(db: Queryable): Promise<void> {
  await db.query(`INSERT INTO artifacts (id, token_id, user_id, content) VALUES ('art0a1', 'tok_a', 'usr_a', 'x'), ('art0a2', 'tok_a', 'usr_a', 'x'), ('art0b1', 'tok_b', 'usr_b', 'x')`);
  const rows: Array<[string, string, string | null, string | null, string | null, string]> = [];
  for (let d = 0; d < 40; d += 1) {
    if (d % 2 === 0) { rows.push(['view', 'art0a1', null, 'browser', `h${d}`.padEnd(32, 'h'), at(d, 1)], ['view', 'art0a1', null, 'browser', `h${d}`.padEnd(32, 'h'), at(d, 2)]); }
    rows.push(['view', 'art0a2', 'usr_x', 'browser', `x1${d}`.padEnd(32, 'x'), at(d, 3)], ['view', 'art0a2', 'usr_x', 'browser', `x2${d}`.padEnd(32, 'y'), at(d, 4)]);
    if (d % 5 === 0) rows.push(['view', 'art0a1', null, 'curl', null, at(d, 5)], ['view', 'art0a1', null, 'curl', null, at(d, 6)]);
    if (d % 3 === 0) rows.push(['view', 'art0b1', 'usr_b', 'browser', `q${d}`.padEnd(32, 'q'), at(d, 7)]);
    if (d % 7 === 0) rows.push(['create', 'art0a1', 'usr_a', 'claude-code', `c${d}`.padEnd(32, 'c'), at(d, 8)], ['sse_connect', 'art0a1', null, null, null, at(d, 9)]);
  }
  for (const r of rows) await db.query('INSERT INTO analytics_events (event, artifact_id, user_id, client, visitor, created_at) VALUES ($1, $2, $3, $4, $5, $6)', r);
}
const asObject = (m: Map<string, number[]>) => Object.fromEntries([...m.entries()].sort());

beforeEach(async () => {
  requestHeaders.clear();
  const db = await harness.db();
  await db.query(`DROP SCHEMA IF EXISTS ${EVENTS_SCHEMA} CASCADE`);
});

describe('the dashboard reads the log', () => {
  it('after the backfill, both queries over the log equal the old queries over analytics_events, for every owner', async () => {
    const db = await harness.db();
    await seedHistory(db);
    await ensureEventsSchema(db, EVENTS_SCHEMA);
    const copied = await backfillAnalyticsEvents(db, { schema: EVENTS_SCHEMA, from: 'analytics_events' });
    expect(copied).toBeGreaterThan(100);
    expect(await eventsTablePresent()).toBe(true);
    for (const user of ['usr_a', 'usr_b', 'usr_nobody']) {
      expect(asObject(await viewSeriesByUser(user))).toEqual(asObject(await oracleSeries(db, user, VIEW_SERIES_DAYS)));
      expect(asObject(await viewSeriesByUser(user, 45))).toEqual(asObject(await oracleSeries(db, user, 45)));
      expect(await dailyViewsByUser(user)).toEqual(await oracleDaily(db, user));
    }
    expect((await dailyViewsByUser('usr_a')).length).toBeGreaterThanOrEqual(40);
  });
  it('with the log present the log IS the source: sentences it alone holds count, a legacy row it never got does not', async () => {
    // The equivalence case above cannot tell the two sources apart — after a
    // backfill they hold the same moments and answer the same numbers. This
    // one pulls them apart on purpose: two sentences only the log has, one
    // legacy row only analytics_events has. Reading the legacy table would
    // answer 1.
    const db = await harness.db();
    await db.query(`INSERT INTO artifacts (id, token_id, user_id, content) VALUES ('art0a1', 'tok_a', 'usr_a', 'x')`);
    await ensureEventsSchema(db, EVENTS_SCHEMA);
    await db.query(
      `INSERT INTO ${EVENTS_SCHEMA}.events (id, at, source, subject_kind, subject_id, verb, object_kind, object_id, payload)
       VALUES ('e1', now(), 'app', 'visitor', 'v1', 'viewed', 'artifact', 'art0a1', '{}'),
              ('e2', now(), 'app', 'visitor', 'v2', 'viewed', 'artifact', 'art0a1', '{}')`,
    );
    await db.query(`INSERT INTO analytics_events (event, artifact_id, visitor) VALUES ('view', 'art0a1', 'v3')`);
    expect((await viewSeriesByUser('usr_a')).get('art0a1')![VIEW_SERIES_DAYS - 1]).toBe(2);
    expect((await dailyViewsByUser('usr_a')).at(-1)?.views).toBe(2);
  });

  it('with no events table, the legacy table answers — a split self-host without the service keeps its dashboard', async () => {
    const db = await harness.db();
    await seedHistory(db);
    expect(await eventsTablePresent()).toBe(false);
    expect(asObject(await viewSeriesByUser('usr_a'))).toEqual(asObject(await oracleSeries(db, 'usr_a', VIEW_SERIES_DAYS)));
    expect(await dailyViewsByUser('usr_a')).toEqual(await oracleDaily(db, 'usr_a'));
  });
  it('live, through the real writer: two opens by one visitor today count once, a second visitor counts', async () => {
    const db = await harness.db();
    const queryable: Queryable = { query: async <T = Record<string, unknown>>(sql: string, params: unknown[] = []) => ({ rows: (await db.query<T>(sql, params)).rows }) };
    setServices({ events: createEvents({ db: queryable, schema: EVENTS_SCHEMA }) });
    await db.query(`INSERT INTO artifacts (id, token_id, user_id, content) VALUES ('art0a1', 'tok_a', 'usr_a', 'x')`);
    requestHeaders.set('user-agent', 'Mozilla/5.0 (visitor one)');
    await trackEvent('view', 'art0a1');
    await trackEvent('view', 'art0a1');
    requestHeaders.set('user-agent', 'Mozilla/5.0 (visitor two)');
    await trackEvent('view', 'art0a1');
    expect(await eventsTablePresent()).toBe(true);
    const rows = (await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM ${EVENTS_SCHEMA}.events WHERE verb = 'viewed'`)).rows[0]!.n;
    expect(rows).toBe(3);
    const series = (await viewSeriesByUser('usr_a')).get('art0a1')!;
    expect(series[VIEW_SERIES_DAYS - 1]).toBe(2);
    expect((await dailyViewsByUser('usr_a')).at(-1)?.views).toBe(2);
    expect(asObject(await viewSeriesByUser('usr_a'))).toEqual(asObject(await oracleSeries(db, 'usr_a', VIEW_SERIES_DAYS)));
  });
});

/**
 * MOVED from analytics.test.ts's `aggregates` describe when the two queries
 * left lib/analytics: the zero-fill, the window, and that an export is not a
 * view. The rows are seeded into the legacy table and copied, so the shapes
 * under test are exactly the ones the old suite pinned. (The half of the
 * second case that reads `listArtifactsByUser` stayed behind — that total is
 * still counted off analytics_events.)
 */
describe('the aggregates, over the log', () => {
  const withLog = async (db: Queryable): Promise<void> => {
    await ensureEventsSchema(db, EVENTS_SCHEMA);
    await backfillAnalyticsEvents(db, { schema: EVENTS_SCHEMA, from: 'analytics_events' });
  };

  it('viewSeriesByUser zero-fills daily buckets, oldest first', async () => {
    const db = await harness.db();
    await db.query(`INSERT INTO artifacts (id, token_id, user_id, content) VALUES ('art0a1', 'tok_a', 'usr_a', 'x')`);
    await db.query(
      `INSERT INTO analytics_events (event, artifact_id, created_at) VALUES
       ('view', 'art0a1', now()), ('view', 'art0a1', now()), ('view', 'art0a1', now() - interval '2 days'),
       ('export', 'art0a1', now())`,
    );
    await withLog(db);
    const series = (await viewSeriesByUser('usr_a')).get('art0a1');
    expect(series).toHaveLength(VIEW_SERIES_DAYS);
    expect(series![VIEW_SERIES_DAYS - 1]).toBe(2); // today
    expect(series![VIEW_SERIES_DAYS - 3]).toBe(1); // two days ago
    expect(series!.reduce((a, b) => a + b, 0)).toBe(3); // exports don't count
  });

  it('dailyViewsByUser buckets all owned artifacts per day, zero-filled to today', async () => {
    const db = await harness.db();
    await db.query(`INSERT INTO artifacts (id, token_id, user_id, content) VALUES ('art0a1', 'tok_a', 'usr_a', 'x'), ('art0a2', 'tok_a', 'usr_a', 'x')`);
    await db.query(
      `INSERT INTO analytics_events (event, artifact_id, created_at) VALUES
       ('view', 'art0a1', now()), ('view', 'art0a1', now()), ('view', 'art0a2', now()),
       ('view', 'art0a1', now() - interval '2 days'),
       ('export', 'art0a1', now())`,
    );
    await withLog(db);
    // Both artifacts pool into one series; the gap day is present as zero.
    const daily = await dailyViewsByUser('usr_a');
    expect(daily).toHaveLength(3);
    expect(daily.map((d) => d.views)).toEqual([1, 0, 3]);
    expect(daily[2].day > daily[0].day).toBe(true);
  });
});
