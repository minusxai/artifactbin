/**
 * THE FIRST RESULTS THE PAGE ARRIVED WITH (StoryIslandDataflow.results): a
 * query the server answered for this request starts CURRENT — the store asks
 * nothing for it on load, and the page's engine is not what the first paint
 * waits on — and from the first change of an input it reads, it runs exactly
 * as before: in the page for what the reader holds, on the server otherwise.
 * A query the server did not answer runs on load as it always has.
 * Real SQLite core, fake server.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadSqlite } from '@artifactbin/sql/core';
import { compiledOf } from '@/test/helpers/compiled';
import type { Row, Scalar } from '@/lib/story/dataflow';
import type { ServedResults } from '../contract';
import { createPageEngine } from '../page-engine';
import { createDataflowStore, type DataflowStore, type QueryTransport } from '../store';

const COLUMNS = [{ name: 'region', type: 'string' as const }, { name: 'revenue', type: 'number' as const }];
const ROWS: Row[] = [{ region: 'EU', revenue: 837 }, { region: 'NA', revenue: 1200 }];
const FLOW = await compiledOf(
  '<Import name="sales" src="ref:Sales0001" /><Import name="other" src="ref:Other0001" />' +
  '<Value name="region" type="string" />' +
  '<Query name="total">{`select sum(revenue) as revenue from sales.rows where $region is null or region = $region`}</Query>' +
  '<Query name="count">{`select count(*) as n from other.rows where $region is null or region = $region`}</Query>' +
  '<Query name="zone">{`select $_tz as tz`}</Query>' +
  '<Mutation name="add">{`insert into other.rows (region, revenue) values ($region, 1)`}</Mutation>',
  { Sales0001: COLUMNS, Other0001: COLUMNS },
);
const SERVED: ServedResults = {
  tables: { total: { rows: [{ revenue: 2037 }], columns: [{ name: 'revenue', type: 'number' }] }, count: { rows: [{ n: 2 }], columns: [{ name: 'n', type: 'number' }] } },
  errors: {},
  mutationAccess: { add: null },
};

let open: DataflowStore[] = [];
afterEach(() => { for (const s of open) s.dispose(); open = []; vi.unstubAllGlobals(); });

function setup(results: ServedResults | undefined, opts: { page?: boolean } = {}) {
  const runs: Array<{ values: Record<string, Scalar>; only: string[] }> = [];
  const holds: string[] = [];
  const transport: QueryTransport = {
    run: async (values, only) => {
      runs.push({ values, only });
      return { tables: Object.fromEntries(only.map((n) => [n, { rows: [{ server: n }], columns: [] }])), errors: {}, mutationAccess: { add: null } };
    },
    page: async () => ({ rows: [], columns: [] }),
    hold: async (name) => { holds.push(name); return { rows: { rows: ROWS, columns: COLUMNS } }; },
    mutate: async () => ({ dataset: 'Other0001' }),
  };
  const engine = opts.page ? createPageEngine({ load: () => loadSqlite(), fetch: async (name) => { holds.push(name); return { rows: { rows: ROWS, columns: COLUMNS } }; } }) : null;
  const store = createDataflowStore({ flow: FLOW, hold: ['sales'], ...(results ? { results } : {}) }, { transport, debounceMs: 0, ...(engine ? { page: { engine, userId: null } } : {}) });
  open.push(store);
  return { store, runs, holds, engine };
}

describe('a page that arrived with its first results', () => {
  it('starts with them current and asks for nothing on load', async () => {
    const { store, runs } = setup(SERVED);
    expect(store.getTable('total')?.rows).toEqual([{ revenue: 2037 }]);
    expect([...store.pending()]).toEqual(['zone']);
    expect(store.mutationUnavailable('add')).toBeNull();
    store.start();
    await vi.waitFor(() => expect(runs).toHaveLength(1));
    // Only the query the server could not answer (it reads the reader's zone) runs.
    expect(runs[0]!.only).toEqual(['zone']);
    await vi.waitFor(() => expect(store.pending().size).toBe(0));
    expect(store.getTable('total')?.rows).toEqual([{ revenue: 2037 }]);
    expect(runs).toHaveLength(1);
  });

  it('runs every query on load when it arrived without them, as before', async () => {
    const { store, runs } = setup(undefined);
    expect([...store.pending()].sort()).toEqual(['count', 'total', 'zone']);
    store.start();
    await vi.waitFor(() => expect(runs).toHaveLength(1));
    expect(runs[0]!.only.sort()).toEqual(['count', 'total', 'zone']);
  });

  it('re-runs through the transport as soon as an input they read changes', async () => {
    const { store, runs } = setup(SERVED);
    store.start();
    await vi.waitFor(() => expect(store.pending().size).toBe(0));
    runs.length = 0;
    store.setValue('region', 'NA');
    await vi.waitFor(() => expect(runs).toHaveLength(1));
    expect(runs[0]!.values.region).toBe('NA');
    expect(runs[0]!.only.sort()).toEqual(['count', 'total']);
    await vi.waitFor(() => expect(store.getTable('total')?.rows).toEqual([{ server: 'total' }]));
  });

  it('does not load the page engine for the first paint, then holds its data once the page is idle and answers changes itself', async () => {
    let idle: (() => void) | null = null;
    vi.stubGlobal('requestIdleCallback', (cb: () => void) => { idle = cb; return 1; });
    vi.stubGlobal('cancelIdleCallback', () => { idle = null; });
    const { store, runs, holds, engine } = setup({ ...SERVED, tables: { ...SERVED.tables }, errors: { zone: 'not asked' } }, { page: true });
    store.start();
    await Promise.resolve();
    expect(runs).toEqual([]);
    expect(holds).toEqual([]);
    expect(idle).not.toBeNull();
    idle!();
    await vi.waitFor(() => expect(engine!.ready(FLOW, ['sales'])).toBe(true));
    expect(holds).toEqual(['sales']);
    store.setValue('region', 'EU');
    await vi.waitFor(() => expect(store.getTable('total')?.rows).toEqual([{ revenue: 837 }]));
    // Held data answered in the page; only the query over data it does not hold went to the server.
    expect(runs.map((r) => r.only)).toEqual([['count']]);
  });

  it('re-runs the served rows and write checks a live dataset wakeup names, as it always has', async () => {
    const { store, runs } = setup(SERVED);
    store.start();
    await vi.waitFor(() => expect(store.pending().size).toBe(0));
    runs.length = 0;
    store.invalidateDatasets(['Other0001']);
    await vi.waitFor(() => expect(runs).toHaveLength(1));
    expect(runs[0]!.only).toEqual(['count']);
    await vi.waitFor(() => expect(store.getTable('count')?.rows).toEqual([{ server: 'count' }]));
    expect(store.mutationUnavailable('add')).toBeNull();
    expect(store.pending().size).toBe(0);
  });

  it('loads the page engine at once when something it answers is still waiting', async () => {
    const idle = vi.fn();
    vi.stubGlobal('requestIdleCallback', idle);
    const { store, holds } = setup({ ...SERVED, tables: { count: SERVED.tables.count! } }, { page: true });
    store.start();
    await vi.waitFor(() => expect(holds).toEqual(['sales']));
    expect(idle).not.toHaveBeenCalled();
  });
});
