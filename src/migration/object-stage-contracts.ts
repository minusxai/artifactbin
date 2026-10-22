export interface MigrationObjectStageEntry {
  store: "media" | "datasets";
  sha256: string;
  bytes: number;
}
/** Private operator manifest: contains no source IDs, credentials or legacy object keys. */
export interface MigrationObjectStagePlan {
  schemaVersion: 1;
  entries: readonly MigrationObjectStageEntry[];
  files: number;
  bytes: number;
  sha256: string;
}
export interface MigrationObjectStageReceipt {
  planSha256: string;
  files: number;
  bytes: number;
  created: number;
  reused: number;
}
