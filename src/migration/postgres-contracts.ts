import type {
  MigrationManifest,
  MigrationMaps,
  PlannedPage,
  SqlReader,
} from "./contracts.ts";
export interface DestinationOptions {
  ownershipOverride?: import("./ownership-override-contracts.ts").MigrationOwnershipOverride;
  schema: string;
  /** Trusted operator role for runtime schema DDL only; archive/data work retains the connecting role. */
  runtimeOwnerRole?: string;
  origin: string;
  /** Caller must verify the destination instance is disposable/isolated before enabling writes. */
  isolated: boolean;
  /** Set only after destination policy enforces owner-only manage for editors. */
  editorManageRestricted: boolean;
}
export interface DestinationPreparation {
  maps: MigrationMaps;
  manifest: MigrationManifest;
}
export interface PreparedPublication {
  page: PlannedPage;
  path: string;
  access: Record<string, unknown>;
}
export interface TransactionalSql extends SqlReader {}
