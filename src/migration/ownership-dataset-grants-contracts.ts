import type { DatasetImportMetadata } from "../datasets/import-contracts.ts";
import type { LegacyArtifact } from "./contracts.ts";
export interface MigrationOwnershipDatasetWriteGrant {
  legacyId: string;
  sourceSha256: string;
  originalResourceSha256: string;
  operations: readonly { pageLegacyId: string; operationName: string }[];
}
export interface MigrationOwnershipDatasetGrantAudit {
  sourceNamespace: string;
  scopeSha256: string;
  datasetLegacyId: string;
  sourceSha256: string;
  originalSource: LegacyArtifact;
  originalResource: DatasetImportMetadata["resources"][number];
  assignedEditor: string;
  operations: readonly { pageLegacyId: string; operationName: string }[];
}
