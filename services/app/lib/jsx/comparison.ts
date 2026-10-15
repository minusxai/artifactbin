/**
 * `<DataTable transpose>`'s authored contract, in ONE place: the publish checks (lib/dataflow/refs for
 * the props, ./row-scope for the columns they name) refuse what the reader kit (lib/story-ui/compare,
 * lib/islands/kit/data ComparisonGrid) cannot draw. Here, below both, so neither imports the other.
 */

/** The most items a comparison shows side by side; a larger table shows the first ones and says so. */
export const MAX_COMPARE_ITEMS = 6;
/** Which way a metric's best value lies. */
export const COMPARE_DIRECTIONS = ['high', 'low'] as const;
/** The props only a comparison reads: on a plain DataTable they are a mistake. */
export const COMPARE_PROPS = ['header', 'metrics', 'edge'] as const;
/** The props only the sortable grid reads, and what a comparison does instead. */
export const GRID_ONLY_PROPS: Readonly<Record<string, string>> = {
  columns: 'list the measures in metrics={[{"col":…,"title":…,"fmt":…,"better":"high"|"low"}]}',
  sort: 'a comparison is not sortable — order the items in the query (order by)',
  rowKey: 'a comparison has no row identity or editing — drop rowKey=',
  run: 'a comparison runs nothing — drop run=',
};
