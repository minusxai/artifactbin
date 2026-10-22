import type { AttachmentBridgeHostOptions, AttachmentBridgeReply, AttachmentRead, AttachmentUpload } from "./dataset-attachment-bridge-contracts.ts";
import { ATTACHMENT_MAX_BYTES, ATTACHMENT_MAX_PENDING, ATTACHMENT_TIMEOUT_MS, attachmentRead, attachmentReceipt, attachmentUpload } from "./dataset-attachment-validation.ts";
/** A binary forwarding boundary, not an authority grant: the server checks the fixed registry. */
export function createAttachmentHost(options: AttachmentBridgeHostOptions) {
  const pending = new Map<string, AbortController>();
  function reply(value: AttachmentBridgeReply) { try { options.reply(value); } catch { /* Disconnected receiver. */ } }
  return {
    handle(message: unknown): boolean {
      if (!message || typeof message !== "object") return false;
      const value = message as { kind?: unknown; id?: unknown; authorizationContext?: unknown; request?: unknown };
      if (!["attachment-upload", "attachment-read", "attachment-cancel"].includes(String(value.kind))) return false;
      if (typeof value.id !== "string" || !value.id || value.id.length > 100) return true;
      const id = value.id;
      if (value.kind === "attachment-cancel") { pending.get(id)?.abort(); return true; }
      const uploading = value.kind === "attachment-upload", context = options.authority(), pageId = options.pageId();
      if (!context || !pageId || !options.active() || context !== value.authorizationContext || pending.has(id) || pending.size >= ATTACHMENT_MAX_PENDING || !(uploading ? attachmentUpload(value.request) : attachmentRead(value.request))) {
        reply({ id, error: "unavailable" }); return true;
      }
      const request = { ...(value.request as AttachmentUpload | AttachmentRead) }, controller = new AbortController();
      const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(ATTACHMENT_TIMEOUT_MS)]);
      pending.set(id, controller);
      const current = () => !signal.aborted && pending.get(id) === controller && options.active() && options.pageId() === pageId && options.authority() === context;
      const fail = () => { if (!controller.signal.aborted) reply({ id, error: uploading ? "unknown" : "unavailable" }); };
      let result: ReturnType<typeof options.port.upload> | ReturnType<typeof options.port.read>;
      try { result = uploading ? options.port.upload(request as AttachmentUpload, signal) : options.port.read(request as AttachmentRead, signal); }
      catch { fail(); pending.delete(id); return true; }
      void result.then((value) => {
        if (!current()) { fail(); return; }
        if (uploading && attachmentReceipt(value)) {
          const expected = `/api/files/${encodeURIComponent(pageId)}/dataset-attachments/${encodeURIComponent(request.backendNamespace)}/${encodeURIComponent(request.bindingName)}/${value.ref.slice(6)}`;
          if (value.url !== expected) { fail(); return; }
          reply({ id, receipt: { ...value } });
        } else if (!uploading && value instanceof Blob && value.size > 0 && value.size <= ATTACHMENT_MAX_BYTES && ["image/png", "image/jpeg", "image/webp"].includes(value.type)) reply({ id, blob: value });
        else fail();
      }).catch(fail).finally(() => { if (pending.get(id) === controller) pending.delete(id); });
      return true;
    },
    // Keep admission until transport cleanup settles, even when the caller disconnects.
    invalidate() { for (const c of pending.values()) c.abort(); },
  };
}
