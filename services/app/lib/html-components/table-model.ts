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
  const end = Math.min(
    count,
    start + Math.ceil(height / rowHeight) + overscan * 2,
  );
  return {
    start,
    end,
    before: start * rowHeight,
    after: (count - end) * rowHeight,
  };
}
