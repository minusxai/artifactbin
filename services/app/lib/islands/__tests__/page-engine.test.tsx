/* @jsxImportSource solid-js */
/**
 * THE PAGE'S OWN SQLITE ENGINE ON A COMPILED PAGE (lib/islands/boot + the standalone lib/islands/sqlite-engine,
 * docs/phase2-architecture.md §2.3) — today's page engine (lib/story-runtime/page-engine) behind the
 * island runtime, exactly as today's reader runs it:
 *
 * - loaded behind the first paint (the snapshot's rows are on screen; nothing waits on the engine);
 * - one scoped hold POST per held dataset, however many imports read it;
 * - once it holds what a query reads, a control change is answered in the page, with no request;
 * - windows of a long result (sort, paging) are read in the page too;
 * - a signed-in page's engine answers `$_me` only once the viewer overlay has named the reader;
 * - a page that may hold nothing (or has no wasm) never loads it.
 *
 * Real SQLite core (the package's wasm, fetched as the page fetches it), fake doors.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { compiledOf } from '@/test/helpers/compiled';
import type { PageEngine } from '@/lib/story-runtime/page-engine';
import type { Row } from '@/lib/dataflow';
import { boot } from '../boot';
import { useIsland } from '../context';
import type { IslandDocument } from '../contract';

const engines = vi.hoisted(() => [] as PageEngine[]);
vi.mock('../sqlite-engine', async (importOriginal) => {
  const real = await importOriginal<typeof import('../sqlite-engine')>();
  return { ...real, pageEngine: (...args: Parameters<typeof real.pageEngine>) => { const engine = real.pageEngine(...args); engines.push(engine); return engine; } };
});

const WASM_URL = '/story/sqlite3-0123456789abcdef.wasm';
const WASM = readFileSync(createRequire(path.resolve(import.meta.dirname, '../../../../sql/package.json')).resolve('@sqlite.org/sqlite-wasm/sqlite3.wasm'));
const COLUMNS = [{ name: 'region', type: 'string' as const }, { name: 'revenue', type: 'number' as const }];
const ROWS: Row[] = [{ region: 'EU', revenue: 837 }, { region: 'NA', revenue: 1200 }, { region: 'EU', revenue: 3 }];

// Two imports of ONE dataset, as the dataflow gate's document declares them.
const FLOW = await compiledOf(
  '<Import name="regions_data" src="ref:Sales0001" /><Import name="sales_data" src="ref:Sales0001" />'
  + '<Value name="region" type="string" />'
  + '<Query name="regions">{`select distinct region from regions_data.rows order by 1`}</Query>'
  + '<Query name="sales">{`select sum(revenue) as revenue from sales_data.rows where $region is null or region = $region`}</Query>'
  + '<Query name="rows">{`select region, revenue from sales_data.rows`}</Query>',
  { Sales0001: COLUMNS },
);
const FLOW_ME = await compiledOf(
  '<Import name="sales_data" src="ref:Sales0001" /><Value name="region" type="string" />'
  + '<Query name="mine">{`select coalesce($_me.id, \'nobody\') as who, count(*) as n from sales_data.rows where $region is null or region = $region`}</Query>',
  { Sales0001: COLUMNS },
);
const FLOW_LOCAL = await compiledOf('<Value name="drafts" type="table" value={[{"id":1}]} />'
  + '<Query name="draft_count">{`select count(*) as n from drafts`}</Query>'
  + '<Mutation name="add">{`insert into drafts values ((select max(id)+1 from drafts))`}</Mutation>');
const HELD = ['regions_data', 'sales_data'];

function Total() {
  const island = useIsland();
  return <div id="island">{String(island.table('sales')?.rows[0]?.revenue ?? '…')}</div>;
}
function Mine() {
  const island = useIsland();
  return <div id="island">{String(island.table('mine')?.rows[0]?.who ?? '…')}:{String(island.table('mine')?.rows[0]?.n ?? '…')}</div>;
}
const text = () => document.getElementById('island')?.textContent;

const page = (data: Record<string, unknown>) => {
  document.body.innerHTML = '<div data-mx-inline-story="" id="mx-story-root"><div data-hk="s0-0" id="island">…</div></div>'
    + `<script type="application/json" id="mx-story-data">${JSON.stringify(data)}</script>`;
};
const table = (rows: Row[], columns = COLUMNS) => ({ rows, columns });
const SERVED = {
  values: {},
  results: { tables: { regions: table([{ region: 'EU' }, { region: 'NA' }]), sales: table([{ revenue: 2040 }]), rows: table(ROWS) }, errors: {} },
  signedIn: false, mermaidImages: {}, readOnly: null, queryUrl: '/a/abc/query', hold: HELD, sqliteWasm: WASM_URL,
};

interface Call { url: string; init: RequestInit | undefined; body: Record<string, unknown> | null }
/** The page's outside world: the wasm, the hold door (every row of the dataset), and a query door that answers "server". */
function network(opts: { overlay?: () => unknown } = {}) {
  const calls: Call[] = [];
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const at = new URL(url, 'http://page.test');
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) as Record<string, unknown> : at.searchParams.has('q') ? JSON.parse(at.searchParams.get('q')!) as Record<string, unknown> : null;
    calls.push({ url, init, body });
    if (url === WASM_URL) return new Response(WASM, { status: 200, headers: { 'content-type': 'application/wasm' } });
    if (at.pathname.endsWith('/viewer')) return Response.json(opts.overlay?.() ?? { viewer: null, results: { tables: {}, errors: {} }, hold: [] });
    if (body && typeof body.hold === 'string') return Response.json({ tables: { rows: table(ROWS) } });
    const only = Array.isArray(body?.only) ? body.only as string[] : [];
    return Response.json({ tables: Object.fromEntries(only.map((name) => [name, table([{ revenue: -1, who: 'server', n: -1 }])])), errors: {} });
  });
  vi.stubGlobal('fetch', fetchMock);
  const holds = () => calls.filter((c) => c.body && typeof c.body.hold === 'string');
  const runs = () => calls.filter((c) => c.url !== WASM_URL && !(c.body && typeof c.body.hold === 'string') && !new URL(c.url, 'http://page.test').pathname.endsWith('/viewer'));
  return { calls, holds, runs };
}

