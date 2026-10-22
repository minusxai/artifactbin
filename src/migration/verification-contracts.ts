import type { SqlReader, PlannedPage, MigrationMaps } from "./contracts.ts";
export interface MigrationRuntimeVerificationInput {
  pages: AsyncIterable<PlannedPage>;
  maps: MigrationMaps;
  origin: string;
}
export interface MigrationRuntimeVerification {
  pages: number;
  sources: number;
  comments: number;
  snapshots: number;
  assets: number;
  backendLinks: number;
  normalizedBytes: number;
}
export type VerifyMigrationRuntime = (
  db: SqlReader,
  schema: string,
  input: MigrationRuntimeVerificationInput,
) => Promise<MigrationRuntimeVerification>;
