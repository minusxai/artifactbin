/**
 * KIT PARITY FOR AN AUTHOR'S CLASS ON A COMPILED DATA COMPONENT: the class an author writes lands where the live
 * component puts it. A `<DataTable>`'s on the grid's `data-slot="data-table"` box (the class `RECIPES.DataTable`
 * names, which kit-data.test holds equal to the live render), never the adapter wrapper, which keeps the node's
 * identity and the author's `data-*` attributes (kit/data `rootProps`); a `<Select>`'s and a `<Number>`'s on their
 * roots. All three read `className`, never the compiler's `class`.
 */
import { describe, expect, it } from 'vitest';
import { JSDOM } from 'jsdom';
import { compilePage, generate } from '../compiler';
import { loadSsrModule } from '../bundle.server';
import { loadCompilerBuild } from '../build.server';
import { RECIPES } from '@/lib/islands/kit/recipes';
import { inputOf } from './p3-static/harness';

const tokens = (value: string | null | undefined) => (value ?? '').split(/\s+/).filter(Boolean).sort();
const MARKUP = '<Helmet><Import name="sales" src="ref:SALES1" /><Query name="monthly">{`select month, sum(revenue) as revenue from sales.rows group by 1 order by 1`}</Query></Helmet>'
  + '<div id="root"><DataTable data="$monthly" className="mt-6 ring-2" data-note="n" id="t" /><DataTable data="$monthly" id="plain" />'
  + '<Select label="Region" options={["a","b"]} className="mt-6 ring-2" id="s" /><Number data="$monthly" col="revenue" agg="sum" className="font-bold" id="n" /></div>';
const RESULTS = { tables: { monthly: { rows: [{ month: '2025-01-01', revenue: 120 }, { month: '2025-02-01', revenue: 160 }], columns: [{ name: 'month', type: 'date' }, { name: 'revenue', type: 'number' }] } }, errors: {} };

describe('an author class on a compiled DataTable', () => {
  it('reaches the grid box the live DataTable styles, and a Select\'s and a Number\'s reach their roots', async () => {
    const input = await inputOf({ key: 'datatable-class', group: 'tag', template: null, markup: MARKUP });
    const page = await compilePage(input, loadCompilerBuild());
    const html = (await loadSsrModule(page.ssr!)).render({ values: {}, results: RESULTS as never, mermaidImages: {}, drawings: {} });
    const doc = new JSDOM(html).window.document;
    const wrapper = doc.getElementById('t')!;
    const grid = wrapper.querySelector('[data-slot="data-table"]');
    expect(grid, 'the table rendered from the snapshot').not.toBeNull();
    expect(tokens(grid!.getAttribute('class'))).toEqual(tokens(RECIPES.DataTable!({ className: 'mt-6 ring-2' })));
    expect(tokens(grid!.getAttribute('class'))).toEqual(expect.arrayContaining(['mt-6', 'ring-2']));
    expect(wrapper.getAttribute('class')).toBeNull();
    expect(wrapper.getAttribute('data-note')).toBe('n');
    // Without an author class, the recipe's own.
    expect(tokens(doc.querySelector('#plain [data-slot="data-table"]')!.getAttribute('class'))).toEqual(tokens(RECIPES.DataTable!({})));
    // A Select's and a Number's land on their roots, as the live components put them (kit/data).
    expect(tokens(doc.getElementById('s')!.getAttribute('class'))).toEqual(tokens(RECIPES.Select!({ className: 'mt-6 ring-2' })));
    expect(doc.getElementById('n')!.getAttribute('class')).toBe('font-bold');
    // The browser module hands the component the same class, so hydration keeps it.
    const browser = generate(input).browserIslands;
    expect(browser).toMatch(/<DataTable [^>]*className=\{"mt-6 ring-2"\}/);
    expect(browser).toMatch(/<Select [^>]*className=\{"mt-6 ring-2"\}/);
    expect(browser).toMatch(/<Number [^>]*className=\{"font-bold"\}/);
  }, 120_000);
});
