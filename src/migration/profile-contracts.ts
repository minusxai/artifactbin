import type { DatasetImportMetadata } from "../datasets/import-contracts.ts";
export interface MigrationProfileProjection {
  profiles: NonNullable<DatasetImportMetadata["profiles"]>;
  /** Original avatar exists but has no verified object projection yet. Never claim it was copied. */
  unavailableAvatarImages: number;
}
