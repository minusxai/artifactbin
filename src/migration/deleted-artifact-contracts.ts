import type { MigrationMaps, PlannedPage } from "./contracts.ts";
import type { MigrationRuntimeVerification } from "./verification-contracts.ts";

/** Admission binds the original deleted rows; it never changes their lifecycle. */
export interface DeletedArtifactAdmissionEntry {
  legacyId: string;
  pageId: string;
  headVersion: number;
  deletedAt: string;
  artifactSha256: string;
  revisions: readonly { version: number; artifactSha256: string }[];
}
export interface DeletedArtifactAdmission {
  kind: "deleted-artifact-admission-v1";
  sourceNamespace: string;
  archiveDigest: string;
  entries: readonly DeletedArtifactAdmissionEntry[];
}
export interface DeletedArtifactPlan {
  kind: "deleted-artifact-plan-v1";
  sourceNamespace: string;
  archiveDigest: string;
  admissionSha256: string;
  pages: readonly { page: PlannedPage; digest: string }[];
}
export interface DeletedArtifactPlanningInput {
  admission: DeletedArtifactAdmission;
  pages: readonly PlannedPage[];
  /** Existing active pages and retained folder IDs are never candidates. */
  protectedPageIds: ReadonlySet<string>;
}
export interface DeletedDestinationPreparation {
  sourceNamespace: string;
  archiveDigest: string;
  maps: MigrationMaps;
}
export interface DeletedArtifactDestination {
  /** Read-only binding to an already prepared archive and existing identities. */
  prepareDeleted(input: DeletedDestinationPreparation): Promise<void>;
  supportsExactDeletedAccess(page: PlannedPage): boolean;
  /** Initial files INSERT includes deletion/trash fields in the same transaction. */
  importDeletedPage(key: string, digest: string, page: PlannedPage): Promise<"created" | "unchanged">;
}
export interface DeletedArtifactApplyResult {
  complete: true;
  created: number;
  unchanged: number;
  pages: number;
  revisions: number;
  verification: MigrationRuntimeVerification;
}

export interface DeletedArtifactApplyInput {
  plan: DeletedArtifactPlan;
  maps: MigrationMaps;
  destination: DeletedArtifactDestination;
  /** Both calls compare independently sealed existing active/addon state. */
  verifyProtectedState(): Promise<void>;
  /** Fresh database comparison, not receipt-only acknowledgement. */
  verifyDeletedState(plan: DeletedArtifactPlan): Promise<MigrationRuntimeVerification>;
}

/** Raw source authority for explicit deleted planning; destination binding remains separate. */
export interface DeletedArtifactSourceAuthority {
  admission: DeletedArtifactAdmission;
  maps: MigrationMaps;
  sourceNamespace: string;
}
