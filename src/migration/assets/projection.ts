import type { LegacyRow } from "../contracts.ts";
import type { VerifiedSupplementalObject } from "./supplemental-contracts.ts";
import type {
  MigrationSupplementalProjection,
  MigrationProfileAsset,
  MigrationCommentAsset,
} from "./projection-contracts.ts";
import { profileAssetId } from "./supplemental.ts";
/** Source rows determine ownership and attachment placement; receipt references confer no authority. */
export function projectSupplementalAssets(
  namespace: string,
  users: readonly LegacyRow[],
  images: readonly LegacyRow[],
  proofs: readonly VerifiedSupplementalObject[],
): MigrationSupplementalProjection {
  const byKey = new Map<string, VerifiedSupplementalObject>();
  for (const proof of proofs) {
    if (byKey.has(proof.objectKey))
      throw Error("Duplicate supplemental source object");
    byKey.set(proof.objectKey, proof);
  }
  const profiles: MigrationProfileAsset[] = [],
    comments: MigrationCommentAsset[] = [];
  let unavailableAvatars = 0,
    unavailableAttachments = 0;
  const usersSeen = new Set<string>(),
    imagesSeen = new Set<string>();
  for (const user of users) {
    if (typeof user.id !== "string" || !user.id || usersSeen.has(user.id))
      throw Error("Ambiguous supplemental user identity");
    usersSeen.add(user.id);
    if (user.image_key == null || user.image_key === "") continue;
    if (typeof user.image_key !== "string")
      throw Error("Invalid source avatar identity");
    const proof = byKey.get(user.image_key);
    if (!proof) {
      unavailableAvatars++;
      continue;
    }
    if (
      proof.kind !== "avatar" ||
      !user.image_key.startsWith(`avatar/${user.id}/`)
    )
      throw Error("Avatar source identity mismatch");
    profiles.push({
      ...proof,
      sourceNamespace: namespace,
      legacyUserId: user.id,
      assetId: profileAssetId(namespace, user.id, proof.sha256),
    });
  }
  for (const image of images) {
    if (typeof image.id !== "string" || !image.id || imagesSeen.has(image.id))
      throw Error("Ambiguous source attachment identity");
    imagesSeen.add(image.id);
    if (image.ready !== true || image.annotation_id == null) continue;
    if (
      typeof image.artifact_id !== "string" ||
      !image.artifact_id ||
      !(
        typeof image.annotation_id === "string" ||
        Number.isSafeInteger(image.annotation_id)
      )
    )
      throw Error("Invalid source attachment placement");
    const variants = (["original", "preview", "thumbnail"] as const).map(
      (variant) => ({
        variant,
        proof: byKey.get(`comment-images/${image.id}/${variant}.webp`),
      }),
    );
    if (variants.some((v) => !v.proof)) {
      unavailableAttachments++;
      continue;
    }
    const total = variants.reduce((sum, v) => sum + v.proof!.byteLength, 0);
    if (
      !/^[0-9]+$/.test(String(image.bytes)) ||
      !Number.isSafeInteger(Number(image.bytes)) ||
      Number(image.bytes) !== total
    )
      throw Error("Source attachment byte total mismatch");
    for (const { variant, proof } of variants) {
      if (proof!.kind !== "comment-image")
        throw Error("Attachment source identity mismatch");
      comments.push({
        ...proof!,
        legacyArtifactId: image.artifact_id,
        commentId: String(image.annotation_id),
        attachmentId: image.id,
        variant,
        name: "Attached image",
      });
    }
  }
  return { profiles, comments, unavailableAvatars, unavailableAttachments };
}
