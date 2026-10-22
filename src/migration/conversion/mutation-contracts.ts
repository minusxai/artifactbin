import type { DatasetColumn } from "../../datasets/contracts.ts";
import type { ConversionIssue } from "./contracts.ts";
/** Catalogs are trusted migration inventory, never declarations supplied by page JavaScript. */
export interface LegacyMutationImportCatalog {
  name: string;
  datasetLegacyId: string;
  tables: readonly {
    schema: string;
    name: string;
    columns: readonly DatasetColumn[];
  }[];
}
/** Publication-only SQL; browser requests contain only name, requestId and scalar parameters. */
export interface LegacyMutationDescriptor {
  name: string;
  bindingName: string;
  datasetLegacyId: string;
  target: { schema: string; table: string };
  /** Exact Import namespace used by SQLite, distinct from the canonical catalog target. */
  sqlSchema: string;
  sql: string;
  paramTypes: Record<string, DatasetColumn["type"]>;
  expectedAffected?: number;
  conflictMode: "refuse";
}
export interface LegacyMutationExtraction {
  mutations: LegacyMutationDescriptor[];
  issues: ConversionIssue[];
}
