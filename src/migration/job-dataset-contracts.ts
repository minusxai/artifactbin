import type { BoundValueColumnProof } from "./conversion/compiled/bound-value-contracts.ts";
import type { CompiledDatasetMutation } from "./conversion/compiled/dataset-mutations-contracts.ts";
import type { DatasetImportMetadata } from "../datasets/import-contracts.ts";
import type { DatasetBrowserBinding } from "./datasets/planner-contracts.ts";
import type { MigrationBackendReceipt } from "./backend-preparation-contracts.ts";
import type { MigrationDatasetImportScan } from "./dataset-scan-contracts.ts";
export interface MigrationJobDatasets {
  metadata: DatasetImportMetadata;
  membersBindings: ReadonlyMap<
    string,
    { backendNamespace: string; backendHref: string }
  >;
  boundValueColumns: ReadonlyMap<string, readonly BoundValueColumnProof[]>;
  scan: MigrationDatasetImportScan;
  mutations: ReadonlyMap<string, readonly CompiledDatasetMutation[]>;
  bindings: ReadonlyMap<string, readonly DatasetBrowserBinding[]>;
  backends: ReadonlyMap<string, readonly MigrationBackendReceipt[]>;
  issues: ReadonlyMap<string, readonly string[]>;
  allocation: { sourceNamespace: string; inventorySha256: string };
  omittedUnmappedTokenPrincipals: number;
  unavailableProfileImages: number;
}
export const migrationDatasetVersionKey = (
  legacyId: string,
  version: number,
): string => JSON.stringify([legacyId, version]);
