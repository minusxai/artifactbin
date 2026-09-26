/**
 * The runtime dataflow store: seeding, identity-stable snapshots, value
 * changes → dependents no longer current → a transport run (debounced for a
 * continuous input) → merged results, with superseded answers dropped. React-free.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDataflowStore, type QueryTransport } from '@/lib/story-runtime/store';
import type { DataflowState, Scalar } from '@/lib/story/dataflow';
import { compiledOf } from '@/test/helpers/compiled';

const SALES = { abc123: [{ name: 'region', type: 'string' as const }, { name: 'revenue', type: 'number' as const }] };
const flowOf = (helmetChildren: string) => compiledOf(helmetChildren, SALES);

const FLOW = await flowOf(
  '<Import name="sales_data" src="ref:abc123" />' +
  '<Value name="region" type="string" />' +
  '<Value name="min_rev" type="number" default={0} />' +
  '<Query name="sales">{`select * from sales_data.rows where region = $region and revenue >= $min_rev`}</Query>' +
  '<Query name="top">{`select * from sales limit 1`}</Query>' +
  '<Query name="other">{`select 1`}</Query>',
);
const STATE: DataflowState = {
  values: { region: null, min_rev: 0 },
  tables: { sales: { rows: [{ a: 1 }], columns: [{ name: 'a', type: 'number' }] }, top: { rows: [], columns: [] }, other: { rows: [{ one: 1 }], columns: [] } },
  errors: {},
};

function fakeTransport() {
  const calls: Array<{ values: Record<string, Scalar>; only: string[] }> = [];
  const resolvers: Array<(r: Pick<DataflowState, 'tables' | 'errors'>) => void> = [];
  const pages: Array<{ values: Record<string, Scalar>; name: string; page: unknown }> = [];
  const transport: QueryTransport = {
    run: (values, only) => {
      calls.push({ values, only });
      return new Promise((resolve) => { resolvers.push(resolve); });
    },
    page: async (values, name, page) => {
      pages.push({ values, name, page });
      return { rows: [{ paged: true }], columns: [] };
    },
  };
  return {
    transport, calls, pages,
    /** Resolve the newest run. */
    resolve: (r: Pick<DataflowState, 'tables' | 'errors'>) => resolvers[resolvers.length - 1](r),
    /** Resolve a specific run by index. */
    resolveNth: (i: number, r: Pick<DataflowState, 'tables' | 'errors'>) => resolvers[i](r),
  };
}

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

const TWO = await flowOf(
  '<Value name="region" type="string" />' +
  '<Value name="window" type="number" default={7} />' +
  '<Query name="sales">{`select $region as region`}</Query>' +
  '<Query name="trend">{`select $window as days`}</Query>',
);

