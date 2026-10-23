import type { AdditiveDatasetBaseApproval } from "./dataset-pages/admission-contracts.ts";
/** Reviewed offline seal for exact deleted metadata, separate from active additive authority. */
export interface DeletedDatasetAuthority {
  kind: "deleted-dataset-additive-v1";
  sourceNamespace: string;
  /** Canonical batch hash with deletedAdditive omitted (avoids self-reference). */
  batchSha256: string;
  admitted: readonly {
    legacyId: string;
    pageId: string;
    version: number;
    artifactSha256: string;
  }[];
  /** Exact additional immutable member/viewer registrations prepared for these pages. */
  registrations?: AdditiveDatasetBaseApproval["inventory"]["protectedRows"];
  /** Frozen current metadata inventory; the normal dataset receipt remains immutable. */
  base: AdditiveDatasetBaseApproval;
}
