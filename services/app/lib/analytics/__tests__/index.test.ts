/** Canonical analytics through real writers and readers; retired history remains untouched. */
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createEvents, ensureEventsSchema } from '@artifactbin/events/local';
import { useAppHarness } from '@/__tests__/harness';
import { EVENTS_SCHEMA, envelope, overrideRequestHeaders, services, setServices } from '@/lib/platform';
import { flushViews, recordView, trackEvent, viewTotalsFor, viewSeriesFor, forgetEventsTable } from '..';

const harness = useAppHarness();
const headers = new Map<string, string>();
overrideRequestHeaders(() => headers.size ? [...headers] : null);
const previous = services().events;
beforeEach(async () => {
  headers.clear();
  headers.set('user-agent', 'Mozilla/5.0 (test)');
  const db = await harness.db();
  await ensureEventsSchema(db, EVENTS_SCHEMA);
  setServices({ events: createEvents({ db, schema: EVENTS_SCHEMA }) });
});
afterAll(() => setServices({ events: previous }));
const retired = async () => (await (await harness.db()).query('SELECT * FROM analytics_events')).rows;
const log = async () => (await (await harness.db()).query<{ verb: string; subject_kind: string | null; subject_id: string | null; payload: { user_id: string | null } }>(`SELECT * FROM ${EVENTS_SCHEMA}.events ORDER BY position`)).rows;

describe('canonical writers', () => {
  it('writes only the log, preserves signed-in payload and daily visitor identity', async () => {
    await trackEvent('view', 'art1', { userId: 'usr1' });
    await trackEvent('view', 'art1', { userId: 'usr1' });
    await trackEvent('view', 'art1', { userId: 'usr2' });
    await trackEvent('view', 'art1');
    const rows = await log();
    expect(rows).toHaveLength(4);
    expect(rows[0]).toMatchObject({ verb: 'viewed', subject_kind: 'visitor', payload: { user_id: 'usr1' } });
    expect(rows[0].subject_id).toMatch(/^[0-9a-f]{32}$/);
    expect(new Set(rows.map(r => r.subject_id)).size).toBe(3);
    expect(await retired()).toEqual([]);
    expect((await viewTotalsFor(['art1'])).get('art1')).toBe(3);
  });

  it('batches served views and resolves all callers without retired writes', async () => {
    const pending = [recordView('art1'), recordView('art1'), recordView('art2', { userId: 'usr2' })];
    await Promise.resolve();
    await Promise.resolve();
    await flushViews();
    await Promise.all(pending);
    expect(await log()).toHaveLength(3);
    expect(await retired()).toEqual([]);
    expect(Object.fromEntries(await viewTotalsFor(['art1', 'art2']))).toEqual({ art1: 1, art2: 1 });
    await flushViews();
    expect(await log()).toHaveLength(3);
  });

  it('keeps buffered opens on their original UTC day across midnight', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      vi.setSystemTime(new Date('2026-11-11T23:59:00Z'));
      const first = recordView('art1');
      await Promise.resolve();
      await Promise.resolve();
      vi.setSystemTime(new Date('2026-11-12T00:01:00Z'));
      const second = recordView('art1');
      await Promise.resolve();
      await Promise.resolve();
      await flushViews();
      await Promise.all([first, second]);
      expect(new Set((await log()).map(r => r.subject_id)).size).toBe(2);
      expect((await viewTotalsFor(['art1'])).get('art1')).toBe(2);
      // The database clock is real; inspect stored UTC buckets independently of the series window.
      const days = await (await harness.db()).query<{ day: string }>(`SELECT to_char(at AT TIME ZONE 'UTC','YYYY-MM-DD') AS day FROM ${EVENTS_SCHEMA}.events ORDER BY at`);
      expect(days.rows.map(r => r.day)).toEqual(['2026-11-11', '2026-11-12']);
    } finally { vi.useRealTimers(); }
  });

  it('keeps anonymous off-request views separate and ignores non-view telemetry', async () => {
    headers.clear();
    await trackEvent('view', 'art1');
    await trackEvent('view', 'art1');
    await trackEvent('export', 'art1', { userId: 'usr1' });
    await trackEvent('sse_connect', 'art1');
    expect(await log()).toHaveLength(3);
    expect((await log())[0].subject_id).toBeNull();
    expect((await viewTotalsFor(['art1'])).get('art1')).toBe(2);
    expect(await retired()).toEqual([]);
  });

  it('never rejects when the events service fails, including buffered views', async () => {
    setServices({ events: { emit: vi.fn().mockRejectedValue(new Error('unavailable')) } });
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      await expect(trackEvent('edit', 'art1')).resolves.toBeUndefined();
      const pending = recordView('art1');
      await Promise.resolve();
      await Promise.resolve();
      await expect(flushViews()).resolves.toBeUndefined();
      await expect(pending).resolves.toBeUndefined();
    } finally { error.mockRestore(); }
  });
});

