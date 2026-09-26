/**
 * ONE SCHEDULING STEP, TWO PLACES. The store splits the core's "compute these
 * nodes at these versions" by placement (lib/story/placement): what the page
 * holds runs in the page engine (lib/story-runtime/page-engine), everything
 * else through the existing transport — and until the page holds its imports,
 * everything goes to the server, so the first paint never waits on the engine.
 * Writes: a held dataset write shows at once and the server decides; a
 * local-table write never leaves the page. Real SQLite core, fake server.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadSqlite } from '@artifactbin/sql/core';
import { compiledOf } from '@/test/helpers/compiled';
import type { Row, Scalar } from '@/lib/story/dataflow';
import type { MutationRequest } from '@/lib/story/mutation-request';
import { createPageEngine } from '../page-engine';
import { createDataflowStore, type DataflowStore, type MutationAnswer, type QueryTransport } from '../store';

const COLUMNS = [{ name: 'id', type: 'string' as const }, { name: 'region', type: 'string' as const }, { name: 'revenue', type: 'number' as const }];
const ROWS: Row[] = [{ id: 'a', region: 'EU', revenue: 837 }, { id: 'b', region: 'NA', revenue: 1200 }];
const FLOW = await compiledOf(
  '<Import name="sales" src="ref:Sales0001" /><Import name="other" src="ref:Other0001" />' +
  '<Value name="region" type="string" /><Value name="min" type="number" default={0} />' +
  '<Value name="todo" type="table" columns={[{name:"t",type:"string"}]} value={[]} />' +
  '<Query name="mine">{`select region, sum(revenue) as revenue from sales.rows where ($region is null or region = $region) and revenue >= $min group by 1 order by 1`}</Query>' +
  '<Query name="theirs">{`select count(*) as n from other.rows where $region is null or region = $region`}</Query>' +
  '<Query name="clock">{`select $_now as now`}</Query>' +
  '<Query name="todos">{`select count(*) as n from todo`}</Query>' +
  '<Mutation name="add">{`insert into sales.rows (id, region, revenue) values ($_row.id, $region, 10)`}</Mutation>' +
  '<Mutation name="remember">{`insert into todo (t) values ($region)`}</Mutation>',
  { Sales0001: COLUMNS, Other0001: COLUMNS },
);

function setup() {
  let rows = ROWS;
  const fetched: string[] = [];
  const runs: Array<{ values: Record<string, Scalar>; only: string[] }> = [];
  const writes: Array<{ request: MutationRequest; resolve: (a: MutationAnswer) => void; reject: (e: Error) => void }> = [];
  const pages: string[] = [];
  const transport: QueryTransport = {
    run: async (values, only) => {
      runs.push({ values, only });
      return { tables: Object.fromEntries(only.map((n) => [n, { rows: [{ server: n }], columns: [] }])), errors: {}, mutationAccess: { add: null } };
    },
    page: async (_values, name) => { pages.push(name); return { rows: [], columns: [] }; },
    mutate: (request) => new Promise((resolve, reject) => { writes.push({ request, resolve, reject }); }),
  };
  const engine = createPageEngine({
    load: () => loadSqlite(),
    fetch: async (name) => { fetched.push(name); return { rows: { rows, columns: COLUMNS } }; },
  });
  const store = createDataflowStore({ flow: FLOW, hold: ['sales'] }, { transport, debounceMs: 0, page: { engine, userId: 'usr_1' } });
  const held = () => vi.waitFor(() => expect(engine.ready(FLOW, ['sales'])).toBe(true));
  return { store, engine, transport, runs, writes, pages, fetched, held, setRows: (next: Row[]) => { rows = next; } };
}
const regions = (store: DataflowStore) => store.getTable('mine')?.rows.map((r) => r.region);
const settled = (store: DataflowStore) => vi.waitFor(() => expect(store.pending().size).toBe(0));

let open: DataflowStore[] = [];
afterEach(() => { for (const s of open) s.dispose(); open = []; vi.useRealTimers(); });
const started = async () => {
  const s = setup();
  open.push(s.store);
  s.store.start();
  await settled(s.store);
  await s.held();
  s.runs.length = 0;
  return s;
};

describe('the store places each run', () => {
  it('paints first: until the page holds its imports, the first run asks the server for everything', async () => {
    const { store, runs, held, fetched } = setup();
    open.push(store);
    store.start();
    expect(runs).toEqual([{ values: { region: null, min: 0 }, only: ['mine', 'theirs', 'clock', 'todos'] }]);
    await settled(store);
    expect(store.getTable('mine')!.rows).toEqual([{ server: 'mine' }]);
    await held();
    expect(fetched).toEqual(['sales']);
  });

  it('once held, a change runs the page\'s queries in the page and only the rest on the server', async () => {
    const { store, runs } = await started();
    store.setValue('region', 'EU');
    expect(runs).toEqual([{ values: { region: 'EU', min: 0 }, only: ['theirs'] }]);
    await settled(store);
    expect(store.getTable('mine')!.rows).toEqual([{ region: 'EU', revenue: 837 }]);
    expect(store.getTable('theirs')!.rows).toEqual([{ server: 'theirs' }]);
  });

  it('a change only the page\'s queries read never touches the network', async () => {
    const { store, runs } = await started();
    store.setValue('min', 1000);
    await settled(store);
    expect(runs).toEqual([]);
    expect(regions(store)).toEqual(['NA']);
  });

  it('a window of a page query is read in the page', async () => {
    const { store, pages } = await started();
    const window = await store.fetchPage('mine', { offset: 1, limit: 5 });
    expect(window.rows).toEqual([{ region: 'NA', revenue: 1200 }]);
    expect(pages).toEqual([]);
  });
});

describe('writes the page can compute', () => {
  it('a local-table write runs entirely in the page', async () => {
    const { store, writes } = await started();
    store.setValue('region', 'EU');
    await store.mutate('remember');
    await settled(store);
    expect(writes).toEqual([]);
    expect(store.getTable('todo')!.rows).toEqual([{ t: 'EU' }]);
    expect(store.getTable('todos')!.rows).toEqual([{ n: 1 }]);
  });

  it('a held write shows at once, then the server decides and the page fetches what it stored', async () => {
    const { store, writes, fetched, setRows, held } = await started();
    store.setValue('region', 'XX');
    await settled(store);
    const done = store.mutate('add', undefined, { id: 'n1' });
    await vi.waitFor(() => expect(regions(store)).toEqual(['XX']));
    expect(writes).toHaveLength(1);
    setRows([...ROWS, { id: 'n1', region: 'XX', revenue: 10 }]);
    writes[0]!.resolve({ dataset: 'Sales0001' });
    await done;
    await held();
    await settled(store);
    expect(fetched).toEqual(['sales', 'sales']);
    expect(regions(store)).toEqual(['XX']);
  });

  it('a refused write is rolled back and its reason is the server\'s; a later write keeps its effect', async () => {
    const { store, writes } = await started();
    const first = store.mutate('add', { region: 'XX' }, { id: 'n1' });
    const second = store.mutate('add', { region: 'YY' }, { id: 'n2' });
    await vi.waitFor(() => expect(regions(store)).toEqual(['EU', 'NA', 'XX', 'YY']));
    writes[0]!.reject(new Error('Dataset policy: not yours'));
    await expect(first).rejects.toThrow('Dataset policy: not yours');
    await vi.waitFor(() => expect(regions(store)).toEqual(['EU', 'NA', 'YY']));
    writes[1]!.resolve({ dataset: 'Sales0001' });
    await second;
  });
});

describe('$_now in the page', () => {
  it('advances once a minute, re-running only what reads it', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'Date'] });
    vi.setSystemTime(new Date('2026-09-30T10:00:00.000Z'));
    const { store, runs } = await started();
    expect(store.getTable('clock')!.rows).toEqual([{ server: 'clock' }]);
    vi.advanceTimersByTime(60_000);
    await settled(store);
    expect(runs).toEqual([]);
    // The page's clock, a minute on (waiting may have moved the fake clock a little further).
    const ticked = store.getTable('clock')!.rows[0]!.now as string;
    expect(Date.parse(ticked)).toBeGreaterThanOrEqual(Date.parse('2026-09-30T10:01:00.000Z'));
    expect(Date.parse(ticked)).toBeLessThan(Date.parse('2026-09-30T10:02:00.000Z'));
    // Nothing else re-ran: what does not read the clock still shows its first answer.
    expect(store.getTable('mine')!.rows).toEqual([{ server: 'mine' }]);
  });
});
