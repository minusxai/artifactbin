import type { DatasetColumn } from "../../datasets/contracts.ts";
import type { DatasetImportMetadata } from "../../datasets/import-contracts.ts";
import type { MigrationManifest, MigrationMaps } from "../contracts.ts";
/** Successful independent object export receipt, never a remotely supplied path. */
export interface DatasetObjectReceipt {
  objectKey: string;
  status: "copied";
  sha256: string;
  bytes: number;
}
/** Resolved by the importer after page/backend ID allocation and backend compilation. */
export interface DatasetImportBindingInput {
  pageLegacyId: string;
  pageVersion: number;
  pageId: string;
  backendId: string;
  backendVersion: string;
  backendNamespace: string;
  name: string;
  mode?: "live" | "pinned";
  standaloneDataset?: import("../dataset-pages/admission-contracts.ts").StandaloneDatasetPageProvenance;
  legacyRef: string;
  datasetLegacyId: string;
  datasetVersion: number;
}
/** Metadata-only contract supplied to conversion; no policy, rows, object keys or credentials. */
export interface DatasetBrowserBinding {
  name: string;
  mode: "live" | "pinned";
  legacyRef: string;
  backendNamespace: string;
  backendHref: string;
  version: number;
  tables: readonly {
    schema: string;
    table: string;
    columns: readonly DatasetColumn[];
  }[];
}
export interface DatasetMetadataPlan {
  metadata: DatasetImportMetadata;
  diagnostics: { unmappedTokenPrincipals: number };
  provenance: {
    baseExportedAt: string;
    relationExportedAt: string;
    relationManifestSha256: string;
  };
  browserBindings: readonly {
    pageLegacyId: string;
    pageVersion: number;
    binding: DatasetBrowserBinding;
  }[];
}
export interface DatasetMetadataInput {
  relationProvenance: { exportedAt: string; manifestSha256: string };
  manifest: MigrationManifest;
  maps: MigrationMaps;
  receipts: readonly DatasetObjectReceipt[];
  bindings: readonly DatasetImportBindingInput[];
  /** Canonically registered current-page membership backends without a dataset Import. */
  programPages?: readonly {
    pageLegacyId: string;
    pageId: string;
    pageVersion: number;
  }[];
  sourceQueryPages?: readonly {
    standaloneExternalDataset?: import("../dataset-pages/admission-contracts.ts").StandaloneDatasetPageProvenance;
    pageLegacyId: string;
    pageId: string;
    pageVersion: number;
  }[];
  memberPages?: readonly {
    pageLegacyId: string;
    pageId: string;
    pageVersion: number;
  }[];
}
