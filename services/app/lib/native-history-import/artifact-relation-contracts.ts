import type { NativeIdentityPlan } from "../native-identity-import/contracts";
import type { NativeHistoryImport, NativeImportRelations } from "./contracts";
/** Exact captured current relation rows; no inferred owner participation or grants. */
export interface NativeArtifactRelationRow {
  subject_kind: "user";
  subject_id: string;
  verb: "join" | "like";
  object_kind: "artifact";
  object_id: string;
  created_at: string;
  deleted_at: string | null;
  status: "accepted" | "pending" | "left" | "dismissed";
  direction: "request" | "invitation";
  initiated_by: string | null;
  explicit_join: boolean;
  accepted_at: string | null;
  revision: number;
}
export interface NativeArtifactRelationsInput {
  history: Pick<
    NativeHistoryImport,
    | "sourceNamespace"
    | "sourceId"
    | "pageId"
    | "selectionSha256"
    | "projectionSha256"
    | "headVersion"
  >;
  /** Actual raw private source files; approved hashes come from the reviewed host receipts. */
  source: {
    capture: Uint8Array;
    selectionManifest: Uint8Array;
    canonicalSource: Uint8Array;
    headWitness: Uint8Array;
    refreshManifest?: Uint8Array;
  };
  approved: {
    captureSha256: string;
    selectionManifestSha256: string;
    headWitnessSha256: string;
    identityPlanSha256: string;
    refreshManifestSha256?: string;
  };
  identityPlan: NativeIdentityPlan;
}
declare const artifactRelationAuthority: unique symbol;
/** Source-bound transaction adapter; a plain authored object cannot delegate relation ownership. */
export interface NativeArtifactRelations extends NativeImportRelations {
  readonly [artifactRelationAuthority]: true;
}
