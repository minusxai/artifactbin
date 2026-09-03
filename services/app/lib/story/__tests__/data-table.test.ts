/**
 * The pure half of <DataTable>: the authored column/sort specs, sorting,
 * formatting and conditional-formatting math. No React.
 */
import { describe, expect, it } from 'vitest';
import {
  barFraction, cellTint, formatCell, gridGeometry, parseColumnSpecs, parseSortSpec, parseTableHeight, resolveColumns, sortRows,
} from '@/lib/story/data-table';
import type { DatasetColumn } from '@/lib/story/dataset-shape';

const COLUMNS: DatasetColumn[] = [
  { name: 'region', type: 'string' },
  { name: 'revenue', type: 'number' },
  { name: 'growth', type: 'number' },
  { name: 'day', type: 'date' },
];
const ROWS = [
  { region: 'EU', revenue: 840, growth: -0.2, day: '2024-01-02' },
  { region: 'NA', revenue: 1200, growth: 0.5, day: '2024-01-01' },
  { region: 'APAC', revenue: null, growth: 0, day: null },
];

describe('parseColumnSpecs', () => {
  it('accepts an array of {col, …} and drops malformed entries', () => {
    expect(parseColumnSpecs([{ col: 'revenue', title: 'Revenue', fmt: '$,.0f', align: 'right', bar: true }, { nope: 1 }, 'x', { col: 'growth', colorScale: 'diverging' }]))
      .toEqual([{ col: 'revenue', title: 'Revenue', fmt: '$,.0f', align: 'right', bar: true }, { col: 'growth', colorScale: 'diverging' }]);
  });
  it('is null when absent or not an array', () => {
    expect(parseColumnSpecs(undefined)).toBeNull();
    expect(parseColumnSpecs('revenue')).toBeNull();
  });
  it('drops unknown alignments and scales rather than passing them to CSS', () => {
    expect(parseColumnSpecs([{ col: 'a', align: 'sideways', colorScale: 'rainbow' }])).toEqual([{ col: 'a' }]);
  });
});

describe('parseSortSpec', () => {
  it('reads {col, dir}, defaulting dir to asc', () => {
    expect(parseSortSpec({ col: 'revenue', dir: 'desc' })).toEqual({ col: 'revenue', dir: 'desc' });
    expect(parseSortSpec({ col: 'revenue' })).toEqual({ col: 'revenue', dir: 'asc' });
    expect(parseSortSpec('revenue')).toEqual({ col: 'revenue', dir: 'asc' });
    expect(parseSortSpec(null)).toBeNull();
    expect(parseSortSpec({ col: 'x', dir: 'up' })).toEqual({ col: 'x', dir: 'asc' });
  });
});

describe('resolveColumns', () => {
  it('with no spec, renders every table column with a plain title, numbers right-aligned', () => {
    const cols = resolveColumns(null, COLUMNS, ROWS);
    expect(cols.map((c) => `${c.col}:${c.title}:${c.align}:${c.type}`)).toEqual([
      'region:region:left:string', 'revenue:revenue:right:number', 'growth:growth:right:number', 'day:day:left:date',
    ]);
  });
  it('with a spec, picks and orders, keeps authored titles/alignment, and computes ranges over the rows', () => {
    const cols = resolveColumns([{ col: 'revenue', title: 'Revenue', bar: true }, { col: 'region', align: 'center' }], COLUMNS, ROWS);
    expect(cols.map((c) => c.col)).toEqual(['revenue', 'region']);
    expect(cols[0].title).toBe('Revenue');
    expect(cols[0].range).toEqual([840, 1200]);
    expect(cols[1].align).toBe('center');
    expect(cols[1].range).toBeNull();
  });
  it('a spec naming a column the table lacks stays, typed string with no range', () => {
    const [c] = resolveColumns([{ col: 'ghost' }], COLUMNS, ROWS);
    expect(c).toMatchObject({ col: 'ghost', type: 'string', range: null });
  });
});

describe('sortRows', () => {
  it('sorts numbers numerically with nulls last, both directions, stably', () => {
    expect(sortRows(ROWS, { col: 'revenue', dir: 'asc' }).map((r) => r.region)).toEqual(['EU', 'NA', 'APAC']);
    expect(sortRows(ROWS, { col: 'revenue', dir: 'desc' }).map((r) => r.region)).toEqual(['NA', 'EU', 'APAC']);
  });
  it('sorts strings by locale and dates as text (ISO sorts correctly)', () => {
    expect(sortRows(ROWS, { col: 'region', dir: 'asc' }).map((r) => r.region)).toEqual(['APAC', 'EU', 'NA']);
    expect(sortRows(ROWS, { col: 'day', dir: 'asc' }).map((r) => r.region)).toEqual(['NA', 'EU', 'APAC']);
  });
  it('returns the rows untouched (same reference) with no sort', () => {
    expect(sortRows(ROWS, null)).toBe(ROWS);
  });
  it('does not mutate the input', () => {
    const copy = [...ROWS];
    sortRows(ROWS, { col: 'revenue', dir: 'desc' });
    expect(ROWS).toEqual(copy);
  });
});

