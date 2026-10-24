import type { MigrationMaps } from "../contracts.ts";
import type { NativeV3IdentityMaps } from "./v3-publication-contracts.ts";
export interface NativeV3IdentityUser {
  id: string;
  email: string | null;
  kind: string;
  parent_user_id?: string | null;
  merged_into_user_id?: string | null;
  expires_at?: string | null;
  created_at: string;
  name?: string | null;
  username?: string | null;
  image_key?: string | null;
}
export interface NativeV3IdentityToken {
  id: string;
  user_id: string | null;
  deleted_at?: string | null;
  expires_at?: string | null;
  created_at?: string | null;
}
export interface NativeV3IdentityInput {
  sourceNamespace: string;
  sourceInventorySha256: string;
  targetInventorySha256: string;
  targetCollectedAt: string;
  sourceUsers: readonly NativeV3IdentityUser[];
  sourceTokens: readonly NativeV3IdentityToken[];
  targetUsers: readonly NativeV3IdentityUser[];
  targetTokens: readonly NativeV3IdentityToken[];
  targetArtifacts: readonly { id: string }[];
  targetReservations: readonly { id: string }[];
  requiredUserIds: readonly string[];
  requiredTokenIds: readonly string[];
  artifactIds: readonly string[];
  legacyMaps: MigrationMaps;
}
export interface NativeV3IdentityPlan {
  sourceNamespace: string;
  sourceInventorySha256: string;
  targetInventorySha256: string;
  targets: NativeV3IdentityMaps;
  targetIdentitySha256: string;
  users: {
    sourceId: string;
    targetId: string;
    action: "create-preserved" | "reuse-verified-email";
    sourceRowSha256: string;
    targetRowSha256?: string;
  }[];
  createUsers: (NativeV3IdentityUser & {
    sourceId: string;
    sourceRowSha256: string;
  })[];
  tokens: {
    sourceId: string;
    targetId: string;
    userId: string | null;
    action: "create-disabled-provenance";
    sourceRowSha256: string;
    sourceCreatedAt: string | null;
    sourceDeletedAt: string | null;
    sourceExpiresAt: string | null;
  }[];
  artifactIds: Record<string, string>;
  /** Only typed user columns may be transformed; source bytes remain archived and derived bytes need independent SHA/catalog proof. */
  userCellMappings: {
    sourceUserId: string;
    targetUserId: string;
    sourceRowSha256: string;
    targetRowSha256: string;
    reason: "verified-email";
  }[];
  blockers: {
    kind: "user" | "token" | "artifact";
    sourceId: string;
    code: string;
  }[];
  sha256: string;
}
