/* @jsxImportSource solid-js */
/**
 * `<DataTable transpose>` — the comparison table: each row of the bound table becomes a column headed by
 * its `header` cell, each metric a row, the best value per metric bold, its rank and sub line beside and
 * under it, and an Edge column. It is a DataTable to look at: the same box, table, header, row and cell
 * classes element by element (kit/recipes/data TABLE_CLASSES), pinned here against a live DataGrid.
 */
import { describe, expect, it } from 'vitest';
import { render } from 'solid-js/web';
import { IslandProvider } from '../context';
import { fakeIsland } from './context.test';
import { DataTable } from '../kit/data';
import { RECIPES } from '../kit/recipes';
import { TABLE_CLASSES } from '../kit/data/table-classes';
import { MAX_COMPARE_ITEMS } from '@/lib/story-ui/compare';
import type { TableResult } from '@/lib/dataflow';

const picks: TableResult = {
  rows: [
    { name: 'Go', cost: 12.5, score: 30.25, cost_rank: 2, cost_range: '$10–$15' },
    { name: 'Rust', cost: 10, score: 31, cost_rank: 1, cost_range: '$8–$12' },
    { name: 'Ruby', cost: 20, score: null, cost_rank: 3, cost_range: null },
  ],
  columns: [{ name: 'name', type: 'string' }, { name: 'cost', type: 'number' }, { name: 'score', type: 'number' }, { name: 'cost_rank', type: 'number' }, { name: 'cost_range', type: 'string' }],
};
const many: TableResult = { rows: Array.from({ length: MAX_COMPARE_ITEMS + 2 }, (_, i) => ({ name: `item${i}`, v: i })), columns: [{ name: 'name', type: 'string' }, { name: 'v', type: 'number' }] };
const METRICS = [
  { col: 'cost', title: 'Cost per run', fmt: '$,.2f', better: 'low', rank: 'cost_rank', sub: 'cost_range' },
  { col: 'score', title: 'Score (of 34)', fmt: '.1f', better: 'high' },
];
const island = () => { const i = fakeIsland(); i.table = (n) => (n === 'picks' ? picks : n === 'many' ? many : undefined); i.tableSnapshot = i.table; return i; };
const mount = (view: () => import('solid-js').JSX.Element) => {
  const host = document.createElement('div');
  document.body.append(host);
  const unmount = render(() => <IslandProvider value={island()}>{view()}</IslandProvider>, host);
  return { host, dispose: () => { unmount(); host.remove(); } };
};
const tokens = (el: Element | null | undefined) => (el?.getAttribute('class') ?? '').split(/\s+/).filter(Boolean).sort();
const cellText = (el: Element) => (el.textContent ?? '').replace(/\s+/g, ' ').trim();
/** A value cell's drawn parts: the value, its rank and its sub line. */
const parts = (td: Element) => [...td.querySelectorAll('span')].filter((s) => !s.children.length).map((s) => s.textContent ?? '');

