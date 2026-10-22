/** Text-only metadata from an already authorized stored page revision. */
export interface SocialPreview {
  readonly title: string;
  readonly description: string;
  /** Trusted canonical platform address, including any saved revision selector. */
  readonly url: string;
  /** Trusted platform card endpoint; authored image URLs are never followed. */
  readonly imageUrl?: string;
}
export interface SocialPreviewAddress {
  readonly url: string;
  readonly imageUrl?: string;
}
/** Caller must use the same current read authorization and deleted-page checks as the page route. */
export interface SocialCardAccess {
  authorize(): Promise<void>;
}
export interface SocialCard {
  readonly contentType: "image/png";
  readonly cacheControl: "private, no-store";
  readonly bytes: Uint8Array;
}
