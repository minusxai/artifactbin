import { format as d3format } from "d3-format";
import { NATIVE_COMPONENT_TARGET } from "./component-map.ts";
const digest = (value: unknown): value is string =>
  typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
/** Exact retained Cell/Number formatting API. Locale is recorded from the source
 * rendering runtime, never selected by the converter. */
export const NATIVE_CELL_SOURCE_PROOF = Object.freeze({
  targetRevision: NATIVE_COMPONENT_TARGET,
  d3FormatVersion: "3.1.2",
  numberFormatSha256:
    "1b4b1b8298ff1acdf935aff2e39783f62e64d7d0812ec5187ef6d4b5a2e15fe3",
  numberAggregationSha256:
    "11d02d37632e7110efe107beebbb6fc4c81386142cc19e978fa35f80ae191b02",
  kitDataSha256:
    "d31e77797d697b50e01ef146248966f4f632ca6841ca7d96251a53e315c56649",
});
export interface NativeNumberLocaleReceipt {
  locale: string;
  numberingSystem: string;
  sourceRuntimeSha256: string;
}
export interface NativeCellFormatInput {
  rows: readonly Readonly<Record<string, unknown>>[] | null;
  col?: string;
  agg?: "first" | "last" | "sum" | "avg" | "median" | "min" | "max" | "count";
  format?: string;
  prefix?: string;
  suffix?: string;
  localeReceipt?: NativeNumberLocaleReceipt;
}
export type NativeCellFormatOutput =
  | { status: "formatted"; text: string }
  | { status: "requires-locale"; detail: string };
/** Source proof: retained islands/kit/data.tsx Cell, dataflow/number-aggregation.ts,
 * dataflow/number-format.ts at NATIVE_COMPONENT_TARGET. d3-format pinned3.1.2.
 * Alias Number consumes table data, not a numeric value/unit shorthand. */
export function formatNativeCell(
  input: NativeCellFormatInput,
): NativeCellFormatOutput {
  if (input.rows === null) return { status: "formatted", text: "—" };
  const rows = input.rows,
    col = input.col ?? Object.keys(rows[0] ?? {})[0] ?? "",
    agg = input.agg ?? "first";
  let value: number | string | null = null;
  if (agg === "first" || agg === "last") {
    for (let i = 0; i < rows.length; i++) {
      const raw = rows[agg === "first" ? i : rows.length - 1 - i]?.[col];
      if (
        typeof raw === "string" &&
        raw.trim() !== "" &&
        !Number.isFinite(Number(raw))
      ) {
        value = raw;
        break;
      }
      const n = Number(raw);
      if (Number.isFinite(n)) {
        value = n;
        break;
      }
    }
  } else {
    const nums = rows.map((r) => Number(r[col])).filter(Number.isFinite);
    if (agg === "count") value = rows.length;
    else if (agg === "sum") value = nums.reduce((a, b) => a + b, 0);
    else if (nums.length) {
      if (agg === "avg") value = nums.reduce((a, b) => a + b, 0) / nums.length;
      else if (agg === "median") {
        const sorted = [...nums].sort((a, b) => a - b),
          mid = sorted.length >> 1;
        value =
          sorted.length % 2
            ? sorted[mid]!
            : (sorted[mid - 1]! + sorted[mid]!) / 2;
      } else if (agg === "min") value = Math.min(...nums);
      else if (agg === "max") value = Math.max(...nums);
    }
  }
  let shown =
    value === null || (typeof value === "number" && !Number.isFinite(value))
      ? "—"
      : typeof value === "string"
        ? value
        : undefined;
  if (shown === undefined) {
    let compiled: ((n: number) => string) | undefined;
    if (input.format)
      try {
        compiled = d3format(input.format);
      } catch {
        /* original fallback */
      }
    if (compiled)
      try {
        shown = compiled(value as number);
      } catch {
        /* original fallback */
      }
    if (shown === undefined) {
      const receipt = input.localeReceipt;
      if (!receipt || !digest(receipt.sourceRuntimeSha256))
        return {
          status: "requires-locale",
          detail:
            "Default/invalid d3 format uses source runtime Intl locale and numbering system",
        };
      if (!receipt.locale || !receipt.numberingSystem)
        return {
          status: "requires-locale",
          detail: "Source Intl locale receipt is incomplete",
        };
      try {
        shown = new Intl.NumberFormat(receipt.locale, {
          numberingSystem: receipt.numberingSystem,
          maximumFractionDigits: 2,
        }).format(value as number);
      } catch {
        return {
          status: "requires-locale",
          detail: "Source Intl locale receipt is invalid in this runtime",
        };
      }
    }
  }
  return {
    status: "formatted",
    text: `${input.prefix ?? ""}${shown}${input.suffix ?? ""}`,
  };
}
