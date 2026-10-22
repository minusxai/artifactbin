/** Internal binary transport. Neither hop receives an account credential. */
export type AttachmentMime = "image/png" | "image/jpeg" | "image/webp";
export interface AttachmentScope {
  backendNamespace: string;
  bindingName: string;
}
export interface AttachmentUpload extends AttachmentScope {
  requestId: string;
  filename: string;
  contentType: AttachmentMime;
  /** Immutable snapshot; structured-cloned, never JSON/base64 encoded. */
  blob: Blob;
}
export interface AttachmentRead extends AttachmentScope { ref: string }
export interface AttachmentReceipt {
  ref: string;
  url: string;
  name: string;
  contentType: AttachmentMime;
  size: number;
  replayed?: boolean;
}
export interface AttachmentPort {
  availability(request: AttachmentScope, signal?: AbortSignal): Promise<{ canAttempt: boolean }>;
  upload(request: AttachmentUpload, signal?: AbortSignal): Promise<AttachmentReceipt>;
  read(request: AttachmentRead, signal?: AbortSignal): Promise<Blob>;
}
export type AttachmentBridgeRequest =
  | { kind: "attachment-upload"; id: string; authorizationContext: string; request: AttachmentUpload }
  | { kind: "attachment-read"; id: string; authorizationContext: string; request: AttachmentRead }
  | { kind: "attachment-availability"; id: string; authorizationContext: string; request: AttachmentScope }
  | { kind: "attachment-cancel"; id: string };
export type AttachmentBridgeReply =
  | { id: string; receipt: AttachmentReceipt }
  | { id: string; blob: Blob }
  | { id: string; availability: { canAttempt: boolean } }
  | { id: string; error: "unavailable" | "unknown" | "invalid_request" };
export interface AttachmentBridgeClient extends AttachmentPort {
  setAuthority(context: string | null): void;
  receive(reply: unknown): void;
  dispose(): void;
}
export interface AttachmentBridgeClientOptions {
  send(message: AttachmentBridgeRequest): void;
  id(): string;
  schedule(callback: () => void, ms: number): () => void;
}
export interface AttachmentBridgeHostOptions {
  pageId(): string | null;
  authority(): string | null;
  active(): boolean;
  port: AttachmentPort;
  reply(reply: AttachmentBridgeReply): void;
}
