import type { AttachmentBridgeClient, AttachmentBridgeClientOptions, AttachmentRead, AttachmentReceipt, AttachmentUpload, AttachmentScope } from "./dataset-attachment-bridge-contracts.ts";
import { ATTACHMENT_MAX_BYTES, ATTACHMENT_MAX_PENDING, ATTACHMENT_TIMEOUT_MS, attachmentRead, attachmentReceipt, attachmentUpload, attachmentScope, publicAttachmentReceipt } from "./dataset-attachment-validation.ts";

/** No retries here: uncertain uploads retain their original caller-owned id/file. */
export function createAttachmentClient(options: AttachmentBridgeClientOptions): AttachmentBridgeClient {
  let context: string | null = null, disposed = false;
  const pending = new Map<string, {
    context: string;
    mode: "upload" | "read" | "availability";
    upload?: AttachmentUpload;
    resolve(value: AttachmentReceipt | Blob | { canAttempt: boolean }): void;
    reject(error: Error): void;
    cleanup(): void;
  }>();
  function cancel(id: string) {
    const item = pending.get(id);
    if (!item) return;
    pending.delete(id);
    item.cleanup();
    try { options.send({ kind: "attachment-cancel", id }); } catch { /* Cancellation is best effort, never proof of rollback. */ }
    item.reject(Error(item.upload ? "Attachment upload outcome unknown" : "Attachment caller changed"));
  }
  function request(value: AttachmentScope, mode: "upload" | "read" | "availability", signal?: AbortSignal): Promise<AttachmentReceipt | Blob | { canAttempt: boolean }> {
    const uploading = mode === "upload";
    if (disposed || !context || signal?.aborted) return Promise.reject(Error("Attachment unavailable"));
    if (!(uploading ? attachmentUpload(value) : mode === "read" ? attachmentRead(value) : attachmentScope(value))) return Promise.reject(Error("Invalid attachment request"));
    if (pending.size >= ATTACHMENT_MAX_PENDING) return Promise.reject(Error("Too many attachment requests"));
    const id = options.id(), epoch = context;
    if (!id || id.length > 100 || pending.has(id)) return Promise.reject(Error("Invalid attachment request identity"));
    return new Promise((resolve, reject) => {
      const abort = () => cancel(id);
      const stopTimer = options.schedule(abort, ATTACHMENT_TIMEOUT_MS);
      const upload = uploading ? { ...value } as AttachmentUpload : undefined;
      pending.set(id, { context: epoch, mode, upload, resolve, reject, cleanup() { stopTimer(); signal?.removeEventListener("abort", abort); } });
      signal?.addEventListener("abort", abort, { once: true });
      try {
        options.send(upload
          ? { kind: "attachment-upload", id, authorizationContext: epoch, request: upload }
          : mode === "read" ? { kind: "attachment-read", id, authorizationContext: epoch, request: { ...value } as AttachmentRead } : { kind: "attachment-availability", id, authorizationContext: epoch, request: { ...value } });
      } catch {
        cancel(id);
      }
    });
  }
  return {
    setAuthority(next) {
      if (context === next) return;
      context = next;
      for (const id of [...pending.keys()]) cancel(id);
    },
    upload: (value, signal) => request(value, "upload", signal) as Promise<AttachmentReceipt>,
    availability: (value, signal) => request(value, "availability", signal) as Promise<{canAttempt:boolean}>,
    read: (value, signal) => request(value, "read", signal) as Promise<Blob>,
    receive(reply) {
      if (!reply || typeof reply !== "object") return;
      const value = reply as { id?: unknown; receipt?: unknown; blob?: unknown; availability?: unknown; error?: unknown };
      if (typeof value.id !== "string") return;
      const item = pending.get(value.id);
      if (!item) return;
      pending.delete(value.id); item.cleanup();
      if (disposed || item.context !== context || value.error) {
        item.reject(Error(item.upload ? "Attachment upload outcome unknown" : "Attachment unavailable")); return;
      }
      if (item.upload && attachmentReceipt(value.receipt)) {
        item.resolve(publicAttachmentReceipt(value.receipt)); return;
      }
      if (item.mode === "availability" && value.availability && typeof value.availability === "object" && typeof (value.availability as {canAttempt?:unknown}).canAttempt === "boolean") {
        item.resolve({canAttempt:(value.availability as {canAttempt:boolean}).canAttempt}); return;
      }
      if (item.mode === "read" && value.blob instanceof Blob && value.blob.size > 0 && value.blob.size <= ATTACHMENT_MAX_BYTES && ["image/png", "image/jpeg", "image/webp"].includes(value.blob.type)) {
        item.resolve(value.blob); return;
      }
      item.reject(Error(item.upload ? "Attachment upload outcome unknown" : "Invalid attachment response"));
    },
    dispose() { disposed = true; context = null; for (const id of [...pending.keys()]) cancel(id); },
  };
}
