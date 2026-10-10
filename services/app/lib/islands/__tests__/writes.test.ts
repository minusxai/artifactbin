// DESTINATION: services/app/lib/islands/__tests__/writes.test.ts
/**
 * OPTIMISTIC WRITES AND THE STATUS FEED (docs/phase2-architecture.md; lib/islands/contract WriteStatus):
 * every write appears at once and the feed says saving, then saved (dropped after its TTL) or failed
 * — a refused change stays visible and marked, with the reason and a retry. Framework-free: the feed
 * wraps the existing store's write events and a transport.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createWriteStatusFeed } from '../writes';
import { SAVED_STATUS_TTL_MS } from '../contract';
import { createDataflowStore } from '@/lib/story-runtime/store';
import type { CompiledDataflow } from '@/lib/dataflow';

const flow: CompiledDataflow = {
  imports: [{ name: 'd', ref: 'DS1', tables: [{ name: 'rows', columns: [{ name: 'n', type: 'number' }] }] }],
  values: [],
  queries: [{ name: 'rows', engine: 'sqlite', sql: 'select count(*) as n from d.rows', params: [], reads: { imports: ['d'], queries: [], values: [], builtins: [] }, columns: [{ name: 'n', type: 'number' }], start: 0, end: 0 }],
  mutations: [{ name: 'add', sql: 'insert into d.rows values (2)', target: { import: 'd', table: 'rows' }, args: [], reads: { imports: ['d'], queries: [], values: [], builtins: [] }, start: 0, end: 0 }],
};

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

const storeWith = (mutate: () => Promise<{ dataset: string }>) => createDataflowStore({ flow }, {
  transport: { run: async () => ({ tables: {}, errors: {} }), page: async () => ({ rows: [], columns: [] }), mutate },
});

describe('createWriteStatusFeed', () => {
  it('reports saving, then saved, then drops the entry after its TTL', async () => {
    let settle!: (v: { dataset: string }) => void;
    const store = storeWith(() => new Promise((resolve) => { settle = resolve; }));
    const feed = createWriteStatusFeed(store);
    const seen: string[][] = [];
    feed.subscribe((statuses) => seen.push(statuses.map((s) => `${s.mutation}:${s.state}`)));
    const done = store.mutate({ mutation: 'add', args: {} } as never);
    expect(feed.current().map((s) => s.state)).toEqual(['saving']);
    settle({ dataset: 'DS1' });
    await done;
    expect(feed.current().map((s) => s.state)).toEqual(['saved']);
    feed.dismiss(feed.current()[0]!.id);
    expect(feed.current().map((s) => s.state), 'ordinary saved entries leave only when their timer expires').toEqual(['saved']);
    vi.advanceTimersByTime(SAVED_STATUS_TTL_MS + 1);
    expect(feed.current()).toEqual([]);
    expect(seen).toEqual([['add:saving'], ['add:saved'], []]);
  });

  it('keeps a failed write marked with the server\'s reason and retries the same write on request', async () => {
    const mutate = vi.fn<() => Promise<{ dataset: string }>>().mockRejectedValueOnce(Object.assign(new Error('Sign in to add a row'), {code:'access_denied'})).mockResolvedValueOnce({ dataset: 'DS1' });
    const store = storeWith(mutate);
    const feed = createWriteStatusFeed(store);
    await store.mutate({ mutation: 'add', args: {} } as never).catch(() => {});
    const [failed] = feed.current();
    expect(failed).toMatchObject({ mutation: 'add', state: 'failed', error: { message: 'Sign in to add a row', code:'access_denied' } });
    vi.advanceTimersByTime(SAVED_STATUS_TTL_MS * 10);
    expect(feed.current(), 'a failure never vanishes on its own').toHaveLength(1);
    failed!.error!.retry();
    await vi.runAllTimersAsync();
    expect(mutate).toHaveBeenCalledTimes(2);
    expect(feed.current().filter((s) => s.state === 'failed')).toEqual([]);
  });
});

it('retains a notifying saved run for status discovery until explicitly dismissed',async()=>{
 const store=storeWith(async()=>({dataset:'DS1',mutationRunId:'run-1'}));
 const feed=createWriteStatusFeed(store);await store.mutate({mutation:'add',args:{}} as never);
 expect(feed.current()[0]).toMatchObject({state:'saved',mutationRunId:'run-1'});
 vi.advanceTimersByTime(SAVED_STATUS_TTL_MS+1);expect(feed.current()).toHaveLength(1);
 feed.dismiss(feed.current()[0]!.id);expect(feed.current()).toEqual([]);
});
