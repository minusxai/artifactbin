/** Shared by publishing, the renderer and the number inspector. In lib/dataflow because the reference checks (./refs) validate `agg` against it. */
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
