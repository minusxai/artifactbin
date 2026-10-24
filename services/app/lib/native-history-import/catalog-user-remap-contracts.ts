/** Exact catalog position from an independently verified canonical dataset row. */
export interface NativeCatalogUserTable {
  sourceId: string;
  version: number;
  schema: string;
  table: string;
  sourceMetaSha256: string;
  sourceObjectKey: string;
  userColumns: readonly string[];
}
/** Derived immutable object proof. Original object bytes/keys remain archived unchanged. */
export interface NativeCatalogUserRemap extends NativeCatalogUserTable {
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
export interface NativeCatalogUserDerivation {
  receipt: NativeCatalogUserRemap;
  bytes: Buffer;
}
