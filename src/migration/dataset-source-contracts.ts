import type { LegacyRow } from "./contracts.ts";
import type { DatasetObjectReceipt } from "./datasets/planner-contracts.ts";
export interface MigrationDatasetSource {
  receipts: readonly DatasetObjectReceipt[];
  relations: readonly LegacyRow[];
  provenance: {
    baseManifestSha256: string;
    relationManifestSha256: string;
    relationExportedAt: string;
  };
  verifiedObjects: number;
  verifiedBytes: number;
}