describe('formatCell', () => {
  const [revenue, growth, region] = resolveColumns([{ col: 'revenue', fmt: '$,.0f' }, { col: 'growth', fmt: '.1%' }, { col: 'region' }], COLUMNS, ROWS);
  it('applies the d3 format to numbers', () => {
    expect(formatCell(1200, revenue)).toBe('$1,200');
    expect(formatCell(-0.2, growth)).toBe('−20.0%'); // d3 uses a true minus sign
  });
  it('renders non-numbers and nulls as plain text / empty', () => {
    expect(formatCell('EU', region)).toBe('EU');
    expect(formatCell(null, revenue)).toBe('');
    expect(formatCell('n/a', revenue)).toBe('n/a');
  });
  it('an unformatted number gets a locale-aware default with at most two decimals', () => {
    const [plain] = resolveColumns([{ col: 'revenue' }], COLUMNS, ROWS);
    expect(formatCell(1234.567, plain)).toBe('1,234.57');
  });
  it('a bad d3 format spec falls back to plain text rather than throwing', () => {
    const [bad] = resolveColumns([{ col: 'revenue', fmt: 'not-a-format-%%%' }], COLUMNS, ROWS);
    expect(() => formatCell(5, bad)).not.toThrow();
  });
});

describe('barFraction', () => {
  const [bar, plain] = resolveColumns([{ col: 'revenue', bar: true }, { col: 'growth' }], COLUMNS, ROWS);
  it('is the value over the column max, clamped 0..1, only for bar columns and numbers', () => {
    expect(barFraction(1200, bar)).toBe(1);
    expect(barFraction(600, bar)).toBe(0.5);
    expect(barFraction(null, bar)).toBeNull();
    expect(barFraction(600, plain)).toBeNull();
  });
  it('uses magnitude for negative values (a bar of |x| / max|x|)', () => {
    const [g] = resolveColumns([{ col: 'growth', bar: true }], COLUMNS, ROWS);
    expect(barFraction(-0.2, g)).toBeCloseTo(0.4);
    expect(barFraction(0.5, g)).toBe(1);
  });
});

describe('gridGeometry', () => {
  const cols = (specs: Parameters<typeof resolveColumns>[0]) => resolveColumns(specs, COLUMNS, ROWS);

  it('unmeasured, every track is minmax(0, 1fr) with no minimum — the pre-measurement render', () => {
    expect(gridGeometry(cols([{ col: 'region' }, { col: 'revenue' }]), null))
      .toEqual({ template: 'minmax(0, 1fr) minmax(0, 1fr)', minWidth: null });
  });

  it('measured, each track keeps its content width as a floor and the grid a total minimum — a narrow viewport scrolls instead of collapsing the tracks to slivers', () => {
    expect(gridGeometry(cols([{ col: 'region' }, { col: 'revenue' }]), [120.4, 90]))
      .toEqual({ template: 'minmax(121px, 1fr) minmax(90px, 1fr)', minWidth: 211 });
  });

  it('an authored width stays a fixed track and counts toward the minimum', () => {
    expect(gridGeometry(cols([{ col: 'region', width: 200 }, { col: 'revenue' }]), [120, 90]))
      .toEqual({ template: '200px minmax(90px, 1fr)', minWidth: 290 });
  });

  it('a measurement from a different column set is ignored — columns can change after the one-time measure', () => {
    expect(gridGeometry(cols([{ col: 'region' }, { col: 'revenue' }]), [120]))
      .toEqual({ template: 'minmax(0, 1fr) minmax(0, 1fr)', minWidth: null });
  });

  it('a useless measurement (zero / non-finite) degrades that track to minmax(0, 1fr)', () => {
    expect(gridGeometry(cols([{ col: 'region' }, { col: 'revenue' }]), [0, 90]))
      .toEqual({ template: 'minmax(0, 1fr) minmax(90px, 1fr)', minWidth: 90 });
  });
});

describe('cellTint', () => {
  it('sequential: alpha grows with the value from 0 at min to 1 at max, on --chart-1', () => {
    const [c] = resolveColumns([{ col: 'revenue', colorScale: 'sequential' }], COLUMNS, ROWS);
    expect(cellTint(840, c)).toMatch(/--chart-1.*\b0(\.0+)?\)$/);
    expect(cellTint(1200, c)).toMatch(/--chart-1.*\b1\)$/);
    expect(cellTint(null, c)).toBeNull();
  });
  it('diverging: negatives on --chart-2, positives on --chart-1, zero untinted', () => {
    const [c] = resolveColumns([{ col: 'growth', colorScale: 'diverging' }], COLUMNS, ROWS);
    expect(cellTint(-0.2, c)).toContain('--chart-2');
    expect(cellTint(0.5, c)).toContain('--chart-1');
    expect(cellTint(0, c)).toBeNull();
  });
  it('is null without a scale', () => {
    const [c] = resolveColumns([{ col: 'growth' }], COLUMNS, ROWS);
    expect(cellTint(0.5, c)).toBeNull();
  });
});

/**
 * The docs teach `height="420px"`; the prop was typed number and the component emitted
 * `420pxpx`. One pure parser, so the component and the docs agree on what a height is.
 */
describe('parseTableHeight', () => {
  it('accepts a number, a numeric string, or a px string', () => {
    expect(parseTableHeight(420)).toBe(420);
    expect(parseTableHeight('420px')).toBe(420);
    expect(parseTableHeight('250')).toBe(250);
  });
  it('falls back for anything that is not a positive pixel length', () => {
    expect(parseTableHeight(undefined)).toBe(420);
    expect(parseTableHeight('abc')).toBe(420);
    expect(parseTableHeight(0)).toBe(420);
    expect(parseTableHeight(-5)).toBe(420);
    expect(parseTableHeight('50%')).toBe(420);
    expect(parseTableHeight(undefined, 300)).toBe(300);
  });
});
