import type { LegacyRow } from "../contracts.ts";
import type { NativeV3IdentityPlan } from "./v3-identity-contracts.ts";
import type { NativePublicationBytes } from "./pipeline-publication-contracts.ts";
export interface NativeLineageApproval {
  identityPlanSha256: string;
  sourceInventorySha256: string;
  targetInventorySha256: string;
  approvedBy: string;
  reason: string;
  sourceId: string;
  targetId: string;
  sourceRowSha256: string;
  targetArtifactCollision: false;
  targetReservationCollision: false;
  importAncestor: false;
  sha256: string;
}
export interface NativeLineageSelection {
  selectionSha256: string;
  datasetCensusSha256: string;
  pageSourceIdsSha256: string;
  datasetSourceIdsSha256: string;
  pageCount: 393;
  datasetCount: 190;
}
export interface NativeAncillaryFolderRecipe {
  schema: "native-reviewed-ancillary-folders-v1";
  sourceNamespace: string;
  parentIdentityPlanSha256: string;
  identityPlanSha256: string;
  identityGroups?: Readonly<Record<string, string>>;
  selection: NativeLineageSelection;
  source: {
    capture: NativePublicationBytes;
    selectionManifest: NativePublicationBytes;
    datasetCensus: NativePublicationBytes;
    sourceInventory: Record<string, unknown>;
    targetInventory: Record<string, unknown>;
  };
  approvals: readonly NativeLineageApproval[];
  folders: readonly {
    sourceId: string;
    targetId: string;
    sourceRowSha256: string;
    sourceInventoryRowSha256: string;
    requiredBy: readonly string[];
    row: LegacyRow;
    shares: readonly {
      email: string;
      role: string;
      userId?: string | null;
      createdAt?: string;
    }[];
  }[];
  /** Raw evidence + exact projection receipt. It grants no database or existence authority. */
  sha256: string;
}
export interface NativeLineageExtensionInput {
  plan: NativeV3IdentityPlan;
  approvedPlanSha256: string;
  source: {
    capture: NativePublicationBytes;
    selectionManifest: NativePublicationBytes;
    datasetCensus: NativePublicationBytes;
    sourceInventory: Record<string, unknown>;
    targetInventory: Record<string, unknown>;
  };
  approvals: readonly NativeLineageApproval[];
  identityGroups?: Readonly<Record<string, string>>;
}
export interface NativeLineageExtensionResult {
  plan: NativeV3IdentityPlan;
  parentIdentityPlanSha256: string;
  approvedPlanSha256: string;
  selection: NativeLineageSelection;
  ancillaryFolders: NativeAncillaryFolderRecipe;
  /** Explicit new reviewed configuration, not a silent mutation of the parent plan. */
  sha256: string;
}
