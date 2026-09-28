/* @jsxImportSource solid-js */
// DESTINATION: services/app/lib/islands/__tests__/kit-data.test.tsx
/**
 * THE DATA KIT (lib/islands/kit/data: Number, Select, DataTable, Question) — the same DOM as today's
 * kit (`parityOf`), bound to the island's tables: a Number aggregates and formats, a Select offers a
 * table's rows and writes its value, a DataTable renders rows and sorts, a Question shows its
 * server-drawn chart until its table changes and loads Vega only then.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'solid-js/web';
import { createSignal } from 'solid-js';
import { createStore, reconcile } from 'solid-js/store';
import { parityOf } from './kit-parity';
import { IslandProvider } from '../context';
import { fakeIsland } from './context.test';
import { Number as KitNumber, Select, DataTable, Question } from '../kit/data';
import type { TableResult } from '@/lib/story/dataflow';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { SelectControl } from '@/components/kit/controls';
import { rowsDigest } from '../digest';
import { DRAWING_CLASS } from '../chart';

const monthly: TableResult = { rows: [{ month: '2025-01-01', revenue: 120, units: 3 }, { month: '2025-02-01', revenue: 160, units: 4 }], columns: [{ name: 'month', type: 'date' }, { name: 'revenue', type: 'number' }, { name: 'units', type: 'number' }] };
const regions: TableResult = { rows: [{ region: 'East' }, { region: 'West' }], columns: [{ name: 'region', type: 'string' }] };
const parityData = { tables: { monthly, regions }, values: { region: 'West' } };
const island = () => { const i = fakeIsland({ region: 'West' }); i.table = (n) => (n === 'monthly' ? monthly : n === 'regions' ? regions : undefined); i.tableSnapshot = i.table; return i; };
const mount = (ctx = island(), view: () => import('solid-js').JSX.Element) => { const host = document.createElement('div'); document.body.append(host); const unmount = render(() => <IslandProvider value={ctx}>{view()}</IslandProvider>, host); return { host, dispose: () => { unmount(); host.remove(); } }; };
beforeEach(() => document.documentElement.setAttribute('data-mx-ready', ''));
afterEach(() => document.documentElement.removeAttribute('data-mx-ready'));

describe('Number', () => {
  it('aggregates and formats like today\'s InlineNumber', () => {
    const { host } = mount(undefined, () => <KitNumber data="$monthly" col="revenue" agg="sum" prefix="$" format=",.0f" id="n" />);
    expect(host.textContent).toContain('$280');
    expect(parityOf('<Number data="$monthly" col="revenue" agg="sum" prefix="$" format=",.0f" id="n" />', host, parityData).filter((d) => !/text/.test(d))).toEqual([]);
  });
});

describe('Select', () => {
  it('writes a chosen literal option immediately', () => {
    const ctx = fakeIsland({ region: 'West' }); ctx.setValue = vi.fn();
    const { host, dispose } = mount(ctx, () => <Select label="Region" value="$region" options={['West','East']} />);
    (host.querySelector('[aria-haspopup="listbox"]') as HTMLButtonElement).click();
    ([...document.querySelectorAll('[role="option"]')].find(x => x.textContent === 'East') as HTMLButtonElement).click();
    expect(ctx.setValue).toHaveBeenCalledWith('region', 'East', undefined);
    dispose();
  });
  it('opens a searchable list', () => {
    const ctx = fakeIsland({ region: 'West' }); ctx.setValue = vi.fn();
    const { host, dispose } = mount(ctx, () => <Select label="Region" value="$region" options={['West','East']} />);
    (host.querySelector('[aria-haspopup="listbox"]') as HTMLButtonElement).click();
    expect(document.querySelector('[role="searchbox"]')).toBeTruthy();
    dispose();
  });
  it('places its popup in a trusted portal, or in place when none exists', () => {
    for (const portal of [null, document.createElement('div')]) {
      const ctx = fakeIsland({ region: 'West' }); ctx.trustedPortal = () => portal;
      const { host, dispose } = mount(ctx, () => <Select label="Region" value="$region" options={['West','East']} />);
      host.querySelector<HTMLButtonElement>('[aria-haspopup="listbox"]')!.click();
      expect((portal ?? host).querySelector('[role="listbox"]')).toBeTruthy();
      if (portal) expect(host.querySelector('[role="listbox"]')).toBeNull();
      dispose();
    }
  });
  it('offers the options table and writes the chosen value', () => {
    const ctx = island(); ctx.setValue = vi.fn();
    const { host } = mount(ctx, () => <Select label="Region" value="$region" options="$regions" placeholder="All regions" id="G2uA" />);
    // The helper mounts SelectControl with the STATIC render's `bound` stamp; today's live SelectAdapter
    // writes none (the parity gate compares against the live reader), so that one attribute is asserted apart.
    const stamp = '/0<div> @data-mx-bound: "value:$region options:$regions" vs undefined';
    expect(parityOf('<Select label="Region" value="$region" options="$regions" placeholder="All regions" id="G2uA" />', host, parityData).filter((d) => d !== stamp)).toEqual([]);
    expect(host.querySelector('[data-mx-bound]')).toBeNull();
    const select = host.querySelector('button[aria-haspopup="listbox"]') as HTMLButtonElement;
    expect(select.textContent).toContain('West');
    select.click();
    const options = [...document.querySelectorAll('[role="option"]')];
    expect(options.map((o) => o.getAttribute('aria-label'))).toEqual(['All regions', 'East', 'West']);
    (options[1] as HTMLButtonElement).click();
    expect(ctx.setValue).toHaveBeenCalledWith('region', 'East', undefined);
  });
});

describe('DataTable', () => {
  it('renders the rows and header of its table and matches today\'s DOM', () => {
    const { host } = mount(undefined, () => <DataTable data="$monthly" height="300px" id="dIQl" />);
    expect(host.querySelectorAll('tbody tr')).toHaveLength(2);
    // Today's DataTableAdapter wrapper holds the author identity; the kit table inside it is the helper's bare kit render.
    const wrapper = host.firstElementChild!;
    expect(Object.fromEntries([...wrapper.attributes].map((a) => [a.name, a.value]))).toEqual({ id: 'dIQl', 'aria-label': 'DataTable embed', 'aria-busy': 'false', style: 'width:100%' });
    const moved = '/0<div> @id: "dIQl" vs undefined';
    expect(parityOf('<DataTable data="$monthly" height="300px" id="dIQl" />', wrapper, parityData).filter((d) => d !== moved)).toEqual([]);
  });
});

describe('Question', () => {
  it('shows the server-drawn chart as ready and loads the chart engine only when its table changes or on interaction', async () => {
    const ctx = island();
    const loadChart = vi.fn(async () => ({ mountChart: () => ({ update() {}, destroy() {} }) }));
    const { host } = mount(ctx, () => <Question title="Revenue by month" data="$monthly" height="300px" viz={{ kind: 'vega-lite', spec: { mark: 'line' } }} id="AVkX" drawn={{ svg: '<svg data-drawn="1"></svg>', table: 'monthly', rows: 'r1' }} chart={loadChart} />);
    expect(host.querySelector('[data-mx-chart-state="ready"] svg[data-drawn]')).toBeTruthy();
    expect(loadChart).not.toHaveBeenCalled();
    host.querySelector('[data-mx-chart-state]')!.dispatchEvent(new Event('pointerenter', { bubbles: true }));
    await vi.waitFor(() => expect(loadChart).toHaveBeenCalledTimes(1));
  });
  it('loads after a new table snapshot lands after boot', async () => {
    const ctx = island();
    const [snapshot, setSnapshot] = createSignal(monthly);
    ctx.tableSnapshot = () => snapshot();
    const loadChart = vi.fn(async () => ({ mountChart: () => ({ destroy() {} }) }));
    mount(ctx, () => <Question data="$monthly" viz={{ kind: 'vega-lite', spec: { mark: 'line' } }} drawn={{ svg: '<svg></svg>', table: 'monthly', rows: 'r1' }} chart={loadChart} />);
    expect(loadChart).not.toHaveBeenCalled();
    setSnapshot({ ...monthly, rows: [...monthly.rows, { month: '2025-03-01', revenue: 10, units: 1 }] });
    // The new rows are checked against the drawing's digest (SubtleCrypto, asynchronous).
    await vi.waitFor(() => expect(loadChart).toHaveBeenCalledTimes(1));
  });
  it('uses the context loader by default after interaction and destroys its chart on dispose', async () => {
    const ctx = island();
    const destroy = vi.fn();
    const mountChart = vi.fn(() => ({ destroy }));
    ctx.loadChart = vi.fn(async () => ({ mountChart }));
    const { host, dispose } = mount(ctx, () => <Question data="$monthly" viz={{ kind: 'vega-lite', spec: { mark: 'line' } }} drawn={{ svg: '<svg></svg>', table: 'monthly', rows: 'r1' }} />);
    expect(ctx.loadChart).not.toHaveBeenCalled();
    host.querySelector('[data-mx-chart-state]')!.dispatchEvent(new Event('pointerenter', { bubbles: true }));
    await vi.waitFor(() => expect(ctx.loadChart).toHaveBeenCalledTimes(1));
    expect(mountChart).toHaveBeenCalledWith({
      element: host.querySelector('[role="graphics-document"]'),
      envelope: { version: 2, source: { kind: 'vega-lite', grammar: 'vega-lite@6', spec: { mark: 'line' } }, dataBindings: null, viewParams: null, interactions: null, assets: null },
      rows: monthly.rows,
    });
    dispose();
    expect(destroy).toHaveBeenCalledTimes(1);
  });
});

describe('DataTable behavior', () => {
  it('updates a comment target when a reconciled row proxy changes its key', () => {
    const ctx = island();
    const [state, setState] = createStore({ rows: [{ key: 'a', customer: 'Alice' }, { key: 'b', customer: 'Bob' }] });
    ctx.table = () => ({ rows: state.rows, columns: [{ name: 'key', type: 'string' }, { name: 'customer', type: 'string' }] });
    const { host, dispose } = mount(ctx, () => <DataTable data="$monthly" rowKey="key" id="orders" />);
    const target = (name: string) => {
      const cell = [...host.querySelectorAll('td')].find(node => node.textContent === name)!;
      return JSON.parse(cell.getAttribute('data-mx-comment-target')!).rowKey;
    };
    expect(target('Alice')).toBe('a');
    setState('rows', reconcile([{ key: 'b', customer: 'Bob updated' }, { key: 'a', customer: 'Alice updated' }], { merge: true }));
    expect([...host.querySelectorAll('td')].map(node => node.textContent)).toContain('Alice updated');
    expect(target('Alice updated')).toBe('a');
    setState('rows', reconcile([{ key: 'b', customer: 'Bob updated' }], { merge: true }));
    expect(host.textContent).not.toContain('Alice updated');
    dispose();
  });
  it('switches a measured long table from static rows to a virtual window', () => {
    const height = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientHeight');
    Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get() { return 300; } });
    try {
      const ctx = island();
      ctx.table = () => ({ rows: Array.from({ length: 200 }, (_, i) => ({ row: i })), columns: [{ name: 'row', type: 'number' }] });
      const { host } = mount(ctx, () => <DataTable data="$long" />);
      expect(host.querySelector('tbody')?.style.position).toBe('relative');
      expect(host.querySelectorAll('tbody tr').length).toBeGreaterThan(0);
      expect(host.querySelectorAll('tbody tr').length).toBeLessThan(50);
    } finally {
      if (height) Object.defineProperty(HTMLElement.prototype, 'clientHeight', height);
      else Reflect.deleteProperty(HTMLElement.prototype, 'clientHeight');
    }
  });
  it('sorts the complete local rows on header clicks', () => {
    const { host } = mount(undefined, () => <DataTable data="$monthly" />);
    const header = host.querySelector('th[aria-label="Sort by revenue"]') as HTMLElement;
    header.click();
    expect([...host.querySelectorAll('tbody tr')].map(row => row.querySelectorAll('td')[1]?.textContent)).toEqual(['120', '160']);
    header.click();
    expect([...host.querySelectorAll('tbody tr')].map(row => row.querySelectorAll('td')[1]?.textContent)).toEqual(['160', '120']);
  });
  it('loads a sorted remote window instead of sorting a truncated sample', async () => {
    const ctx = island();
    const sample = { ...monthly, truncated: true, totalRows: 1000 };
    ctx.table = () => sample;
    const fetchPage = vi.fn(async () => ({ ...monthly, rows: [{ month: 'remote', revenue: 900, units: 1 }] }));
    ctx.store = () => ({ fetchPage }) as unknown as ReturnType<typeof ctx.store>;
    const { host } = mount(ctx, () => <DataTable data="$monthly" />);
    (host.querySelector('th[aria-label="Sort by revenue"]') as HTMLElement).click();
    await Promise.resolve();
    expect(fetchPage).toHaveBeenCalledWith('monthly', { offset: 0, limit: 500, sort: { col: 'revenue', dir: 'asc' } });
    expect(host.querySelector('tbody')?.textContent).toContain('900');
    (host.querySelector('button[aria-label="Load more rows"]') as HTMLButtonElement).click();
    await Promise.resolve();
    expect(fetchPage).toHaveBeenLastCalledWith('monthly', { offset: 1, limit: 500, sort: { col: 'revenue', dir: 'asc' } });
    expect(host.querySelectorAll('tbody tr')).toHaveLength(2);
  });
  it('renders image copies, timestamps and authored cell templates', () => {
    const ctx = island();
    ctx.table = () => ({ rows: [{ photo: 'https://example.test/a.png', when: '2025-01-01T00:00:00Z', label: 'raw' }], columns: [{ name: 'photo', type: 'string' }, { name: 'when', type: 'timestamp' }, { name: 'label', type: 'string' }] });
    const { host } = mount(ctx, () => <DataTable data="$rich" templates={[{ col: 'photo', props: { col: 'photo', kind: 'image' }, nodes: [], path: '0' }, { col: 'when', props: { col: 'when' }, nodes: [], path: '1' }, { col: 'label', props: { col: 'label' }, nodes: [{ type: 'text', value: 'template' }], path: '2' }]} renderCell={() => <strong>templated</strong>} resolveSrc={() => '/copy/a.png'} />);
    expect(host.querySelector('img')?.getAttribute('src')).toBe('/copy/a.png');
    expect(host.querySelector('time')?.getAttribute('datetime')).toBe('2025-01-01T00:00:00Z');
    expect(host.querySelector('strong')?.textContent).toBe('templated');
  });
  it('uses the resolved person card and hides an unknown user id', () => {
    const ctx = island();
    ctx.table = () => ({ rows: [{ owner: 'usr_known' }, { owner: 'usr_hidden' }], columns: [{ name: 'owner', type: 'user' }] });
    ctx.people = () => ({ usr_known: { name: 'Ada', handle: 'ada', image: null } });
    const { host } = mount(ctx, () => <DataTable data="$people" />);
    expect(host.querySelector('a[data-slot="user-handle"]')?.textContent).toBe('@ada');
    expect(host.textContent).toContain('Unknown person');
    expect(host.textContent).not.toContain('usr_hidden');
  });
});

/*
 * PARITY WITH TODAY'S LIVE READER (scripts/gate-compiled-parity.mjs): the adapters' wrappers, the
 * chart slot around the drawing box only, and a served drawing kept while it is current.
 */
