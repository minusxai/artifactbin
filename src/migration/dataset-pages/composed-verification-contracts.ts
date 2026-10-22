export interface DatasetAdditiveReceiptProof {
  source_namespace: string;
  authority_sha256: string;
  fingerprint: string;
  base_fingerprint: string;
}
export interface VerifiedPageScopeProof {
  report: { path: string; sha256: string };
  pageIds: readonly string[];
  pageReceiptsSha256: string;
}
/** Explicit composition of two completed read-only verifications, never a synthetic normal report. */
export interface ComposedAdditiveVerification {
  kind: "verified-additive-composition-v1";
  complete: true;
  readOnly: true;
  compilerIdentity: string;
  sourceNamespace: string;
  immutableDatasetFingerprint: string;
  base: VerifiedPageScopeProof;
  addition: VerifiedPageScopeProof & {
    datasetReceipt: DatasetAdditiveReceiptProof;
  };
  currentFactsSha256: string;
  runtime: { pages: number };
  archives: readonly { manifestSha256: string }[];
}
