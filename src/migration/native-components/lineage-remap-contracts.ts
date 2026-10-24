import type { NativeV3IdentityPlan } from "./v3-identity-contracts.ts";
import type { NativeLineageExtensionResult } from "./lineage-extension-contracts.ts";
export interface NativeLineageUserTable {
  sourceId: string;
  version: number;
  schema: string;
  table: string;
  sourceMetaSha256: string;
  sourceObjectKey: string;
  userColumns: readonly string[];
}
export interface NativeLineageUserRemap extends NativeLineageUserTable {
  sourceSha256: string;
  sourceBytes: number;
  identityPlanSha256: string;
  usersSha256: string;
  targetKey: string;
  targetSha256: string;
  targetBytes: number;
  changedCells: number;
  receiptSha256: string;
}
export interface NativeLineageRemapInput {
  parentPlan: NativeV3IdentityPlan;
  extension: NativeLineageExtensionResult;
  receipts: readonly {
    receipt: NativeLineageUserRemap;
    sourcePath: string;
    targetPath: string;
  }[];
}
export interface NativeLineageRemapHost {
  read(path: string): Promise<Uint8Array>;
  tables(
    meta: Record<string, unknown>,
    sourceId: string,
    version: number,
  ): readonly NativeLineageUserTable[];
  derive(
    table: NativeLineageUserTable,
    bytes: Uint8Array,
    users: Readonly<Record<string, string>>,
    identityPlanSha256: string,
  ): { receipt: NativeLineageUserRemap; bytes: Uint8Array } | null;
}
export interface NativeLineageRemapResult {
  parentIdentityPlanSha256: string;
  identityPlanSha256: string;
  extensionSha256: string;
  usersSha256: string;
  receipts: readonly {
    receipt: NativeLineageUserRemap;
    sourcePath: string;
    targetPath: string;
  }[];
  sha256: string;
}
