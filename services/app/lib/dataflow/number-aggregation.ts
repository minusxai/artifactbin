/** Shared by publishing, the renderer and the Cell inspector. In lib/dataflow because the reference checks (./refs) validate `agg` against it. */
export const NUMBER_AGGS = ['first', 'last', 'sum', 'avg', 'median', 'min', 'max', 'count'] as const;
export type NumberAgg = typeof NUMBER_AGGS[number];

/** One figure from a column: `count` counts rows, the rest read the column's numeric cells (NaN when there are none). */
export function aggregateNumber(rows: ReadonlyArray<Record<string, unknown>>, column: string, agg: NumberAgg): number {
  if (agg === 'count') return rows.length;
  const nums = rows.map((r) => Number(r[column])).filter((n) => Number.isFinite(n));
  if (agg === 'sum') return nums.reduce((a, b) => a + b, 0);
  if (!nums.length) return NaN;
  switch (agg) {
    case 'last': return nums[nums.length - 1]!;
    case 'avg': return nums.reduce((a, b) => a + b, 0) / nums.length;
    case 'median': {
      const sorted = [...nums].sort((a, b) => a - b), mid = sorted.length >> 1;
      return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
    }
    case 'min': return Math.min(...nums);
    case 'max': return Math.max(...nums);
    case 'first': return nums[0]!;
  }
}

/** What a `<Cell>` shows: a number to format, a text cell as written, or nothing. */
export type CellValue = { kind: 'number'; value: number } | { kind: 'text'; value: string } | null;

/** Text a cell shows as written: a string with content that is not a number (`"42"` stays numeric, `""` reads 0). */
const isText = (value: unknown): value is string => typeof value === 'string' && value.trim() !== '' && !Number.isFinite(Number(value));

/**
 * ONE VALUE of a column, for `<Cell>` (renderer and inspector alike). `first`/`last` read the first/last cell that
 * holds a number or text, and text is shown as written; over a column with no text that is exactly
 * {@link aggregateNumber}. Every other aggregate is numeric: `count` counts rows, the rest read the numeric cells.
 */
export function cellValue(rows: ReadonlyArray<Record<string, unknown>>, column: string, agg: NumberAgg): CellValue {
  if (agg === 'first' || agg === 'last') {
    for (let i = 0; i < rows.length; i++) {
      const value = rows[agg === 'first' ? i : rows.length - 1 - i]?.[column];
      if (isText(value)) return { kind: 'text', value };
      const n = Number(value);
      if (Number.isFinite(n)) return { kind: 'number', value: n };
    }
    return null;
  }
  const value = aggregateNumber(rows, column, agg);
  return Number.isFinite(value) ? { kind: 'number', value } : null;
}

/** The aggregates that read numbers: over a column the query types as text they show nothing. */
export const NUMERIC_AGGS: ReadonlySet<NumberAgg> = new Set(['sum', 'avg', 'median', 'min', 'max']);
