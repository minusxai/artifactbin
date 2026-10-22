export interface MigratedAsset {
  artifactId: string;
  version: number;
  variant: "original" | "small";
  sha256: string;
  contentType: string;
  filename: string | null;
  bytes: number;
  width?: number;
  /** Private local verified bytes, never included in page source. */ path: string;
}
export interface MigrationMediaIndex {
  assets: MigratedAsset[];
  verifiedObjects: number;
}
export interface MigrationMediaOptions {
  origin: string;
  assets: readonly MigratedAsset[];
  resourceMap?: Readonly<Record<string, string>>;
  /** Verified default-version aliases, scoped to exact source literals before conversion. */
  resourceMapAliases?: Readonly<Record<string, string>>;
}
/** Exact immutable source head revisions. Missing heads never imply the largest available asset version. */
export type MigrationMediaHeads = Readonly<Record<string, number>>;
export interface LegacyRawMediaAddress {
  readonly artifactId: string;
  readonly version?: number;
  readonly width?: number;
}
export interface LegacyRawMediaRewrite {
  readonly source: string;
  readonly rewritten: number;
}
