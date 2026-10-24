/** Browser formatter is bundled from the same reviewed pure Cell implementation as offline lowering. */
export interface NativeCellAdapter {
  specifier: string;
  sha256: string;
}
export interface NativeCellOptions {
  col?: string;
  agg?: "first" | "last" | "sum" | "avg" | "median" | "min" | "max" | "count";
  format?: string;
  prefix?: string;
  suffix?: string;
}
