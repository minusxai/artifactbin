/**
 * The pure half of `<DataTable transpose>`: each query row becomes a column, each metric a row; the
 * best value per metric, its rank and sub line, and the edge text are computed here, formatted the
 * way a DataTable formats the same cell.
 */
import { describe, expect, it } from 'vitest';
import { compareTable, MAX_COMPARE_ITEMS, parseMetricSpecs } from '@/lib/story-ui/compare';
import { formatCell, resolveColumns } from '@/lib/story-ui/data-table';
import type { DatasetColumn, Row } from '@/lib/dataflow';

const COLUMNS: DatasetColumn[] = [
  { name: 'name', type: 'string' }, { name: 'cost', type: 'number' }, { name: 'score', type: 'number' },
  { name: 'cost_rank', type: 'number' }, { name: 'cost_range', type: 'string' },
];
const ROWS: Row[] = [
  { name: 'Go', cost: 12.5, score: 30.25, cost_rank: 2, cost_range: '$10–$15' },
  { name: 'Rust', cost: 10, score: 31, cost_rank: 1, cost_range: '$8–$12' },
  { name: 'Ruby', cost: 20, score: null, cost_rank: 3, cost_range: null },
];
const METRICS = parseMetricSpecs([
  { col: 'cost', title: 'Cost per run', fmt: '$,.2f', better: 'low', rank: 'cost_rank', sub: 'cost_range' },
  { col: 'score', title: 'Score (of 34)', fmt: '.1f', better: 'high' },
]);
const text = (edge: { lead: string; rest: string } | null) => (edge ? edge.lead + edge.rest : '');

describe('parseMetricSpecs', () => {
  it('keeps {col, title, fmt, better, rank, sub} and drops malformed entries and unknown directions', () => {
    expect(parseMetricSpecs([{ col: 'cost', title: 'Cost', fmt: '$,.2f', better: 'low', rank: 'r', sub: 's', bogus: 1 }, { title: 'no col' }, 'x', { col: 'q', better: 'up' }]))
      .toEqual([{ col: 'cost', title: 'Cost', fmt: '$,.2f', better: 'low', rank: 'r', sub: 's' }, { col: 'q' }]);
    expect(parseMetricSpecs(undefined)).toEqual([]);
    expect(parseMetricSpecs('cost')).toEqual([]);
  });
});

