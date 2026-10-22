export type CompiledDataControl =
  | {
      kind: "select";
      value: string;
      options: string | readonly unknown[];
      compatibility?: readonly SelectCompatibility[];
    }
  | {
      kind: "table";
      data: string;
      comparison?: true;
      compatibility?: readonly import("./table-presentation-contracts.ts").TablePresentationCompatibility[];
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
  /** Bounded literal CSS length strings were ignored by the frozen renderer and remain ignored. */
  width?: number | string;
  bar?: boolean;
  colorScale?: "sequential" | "diverging";
  hasContent: boolean;
}

/** Frozen behavior retained verbatim; these never grant mutation authority. */
export type SelectCompatibility =
  | "empty-select-pair-options"
  | "ignored-select-run"
  | "ignored-select-value-format"
  | "ignored-select-allow-create";
