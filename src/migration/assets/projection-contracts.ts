import type { VerifiedSupplementalObject } from "./supplemental-contracts.ts";
export interface MigrationProfileAsset extends VerifiedSupplementalObject {
  sourceNamespace: string;
  legacyUserId: string;
  assetId: string;
}
export interface MigrationCommentAsset extends VerifiedSupplementalObject {
  legacyArtifactId: string;
  commentId: string;
  attachmentId: string;
  variant: "original" | "preview" | "thumbnail";
  name: string;
}
export interface MigrationSupplementalProjection {
  profiles: readonly MigrationProfileAsset[];
  comments: readonly MigrationCommentAsset[];
  unavailableAvatars: number;
  unavailableAttachments: number;
}