describe('createDataflowStore', () => {
  it('seeds from the island and keeps snapshot identity until something changes', () => {
    const store = createDataflowStore({ flow: FLOW, state: STATE });
    const a = store.getState();
    expect(a.values).toEqual({ region: null, min_rev: 0 });
    expect(store.getTable('sales')?.rows).toEqual([{ a: 1 }]);
    expect(store.getState()).toBe(a);
    store.setValue('region', null); // no change
    expect(store.getState()).toBe(a);
  });

  it('seeds defaults for scalars the state omits', () => {
    const store = createDataflowStore({ flow: FLOW });
    expect(store.getState().values).toEqual({ region: null, min_rev: 0 });
    expect(store.getState().tables).toEqual({});
  });

  it('setValue updates a declared scalar, notifies, and ignores undeclared names', () => {
    const store = createDataflowStore({ flow: FLOW, state: STATE });
    const listener = vi.fn();
    store.subscribe(listener);
    store.setValue('region', 'EU');
    expect(store.getValue('region')).toBe('EU');
    expect(listener).toHaveBeenCalledTimes(1);
    store.setValue('bogus', 1);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(store.getState().values).toEqual({ region: 'EU', min_rev: 0 });
  });

  it('re-runs exactly the dependent queries (transitively) after the debounce, and merges results', async () => {
    const { transport, calls, resolve } = fakeTransport();
    const store = createDataflowStore({ flow: FLOW, state: STATE }, { transport, debounceMs: 100 });
    store.setValue('region', 'EU', { debounce: true });
    expect(calls).toHaveLength(0);
    vi.advanceTimersByTime(99);
    expect(calls).toHaveLength(0);
    vi.advanceTimersByTime(1);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual({ values: { region: 'EU', min_rev: 0 }, only: ['sales', 'top'] });
    expect([...store.pending()]).toEqual(['sales', 'top']);
    resolve({ tables: { sales: { rows: [{ a: 2 }], columns: [] }, top: { rows: [{ a: 2 }], columns: [] } }, errors: {} });
    await Promise.resolve(); await Promise.resolve();
    expect(store.getTable('sales')?.rows).toEqual([{ a: 2 }]);
    expect(store.getTable('other')?.rows).toEqual([{ one: 1 }]); // untouched
    expect(store.pending().size).toBe(0);
  });

  it('coalesces rapid changes into one run with the latest values', () => {
    const { transport, calls } = fakeTransport();
    const store = createDataflowStore({ flow: FLOW, state: STATE }, { transport, debounceMs: 100 });
    store.setValue('min_rev', 1, { debounce: true });
    vi.advanceTimersByTime(50);
    store.setValue('min_rev', 2, { debounce: true });
    vi.advanceTimersByTime(50);
    expect(calls).toHaveLength(0);
    vi.advanceTimersByTime(50);
    expect(calls).toHaveLength(1);
    expect(calls[0].values.min_rev).toBe(2);
  });

  it('drops a superseded run and applies only the newest', async () => {
    const { transport, calls, resolve, resolveNth } = fakeTransport();
    const store = createDataflowStore({ flow: FLOW, state: STATE }, { transport, debounceMs: 10 });
    store.setValue('region', 'EU');
    vi.advanceTimersByTime(10);
    // second change while the first run is in flight
    store.setValue('region', 'NA');
    vi.advanceTimersByTime(10);
    expect(calls).toHaveLength(2);
    // The FIRST run resolves late with stale data — must be ignored.
    resolveNth(0, { tables: { sales: { rows: [{ a: 'stale' }], columns: [] } }, errors: {} });
    await Promise.resolve(); await Promise.resolve();
    expect(store.getTable('sales')?.rows).toEqual([{ a: 1 }]);
    resolve({ tables: { sales: { rows: [{ a: 'fresh' }], columns: [] } }, errors: {} });
    await Promise.resolve(); await Promise.resolve();
    expect(store.getTable('sales')?.rows).toEqual([{ a: 'fresh' }]);
  });

  it('a query error replaces the table; a later success clears the error', async () => {
    const { transport, resolve } = fakeTransport();
    const store = createDataflowStore({ flow: FLOW, state: STATE }, { transport, debounceMs: 10 });
    store.setValue('region', 'EU');
    vi.advanceTimersByTime(10);
    resolve({ tables: { top: { rows: [], columns: [] } }, errors: { sales: 'boom' } });
    await Promise.resolve(); await Promise.resolve();
    expect(store.getTable('sales')).toBeUndefined();
    expect(store.getState().errors.sales).toBe('boom');
    store.setValue('region', 'NA');
    vi.advanceTimersByTime(10);
    resolve({ tables: { sales: { rows: [{ a: 3 }], columns: [] }, top: { rows: [], columns: [] } }, errors: {} });
    await Promise.resolve(); await Promise.resolve();
    expect(store.getState().errors.sales).toBeUndefined();
    expect(store.getTable('sales')?.rows).toEqual([{ a: 3 }]);
  });

  it('a rejected transport reports the message on every requested query', async () => {
    const transport: QueryTransport = { run: () => Promise.reject(new Error('offline')), page: () => Promise.reject(new Error('offline')) };
    const store = createDataflowStore({ flow: FLOW, state: STATE }, { transport, debounceMs: 10 });
    store.setValue('region', 'EU');
    vi.advanceTimersByTime(10);
    await Promise.resolve(); await Promise.resolve();
    expect(store.getState().errors).toEqual({ sales: 'offline', top: 'offline' });
  });

  it('without a transport values change and tables stay; attaching one flushes what is dirty', () => {
    const store = createDataflowStore({ flow: FLOW, state: STATE });
    store.setValue('region', 'EU');
    vi.advanceTimersByTime(1000);
    expect(store.getTable('sales')?.rows).toEqual([{ a: 1 }]);
    const { transport, calls } = fakeTransport();
    store.setTransport(transport);
    expect(calls).toHaveLength(1);
    expect(calls[0].only).toEqual(['sales', 'top']);
  });

  it('fetchPage reads a window through the transport with the CURRENT values, leaving tables alone', async () => {
    const { transport, pages } = fakeTransport();
    const store = createDataflowStore({ flow: FLOW, state: STATE }, { transport, debounceMs: 10 });
    store.setValue('region', 'EU');
    const r = await store.fetchPage('sales', { offset: 100, limit: 50, sort: { col: 'a', dir: 'desc' } });
    expect(pages[0]).toEqual({ values: { region: 'EU', min_rev: 0 }, name: 'sales', page: { offset: 100, limit: 50, sort: { col: 'a', dir: 'desc' } } });
    expect(r.rows).toEqual([{ paged: true }]);
    expect(store.getTable('sales')?.rows).toEqual([{ a: 1 }]);
    await expect(createDataflowStore({ flow: FLOW, state: STATE }).fetchPage('sales', { offset: 0, limit: 1 })).rejects.toThrow(/transport/);
  });

  it('refresh re-runs on demand', () => {
    const { transport, calls } = fakeTransport();
    const store = createDataflowStore({ flow: FLOW, state: STATE }, { transport });
    store.refresh(['other']);
    expect(calls[0].only).toEqual(['other']);
    store.refresh();
    expect(calls[1].only.sort()).toEqual(['other', 'sales', 'top']);
  });
});

