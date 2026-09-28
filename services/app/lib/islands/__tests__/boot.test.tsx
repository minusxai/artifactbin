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
import { boot } from '../boot';
import { islandDocumentOf } from '../handover';
import { useIsland } from '../context';
import type { IslandDocument, IslandEvent } from '../contract';
import type { CompiledDataflow } from '@/lib/story/compiled-dataflow';

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

  it('edit mode disposes the islands and leaves their DOM as static markup', () => {
    page(snapshot);
    booted = boot({ ISLANDS: [['s0-', Total]], FLOW: flow });
    const events: IslandEvent[] = [];
    booted.subscribe((e) => events.push(e));
    booted.setMode('edit');
    expect(booted.mode()).toBe('edit');
    expect(events).toEqual([{ type: 'mode', mode: 'edit' }]);
    booted.context.setValue('region', 'North');
    expect(document.getElementById('island')?.textContent, 'no island computation runs after edit mode').toBe('41West');
    expect(document.getElementById('before')?.textContent).toBe('static');
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
    expect(sources.map((s) => s.url)).toEqual(['/a/abc/events']);
    expect(fetchMock, 'the snapshot answered every query: nothing runs at start').not.toHaveBeenCalled();

    sources[0]!.dispatchEvent(new MessageEvent('data', { data: JSON.stringify({ datasets: ['OTHER'] }) }));
    expect(fetchMock, 'a dataset this page does not read costs nothing').not.toHaveBeenCalled();

    sources[0]!.dispatchEvent(new MessageEvent('data', { data: JSON.stringify({ datasets: ['DS1'] }) }));
    await vi.waitFor(() => expect(document.getElementById('island')?.textContent).toBe('42West'));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url] = fetchMock.mock.calls[0] as unknown as [string];
    expect(url.startsWith('https://app.example/a/abc/query?')).toBe(true);
    expect(JSON.parse(new URL(url).searchParams.get('q')!)).toMatchObject({ only: ['total'], values: { region: 'West' } });

    booted.dispose();
    expect(sources[0]!.closed).toBe(true);
    booted = null;
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
