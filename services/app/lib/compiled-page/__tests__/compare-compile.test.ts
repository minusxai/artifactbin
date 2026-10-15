/**
 * `<DataTable transpose>` THROUGH THE COMPILER: the authored comparison props (`transpose`, `header`,
 * `metrics`, `edge`, the bare booleans included) reach the kit as API props, so the server render is the
 * comparison table and the browser module hands the island the same props for hydration.
 */
import { describe, expect, it } from 'vitest';
import { JSDOM } from 'jsdom';
import { compilePage, generate } from '../compiler';
import { loadSsrModule } from '../bundle.server';
import { loadCompilerBuild } from '../build.server';
import { inputOf } from './p3-static/harness';

const MARKUP = '<Helmet><Import name="sales" src="ref:SALES1" /><Query name="picks">{`select region as name, revenue as cost, units as score from sales.rows`}</Query></Helmet>'
  + '<div id="root"><DataTable data="$picks" transpose header="name" edge metrics={[{"col":"cost","title":"Cost per run","fmt":"$,.2f","better":"low"},{"col":"score","title":"Score","fmt":".1f","better":"high"}]} id="cmp" /></div>';
const RESULTS = { tables: { picks: { rows: [{ name: 'Go', cost: 12.5, score: 30 }, { name: 'Rust', cost: 10, score: 31 }, { name: 'Ruby', cost: 20, score: 22 }], columns: [{ name: 'name', type: 'string' }, { name: 'cost', type: 'number' }, { name: 'score', type: 'number' }] } }, errors: {} };

describe('a compiled transposed DataTable', () => {
  it('serves the comparison table and hands the island its comparison props', async () => {
    const input = await inputOf({ key: 'datatable-transpose', group: 'tag', template: null, markup: MARKUP });
    const page = await compilePage(input, loadCompilerBuild());
    const html = (await loadSsrModule(page.ssr!)).render({ values: {}, results: RESULTS as never, mermaidImages: {}, drawings: {} });
    const doc = new JSDOM(html).window.document;
    const table = doc.querySelector('#cmp table[data-mx-compare]');
    expect(table, 'the served DataTable is the comparison').not.toBeNull();
    expect([...table!.querySelectorAll('thead th')].map((th) => th.textContent)).toEqual(['Measure', 'Go', 'Rust', 'Ruby', 'Edge']);
    const rows = [...table!.querySelectorAll('tbody tr')];
    expect(rows.map((r) => r.querySelector('th')!.textContent)).toEqual(['Cost per run', 'Score']);
    expect(rows[0]!.querySelector('td .font-bold')?.textContent).toBe('$10.00');
    expect(rows[0]!.lastElementChild!.textContent).toBe('Rust by 25% vs Go');
    const browser = generate(input).browserIslands;
    // Structured props travel as hoisted constants (compiler §9); the server render above proves their values.
    expect(browser).toMatch(/<DataTable [^>]*transpose=\{/);
    expect(browser).toMatch(/<DataTable [^>]*edge=\{/);
    expect(browser).toMatch(/<DataTable [^>]*header=\{"name"\}/);
    expect(browser).toMatch(/<DataTable [^>]*metrics=\{/);
  }, 120_000);
});
