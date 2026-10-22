export type CompiledDataControl =
  | { kind: "select"; value: string; options: string | readonly unknown[] }
  | { kind: "table"; data: string };
export interface CompiledDisplayTable {
  columns: readonly { name: string; type: string }[];
  rows: Record<string, unknown>[];
  truncated?: boolean;
  totalRows?: number;
}
export interface CompiledDataControlLimits {
  maxRows: number;
  maxBytes: number;
  pageSize: number;
}
