import type { MediaResponse, MediaStore } from "./contracts.ts";
export type AttachmentVariant = "original" | "preview" | "thumbnail";
export interface CommentAttachmentAddress {
  readonly kind: "comment";
  readonly pageId: string;
  readonly commentId: string;
  readonly attachmentId: string;
  readonly variant: AttachmentVariant;
}
export interface PersonImageAddress {
  readonly kind: "person";
  readonly pageId: string;
  readonly valueName: string;
  /** SHA256 of JSON [namespace, legacy user ID, stored byte digest]; never a source ID. */
  readonly assetId: string;
}
export type SupplementalAddress = CommentAttachmentAddress | PersonImageAddress;
export interface SupplementalDescriptor {
  readonly address: SupplementalAddress;
  readonly sha256: string;
  readonly byteLength: number;
  readonly width: number;
  readonly height: number;
  readonly contentType: "image/webp";
  readonly storageKey: string;
  readonly filename: string;
}
export interface SupplementalRepository {
  /** Fresh same-page ACL; person images additionally recheck the exact bound user occurrence. */
  read(address: SupplementalAddress, credential: string, signal?: AbortSignal): Promise<SupplementalDescriptor | null>;
}
export interface SupplementalRequest {
  readonly address: SupplementalAddress;
  readonly credential: string;
  readonly method: "GET" | "HEAD";
  readonly range?: string;
  readonly signal?: AbortSignal;
}
export interface SupplementalService {
  read(request: SupplementalRequest): Promise<MediaResponse>;
}
export interface SupplementalServiceOptions {
  readonly repository: SupplementalRepository;
  readonly store: MediaStore;
}
