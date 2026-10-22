import type { StreamManifest } from "./stream-contracts.ts";
export interface MigrationArchiveSource {
  namespace: string;
  kind: "base" | "supplemental-relations";
  directory: string;
  manifest: StreamManifest;
  originalManifest: Record<string, unknown>;
  manifestSha256: string;
}
export interface MigrationArchiveInputs {
  baseDirectory: string;
  relationDirectory?: string;
}
export interface MigrationArchiveVerification {
  manifests: number;
  parts: number;
  rows: number;
  bytes: number;
}
