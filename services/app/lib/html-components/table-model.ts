/** Internal helper for af-data-table; not a public entry point. */
import type { DatasetColumn, Row } from "@/lib/dataflow";
import { keyedRowsError } from "@/lib/story-ui/row-key";
import type { SortSpec } from "@/lib/story-ui/data-table";
export interface TableData {
  rows: Row[];
  columns: DatasetColumn[];
  totalRows?: number;
  truncated?: boolean;
}
export interface TableRequest {
  offset: number;
  limit: number;
  sort: SortSpec | null;
  signal: AbortSignal;
}
/** Caller-owned transport: no credentials or account fetching belongs to the component. */
export interface TableSource {
  read(request: TableRequest): Promise<TableData>;
}
interface TableCellContext {
  row: Row;
  key: unknown;
  column: string;
  index: number;
  identity: string;
  edit(value: unknown): void;
}
export type TableCellRenderer = (
  context: TableCellContext,
  existing: HTMLElement,
) => Node | string | void;
export interface TableTemplate {
  col: string;
  template: HTMLTemplateElement;
}
export const TABLE_ROW_HEIGHT = 33;
export interface MeasuredTableWindow {
  start: number;
  end: number;
  total: number;
  offsets: number[];
}
/** Variable-height virtual window, using the source table's 33px estimate until
 * a rendered row has been measured. Offsets are absolute within the full body. */
export function measuredTableWindow(
  heights: readonly number[],
  offset: number,
  viewportHeight: number,
  overscan = 12,
  estimate = TABLE_ROW_HEIGHT,
): MeasuredTableWindow {
  const safeHeights = heights.map((height) =>
    Number.isFinite(height) && height > 0 ? height : estimate,
  );
  const offsets = new Array<number>(safeHeights.length);
  let total = 0;
  for (let i = 0; i < safeHeights.length; i++) {
    offsets[i] = total;
    total += safeHeights[i]!;
  }
  const top = Math.max(0, Number.isFinite(offset) ? offset : 0);
  const bottom = top + Math.max(0, Number.isFinite(viewportHeight) ? viewportHeight : 0);
  let first = safeHeights.findIndex((height, index) => offsets[index]! + height > top);
  if (first < 0) first = Math.max(0, safeHeights.length - 1);
  let last = first;
  while (last < safeHeights.length && offsets[last]! < bottom) last++;
  const start = Math.max(0, first - overscan);
  const end = Math.min(safeHeights.length, last + overscan);
  return { start, end, total, offsets };
}
export function nextTableSort(
  sort: SortSpec | null,
  col: string,
): SortSpec | null {
  return !sort || sort.col !== col
    ? { col, dir: "asc" }
    : sort.dir === "asc"
      ? { col, dir: "desc" }
      : null;
}
export function tableRowIdentities(rows: Row[], rowKey?: string): string[] {
  if (rowKey) {
    const error = keyedRowsError(rows, rowKey);
    if (error) throw new Error(error);
  }
  return rows.map((row, index) =>
    JSON.stringify(
      rowKey ? [typeof row[rowKey], row[rowKey]] : ["index", index],
    ),
  );
}
/** Latest request wins even when the adapter ignores abort. */
export class TableLoader {
  private generation = 0;
  private controller?: AbortController;
  cancel(): void {
    ++this.generation;
    this.controller?.abort();
  }
  async read(
    source: TableSource,
    request: Omit<TableRequest, "signal">,
  ): Promise<TableData | undefined> {
    this.cancel();
    const generation = this.generation;
    const controller = (this.controller = new AbortController());
    try {
      const result = await source.read({
        ...request,
        signal: controller.signal,
      });
      return generation === this.generation ? result : undefined;
    } catch (error) {
      if (generation === this.generation) throw error;
      return undefined;
    }
  }
}
export function tableWindow(
  count: number,
  offset: number,
  height: number,
  rowHeight = TABLE_ROW_HEIGHT,
  overscan = 12,
): { start: number; end: number; before: number; after: number } {
  const start = Math.min(
    Math.max(0, Math.floor(offset / rowHeight) - overscan),
    Math.max(0, count - Math.ceil(height / rowHeight)),
  );
  // Match the served table's virtualizer: its range is the visible interval
  // plus `overscan` on either side. At the top of the list there is no leading
  // range to fill, so only one overscan buffer belongs after the viewport.
  const end = Math.min(
    count,
    Math.max(start, Math.ceil((offset + height) / rowHeight) + overscan),
  );
  return {
    start,
    end,
    before: start * rowHeight,
    after: (count - end) * rowHeight,
  };
}
