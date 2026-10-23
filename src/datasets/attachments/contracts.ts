import type {
  DatasetBinding,
  DatasetCallContext,
  DatasetReadAuthority,
} from "../contracts.ts";
export type DatasetAttachmentMime = "image/png" | "image/jpeg" | "image/webp";
/** Original FileUpload ABI limits; attachment bytes never pass through JSON capabilities. */
export const DATASET_ATTACHMENT_LIMITS = Object.freeze({
  fileBytes: 50_000_000,
  datasetFiles: 1000,
  datasetBytes: 500_000_000,
  maxConcurrent: 2,
  timeoutMs: 60_000,
});
export interface DatasetAttachmentContext extends DatasetCallContext {
  backendNamespace: string;
  bindingName: string;
  /** Trusted host only; revalidated after binary I/O, never sent to page code. */
  credentialHash: string | null;
}
/** Trusted publication record. Browser requests never supply this authority. */
export interface DatasetAttachmentRegistration {
  /** Trusted presentation-only revision alias; authority still uses binding.page.version. */
  receiptIdentity?: import("../receipt-identity-contracts.ts").VisualReceiptIdentity;
  backendNamespace: string;
  sourceNamespace: string;
  binding: DatasetBinding;
  acceptedTypes: readonly DatasetAttachmentMime[];
}
export interface DatasetAttachmentAuthority {
  registration: DatasetAttachmentRegistration;
  authority: DatasetReadAuthority;
  generation: string;
}
export interface DatasetAttachmentUpload {
  requestId: string;
  filename: string;
  contentType: DatasetAttachmentMime;
  body: AsyncIterable<Uint8Array>;
}
export interface DatasetAttachmentObject {
  sha256: string;
  storageKey: string;
  byteLength: number;
  contentType: DatasetAttachmentMime;
  filename: string;
  /** Quota includes all persisted variants, not only the primary response. */
  totalBytes?: number;
  small?: {
    sha256: string;
    storageKey: string;
    byteLength: number;
    contentType: "image/webp";
    width: number;
    height: number;
  };
}
export interface DatasetAttachmentReceipt {
  ref: string;
  url: string;
  name: string;
  contentType: DatasetAttachmentMime;
  size: number;
  replayed?: boolean;
}
export interface DatasetAttachmentRecord {
  id: string;
  sourceNamespace: string;
  datasetId: string;
  pageId: string;
  object: DatasetAttachmentObject;
}
export interface DatasetAttachmentStaged {
  inputSha256: string;
  object: DatasetAttachmentObject;
  /** Called only after a durable charged reservation, before final fresh-authority completion. */
  publish(): Promise<void>;
  /** Removes only request-owned staging; never deletes deduplicated immutable objects. */ discard(): Promise<void>;
}
export interface DatasetAttachmentRepository {
  authority(
    context: DatasetAttachmentContext,
    signal?: AbortSignal,
  ): Promise<DatasetAttachmentAuthority | null>;
  /** Durable quota reservation, idempotent promotion and final fresh-authority completion; unknown failures remain charged and unreadable. */
  commit(
    input: {
      context: DatasetAttachmentContext;
      request: Omit<DatasetAttachmentUpload, "body">;
      initial: DatasetAttachmentAuthority;
      staged: DatasetAttachmentStaged;
    },
    signal?: AbortSignal,
  ): Promise<{ record: DatasetAttachmentRecord; replayed: boolean }>;
  /** Current registration/read permission and exact same-document/dataset attachment. */
  read(
    context: DatasetAttachmentContext,
    id: string,
    signal?: AbortSignal,
  ): Promise<{ record: DatasetAttachmentRecord; generation: string } | null>;
}
export interface DatasetAttachmentStorage {
  /** Enforces received-byte limit before buffering/decoding; caller retains admission until discard completes. */
  stage(
    upload: DatasetAttachmentUpload,
    signal?: AbortSignal,
  ): Promise<DatasetAttachmentStaged>;
  open(
    object: DatasetAttachmentObject,
    signal?: AbortSignal,
  ): Promise<{ body: AsyncIterable<Uint8Array>; close(): Promise<void> }>;
}
export class DatasetAttachmentError extends Error {
  readonly code:
    | "denied"
    | "invalid_request"
    | "too_large"
    | "busy"
    | "conflict"
    | "quota"
    | "unavailable";
  constructor(code: DatasetAttachmentError["code"]) {
    super(code);
    this.code = code;
    this.name = "DatasetAttachmentError";
  }
}

export interface DatasetAttachmentService {
  /** Advisory only: no quota/row/value success promise or reservation. */
  availability(
    context: DatasetAttachmentContext,
    signal?: AbortSignal,
  ): Promise<{ canAttempt: boolean }>;
  upload(
    context: DatasetAttachmentContext,
    upload: DatasetAttachmentUpload,
    signal?: AbortSignal,
  ): Promise<DatasetAttachmentReceipt>;
  read(
    context: DatasetAttachmentContext,
    id: string,
    signal?: AbortSignal,
  ): Promise<{
    record: DatasetAttachmentRecord;
    body: AsyncIterable<Uint8Array>;
    close(): Promise<void>;
  } | null>;
}