let booted: IslandDocument | null = null;
afterEach(() => {
  booted?.dispose();
  booted = null;
  engines.length = 0;
  vi.unstubAllGlobals();
});

/** The engine the page loaded holds what these imports read (the core is loaded and every one is fetched). */
const engineReady = (imports: string[] = HELD, flow = FLOW) => vi.waitFor(() => expect(engines[0]?.ready(flow, imports)).toBe(true), { timeout: 15_000, interval: 20 });

describe('the page engine on a compiled page', () => {
  it('starts SQLite for a local table with no held import and keeps its writes in the page', async () => {
    const net = network();
    page({ ...SERVED, hold: [], results: { tables: { draft_count: table([{ n: 1 }], [{ name: 'n', type: 'number' }]) }, errors: {} } });
    booted = boot({ ISLANDS: [], FLOW: FLOW_LOCAL });
    await engineReady([], FLOW_LOCAL);
    const before = net.calls.length;
    await booted.store!.mutate('add');
    await vi.waitFor(() => expect(booted!.context.table('draft_count')?.rows[0]?.n).toBe(2));
    expect(net.calls.slice(before)).toEqual([]);
  });
  it('loads behind the first paint, holds the dataset through ONE scoped POST, and answers a control change in the page', async () => {
    const net = network();
    page(SERVED);
    booted = boot({ ISLANDS: [['s0-', Total]], FLOW });
    expect(text(), 'the snapshot is the first paint').toBe('2040');
    expect(net.calls, 'nothing is fetched before the first paint').toEqual([]);

    await engineReady();
    expect(net.calls.filter((c) => c.url === WASM_URL)).toHaveLength(1);
    expect(net.calls.find((c) => c.url === WASM_URL)?.init).toMatchObject({ credentials: 'omit' });
    const holds = net.holds();
    expect(holds.map((c) => c.body!.hold), 'one dataset, one fetch — by the first import that reads it').toEqual(['regions_data']);
    expect(holds[0]!.url).toBe('/a/abc/query');
    expect(holds[0]!.init, 'the scoped POST, credential-free for a guest').toMatchObject({ method: 'POST', credentials: 'omit' });
    expect(net.runs(), 'the served rows answered the first paint: no run request').toEqual([]);

    const before = net.calls.length;
    booted.context.setValue('region', 'NA');
    await vi.waitFor(() => expect(text()).toBe('1200'));
    booted.context.setValue('region', null as never);
    await vi.waitFor(() => expect(text()).toBe('2040'));
    expect(net.calls.slice(before), 'the change ran in the page: no request').toEqual([]);
  });

  it('reads the windows of a long result in the page: a sorted window, then the next one, with no request', async () => {
    const net = network();
    page(SERVED);
    booted = boot({ ISLANDS: [['s0-', Total]], FLOW });
    await engineReady();
    const before = net.calls.length;
    const sorted = await booted.store!.fetchPage('rows', { offset: 0, limit: 2, sort: { col: 'revenue', dir: 'desc' } });
    expect(sorted.rows).toEqual([{ region: 'NA', revenue: 1200 }, { region: 'EU', revenue: 837 }]);
    const next = await booted.store!.fetchPage('rows', { offset: 2, limit: 2, sort: { col: 'revenue', dir: 'desc' } });
    expect(next.rows).toEqual([{ region: 'EU', revenue: 3 }]);
    expect(net.calls.slice(before)).toEqual([]);
  });

  it('until it holds what a change reads, the change is the server\'s, as today', async () => {
    const net = network();
    page(SERVED);
    booted = boot({ ISLANDS: [['s0-', Total]], FLOW });
    booted.context.setValue('region', 'NA');
    await vi.waitFor(() => expect(net.runs()).toHaveLength(1));
    expect(net.runs()[0]!.body).toMatchObject({ only: ['sales'], values: { region: 'NA' } });
    await vi.waitFor(() => expect(text()).toBe('-1'));
  });

  it('a signed-in page answers $_me in the page only once the overlay has named the reader', async () => {
    const net = network({ overlay: () => ({ viewer: { id: 'u1', handle: 'ada', name: 'Ada', image: null }, results: { tables: { mine: table([{ who: 'u1', n: 3 }]) }, errors: {} }, hold: ['sales_data'] }) });
    let landOverlay!: () => void;
    const overlayLanded = new Promise<void>((resolve) => { landOverlay = resolve; });
    const fetchNow = globalThis.fetch;
    // Hold the overlay back until the test lets it land.
    vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
      if (new URL(url, 'http://page.test').pathname.endsWith('/viewer')) await overlayLanded;
      return fetchNow(url, init);
    });
    page({ ...SERVED, signedIn: true, viewerUrl: '/a/abc/viewer', hold: ['sales_data'], results: { tables: {}, errors: {} } });
    booted = boot({ ISLANDS: [['s0-', Mine]], FLOW: FLOW_ME });
    await engineReady(['sales_data'], FLOW_ME);
    await vi.waitFor(() => expect(text()).toBe('server:-1'));

    const before = net.runs().length;
    booted.context.setValue('region', 'NA');
    await vi.waitFor(() => expect(net.runs().length, 'the reader is not named yet: the session door answers').toBe(before + 1));
    expect(net.runs().at(-1)!.init).toMatchObject({ method: 'POST', credentials: 'same-origin' });

    landOverlay();
    await vi.waitFor(() => expect(booted!.context.viewer()).toMatchObject({ id: 'u1' }));
    const after = net.calls.length;
    booted.context.setValue('region', 'EU');
    await vi.waitFor(() => expect(text(), 'the page binds $_me.id to the reader the overlay named').toBe('u1:2'));
    expect(net.calls.slice(after)).toEqual([]);
  });

  it('a signed-in page whose data never names the reader uses the engine at once', async () => {
    const net = network();
    page({ ...SERVED, signedIn: true });
    booted = boot({ ISLANDS: [['s0-', Total]], FLOW });
    await engineReady();
    const before = net.calls.length;
    booted.context.setValue('region', 'NA');
    await vi.waitFor(() => expect(text()).toBe('1200'));
    expect(net.calls.slice(before)).toEqual([]);
    expect(net.holds()[0]!.init, 'the signed-in page holds through the session door').toMatchObject({ method: 'POST', credentials: 'same-origin' });
  });

  it('a page with no wasm never loads the engine: every change is the server\'s', async () => {
    for (const data of [{ ...SERVED, hold: [], sqliteWasm: undefined }, { ...SERVED, sqliteWasm: undefined }]) {
      const net = network();
      page(data);
      booted = boot({ ISLANDS: [['s0-', Total]], FLOW });
      booted.context.setValue('region', 'NA');
      await vi.waitFor(() => expect(text()).toBe('-1'));
      await new Promise((r) => setTimeout(r, 50));
      expect(net.calls.filter((c) => c.url === WASM_URL || (c.body && 'hold' in c.body))).toEqual([]);
      expect(engines).toEqual([]);
      booted.dispose();
      booted = null;
      vi.unstubAllGlobals();
    }
  });

  it('closes the engine it loaded when the document is disposed', async () => {
    network();
    page(SERVED);
    booted = boot({ ISLANDS: [['s0-', Total]], FLOW });
    await engineReady();
    booted.dispose();
    booted = null;
    expect(engines[0]!.ready(FLOW, HELD)).toBe(false);
  });
});
