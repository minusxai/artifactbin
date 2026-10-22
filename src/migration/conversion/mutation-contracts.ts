import type { DatasetColumn } from "../../datasets/contracts.ts";
import type {
  DatasetMutationParameterType,
  DatasetMutationRowParameters,
  DatasetMutationValueParameter,
} from "../../datasets/mutation/parameter-contracts.ts";
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
  paramTypes: Record<string, DatasetMutationParameterType>;
  /** Fixed SQL row bindings; full server paramTypes includes these generated parameter names. */
  rowParams?: DatasetMutationRowParameters;
  /** Fixed scalar supplied only by the validated editing cell. */
  valueParam?: DatasetMutationValueParameter;
  /** Read-only accepted joins of the current executing page. */
  readsMembers?: true;
  expectedAffected?: number;
  /** Viewer-local fields reset only after confirmed commit and only if still unchanged. */
  reset?: readonly string[];
  conflictMode: "refuse";
}
export interface LegacyMutationExtraction {
  mutations: LegacyMutationDescriptor[];
  issues: ConversionIssue[];
}
