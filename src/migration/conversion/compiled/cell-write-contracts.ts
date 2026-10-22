import type { DatasetColumn } from "../../../datasets/contracts.ts";
/** Offline source context, never permission or an arbitrary dataset target. */
export interface LegacyCellWriteSite {
  mutationName: string;
  dataName: string;
  column: string;
  rowKey: string;
  tag: "input" | "textarea" | "Select";
  optionsQuery?: string;
}
export interface TypedLegacyCellWriteSite extends LegacyCellWriteSite {
  type: DatasetColumn["type"];
}
export type ReadLegacyCellWriteSites = (
  source: string,
  visit?: (node: unknown, site: LegacyCellWriteSite) => void,
) => readonly LegacyCellWriteSite[];
export type TypeLegacyCellWriteSites = (
  sites: readonly LegacyCellWriteSite[],
  columns: Readonly<Record<string, readonly DatasetColumn[]>>,
) => readonly TypedLegacyCellWriteSite[];