describe('compareTable', () => {
  const table = compareTable({ rows: ROWS, columns: COLUMNS, header: 'name', metrics: METRICS, edge: true });

  it('turns each row into an item column headed by its header column, and each metric into a row', () => {
    expect(table.items).toEqual(['Go', 'Rust', 'Ruby']);
    expect(table.rows.map((r) => r.title)).toEqual(['Cost per run', 'Score (of 34)']);
    expect(table.total).toBe(3);
  });

  it('formats each value exactly as a DataTable column with the same fmt does', () => {
    const cost = resolveColumns([{ col: 'cost', fmt: '$,.2f' }], COLUMNS, ROWS)[0]!;
    expect(table.rows[0]!.cells.map((c) => c.text)).toEqual(ROWS.map((r) => formatCell(r.cost, cost)));
    expect(table.rows[0]!.cells.map((c) => c.text)).toEqual(['$12.50', '$10.00', '$20.00']);
    expect(table.rows[1]!.cells.map((c) => c.text)).toEqual(['30.3', '31.0', '–']);
  });

  it('bolds the best value per metric in the declared direction, and skips nulls', () => {
    expect(table.rows[0]!.cells.map((c) => c.best)).toEqual([false, true, false]);
    expect(table.rows[1]!.cells.map((c) => c.best)).toEqual([false, true, false]);
  });

  it('renders the rank as #n after the value and the sub column as a line under it', () => {
    expect(table.rows[0]!.cells.map((c) => c.rank)).toEqual(['#2', '#1', '#3']);
    expect(table.rows[0]!.cells.map((c) => c.sub)).toEqual(['$10–$15', '$8–$12', null]);
    expect(table.rows[1]!.cells.map((c) => c.rank)).toEqual([null, null, null]);
  });

  it('writes the edge: winner by N% over the runner-up, naming the runner-up when more than two values compete', () => {
    // cost: Rust 10 vs Go 12.5 → 100·2.5/10 = 25%; three values → " vs Go".
    expect(text(table.rows[0]!.edge)).toBe('Rust by 25% vs Go');
    expect(table.rows[0]!.edge).toEqual({ lead: 'Rust', rest: ' by 25% vs Go' });
    // score: Ruby is null, so two values: Rust 31 vs Go 30.25 → 100·0.75/30.25 = 2.48 → 2%.
    expect(text(table.rows[1]!.edge)).toBe('Rust by 2%');
  });

  it('bolds every tied best and names them in the edge', () => {
    const tied = compareTable({ rows: [{ name: 'A', v: 5 }, { name: 'B', v: 5 }, { name: 'C', v: 3 }], columns: [{ name: 'name', type: 'string' }, { name: 'v', type: 'number' }], header: 'name', metrics: [{ col: 'v', better: 'high' }], edge: true });
    expect(tied.rows[0]!.cells.map((c) => c.best)).toEqual([true, true, false]);
    expect(text(tied.rows[0]!.edge)).toBe('tied: A, B');
  });

  it('has no best and an empty edge with fewer than two values, without a direction, or without edge', () => {
    const one = compareTable({ rows: [{ name: 'A', v: 5 }, { name: 'B', v: null }], columns: [{ name: 'name', type: 'string' }, { name: 'v', type: 'number' }], header: 'name', metrics: [{ col: 'v', better: 'high' }], edge: true });
    expect(one.rows[0]!.cells.map((c) => c.best)).toEqual([false, false]);
    expect(one.rows[0]!.edge).toBeNull();
    expect(one.rows[0]!.cells.map((c) => c.text)).toEqual(['5', '–']);
    const undirected = compareTable({ rows: ROWS, columns: COLUMNS, header: 'name', metrics: [{ col: 'cost' }], edge: true });
    expect(undirected.rows[0]!.cells.some((c) => c.best)).toBe(false);
    expect(undirected.rows[0]!.edge).toBeNull();
    expect(compareTable({ rows: ROWS, columns: COLUMNS, header: 'name', metrics: METRICS }).rows[0]!.edge).toBeNull();
  });

  it('omits the percentage when the runner-up or winner is zero (no ratio exists)', () => {
    const zero = compareTable({ rows: [{ name: 'A', v: 0 }, { name: 'B', v: 4 }], columns: [{ name: 'name', type: 'string' }, { name: 'v', type: 'number' }], header: 'name', metrics: [{ col: 'v', better: 'low' }], edge: true });
    expect(text(zero.rows[0]!.edge)).toBe('A');
  });

  it('uses magnitudes for the ratio of negative values', () => {
    const neg = compareTable({ rows: [{ name: 'A', v: -2 }, { name: 'B', v: -4 }], columns: [{ name: 'name', type: 'string' }, { name: 'v', type: 'number' }], header: 'name', metrics: [{ col: 'v', better: 'high' }], edge: true });
    expect(text(neg.rows[0]!.edge)).toBe('A by 100%');
  });

  it('titles a metric by its column when untitled, and heads an item by the first text column when no header is named', () => {
    const plain = compareTable({ rows: ROWS, columns: COLUMNS, metrics: [{ col: 'cost' }] });
    expect(plain.rows[0]!.title).toBe('cost');
    expect(plain.items).toEqual(['Go', 'Rust', 'Ruby']);
    // Without metrics, every column but the header is one.
    expect(compareTable({ rows: ROWS, columns: COLUMNS, header: 'name' }).rows.map((r) => r.col)).toEqual(['cost', 'score', 'cost_rank', 'cost_range']);
  });

  it('caps the items it shows and reports the total, so the reader can say what was left out', () => {
    const many = Array.from({ length: MAX_COMPARE_ITEMS + 3 }, (_, i) => ({ name: `item${i}`, v: i }));
    const capped = compareTable({ rows: many, columns: [{ name: 'name', type: 'string' }, { name: 'v', type: 'number' }], header: 'name', metrics: [{ col: 'v', better: 'high' }], edge: true });
    expect(MAX_COMPARE_ITEMS).toBe(6);
    expect(capped.items).toHaveLength(MAX_COMPARE_ITEMS);
    expect(capped.total).toBe(MAX_COMPARE_ITEMS + 3);
    // Best and edge are judged over the items shown, never over a hidden one.
    expect(text(capped.rows[0]!.edge)).toBe('item5 by 25% vs item4');
  });
});