describe('canonical readers and history boundary', () => {
  it('dedupes within UTC days, counts different days and null subjects, ignores legacy caches', async () => {
    const db = await harness.db();
    await db.query("SET TIME ZONE 'America/Los_Angeles'");
    try {
      await db.query(`INSERT INTO ${EVENTS_SCHEMA}.events (id,at,source,verb,object_kind,object_id,subject_kind,subject_id)
        SELECT id, at::timestamptz, 'app', verb, kind, 'art1', 'visitor', visitor FROM (VALUES
        ('a','2026-01-01T23:59:00Z','viewed','artifact','v1'),
        ('b','2026-01-01T23:59:30Z','viewed','artifact','v1'),
        ('c','2026-01-02T00:01:00Z','viewed','artifact','v1'),
        ('d','2026-01-02T00:02:00Z','viewed','artifact','v2'),
        ('e','2026-01-02T00:03:00Z','viewed','artifact',NULL),
        ('f','2026-01-02T00:04:00Z','viewed','artifact',NULL),
        ('g','2026-01-02T00:05:00Z','exported','artifact','v3'),
        ('h','2026-01-02T00:06:00Z','viewed','user','v4')) x(id,at,verb,kind,visitor)`);
      await db.query("INSERT INTO analytics_events (event,artifact_id,visitor) VALUES ('view','legacy','v')");
      await db.query("INSERT INTO artifact_view_totals (artifact_id,closed_through,views) VALUES ('art1','2026-01-01',999),('legacy','2026-01-01',888)");
      expect(Object.fromEntries(await viewTotalsFor(['art1', 'legacy', 'never']))).toEqual({ art1: 5, legacy: 0, never: 0 });
      expect((await db.query('SELECT views FROM artifact_view_totals ORDER BY artifact_id')).rows).toEqual([{ views: 999 }, { views: 888 }]);
      expect(await retired()).toHaveLength(1);
    } finally { await db.query("SET TIME ZONE 'UTC'"); }
  });

  it('reads a batched zero-filled series from canonical events and tolerates an absent table', async () => {
    await trackEvent('view', 'art1');
    await trackEvent('view', 'art1');
    const series = await viewSeriesFor(['art1', 'never'], 14);
    expect(series.get('art1')).toHaveLength(14);
    expect(series.get('art1')!.at(-1)).toBe(1);
    expect((await viewTotalsFor([])).size).toBe(0);
    const db = await harness.db();
    await db.query(`ALTER TABLE ${EVENTS_SCHEMA}.events RENAME TO unavailable_events`);
    forgetEventsTable();
    try {
      expect(Object.fromEntries(await viewTotalsFor(['art1']))).toEqual({ art1: 0 });
      expect((await viewSeriesFor(['art1'])).size).toBe(0);
    } finally { await db.query(`ALTER TABLE ${EVENTS_SCHEMA}.unavailable_events RENAME TO events`); }
  });
});


