/**
 * `<DataTable transpose>`'s authored contract, in ONE place: the publish checks (lib/dataflow/refs for
 * the props, ./row-scope for the columns they name) refuse what the reader kit (lib/story-ui/compare,
 * lib/islands/kit/data ComparisonGrid) cannot draw. Here, below both, so neither imports the other.
 */

/** The most items a comparison shows side by side; a larger table shows the first ones and says so. */
export const MAX_COMPARE_ITEMS = 6;
/** Which way a metric's best value lies. */
export const COMPARE_DIRECTIONS = ['high', 'low'] as const;
