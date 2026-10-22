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
}
/** Trusted publication record. Browser requests never supply this authority. */
export interface DatasetAttachmentRegistration {
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
  /** Removes only request-owned staging; never deletes deduplicated immutable objects. */ discard(): Promise<void>;
}
export interface DatasetAttachmentRepository {
  authority(
    context: DatasetAttachmentContext,
    signal?: AbortSignal,
  ): Promise<DatasetAttachmentAuthority | null>;
  /** Atomic fresh authority/registration+grant recheck, actor-scoped idempotency, quota serialization and metadata commit. */
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
  constructor(
    readonly code:
      | "denied"
      | "invalid_request"
      | "too_large"
      | "busy"
      | "conflict"
      | "quota"
      | "unavailable",
  ) {
    super(code);
    this.name = "DatasetAttachmentError";
  }
}

export interface DatasetAttachmentService {
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