describe('incremental canonical totals', () => {
  const append = async (id: string, visitor: string | null, at: string, artifact = 'art1') => {
    const event = envelope(visitor ? { kind: 'visitor', id: visitor } : null, 'viewed', { kind: 'artifact', id: artifact }, {});
    await services().events.emit([{ ...event, id, at }]);
  };

  it('folds late events and concurrent overlapping batches without double counting, even after pruning', async () => {
    await append('first', 'v1', '2026-01-01T23:59:00Z');
    expect(Object.fromEntries(await viewTotalsFor(['art1', 'art2']))).toEqual({ art1: 1, art2: 0 });
    const db = await harness.db();
    // A folded membership survives source pruning and still dedupes a later delivery.
    await db.query(`DELETE FROM ${EVENTS_SCHEMA}.events`);
    expect((await viewTotalsFor(['art1'])).get('art1')).toBe(1);
    await append('late-repeat', 'v1', '2026-01-01T23:50:00Z');
    await append('late-new', 'v2', '2026-01-01T00:01:00Z');
    await append('next-day', 'v1', '2026-01-02T00:01:00Z');
    await append('anonymous1', null, '2026-01-01T00:01:00Z');
    await append('anonymous2', null, '2026-01-01T00:01:00Z');
    await append('other', 'v1', '2026-01-01T00:01:00Z', 'art2');
    const racers = await Promise.all([
      viewTotalsFor(['art1', 'art2']), viewTotalsFor(['art2', 'art1']), viewTotalsFor(['art1']),
    ]);
    expect(Object.fromEntries(racers[0])).toEqual({ art1: 5, art2: 1 });
    expect(Object.fromEntries(racers[1])).toEqual({ art2: 1, art1: 5 });
    expect(racers[2].get('art1')).toBe(5);
    expect((await viewTotalsFor(['art1'])).get('art1')).toBe(5);
  });

  it('does not read folded event rows again on unchanged listings', async () => {
    await append('once', 'v1', '2026-01-01T00:01:00Z');
    await viewTotalsFor(['art1']);
    const db = await harness.db();
    // A retained row whose timestamp can no longer be read proves the incremental predicate
    // excludes old positions, rather than a query-count assertion hiding a full-history scan.
    await db.query(`ALTER TABLE ${EVENTS_SCHEMA}.events RENAME TO stored_events`);
    await db.query(`CREATE VIEW ${EVENTS_SCHEMA}.events AS SELECT id,
      CASE WHEN id='once' THEN ('unreadable-' || id)::timestamptz ELSE at END AS at,
      source, subject_kind, subject_id, verb, object_kind, object_id, payload, position FROM ${EVENTS_SCHEMA}.stored_events`);
    try {
      expect((await viewTotalsFor(['art1'])).get('art1')).toBe(1);
      // The fold path must exclude old positions too, even when a new late event needs folding.
      await db.query(`INSERT INTO ${EVENTS_SCHEMA}.stored_events (id,at,source,verb,object_kind,object_id,subject_id,position)
        SELECT 'fresh', '2026-01-01T00:00:00Z', 'app', 'viewed', 'artifact', 'art1', 'v2', max(position)+1
        FROM ${EVENTS_SCHEMA}.stored_events`);
      expect((await viewTotalsFor(['art1'])).get('art1')).toBe(2);
    } finally {
      await db.query(`DROP VIEW ${EVENTS_SCHEMA}.events`);
      await db.query(`ALTER TABLE ${EVENTS_SCHEMA}.stored_events RENAME TO events`);
    }
  });
});


it('isolates canonical source versions and rolls memberships and cursor back together', async () => {
  const db = await harness.db();
  await db.query(`INSERT INTO canonical_view_totals (source,artifact_id,position,views) VALUES ('different-source','art1',99999,999)`);
  await trackEvent('view', 'art1');
  const transaction = db.transaction.bind(db);
  const injected = vi.spyOn(db, 'transaction').mockImplementation(fn => transaction(async tx => {
    await fn(tx);
    throw new Error('abort fold');
  }));
  try {
    await expect(viewTotalsFor(['art1'])).rejects.toThrow('abort fold');
  } finally { injected.mockRestore(); }
  expect((await db.query('SELECT * FROM canonical_view_visitors')).rows).toEqual([]);
  expect((await db.query('SELECT views FROM canonical_view_totals')).rows).toEqual([{ views: 999 }]);
  expect((await viewTotalsFor(['art1'])).get('art1')).toBe(1);
});
