/**
 * Class strings only, no imports: the data kit's live islands read these, and the compile-time recipes
 * (../recipes/data) do too — a module that pulled in the recipes' class merger would put it in the reader.
 * Under kit/data/ so the recipe-class reach counts these as the data family's (scripts/generate-story-ui-classes).
 *
 * A DataTable's elements, one class each: the live grid (kit/data DataGrid) and its transposed comparison
 * (kit/data ComparisonGrid) both draw from these, so a comparison table reads as a DataTable in every design
 * system — same box, type, padding, rules and header. A grid adds only what it alone does (sorting, stickiness).
 */
export const TABLE_CLASSES = {
  box: 'flex h-full w-full flex-col overflow-hidden rounded-md border border-border bg-card text-sm',
  scroll: 'relative min-h-0 w-full flex-1 overflow-auto',
  table: 'w-full border-collapse text-sm',
  head: 'bg-card text-left text-muted-foreground',
  headRow: 'border-b border-border',
  headCell: 'min-w-0 overflow-hidden text-ellipsis whitespace-nowrap px-3 py-2 font-bold',
  /** `headCell` plus the grid's sort affordance, in the order the served reader has always written (p3-static parity). */
  sortHeadCell: 'min-w-0 cursor-pointer select-none overflow-hidden text-ellipsis whitespace-nowrap px-3 py-2 font-bold',
  row: 'border-b border-border/50 transition-colors hover:bg-muted/30',
  cell: 'relative min-w-0 overflow-hidden whitespace-nowrap px-3 py-1.5 align-middle',
  footer: 'flex items-center justify-between gap-3 border-t border-border px-3 py-1.5 text-xs text-muted-foreground',
} as const;
