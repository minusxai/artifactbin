/** Trusted operator input for a later, additive normal migration job. No browser authority. */
export interface StandaloneDatasetJobAdmission {
  kind: "standalone-dataset-pages-v1";
  sourceNamespace: string;
  heads: readonly {
    legacyId: string;
    version: number;
    artifactSha256: string;
    /** Required to introduce an original resource not present in the completed base. */
    resourceSha256?: string;
  }[];
  /** Entire frozen source-ID and base backend-ID inventory, including deleted/blocked source artifacts. */
  reservedFileIds: readonly string[];
  base: AdditiveDatasetBaseApproval;
  /** Exact reviewed canonical declarations and notebook-expanded server registrations; never browser metadata. */
  external?: readonly {
    legacyId: string;
    version: number;
    artifactSha256: string;
    declarations: string;
    queries: readonly import("../../datasets/source-query/contracts.ts").MigrationSourceQueryRegistration[];
  }[];
}
export interface AdditiveDatasetBaseApproval {
  /** A completed normal read-only verification report, frozen and reviewed with this exact inventory. */
  verificationReport: { path: string; sha256: string };
  inventory: {
    sourceNamespace: string;
    datasetFingerprint: string;
    /** Exact current resource descriptors from the completed base batch, including reviewed ownership projections. */
    resources: import("../../datasets/import-contracts.ts").DatasetImportMetadata["resources"];
    baseManifestSha256: string;
    relationManifestSha256: string;
    relationExportedAt: string;
    compilerIdentity: string;
    reservedFileIds: readonly string[];
    protectedRows: readonly {
      table:
        | "dataset_mutation_operations"
        | "dataset_member_bindings"
        | "dataset_viewer_bindings"
        | "dataset_source_queries";
      key: readonly unknown[];
      sha256: string;
    }[];
    backendRows: readonly {
      table:
        | "af_backend_files"
        | "af_backend_versions"
        | "af_page_backends"
        | "af_backend_pages";
      key: readonly unknown[];
      sha256: string;
    }[];
    pageReceipts: readonly { key: string; digest: string; pageId: string }[];
    sources: readonly {
      pageId: string;
      head: string;
      sha256: string;
      recordSha256: string;
    }[];
    /** Every existing dataset runtime row, including current ACL and catalog facts. */
    tables: readonly {
      table: string;
      rows: readonly { key: readonly unknown[]; sha256: string }[];
    }[];
  };
}
/** All fields are pinned provenance, never a rewrite of the original format. */
export interface StandaloneDatasetPageProvenance {
  sourceFormat: "dataset";
  legacyId: string;
  pageId: string;
  pageVersion: number;
  editId: string;
  artifactSha256: string;
}
