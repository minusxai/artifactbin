/* @jsxImportSource solid-js */
/**
 * THE ISLAND BOOT (lib/islands/boot, docs/phase2-architecture.md §2.3, §2.4): a compiled page with
 * the data island and one island hydrates in place from the snapshot, installs the IslandDocument on
 * the story root, sets `data-mx-ready` and fires `mx:ready`; a `data` frame on the document's live
 * stream re-runs exactly the queries reading the named dataset.
 *
 * The islands test project compiles JSX non-hydratable, so the island here comes back as a fresh
 * node and replaces the served root (rt `hydrateIsland`'s mismatch path); rt-adopt.test.ts proves
 * adoption of the served node with compiler-shaped hydratable code.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Show } from 'solid-js';
import { boot } from '../boot';
import { islandDocumentOf } from '../handover';
import { useIsland } from '../context';
import { DataTable, Question } from '../kit/data';
import type { IslandDocument, IslandEvent } from '../contract';
import type { CompiledDataflow } from '@/lib/story/data/compiled-dataflow';

const reads = (imports: string[]) => ({ imports, queries: [], values: [], builtins: [] });
const flow: CompiledDataflow = {
  imports: [{ name: 'd', ref: 'DS1', tables: [{ name: 'rows', columns: [{ name: 'n', type: 'number' }] }] }],
  values: [{ name: 'region', kind: 'scalar', type: 'string', default: 'All' }],
  queries: [{ name: 'total', engine: 'sqlite', sql: 'select count(*) as n from d.rows', params: [], reads: reads(['d']), columns: [{ name: 'n', type: 'number' }], start: 0, end: 0 }],
  mutations: [],
};

function Total() {
  const island = useIsland();
  return <div id="island"><b>{String(island.table('total')?.rows[0]?.n ?? '…')}</b><i>{String(island.value('region'))}</i></div>;
}

const page = (data: Record<string, unknown> | null) => {
  document.documentElement.removeAttribute('data-mx-ready');
  document.body.innerHTML = '<div data-mx-inline-story="" data-mx-story-root="" id="mx-story-root">'
    + '<p id="before">static</p><div data-hk="s0-0" id="island"><b>41</b><i>West</i></div><p id="after">static</p></div>'
    + (data ? `<script type="application/json" id="mx-story-data">${JSON.stringify(data)}</script>` : '');
};
const snapshot = { values: { region: 'West' }, results: { tables: { total: { rows: [{ n: 41 }], columns: [{ name: 'n', type: 'number' }] } }, errors: {} }, signedIn: false, mermaidImages: {}, readOnly: null };

let booted: IslandDocument | null = null;
afterEach(() => {
  booted?.dispose();
  booted = null;
  document.body.removeAttribute('data-mx-live-id');
  document.body.removeAttribute('data-mx-live-edit');
  vi.unstubAllGlobals();
});

describe('boot', () => {
  // Retired the cold-island template fetch assertion: one-tree modules carry no shell template resource.
  // Retired the first-switch template replay assertion: one-tree modules mount closed panels from the served tree.
  // Retired the cold-factory query wait assertion: one-tree queries use native hydration without shell factories.
  it('makes served islands ready and starts queries', async () => {
    const url = '/islands/t/bbbbbbbbbbbbbbbb.json';
    page({ ...snapshot, results: null, queryUrl: '/a/abc/query' });
    const requests: Array<{ url: string; ready: boolean }> = [];
    vi.stubGlobal('fetch', vi.fn((input: string | URL | Request) => {
      const requested = String(input);
      requests.push({ url: requested, ready: document.documentElement.hasAttribute('data-mx-ready') });
      return Promise.resolve(Response.json({ tables: { total: { rows: [{ n: 42 }], columns: [{ name: 'n', type: 'number' }] } }, errors: {} }));
    }));
    booted = boot({ ISLANDS: [['s0-', Total]], FLOW: flow });
    expect(document.documentElement.hasAttribute('data-mx-ready')).toBe(true);
    await vi.waitFor(() => expect(requests.some((request) => request.url.includes('/a/abc/query'))).toBe(true));
    expect(requests.some((request) => request.url === url)).toBe(false);
    expect(requests.find((request) => request.url.includes('/a/abc/query'))?.ready).toBe(true);
  });
  it('replaces cold DataTable and Question placeholders when their query answers, including a multi-root island', async () => {
    const cold = { ...snapshot, results: null, queryUrl: '/a/abc/query' };
    document.body.innerHTML = '<div data-mx-inline-story="" id="mx-story-root">'
      + '<p id="before">static</p><div data-hk="s0-0" id="table">loading data…</div>'
      + '<div data-hk="s1-0" id="question">loading data…</div>'
      + '<div data-hk="s2-0" id="multi">loading data…</div>'
      + '<aside data-hk="s3-0" id="swap">loading data…</aside><p id="after">static</p></div>'
      + `<script type="application/json" id="mx-story-data">${JSON.stringify(cold)}</script>`;
    const before = document.getElementById('before');
    const after = document.getElementById('after');
    let answer!: (response: Response) => void;
    const fetchMock = vi.fn(() => new Promise<Response>((resolve) => { answer = resolve; }));
    vi.stubGlobal('fetch', fetchMock);
    const Table = () => <DataTable data="$total" id="table" />;
    const Chart = () => <Question data="$total" id="question" />;
    const Multi = () => <><DataTable data="$total" id="multi" /><span id="companion">companion</span></>;
    const Swap = () => { const island = useIsland(); return <Show when={island.table('total')} fallback={<aside id="swap">loading data…</aside>}><section id="swap">rows ready</section></Show>; };

    booted = boot({ ISLANDS: [['s0-', Table], ['s1-', Chart], ['s2-', Multi], ['s3-', Swap]], FLOW: flow });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(document.querySelector('#table')?.textContent).toContain('loading data');
    expect(document.querySelector('#question')?.textContent).toContain('loading data');
    answer(Response.json({ tables: { total: { rows: [{ n: 42 }], columns: [{ name: 'n', type: 'number' }] } }, errors: {} }));
    await vi.waitFor(() => expect(booted?.store?.getTable('total')?.rows).toEqual([{ n: 42 }]));

    await vi.waitFor(() => {
      expect(document.querySelector('#table tbody')?.textContent, document.getElementById('mx-story-root')?.innerHTML).toContain('42');
      expect(document.querySelector('#question [aria-label="Data table"] tbody')?.textContent).toContain('42');
      expect(document.querySelector('#multi tbody')?.textContent).toContain('42');
      expect(document.querySelector('section#swap')?.textContent).toBe('rows ready');
    });
    expect(document.getElementById('companion')?.textContent).toBe('companion');
    expect(document.getElementById('before')).toBe(before);
    expect(document.getElementById('after')).toBe(after);
  });
  it('hydrates the island from the snapshot in place, installs the document, marks ready and fires mx:ready', () => {
    page(snapshot);
    const root = document.querySelector<HTMLElement>('[data-mx-inline-story]')!;
    const before = document.getElementById('before'), after = document.getElementById('after');
    const ready = vi.fn();
    document.addEventListener('mx:ready', ready, { once: true });

    booted = boot({ ISLANDS: [['s0-', Total]], FLOW: flow });

    expect(document.getElementById('before')).toBe(before);
    expect(document.getElementById('after')).toBe(after);
    expect(root.querySelectorAll('#island')).toHaveLength(1);
    expect(document.getElementById('island')?.textContent, 'the snapshot rows and the URL value, no fetch').toBe('41West');
    expect(document.documentElement.hasAttribute('data-mx-ready')).toBe(true);
    expect(ready).toHaveBeenCalledTimes(1);
    expect(islandDocumentOf(root)).toBe(booted);
    expect(booted.ready()).toBe(true);
    expect(booted.store?.getTable('total')?.rows).toEqual([{ n: 41 }]);

    booted.context.setValue('region', 'East');
    expect(document.getElementById('island')?.textContent).toBe('41East');
  });

  it('exposes the declared names as window.page on a page with no script, removes it for editing and restores it on reading', async () => {
    // A root-relative module id: the test runner loads it through its own module graph.
    const runtimeUrl = new URL('../page-runtime.ts', import.meta.url).pathname;
    page({ ...snapshot, vendor: { '@mx/page-runtime': runtimeUrl } });
    expect(window.page).toBeUndefined();
    booted = boot({ ISLANDS: [['s0-', Total]], FLOW: flow });
    await vi.waitFor(() => expect(window.page).toBeDefined());
    const api = window.page!;
    expect(Object.keys(api).sort()).toEqual(['fileUrl', 'get', 'imageUrl', 'mutation', 'ready', 'set', 'upload', 'uploadImage']);
    expect(api.get('region'), 'a Value reads the store').toBe('West');
    expect(api.get('total'), 'a Query is its rows').toEqual([{ n: 41 }]);
    await expect(api.ready('total'), 'ready is the settled rows').resolves.toEqual([{ n: 41 }]);
    expect(api.get('missing')).toBeUndefined();
    expect(api.mutation('missing')).toBeUndefined();
    expect(() => api.set('total', 1), 'a Query cannot be set').toThrow(/names no declared Value/);
    api.set('region', 'East');
    expect(booted.store?.getState().values.region, 'set writes the store').toBe('East');
    expect(api.get('region')).toBe('East');
    expect(document.getElementById('island')?.textContent).toBe('41East');

    booted.setMode('edit');
    expect(window.page, 'editing removes the session API').toBeUndefined();
    booted.setMode('read');
    await vi.waitFor(() => expect(window.page).toBeDefined());
    expect(window.page!.get('region')).toBe('East');
    booted.dispose();
    booted = null;
    expect(window.page, 'dispose removes it').toBeUndefined();
  });

  it('exposes no window.page when the page names no runtime or declares no data', async () => {
    page(snapshot);
    booted = boot({ ISLANDS: [['s0-', Total]], FLOW: flow });
    page(null);
    const bare = boot({ ISLANDS: [] });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(window.page).toBeUndefined();
    bare.dispose();
  });

  it('signals ready on a page whose module has no islands and no data', () => {
    page(null);
    const ready = vi.fn();
    document.addEventListener('mx:ready', ready, { once: true });
    booted = boot({ ISLANDS: [] });
    expect(document.documentElement.hasAttribute('data-mx-ready')).toBe(true);
    expect(ready).toHaveBeenCalledTimes(1);
    expect(booted.store).toBeNull();
    expect(booted.context.writesUnavailable()).toBeNull();
  });

  it('accepts ISLANDS alone for a module whose islands read no data', () => {
    page(snapshot);
    booted = boot([['s0-', Total]]);
    expect(booted.store).toBeNull();
    expect(document.getElementById('island')?.textContent, 'no data: the island renders its declared state').toBe('…undefined');
    expect(document.documentElement.hasAttribute('data-mx-ready')).toBe(true);
  });

  it('edit mode pauses the islands: their DOM and state stay, bound controls move nothing, and reading resumes them', () => {
    page(snapshot);
    const Picker = () => {
      const island = useIsland();
      return <div id="island"><b>{String(island.table('total')?.rows[0]?.n ?? '…')}</b><i>{String(island.value('region'))}</i>
        <button type="button" id="north" onClick={() => island.setValue('region', 'North')}>North</button></div>;
    };
    booted = boot({ ISLANDS: [['s0-', Picker]], FLOW: flow });
    const island = document.getElementById('island')!;
    const events: IslandEvent[] = [];
    booted.subscribe((e) => events.push(e));
    booted.setMode('edit');
    expect(booted.mode()).toBe('edit');
    expect(events).toEqual([{ type: 'mode', mode: 'edit' }]);
    const morph = (booted as import('../boot').MorphableIslandDocument).morph!;
    expect([...morph.islands.keys()], 'paused, not disposed: the morph engine can keep the running island').toEqual(['s0-']);
    booted.context.setValue('region', 'North');
    document.getElementById('north')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(booted.store?.getState().values.region, 'a bound control moves no value while editing').toBe('West');
    expect(document.getElementById('island')?.textContent, 'no island paints while editing').toBe('41WestNorth');
    expect(document.getElementById('island'), 'the island keeps its element').toBe(island);
    expect(island.isConnected).toBe(true);
    expect(document.getElementById('before')?.textContent).toBe('static');

    booted.setMode('read');
    expect(document.getElementById('island'), 'reading again: the same island, never hydrated again').toBe(island);
    document.getElementById('north')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(document.getElementById('island')?.textContent, 'reading again: the island answers its controls').toBe('41NorthNorth');
  });

  it('a live `data` frame re-runs the queries that read the named dataset, through the page\'s own query door', async () => {
    page({ ...snapshot, queryUrl: 'https://app.example/a/abc/query' });
    document.body.setAttribute('data-mx-live-id', 'abc');
    document.body.setAttribute('data-mx-live-edit', 'e1');
    const sources: FakeEventSource[] = [];
    class FakeEventSource extends EventTarget {
      onmessage: ((e: MessageEvent) => void) | null = null;
      closed = false;
      constructor(public url: string) { super(); sources.push(this); }
      close() { this.closed = true; }
    }
    vi.stubGlobal('EventSource', FakeEventSource);
    const fetchMock = vi.fn(async () => Response.json({ tables: { total: { rows: [{ n: 42 }], columns: [{ name: 'n', type: 'number' }] } }, errors: {} }));
    vi.stubGlobal('fetch', fetchMock);

    booted = boot({ ISLANDS: [['s0-', Total]], FLOW: flow });
    // The live stream loads after hydration (boot imports it lazily, off the shared runtime's closure).
    await vi.waitFor(() => expect(sources.map((s) => s.url)).toEqual(['/a/abc/events']));
    expect(fetchMock, 'the snapshot answered every query: nothing runs at start').not.toHaveBeenCalled();

    sources[0]!.dispatchEvent(new MessageEvent('data', { data: JSON.stringify({ datasets: ['OTHER'] }) }));
    expect(fetchMock, 'a dataset this page does not read costs nothing').not.toHaveBeenCalled();

    sources[0]!.dispatchEvent(new MessageEvent('data', { data: JSON.stringify({ datasets: ['DS1'] }) }));
    await vi.waitFor(() => expect(document.getElementById('island')?.textContent).toBe('42West'));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url] = fetchMock.mock.calls[0] as unknown as [string];
    expect(url.startsWith('https://app.example/a/abc/query?')).toBe(true);
    expect(JSON.parse(new URL(url).searchParams.get('q')!)).toMatchObject({ only: ['total'], values: { region: 'West' } });

    booted.setMode('edit');
    expect(sources[0]!.closed, 'the compiled stream cannot reload an active editor').toBe(true);

    // Done: the page drew the saved version in place and hands the document back to reading. The stream
    // reopens from the version the page now shows, and a dataset written afterwards re-runs its queries.
    document.body.setAttribute('data-mx-live-edit', 'e2');
    booted.setMode('read');
    expect(booted.mode()).toBe('read');
    await vi.waitFor(() => expect(sources).toHaveLength(2));
    expect(sources[1]!.closed).toBe(false);
    fetchMock.mockClear();
    sources[1]!.dispatchEvent(new MessageEvent('data', { data: JSON.stringify({ datasets: ['DS1'] }) }));
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    booted.dispose();
    expect(sources[1]!.closed).toBe(true);
    booted = null;
  });

  it('hands a newer version\'s module to the running document instead of booting a second one (the live morph)', () => {
    page(snapshot);
    booted = boot({ ISLANDS: [['s0-', Total, 'k0']], FLOW: flow });
    const doc = booted as import('../boot').MorphableIslandDocument;
    expect([...doc.morph!.islands.keys()]).toEqual(['s0-']);
    expect(doc.morph!.islands.get('s0-')![0], 'each running island carries its key').toBe('k0');
    const handed: unknown[] = [];
    doc.morph!.take = (module) => handed.push(module);
    const next = { ISLANDS: [['s0-', Total, 'k1']] as const, FLOW: flow };
    const ready = vi.fn();
    document.addEventListener('mx:ready', ready, { once: true });
    expect(boot(next)).toBe(booted);
    expect(handed).toEqual([next]);
    expect(ready, 'no second boot').not.toHaveBeenCalled();
    expect(islandDocumentOf(document.querySelector('[data-mx-inline-story]'))).toBe(booted);
    delete doc.morph!.take;
    document.removeEventListener('mx:ready', ready);
  });

  it('does not hold a live stream inside a frame (the page above holds it)', () => {
    page(snapshot);
    document.body.setAttribute('data-mx-live-id', 'abc');
    document.body.setAttribute('data-mx-live-edit', 'e1');
    const created = vi.fn();
    vi.stubGlobal('EventSource', class { constructor() { created(); } close() {} });
    const framed = new Proxy(window, { get: (target, key) => (key === 'parent' ? {} : Reflect.get(target, key, target)) });
    booted = boot({ ISLANDS: [['s0-', Total]], FLOW: flow }, framed);
    expect(created).not.toHaveBeenCalled();
  });
});

beforeEach(() => {
  document.documentElement.removeAttribute('data-mx-ready');
});
