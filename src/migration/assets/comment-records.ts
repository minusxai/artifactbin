import type { MigrationCommentAsset } from "./projection-contracts.ts";
/** Runtime descriptor projection deliberately excludes original storage keys and captured metadata. */
export function migrationCommentAssetRecords(
  assets: readonly MigrationCommentAsset[],
) {
  return assets
    .map((asset) => ({
      comment_id: asset.commentId,
      attachment_id: asset.attachmentId,
      variant: asset.variant,
      name: asset.name,
      sha256: asset.sha256,
      byte_length: String(asset.byteLength),
      width: asset.width,
      height: asset.height,
      content_type: asset.contentType,
      storage_key: asset.storageKey,
    }))
    .sort(
      (a, b) =>
        a.comment_id.localeCompare(b.comment_id) ||
        a.attachment_id.localeCompare(b.attachment_id) ||
        a.variant.localeCompare(b.variant),
    );
}
