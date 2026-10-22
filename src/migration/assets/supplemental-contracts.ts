/** Private migration proof. Source object identities never enter public profile/comment DTOs. */
export interface VerifiedSupplementalObject {
  readonly objectKey: string;
  readonly kind: "avatar" | "comment-image";
  readonly sha256: string;
  readonly byteLength: number;
  readonly width: number;
  readonly height: number;
  readonly contentType: "image/webp";
  readonly storageKey: string;
}
