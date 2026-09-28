/* @jsxImportSource solid-js */
// DESTINATION: services/app/lib/islands/__tests__/kit-data.test.tsx
/**
 * THE DATA KIT (lib/islands/kit/data: Number, Select, DataTable, Question) — the same DOM as today's
 * kit (`parityOf`), bound to the island's tables: a Number aggregates and formats, a Select offers a
 * table's rows and writes its value, a DataTable renders rows and sorts, a Question shows its
 * server-drawn chart until its table changes and loads Vega only then.
 */
import { describe, expect, it, vi } from 'vitest';
import { render } from 'solid-js/web';
import { createSignal } from 'solid-js';
import { parityOf } from './kit-parity';
import { IslandProvider } from '../context';
import { fakeIsland } from './context.test';
import { Number as KitNumber, Select, DataTable, Question } from '../kit/data';
import type { TableResult } from '@/lib/story/dataflow';

const monthly: TableResult = { rows: [{ month: '2025-01-01', revenue: 120, units: 3 }, { month: '2025-02-01', revenue: 160, units: 4 }], columns: [{ name: 'month', type: 'date' }, { name: 'revenue', type: 'number' }, { name: 'units', type: 'number' }] };
const regions: TableResult = { rows: [{ region: 'East' }, { region: 'West' }], columns: [{ name: 'region', type: 'string' }] };
const parityData = { tables: { monthly, regions }, values: { region: 'West' } };
const island = () => { const i = fakeIsland({ region: 'West' }); i.table = (n) => (n === 'monthly' ? monthly : n === 'regions' ? regions : undefined); i.tableSnapshot = i.table; return i; };
const mount = (ctx = island(), view: () => import('solid-js').JSX.Element) => { const host = document.createElement('div'); document.body.append(host); const unmount = render(() => <IslandProvider value={ctx}>{view()}</IslandProvider>, host); return { host, dispose: () => { unmount(); host.remove(); } }; };

describe('Number', () => {
  it('aggregates and formats like today\'s InlineNumber', () => {
    const { host } = mount(undefined, () => <KitNumber data="$monthly" col="revenue" agg="sum" prefix="$" format=",.0f" id="n" />);
    expect(host.textContent).toContain('$280');
    expect(parityOf('<Number data="$monthly" col="revenue" agg="sum" prefix="$" format=",.0f" id="n" />', host, parityData).filter((d) => !/text/.test(d))).toEqual([]);
  });
});

describe('Select', () => {
  it('offers the options table and writes the chosen value', () => {
    const ctx = island(); ctx.setValue = vi.fn();
    const { host } = mount(ctx, () => <Select label="Region" value="$region" options="$regions" placeholder="All regions" id="G2uA" />);
    expect(parityOf('<Select label="Region" value="$region" options="$regions" placeholder="All regions" id="G2uA" />', host, parityData)).toEqual([]);
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
    expect(parityOf('<DataTable data="$monthly" height="300px" id="dIQl" />', host, parityData)).toEqual([]);
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
    await Promise.resolve();
    expect(loadChart).toHaveBeenCalledTimes(1);
  });
  it('loads after a new table snapshot lands after boot', async () => {
    const ctx = island();
    const [snapshot, setSnapshot] = createSignal(monthly);
    ctx.tableSnapshot = () => snapshot();
    const loadChart = vi.fn(async () => ({ mountChart: () => ({ destroy() {} }) }));
    mount(ctx, () => <Question data="$monthly" viz={{ kind: 'vega-lite', spec: { mark: 'line' } }} drawn={{ svg: '<svg></svg>', table: 'monthly', rows: 'r1' }} chart={loadChart} />);
    expect(loadChart).not.toHaveBeenCalled();
    setSnapshot({ ...monthly, rows: [...monthly.rows, { month: '2025-03-01', revenue: 10, units: 1 }] });
    await Promise.resolve();
    expect(loadChart).toHaveBeenCalledTimes(1);
  });
  it('uses the context loader by default after interaction and destroys its chart on dispose', async () => {
    const ctx = island();
    const destroy = vi.fn();
    const mountChart = vi.fn(() => ({ destroy }));
    ctx.loadChart = vi.fn(async () => ({ mountChart }));
    const { host, dispose } = mount(ctx, () => <Question data="$monthly" viz={{ kind: 'vega-lite', spec: { mark: 'line' } }} drawn={{ svg: '<svg></svg>', table: 'monthly', rows: 'r1' }} />);
    expect(ctx.loadChart).not.toHaveBeenCalled();
    host.querySelector('[data-mx-chart-state]')!.dispatchEvent(new Event('pointerenter', { bubbles: true }));
    await Promise.resolve();
    expect(ctx.loadChart).toHaveBeenCalledTimes(1);
    expect(mountChart).toHaveBeenCalledWith({
      element: host.querySelector('[data-mx-chart-slot]'),
      envelope: { version: 2, source: { kind: 'vega-lite', grammar: 'vega-lite@6', spec: { mark: 'line' } }, dataBindings: null, viewParams: null, interactions: null, assets: null },
      rows: monthly.rows,
    });
    dispose();
    expect(destroy).toHaveBeenCalledTimes(1);
  });
});

describe('DataTable behavior', () => {
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
