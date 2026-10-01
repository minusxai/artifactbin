/**
 * The dashboard's view queries read the events log (lib/workspace-analytics): one sentence per open, deduped
 * per UTC day on the subject (a null subject counts once), zero-filled to today; with no log table the answers
 * are empty, never an error. And live: the real in-process writer, two opens by one visitor today count once.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Queryable } from '@artifactbin/contracts';
import { createEvents, ensureEventsSchema } from '@artifactbin/events/local';
import { useAppHarness } from '@/__tests__/harness';
import { trackEvent } from '@/lib/analytics';
import { EVENTS_SCHEMA } from '@/lib/config';
import { dailyViewsByUser, eventsTablePresent, forkCountByUser, viewSeriesByUser, VIEW_SERIES_DAYS } from '@/lib/workspace-analytics';
import { setServices } from '@/lib/services';

const harness = useAppHarness();

// The request the live test's views arrive on: a user-agent is what makes a visitor hash.
const requestHeaders = new Map<string, string>();
vi.mock('@/lib/request-context', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/request-context')>()),
  currentHeaders: async () => (requestHeaders.size === 0 ? null : { get: (k: string) => requestHeaders.get(k.toLowerCase()) ?? null }),
}));

/** One view sentence in the log: subject = the daily visitor hash (null counts once), object = the artifact. */
type Moment = [verb: 'viewed' | 'exported' | 'forked', artifact: string, subject: string | null, at: string];
async function seedLog(db: Queryable, moments: Moment[]): Promise<void> {
  await ensureEventsSchema(db, EVENTS_SCHEMA);
  let n = 0;
  for (const [verb, artifact, subject, when] of moments) {
    await db.query(
      `INSERT INTO ${EVENTS_SCHEMA}.events (id, at, source, subject_kind, subject_id, verb, object_kind, object_id, payload)
       VALUES ($1, $2, 'app', $3, $4, $5, 'artifact', $6, '{}')`,
      [`m${++n}`, when, subject === null ? null : 'visitor', subject, verb, artifact],
    );
  }
}

const at = (daysAgo: number, minute: number, now = Date.now()) => new Date(Math.floor(now / 86_400_000) * 86_400_000 - daysAgo * 86_400_000 + minute * 60_000).toISOString();

it.each(['2026-09-10T00:01:00Z', '2026-09-10T23:59:00Z'])('history timestamps stay in their intended UTC day at %s', (now) => {
  expect(at(39, 9, Date.parse(now))).toBe('2026-08-02T00:09:00.000Z');
});

beforeEach(async () => {
  requestHeaders.clear();
  const db = await harness.db();
  await db.query(`DROP SCHEMA IF EXISTS ${EVENTS_SCHEMA} CASCADE`);
});

