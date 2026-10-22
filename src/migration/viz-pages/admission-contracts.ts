import type { AdditiveDatasetBaseApproval } from "../dataset-pages/admission-contracts.ts";
import type { DatasetMigrationBatch } from "../dataset-destination-contracts.ts";
/** Operator-owned, exact immutable scope. Never derived from a browser request. */
export interface StandaloneVizJobAdmission {
  kind: "standalone-viz-pages-v1";
  sourceNamespace: string;
  heads: readonly {
    legacyId: string;
    pageId: string;
    version: number;
    artifactSha256: string;
    sourceSha256: string;
    /** Every original saved source revision, including the current head. */
    versions: readonly { version: number; artifactSha256: string }[];
  }[];
  base: AdditiveDatasetBaseApproval;
}
/** Immutable base inputs permit the same complete, read-only fact capture as the base verifier. */
export interface StandaloneVizBaseInputs {
  batch: DatasetMigrationBatch;
}
export interface StandaloneVizReceipt {
  kind: "standalone-viz-pages-v1";
  authoritySha256: string;
  sourceNamespace: string;
  pages: readonly {
    pageId: string;
    sourceVersions: readonly number[];
    digest: string;
  }[];
}
