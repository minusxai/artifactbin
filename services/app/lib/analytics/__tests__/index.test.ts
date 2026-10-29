/** lib/analytics through its index, on the in-memory database: the counter rows, the batched views and the all-time totals. */
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeEvents, type FakeEvents } from '@artifactbin/utils';
import { useAppHarness } from '@/__tests__/harness';
import { getDb, overrideRequestHeaders, services, setServices } from '@/lib/platform';
import { flushViews, recordView, trackEvent, viewTotalsFor } from '..';

const harness = useAppHarness();
const headers = new Map<string, string>([['user-agent', 'Mozilla/5.0 (test)']]);
overrideRequestHeaders(() => (headers.size === 0 ? null : [...headers]));

let fake: FakeEvents;
const previous = services().events;
beforeEach(() => { fake = fakeEvents(); setServices({ events: fake }); });
afterAll(() => setServices({ events: previous }));

const rows = async () => (await (await harness.db()).query<{ event: string; artifact_id: string; user_id: string | null; visitor: string | null }>(
  'SELECT event, artifact_id, user_id, visitor FROM analytics_events ORDER BY seq')).rows;

describe('trackEvent', () => {
  it('writes the counter row with a daily visitor hash, never the raw agent', async () => {
    await trackEvent('export', 'art1', { userId: 'usr_1' });
    const [row] = await rows();
    expect(row).toMatchObject({ event: 'export', artifact_id: 'art1', user_id: 'usr_1' });
    expect(row!.visitor).toMatch(/^[0-9a-f]{32}$/);
    expect(fake.events.map((e) => e.verb)).toEqual(['exported']);
  });

  it('has no visitor off a request, and never rejects when the insert fails', async () => {
    headers.clear();
    try {
      await trackEvent('sse_connect', 'art1');
      expect((await rows())[0]).toMatchObject({ event: 'sse_connect', visitor: null });
      expect(fake.events).toHaveLength(0);
      const db = await getDb();
      const query = vi.spyOn(db, 'query').mockRejectedValueOnce(new Error('down'));
      await expect(trackEvent('edit', 'art1')).resolves.toBeUndefined();
      query.mockRestore();
      expect(await rows()).toHaveLength(1);
    } finally {
      headers.set('user-agent', 'Mozilla/5.0 (test)');
    }
  });
});

describe('recordView and flushViews', () => {
  it('buffers views into one batch that a flush writes and resolves', async () => {
    let settled = 0;
    const views = [recordView('art1').then(() => settled++), recordView('art2', { userId: 'usr_2' }).then(() => settled++)];
    await Promise.resolve();
    expect(await rows()).toHaveLength(0);
    expect(settled).toBe(0);
    await flushViews();
    await Promise.all(views);
    expect(settled).toBe(2);
    expect((await rows()).map((r) => [r.event, r.artifact_id, r.user_id])).toEqual([['view', 'art1', null], ['view', 'art2', 'usr_2']]);
    expect(fake.events.map((e) => [e.verb, e.object_id, e.subject_kind])).toEqual([['viewed', 'art1', 'visitor'], ['viewed', 'art2', 'visitor']]);
  });

  it('is a no-op with nothing pending', async () => {
    await flushViews();
    expect(await rows()).toHaveLength(0);
    expect(fake.events).toHaveLength(0);
  });
});

describe('viewTotalsFor', () => {
  const insert = async (artifact: string, visitor: string | null, daysAgo: number, event = 'view') => (await harness.db()).query(
    `INSERT INTO analytics_events (event, artifact_id, visitor, created_at) VALUES ($1, $2, $3, now() - make_interval(days => $4))`, [event, artifact, visitor, daysAgo]);

  it('answers every id, zero when never viewed, and nothing for no ids', async () => {
    expect((await viewTotalsFor([])).size).toBe(0);
    expect([...await viewTotalsFor(['never'])]).toEqual([['never', 0]]);
  });

  it('counts unique visitors per day, each legacy row once, views only, and folds the closed days', async () => {
    await insert('art1', 'v1', 3);
    await insert('art1', 'v1', 2);
    await insert('art1', 'v1', 2);
    await insert('art1', null, 2);
    await insert('art1', null, 2);
    await insert('art1', 'v2', 0);
    await insert('art1', 'v2', 0);
    await insert('art1', 'v3', 0, 'export');
    await insert('art2', 'v1', 1);
    expect(Object.fromEntries(await viewTotalsFor(['art1', 'art2']))).toEqual({ art1: 5, art2: 1 });
    const folded = (await (await harness.db()).query<{ artifact_id: string; views: number }>('SELECT artifact_id, views FROM artifact_view_totals ORDER BY artifact_id')).rows;
    expect(folded).toEqual([{ artifact_id: 'art1', views: 4 }, { artifact_id: 'art2', views: 1 }]);
    await insert('art1', 'v4', 0);
    expect((await viewTotalsFor(['art1'])).get('art1')).toBe(6);
  });
});
