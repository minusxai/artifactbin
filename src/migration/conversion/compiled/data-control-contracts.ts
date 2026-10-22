export type CompiledDataControl =
  | { kind: "select"; value: string; options: string | readonly unknown[] }
  | {
      kind: "table";
      data: string;
      comparison?: true;
      columns?: readonly CompiledDataColumn[];
    };
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
/** A source-owned read-only Column; its descendants are separately admitted row display markup. */
export interface CompiledDataColumn {
  id?: string;
  col: string;
  title?: string;
  fmt?: string;
  align?: "left" | "right" | "center";
  width?: number;
  bar?: boolean;
  colorScale?: "sequential" | "diverging";
  hasContent: boolean;
}
