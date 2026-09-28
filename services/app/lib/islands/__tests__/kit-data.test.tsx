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
import { parityOf } from './kit-parity';
import { IslandProvider } from '../context';
import { fakeIsland } from './context.test';
import { Number as KitNumber, Select, DataTable, Question } from '../kit/data';
import type { TableResult } from '@/lib/story/dataflow';

const monthly: TableResult = { rows: [{ month: '2025-01-01', revenue: 120, units: 3 }, { month: '2025-02-01', revenue: 160, units: 4 }], columns: [{ name: 'month', type: 'date' }, { name: 'revenue', type: 'number' }, { name: 'units', type: 'number' }] };
const regions: TableResult = { rows: [{ region: 'East' }, { region: 'West' }], columns: [{ name: 'region', type: 'string' }] };
const island = () => { const i = fakeIsland({ region: 'West' }); i.table = (n) => (n === 'monthly' ? monthly : n === 'regions' ? regions : undefined); i.tableSnapshot = i.table; return i; };
const mount = (ctx = island(), view: () => import('solid-js').JSX.Element) => { const host = document.createElement('div'); const dispose = render(() => <IslandProvider value={ctx}>{view()}</IslandProvider>, host); return { host, dispose }; };

describe('Number', () => {
  it('aggregates and formats like today\'s InlineNumber', () => {
    const { host } = mount(undefined, () => <KitNumber data="$monthly" col="revenue" agg="sum" prefix="$" format=",.0f" id="n" />);
    expect(host.textContent).toContain('$280');
    expect(parityOf('<Number data="$monthly" col="revenue" agg="sum" prefix="$" format=",.0f" id="n" />', host).filter((d) => !/text/.test(d))).toEqual([]);
  });
});

describe('Select', () => {
  it('offers the options table and writes the chosen value', () => {
    const ctx = island(); ctx.setValue = vi.fn();
    const { host } = mount(ctx, () => <Select label="Region" value="$region" options="$regions" placeholder="All regions" id="G2uA" />);
    expect(parityOf('<Select label="Region" value="$region" options="$regions" placeholder="All regions" id="G2uA" />', host)).toEqual([]);
    const select = host.querySelector('select') as HTMLSelectElement;
    expect([...select.options].map((o) => o.value)).toEqual(['', 'East', 'West']);
    expect(select.value).toBe('West');
    select.value = 'East'; select.dispatchEvent(new Event('change', { bubbles: true }));
    expect(ctx.setValue).toHaveBeenCalledWith('region', 'East', undefined);
  });
});

describe('DataTable', () => {
  it('renders the rows and header of its table and matches today\'s DOM', () => {
    const { host } = mount(undefined, () => <DataTable data="$monthly" height="300px" id="dIQl" />);
    expect(host.querySelectorAll('tbody tr')).toHaveLength(2);
    expect(parityOf('<DataTable data="$monthly" height="300px" id="dIQl" />', host)).toEqual([]);
  });
});

describe('Question', () => {
  it('shows the server-drawn chart as ready and loads the chart engine only when its table changes or on interaction', async () => {
    const ctx = island();
    const loadChart = vi.fn(async () => ({ mountChart: () => ({ update() {}, dispose() {} }) }));
    const { host } = mount(ctx, () => <Question title="Revenue by month" data="$monthly" height="300px" viz={{ kind: 'vega-lite', spec: { mark: 'line' } }} id="AVkX" drawn={{ svg: '<svg data-drawn="1"></svg>', table: 'monthly', rows: 'r1' }} chart={loadChart} />);
    expect(host.querySelector('[data-mx-chart-state="ready"] svg[data-drawn]')).toBeTruthy();
    expect(loadChart).not.toHaveBeenCalled();
    host.querySelector('[data-mx-chart-state]')!.dispatchEvent(new Event('pointerenter', { bubbles: true }));
    await Promise.resolve();
    expect(loadChart).toHaveBeenCalledTimes(1);
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
