/** Trusted offline evidence, obtained only after unchanged base and additive verifiers passed.
 * A report digest identifies that separately retained verification; it is not a browser grant. */
export interface GroupHandleBaseProof {
  readonly kind: "verified-base-import";
  readonly sourceNamespace: string;
  readonly archiveManifestSha256: string;
  readonly reportSha256: string;
  readonly datasetReportSha256: string;
  readonly visualizationReportSha256: string;
}
export interface GroupHandleCandidate {
  readonly legacyGroupId: string;
  readonly actor: string;
  readonly sourceHandle: string;
  readonly sourceDeleted: boolean;
  readonly expectedHandle: null;
}
export interface GroupHandlePlan {
  readonly schemaVersion: 1;
  readonly base: GroupHandleBaseProof;
  readonly candidates: readonly GroupHandleCandidate[];
  readonly sha256: string;
}
export interface GroupHandleReceipt {
  readonly schemaVersion: 1;
  readonly planSha256: string;
  readonly baseReportSha256: string;
  readonly datasetReportSha256: string;
  readonly visualizationReportSha256: string;
  readonly archiveManifestSha256: string;
  readonly sourceNamespace: string;
  readonly candidates: readonly GroupHandleCandidate[];
}
export interface GroupHandlePreservation {
  /** Explicit post-base amendment. Never invoked by the frozen importer. */
  apply(plan: GroupHandlePlan): Promise<{
    status: "applied" | "already-applied";
    receipt: GroupHandleReceipt;
  }>;
  /** Fails on missing/altered receipts, revoked handles, or changed source/mapping.
   * It does not stand in for the original base or additive-authority verifier. */
  verify(plan: GroupHandlePlan): Promise<GroupHandleReceipt>;
}