/*
 * One run never strands another. A result is judged by the versions of what
 * ITS queries read, not by whether it came from the newest run — so a run for
 * `sales` survives a later run for `trend` that a different value started.
 */
describe('independent runs', () => {
  const TWO_STATE: DataflowState = {
    values: { region: null, window: 7 },
    tables: { sales: { rows: [{ region: null }], columns: [] }, trend: { rows: [{ days: 7 }], columns: [] } },
    errors: {},
  };
  const settle = async () => { for (let i = 0; i < 5; i++) await Promise.resolve(); };

  it('a run for one value is applied although a run for another value started while it was in flight', async () => {
    const { transport, calls, resolveNth } = fakeTransport();
    const store = createDataflowStore({ flow: TWO, state: TWO_STATE }, { transport, debounceMs: 10 });
    store.setValue('region', 'EU');
    vi.advanceTimersByTime(10);
    store.setValue('window', 30);
    vi.advanceTimersByTime(10);
    expect(calls.map((c) => c.only)).toEqual([['sales'], ['trend']]);
    resolveNth(0, { tables: { sales: { rows: [{ region: 'EU' }], columns: [] } }, errors: {} });
    resolveNth(1, { tables: { trend: { rows: [{ days: 30 }], columns: [] } }, errors: {} });
    await settle();
    expect(store.getTable('sales')?.rows).toEqual([{ region: 'EU' }]);
    expect(store.getTable('trend')?.rows).toEqual([{ days: 30 }]);
    expect(store.pending().size).toBe(0);
  });

  it('a dataset invalidation does not strand a reader run already in flight', async () => {
    const flow = await flowOf(
      '<Import name="stock_data" src="ref:abc123" />' +
      '<Value name="region" type="string" />' +
      '<Query name="sales">{`select $region as region`}</Query>' +
      '<Query name="stock">{`select * from stock_data.rows`}</Query>',
    );
    const { transport, calls, resolveNth } = fakeTransport();
    const store = createDataflowStore({ flow, state: { values: { region: null }, tables: {}, errors: {} } }, { transport, debounceMs: 10 });
    store.setValue('region', 'EU');
    vi.advanceTimersByTime(10);
    store.invalidateDatasets(['abc123']);
    expect(calls.map((c) => c.only)).toEqual([['sales'], ['stock']]);
    resolveNth(0, { tables: { sales: { rows: [{ region: 'EU' }], columns: [] } }, errors: {} });
    resolveNth(1, { tables: { stock: { rows: [{ n: 1 }], columns: [] } }, errors: {} });
    await settle();
    expect(store.getTable('sales')?.rows).toEqual([{ region: 'EU' }]);
    expect(store.getTable('stock')?.rows).toEqual([{ n: 1 }]);
    expect(store.pending().size).toBe(0);
  });
});

// This file runs on fake timers; disposal is about a real pending promise,
// not a debounce, and its transport must actually be called on start().
describe('document store disposal', () => {
  beforeEach(() => { vi.useRealTimers(); });

  it('revokes pending results and later writes/subscriptions', async () => {
    let finish!: (value: {tables: {}; errors: {}}) => void;
    const run = vi.fn(() => new Promise<{tables: {}; errors: {}}>(resolve => { finish = resolve; }));
    const transport = { run, page: vi.fn() } satisfies QueryTransport;
    const store = createDataflowStore({ flow: await flowOf('<Value name="n" type="number" default={0} /><Query name="q">{`select 1 as one`}</Query>') }, { transport });
    store.start();
    const before = store.getState();
    const listener = vi.fn();
    store.subscribe(listener);
    store.dispose();
    store.setValue('n', 5);
    store.refresh();
    finish({tables:{},errors:{}});
    await Promise.resolve();
    expect(store.getState()).toBe(before);
    expect(listener).not.toHaveBeenCalled();
    expect(run).toHaveBeenCalledTimes(1);
    const late = vi.fn(); store.subscribe(late); store.setValue('n', 6);
    expect(late).not.toHaveBeenCalled();
  });
});
