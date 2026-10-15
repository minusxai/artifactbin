/** Root class recipes evaluated at compile time, before islands load. */
import { cn } from './cn';
import type { Recipe } from '.';
const author = (props: Record<string, unknown>) => typeof props.className === 'string' ? props.className : undefined;

/**
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
  row: 'border-b border-border/50 transition-colors hover:bg-muted/30',
  cell: 'relative min-w-0 overflow-hidden whitespace-nowrap px-3 py-1.5 align-middle',
  footer: 'flex items-center justify-between gap-3 border-t border-border px-3 py-1.5 text-xs text-muted-foreground',
} as const;

export const RECIPES: Record<string, Recipe> = {
  Cell: props => cn(author(props)),
  Select: props => cn('mx-control relative inline-flex flex-col gap-1.5 align-top', author(props)),
  DataTable: props => cn(TABLE_CLASSES.box, author(props)),
  Chart: props => cn('flex h-full w-full flex-col', author(props)),
};
