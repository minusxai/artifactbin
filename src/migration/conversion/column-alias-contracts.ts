/** Explicit inferred rename repair; archive source and dataset columns remain unchanged. */
export interface LegacyColumnAliasAdmission {
  version: "column-alias-v1";
  sourceSha256: string;
  queryName: string;
  querySha256: string;
  bindingName: string;
  legacyRef: string;
  datasetVersion: number;
  tableSha256: string;
  from: string;
  to: string;
}
export interface LegacyColumnAliasReceipt {
  version: "column-alias-v1";
  admissionSha256: string;
  originalSourceSha256: string;
  repairedSourceSha256: string;
  inference: "audited-column-rename";
}
