import type { MigrationManifest, MigrationMaps, SqlReader } from "./contracts.ts";
import type { VerifiedSupplementalObject } from "./assets/supplemental-contracts.ts";
/** Trusted offline evidence. Run only after all unchanged full-row verifiers passed. */
export interface AvatarPreservationBaseProof {
  readonly kind: "verified-base-and-addons";
  readonly sourceNamespace: string;
  /** Digest stored in archive.archives, not the separate snapshot manifest. */
  readonly archiveManifestSha256: string;
  readonly baseReportSha256: string;
  readonly datasetReportSha256: string;
  readonly visualizationReportSha256: string;
}
export interface AvatarPreservationSource {
  readonly manifest: MigrationManifest;
  readonly maps: Pick<MigrationMaps, "users">;
  readonly archiveManifestSha256: string;
}
export interface AvatarPreservationInput {
  readonly legacyUserId: string;
  /** Obtain through readVerifiedSupplementalAssets; source rows confer authority. */
  readonly object: VerifiedSupplementalObject;
  readonly bytes: Uint8Array;
}
export interface AvatarPreservationCandidate {
  readonly legacyUserId: string;
  readonly actor: string;
  readonly sourceUserSha256: string;
  readonly object: VerifiedSupplementalObject;
  readonly image: string;
  readonly expectedImage: null;
}
export interface AvatarPreservationPlan {
  readonly schemaVersion: 1;
  readonly base: AvatarPreservationBaseProof;
  readonly candidates: readonly AvatarPreservationCandidate[];
  readonly sha256: string;
}
export interface AvatarPreservationReceipt {
  readonly schemaVersion: 1;
  readonly plan: AvatarPreservationPlan;
}
export interface AvatarPreservationOptions {
  readonly runtimeSchema: string;
  readonly archiveSchema: string;
  /** Must independently check the referenced successful base and addon reports. */
  readonly verifyPrerequisites: (proof: AvatarPreservationBaseProof) => Promise<void>;
}
export interface AvatarPreservation {
  /** Dedicated connection; owns an atomic transaction. Retry never restores changed photos. */
  apply(plan: AvatarPreservationPlan, mode: "initial" | "retry"): Promise<{
    status: "applied" | "already-applied";
    receipt: AvatarPreservationReceipt;
  }>;
  verify(plan: AvatarPreservationPlan): Promise<AvatarPreservationReceipt>;
}
export type AvatarPreservationDatabase = SqlReader;
