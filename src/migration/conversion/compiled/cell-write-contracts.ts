import type { DatasetColumn } from "../../../datasets/contracts.ts";
/** Offline source context, never permission or an arbitrary dataset target. */
export interface LegacyCellWriteSite {
  mutationName: string;
  dataName: string;
  column: string;
  rowKey: string;
  tag: "input" | "textarea" | "Select";
  optionsQuery?: string;
  /** Exact native control wire protocol, used only for prototype computed fields. */
  wireType?: DatasetColumn["type"];
}
export interface TypedLegacyCellWriteSite extends LegacyCellWriteSite {
  type: DatasetColumn["type"];
}
export type ReadLegacyCellWriteSites = (
  source: string,
  visit?: (node: unknown, site: LegacyCellWriteSite) => void,
  sourceAdmission?:import("./local-contracts.ts").CompiledSourceAdmission,
) => readonly LegacyCellWriteSite[];
export interface LegacyCellWriteColumn { name: string; type?: DatasetColumn["type"] | null; }
export type TypeLegacyCellWriteSites = (
  sites: readonly LegacyCellWriteSite[],
  columns: Readonly<Record<string, readonly LegacyCellWriteColumn[]>>,
  sourceAdmission?:import("./local-contracts.ts").CompiledSourceAdmission,
) => readonly TypedLegacyCellWriteSite[];
