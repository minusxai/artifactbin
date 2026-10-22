/** Immutable imported image metadata; never includes source URLs or credentials. */
export type CommentImageVariant = "thumbnail" | "preview" | "original";
export type CommentImageMime = "image/webp" | "image/png" | "image/jpeg" | "image/gif";
export interface CommentAttachmentVariant {
  variant: CommentImageVariant;
  mimeType: CommentImageMime;
  width: number;
  height: number;
  bytes: number;
  sha256: string;
}
export interface CommentAttachment {
  id: string;
  name: string;
  variants: readonly CommentAttachmentVariant[];
}
