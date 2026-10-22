import type { ConversionIssue } from "./contracts.ts";
export interface LegacyImportDescriptor {
  name: string;
  /** Exact source literal; no URL normalization or inferred authority. */
  legacyRef: string;
  datasetLegacyId: string;
}
export interface LegacyImportExtraction {
  /** Empty if any issue exists: partial dependency preparation is not allowed. */
  imports: LegacyImportDescriptor[];
  issues: ConversionIssue[];
}
