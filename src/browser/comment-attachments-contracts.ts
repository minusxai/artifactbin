import type {
  CommentAttachment,
  CommentAttachmentVariant,
  CommentImageVariant,
} from "../comment-attachment-contracts.ts";
/** Credential handling belongs exclusively to the trusted transport. */
export type CommentAttachmentLoader = (
  commentId: string,
  attachmentId: string,
  variant: CommentImageVariant,
  signal: AbortSignal,
) => Promise<Blob>;
export interface CommentAttachmentLease {
  /** Always an owned Blob URL, never a server URL. */
  url: string;
  release(): void;
}
export interface CommentAttachmentResources {
  /** Non-secret rendering epoch; changes when loaded image authority retires. */
  readonly revision: number;
  /** Synchronous authority changes abort reads and revoke even already displayed images. */
  setAuthority(context: string | null): void;
  acquire(
    commentId: string,
    attachment: CommentAttachment,
    variant: CommentAttachmentVariant,
    signal?: AbortSignal,
  ): Promise<CommentAttachmentLease>;
  subscribeInvalidation(listener: () => void): () => void;
  dispose(): void;
}
export interface CommentAttachmentResourcesOptions {
  load: CommentAttachmentLoader;
  createURL(blob: Blob): string;
  revokeURL(url: string): void;
  /** A single decoded image may not exceed this transport bound (default 20 MiB). */
  maxBytes?: number;
}
export interface CommentAttachmentGallery {
  dispose(): void;
}
export interface CommentAttachmentGalleryOptions {
  parent: HTMLElement;
  commentId: string;
  attachments: readonly CommentAttachment[];
  resources: CommentAttachmentResources;
}