describe('DataTable transpose', () => {
  it('draws items as columns, metrics as rows, the best value bold, rank and sub, and the edge', () => {
    const { host, dispose } = mount(() => <DataTable data="$picks" transpose header="name" edge metrics={METRICS} id="cmp" />);
    try {
      const table = host.querySelector('#cmp table')!;
      expect(table.hasAttribute('data-mx-kit-table'), 'opts out of the document table scroll box').toBe(true);
      expect([...table.querySelectorAll('thead th')].map(cellText)).toEqual(['Measure', 'Go', 'Rust', 'Ruby', 'Edge']);
      const rows = [...table.querySelectorAll('tbody tr')];
      expect(rows.map((r) => cellText(r.querySelector('th[scope="row"]')!))).toEqual(['Cost per run', 'Score (of 34)']);
      const cost = [...rows[0]!.querySelectorAll('td')];
      expect(cost.slice(0, 3).map(parts)).toEqual([['$12.50', '#2', '$10–$15'], ['$10.00', '#1', '$8–$12'], ['$20.00', '#3']]);
      expect(cost.slice(0, 3).map((td) => !!td.querySelector('.font-bold'))).toEqual([false, true, false]);
      expect(cellText(cost[3]!)).toBe('Rust by 25% vs Go');
      expect(cost[3]!.querySelector('strong')?.textContent).toBe('Rust');
      const score = [...rows[1]!.querySelectorAll('td')];
      expect(score.slice(0, 3).map(cellText)).toEqual(['30.3', '31.0', '–']);
      expect(cellText(score[3]!)).toBe('Rust by 2%');
      // No sort affordance: a comparison is not a sortable grid.
      expect(table.querySelector('[aria-sort]')).toBeNull();
    } finally { dispose(); }
  });

  it('leaves out the Edge column without edge, and every column but the header is a metric without metrics', () => {
    const { host, dispose } = mount(() => <DataTable data="$picks" transpose header="name" />);
    try {
      expect([...host.querySelectorAll('thead th')].map(cellText)).toEqual(['Measure', 'Go', 'Rust', 'Ruby']);
      expect([...host.querySelectorAll('tbody th[scope="row"]')].map(cellText)).toEqual(['cost', 'score', 'cost_rank', 'cost_range']);
    } finally { dispose(); }
  });

  it('shows at most MAX_COMPARE_ITEMS items and says how many were left out', () => {
    const { host, dispose } = mount(() => <DataTable data="$many" transpose header="name" metrics={[{ col: 'v', better: 'high' }]} />);
    try {
      expect(host.querySelectorAll('thead th')).toHaveLength(MAX_COMPARE_ITEMS + 1);
      expect(host.querySelector('[aria-label="Item count"]')?.textContent).toBe(`showing ${MAX_COMPARE_ITEMS} of ${MAX_COMPARE_ITEMS + 2} items — a comparison holds ${MAX_COMPARE_ITEMS}; filter the query to choose which`);
    } finally { dispose(); }
  });

  it('looks like a DataTable: the same box, table, header, row and cell classes as a live DataGrid', () => {
    const grid = mount(() => <DataTable data="$picks" className="mt-4" />);
    const cmp = mount(() => <DataTable data="$picks" transpose header="name" edge metrics={METRICS} className="mt-4" />);
    try {
      const g = grid.host, c = cmp.host;
      // The box takes the DataTable recipe, author class included (kit-class-parity holds for both).
      expect(tokens(c.querySelector('[data-slot="data-table"]'))).toEqual(tokens(g.querySelector('[data-slot="data-table"]')));
      expect(tokens(c.querySelector('[data-slot="data-table"]'))).toEqual(RECIPES.DataTable!({ className: 'mt-4' }).split(' ').sort());
      for (const selector of ['[data-slot="data-table"] > div', 'table', 'thead tr', 'tbody tr']) {
        expect(tokens(c.querySelector(selector)), selector).toEqual(tokens(g.querySelector(selector)));
      }
      // Header cells: DataGrid's add only its sort affordance to the shared header cell.
      const gridHead = g.querySelector('thead th')!, itemHead = c.querySelectorAll('thead th')[1]!;
      expect(tokens(itemHead)).toEqual(TABLE_CLASSES.headCell.split(' ').sort());
      expect(tokens(gridHead)).toEqual([...TABLE_CLASSES.headCell.split(' '), 'cursor-pointer', 'select-none'].sort());
      expect(tokens(gridHead)).toEqual(TABLE_CLASSES.sortHeadCell.split(' ').sort());
      expect(tokens(c.querySelector('thead'))).toEqual(TABLE_CLASSES.head.split(' ').sort());
      // A value cell is exactly a numeric DataGrid cell: same padding, rules, tabular figures; same alignment.
      const gridNumber = g.querySelectorAll('tbody tr')[0]!.querySelectorAll('td')[1]!;
      const value = c.querySelector('tbody td')!;
      expect(tokens(value)).toEqual(tokens(gridNumber));
      expect((value as HTMLElement).style.textAlign).toBe((gridNumber as HTMLElement).style.textAlign);
      expect((value as HTMLElement).style.textAlign).toBe('right');
      // The measure column is a body cell (not a bold header), pinned to the left while the items scroll.
      const measure = c.querySelector('tbody th[scope="row"]')!;
      expect(tokens(measure)).toEqual(expect.arrayContaining([...TABLE_CLASSES.cell.split(' '), 'sticky', 'left-0', 'font-normal']));
    } finally { grid.dispose(); cmp.dispose(); }
  });
});
