import type { DatasetImportMetadata } from "../datasets/import-contracts.ts";
/** Pins both independently consistent exports; never implies one shared snapshot. */
export interface DatasetMigrationBatch {
  metadata: DatasetImportMetadata;
  sourceQueryRegistrations?: readonly import("./source-query-contracts.ts").MigrationSourceQueryBatch[];
  ownershipDatasetGrants?: readonly import("./ownership-dataset-grants-contracts.ts").MigrationOwnershipDatasetGrantAudit[];
  queryRegistrations?: readonly import("./query-preparation-contracts.ts").MigrationSavedQueryRegistration[];
  profileAssets?: readonly import("./assets/projection-contracts.ts").MigrationProfileAsset[];
  baseManifestSha256: string;
  relationManifestSha256: string;
  relationExportedAt: string;
}
export interface DatasetMetadataDestination {
  /** Runtime accounts, groups, source pages and compiled backends must already exist. */
  import(
    batch: DatasetMigrationBatch,
  ): Promise<{ created: number; unchanged: number }>;
}