const attrsOf = (el: Element | null | undefined) => Object.fromEntries([...(el?.attributes ?? [])].map((a) => [a.name, a.value]));
const chart = { kind: 'vega-lite', spec: { mark: 'line' } };
const drawnFor = async (rows: TableResult['rows']) => ({ svg: '<svg data-drawn="1" height="303"></svg>', table: 'monthly', rows: await rowsDigest(rows) });

describe('data widget parity with the live reader', () => {
  it('Number carries no class and no binding stamp; Select writes no static binding stamp and today\'s trigger classes', () => {
    const { host } = mount(undefined, () => <><KitNumber data="$monthly" col="revenue" id="n" /><Select label="Region" value="$region" options="$regions" id="s" /></>);
    expect(attrsOf(host.querySelector('#n'))).toEqual({ id: 'n', 'aria-busy': 'false' });
    expect(host.querySelector('#s')?.hasAttribute('data-mx-bound')).toBe(false);
    const today = renderToStaticMarkup(createElement(SelectControl, { label: 'Region', options: [], value: null, onChange: () => {} }));
    const trigger = /<button[^>]*class="([^"]*)"/.exec(today)?.[1];
    expect(host.querySelector('#s button')?.getAttribute('class')).toBe(trigger);
  });

  it('Question: the adapter wrapper holds the identity, the chart slot marker never reaches the root, and the title sits outside the drawing box', () => {
    const { host } = mount(undefined, () => <Question title="Revenue by month" data="$monthly" height="300px" viz={chart} id="AVkX" data-mx-ast="1.5" {...{ 'data-mx-chart-slot': 'AVkX' }} drawn={{ svg: '<svg></svg>', table: 'monthly', rows: 'r' }} chart={async () => ({ mountChart: () => ({ destroy() {} }) })} />);
    const root = host.firstElementChild!;
    expect(attrsOf(root)).toEqual({ id: 'AVkX', 'data-mx-ast': '1.5', 'aria-label': 'Question embed', 'aria-busy': 'false', style: 'width:100%;height:340px' });
    expect(host.querySelector('[data-mx-chart-slot]')).toBeNull();
    const body = root.firstElementChild!;
    expect(attrsOf(body)).toEqual({ class: 'flex h-full w-full flex-col', 'aria-label': 'Question embed body' });
    const slot = host.querySelector('[role="graphics-document"]')!;
    expect(slot.textContent).not.toContain('Revenue by month');
    expect(body.firstElementChild?.textContent).toBe('Revenue by month');
    expect(attrsOf(slot)).toEqual({ 'data-mx-chart-state': 'ready', 'aria-label': 'Vega visualization', class: 'h-full w-full overflow-hidden [&_.vega-embed]:block [&_svg]:block', role: 'graphics-document', 'aria-roledescription': 'visualization', style: 'cursor: default;' });
    expect(slot.parentElement?.getAttribute('class')).toBe('relative min-h-0 w-full flex-1 overflow-hidden');
  });

  it('Question in a grid cell fills the cell, and a table viz renders today\'s plain table', () => {
    const { host } = mount(undefined, () => <><Question data="$monthly" viz={chart} inGridItem id="g" chart={async () => ({ mountChart: () => ({ destroy() {} }) })} /><Question data="$monthly" id="t" /></>);
    expect(host.querySelector('#g')?.getAttribute('style')).toBe('width:100%;height:100%');
    expect(host.querySelector('#t')?.getAttribute('style')).toBe('width:100%;height:430px');
    expect(host.querySelector('#t [aria-label="Data table"] thead')?.textContent).toBe('monthrevenueunits');
    expect(host.querySelectorAll('#t [aria-label="Data table"] tbody tr')).toHaveLength(2);
  });

  it('Question draws a chart the server did not draw after readiness', async () => {
    const loadChart = vi.fn(async () => ({ mountChart: () => ({ destroy() {} }) }));
    mount(undefined, () => <Question data="$monthly" viz={chart} chart={loadChart} />);
    await vi.waitFor(() => expect(loadChart).toHaveBeenCalledTimes(1));
  });

  it('Question leaves the placeholder and keeps Vega unloaded until reader readiness', async () => {
    document.documentElement.removeAttribute('data-mx-ready');
    const loadChart = vi.fn(async () => ({ mountChart: () => ({ destroy() {} }) }));
    const { host } = mount(undefined, () => <Question data="$monthly" viz={chart} chart={loadChart} />);
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(loadChart).not.toHaveBeenCalled();
    expect(host.querySelector('[data-mx-chart-state]')?.getAttribute('data-mx-chart-state')).toBe('pending');
    document.documentElement.setAttribute('data-mx-ready', '');
    document.dispatchEvent(new Event('mx:ready'));
    await vi.waitFor(() => expect(loadChart).toHaveBeenCalledTimes(1));
  });

  it('Question keeps a current served drawing and its ready state when the same rows arrive again, and draws when they change', async () => {
    const ctx = island();
    const [snapshot, setSnapshot] = createSignal(monthly);
    ctx.tableSnapshot = () => snapshot();
    const loadChart = vi.fn(async () => ({ mountChart: () => ({ destroy() {} }) }));
    const drawn = await drawnFor(monthly.rows);
    const { host } = mount(ctx, () => <Question data="$monthly" viz={chart} drawn={drawn} chart={loadChart} />);
    const slot = host.querySelector('[role="graphics-document"]')!;
    const served = slot.firstElementChild;
    setSnapshot({ ...monthly, rows: monthly.rows.map((r) => ({ ...r })) });
    await new Promise((r) => setTimeout(r, 20));
    expect(loadChart).not.toHaveBeenCalled();
    expect(slot.getAttribute('data-mx-chart-state')).toBe('ready');
    expect(slot.firstElementChild).toBe(served);
    setSnapshot({ ...monthly, rows: [...monthly.rows, { month: '2025-03-01', revenue: 10, units: 1 }] });
    await vi.waitFor(() => expect(loadChart).toHaveBeenCalledTimes(1));
  });

  it('Question leaves a responsive served drawing exactly as served: no inline size, no redraw', async () => {
    const loadChart = vi.fn(async () => ({ mountChart: () => ({ destroy() {} }) }));
    const drawn = { ...(await drawnFor(monthly.rows)), svg: `<svg class="marks ${DRAWING_CLASS}" width="640" height="303" viewBox="0 0 640 303"></svg>` };
    // A box smaller than the nominal drawing (a fixed-height card): the drawing already fills it from the first paint.
    const rect = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ height: 249, width: 515 } as DOMRect);
    try {
      const { host } = mount(undefined, () => <Question data="$monthly" viz={chart} drawn={drawn} chart={loadChart} />);
      const svg = host.querySelector('[role="graphics-document"] > svg')!;
      expect(svg.hasAttribute('style')).toBe(false);
    } finally { rect.mockRestore(); }
    await new Promise((r) => setTimeout(r, 20));
    expect(loadChart).not.toHaveBeenCalled();
  });

  it('Question feeds a chart drawn here the rows of every later result', async () => {
    const ctx = island();
    const [snapshot, setSnapshot] = createSignal(monthly);
    ctx.tableSnapshot = () => snapshot();
    const update = vi.fn();
    mount(ctx, () => <Question data="$monthly" viz={chart} chart={async () => ({ mountChart: () => ({ update, destroy() {} }) })} />);
    await new Promise((r) => setTimeout(r, 0));
    const next = [{ month: '2025-03-01', revenue: 10, units: 1 }];
    setSnapshot({ ...monthly, rows: next });
    await vi.waitFor(() => expect(update).toHaveBeenCalledWith(next));
  });

  it('DataTable takes the compiler\'s columns and column identities, and writes no style before it measures', () => {
    const { host } = mount(undefined, () => <DataTable data="$monthly" id="t" columns={[{ col: 'month', title: 'Month' }, { col: 'revenue', title: 'Revenue' }]} templates={[{ col: 'month', id: 'cm', path: '1.1' }, { col: 'revenue', path: '1.3' }]} />);
    const heads = [...host.querySelectorAll('thead th')];
    expect(heads.map((th) => [th.textContent, th.getAttribute('id'), th.getAttribute('data-mx-ast')])).toEqual([['Month', 'cm', '1.1'], ['Revenue', null, '1.3']]);
    expect(host.querySelectorAll('tbody tr td')).toHaveLength(4);
    for (const el of host.querySelectorAll('table, thead, thead tr, tbody, tbody tr')) expect(el.hasAttribute('style'), el.tagName).toBe(false);
    expect(host.querySelector('td')?.getAttribute('style')).toBe('text-align: left;');
    expect(host.querySelector('[data-slot="data-table"] > div')?.getAttribute('style')).toBe('max-height: 420px;');
  });

  it('DataTable becomes a virtual window once measured, whatever its row count, and keeps the rows it rendered', () => {
    const height = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientHeight');
    Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get() { return 300; } });
    const host = document.createElement('div'); document.body.append(host);
    const removed: Node[] = [];
    const observer = new MutationObserver(() => {});
    observer.observe(host, { childList: true, subtree: true });
    try {
      const unmount = render(() => <IslandProvider value={island()}><DataTable data="$monthly" /></IslandProvider>, host);
      for (const record of observer.takeRecords()) removed.push(...record.removedNodes);
      expect(host.querySelector('table')?.getAttribute('style')).toBe('display: block;');
      expect(host.querySelector('tbody')?.getAttribute('style')).toMatch(/^display: block; height: \d+px; position: relative;$/);
      expect(host.querySelector('tbody tr')?.getAttribute('style')).toMatch(/position: absolute; top: 0px; left: 0px; transform: translateY\(0px\);$/);
      expect(host.querySelectorAll('tbody tr')).toHaveLength(2);
      expect(removed.filter((n) => n.nodeName === 'TR' || n.nodeName === 'TD'), 'the static rows are the virtual rows').toEqual([]);
      unmount();
    } finally {
      observer.disconnect(); host.remove();
      if (height) Object.defineProperty(HTMLElement.prototype, 'clientHeight', height);
      else Reflect.deleteProperty(HTMLElement.prototype, 'clientHeight');
    }
  });

  it('DataTable says why it has no table, inside today\'s adapter wrapper', () => {
    const ctx = island(); ctx.table = () => undefined; ctx.error = (n) => (n === 'monthly' ? 'boom' : undefined);
    const { host } = mount(ctx, () => <DataTable data="$monthly" id="t" />);
    expect(attrsOf(host.firstElementChild)).toMatchObject({ id: 't', 'aria-label': 'DataTable embed', style: 'width:100%' });
    expect(host.textContent).toBe('query "monthly" failed: boom');
  });
});

// The compiler writes these classes before hydration; compare them with today's roots.
import { RECIPES } from '../kit/recipes/data';
import { reactRender, shapeOf } from './kit-parity';

describe('data class recipes', () => {
  for (const tag of ['Select', 'DataTable'] as const) {
    it(`${tag} preserves its root class and merges author classes`, () => {
      for (const author of ['', ' ring-2 px-4']) {
        const props = { className: author.trim() };
        const markup = `<${tag} label="Region" className="${author.trim()}" />`;
        const expected = shapeOf(reactRender(markup))[0]?.attrs.class;
        expect(RECIPES[tag]?.(props).split(/\s+/).sort().join(' ')).toBe(expected);
      }
    });
  }
});
