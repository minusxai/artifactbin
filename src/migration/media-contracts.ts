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
}
