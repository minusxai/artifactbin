/**
 * The runtime dataflow store: seeding, identity-stable snapshots, value
 * changes → dirty dependents → a debounced transport run → merged results,
 * with superseded runs dropped. React-free.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseJsx, type JsxNode } from '@/lib/jsx';
import { splitHelmet } from '@/lib/story/helmet';
import { createDataflowStore, type QueryTransport } from '@/lib/story-runtime/store';
import type { Dataflow, DataflowState, Scalar } from '@/lib/story/dataflow';

const flowOf = (helmetChildren: string): Dataflow => {
  const parsed = parseJsx(`<Helmet>${helmetChildren}</Helmet>`);
  if (!parsed.ok) throw new Error(parsed.error);
  const { content } = splitHelmet(parsed.nodes as JsxNode[]);
  return { values: content.values, queries: content.queries };
};

const FLOW = flowOf(
  '<Value name="region" type="string" />' +
  '<Value name="min_rev" type="number" default={0} />' +
  '<Query name="sales">{`select * from ref_abc123 where region = $region and revenue >= $min_rev`}</Query>' +
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
    store.setValue('region', 'EU');
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
    store.setValue('min_rev', 1);
    vi.advanceTimersByTime(50);
    store.setValue('min_rev', 2);
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