describe('the dashboard reads the log', () => {
  it('counts distinct subjects per UTC day, a null subject once each, other owners and non-views never', async () => {
    const db = await harness.db();
    await db.query(`INSERT INTO artifacts (id, token_id, user_id) VALUES ('art0a1', 'tok_a', 'usr_a'), ('art0b1', 'tok_b', 'usr_b')`);
    await seedLog(db, [
      ['viewed', 'art0a1', 'v1', at(0, 1)], ['viewed', 'art0a1', 'v1', at(0, 2)], ['viewed', 'art0a1', 'v2', at(0, 3)],
      ['viewed', 'art0a1', null, at(0, 4)], ['viewed', 'art0a1', null, at(0, 5)],
      ['viewed', 'art0a1', 'v1', at(2, 1)],
      ['viewed', 'art0a1', 'old', at(40, 1)],
      ['exported', 'art0a1', 'v1', at(0, 6)],
      ['viewed', 'art0b1', 'v1', at(0, 7)],
    ]);
    const series = (await viewSeriesByUser('usr_a')).get('art0a1')!;
    expect(series).toHaveLength(VIEW_SERIES_DAYS);
    expect(series[VIEW_SERIES_DAYS - 1]).toBe(4); // v1, v2, and two visitor-less opens
    expect(series[VIEW_SERIES_DAYS - 3]).toBe(1);
    expect(series.reduce((a, b) => a + b, 0)).toBe(5); // the 40-day-old view is outside the window
    expect([...(await viewSeriesByUser('usr_a', 45)).get('art0a1')!].reduce((a, b) => a + b, 0)).toBe(6);
    expect((await viewSeriesByUser('usr_b')).get('art0b1')![VIEW_SERIES_DAYS - 1]).toBe(1);
    expect((await viewSeriesByUser('usr_nobody')).size).toBe(0);
    const daily = await dailyViewsByUser('usr_a');
    expect(daily.length).toBeGreaterThanOrEqual(41);
    expect(daily.at(-1)?.views).toBe(4);
  });

  it('with no events table the answers are empty, never an error', async () => {
    const db = await harness.db();
    await db.query(`INSERT INTO artifacts (id, token_id, user_id) VALUES ('art0a1', 'tok_a', 'usr_a')`);
    await db.query(`INSERT INTO analytics_events (event, artifact_id, visitor) VALUES ('view', 'art0a1', 'v1')`);
    expect(await eventsTablePresent()).toBe(false);
    expect((await viewSeriesByUser('usr_a')).size).toBe(0);
    expect(await dailyViewsByUser('usr_a')).toEqual([]);
    expect(await forkCountByUser('usr_a')).toBe(0);
  });
  it('live, through the real writer: two opens by one visitor today count once, a second visitor counts', async () => {
    const db = await harness.db();
    const queryable: Queryable = { query: async <T = Record<string, unknown>>(sql: string, params: unknown[] = []) => ({ rows: (await db.query<T>(sql, params)).rows }) };
    setServices({ events: createEvents({ db: queryable, schema: EVENTS_SCHEMA }) });
    await db.query(`INSERT INTO artifacts (id, token_id, user_id) VALUES ('art0a1', 'tok_a', 'usr_a')`);
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
  });
});

/** The zero-fill, the window, and that an export is not a view. */
describe('the aggregates, over the log', () => {
  it('viewSeriesByUser zero-fills daily buckets, oldest first', async () => {
    const db = await harness.db();
    await db.query(`INSERT INTO artifacts (id, token_id, user_id) VALUES ('art0a1', 'tok_a', 'usr_a')`);
    await seedLog(db, [['viewed', 'art0a1', 'a', at(0, 1)], ['viewed', 'art0a1', 'b', at(0, 2)], ['viewed', 'art0a1', 'a', at(2, 1)], ['exported', 'art0a1', 'a', at(0, 3)]]);
    const series = (await viewSeriesByUser('usr_a')).get('art0a1');
    expect(series).toHaveLength(VIEW_SERIES_DAYS);
    expect(series![VIEW_SERIES_DAYS - 1]).toBe(2); // today
    expect(series![VIEW_SERIES_DAYS - 3]).toBe(1); // two days ago
    expect(series!.reduce((a, b) => a + b, 0)).toBe(3); // exports don't count
  });

  it('dailyViewsByUser buckets all owned artifacts per day, zero-filled to today', async () => {
    const db = await harness.db();
    await db.query(`INSERT INTO artifacts (id, token_id, user_id) VALUES ('art0a1', 'tok_a', 'usr_a'), ('art0a2', 'tok_a', 'usr_a')`);
    await seedLog(db, [['viewed', 'art0a1', 'a', at(0, 1)], ['viewed', 'art0a1', 'b', at(0, 2)], ['viewed', 'art0a2', 'c', at(0, 3)], ['viewed', 'art0a1', 'a', at(2, 1)], ['exported', 'art0a1', 'a', at(0, 4)]]);
    // Both artifacts pool into one series; the gap day is present as zero.
    const daily = await dailyViewsByUser('usr_a');
    expect(daily).toHaveLength(3);
    expect(daily.map((d) => d.views)).toEqual([1, 0, 3]);
    expect(daily[2].day > daily[0].day).toBe(true);
  });
});
