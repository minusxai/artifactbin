import type { AttachmentRead, AttachmentReceipt, AttachmentScope, AttachmentUpload } from "./dataset-attachment-bridge-contracts.ts";
export const ATTACHMENT_MAX_BYTES = 50_000_000;
export const ATTACHMENT_MAX_PENDING = 2;
export const ATTACHMENT_TIMEOUT_MS = 60_000;
const names = /^[A-Za-z_][A-Za-z0-9_-]{0,127}$/;
const mime = (value: unknown) => value === "image/png" || value === "image/jpeg" || value === "image/webp";
function filename(value: unknown): value is string {
  if (typeof value !== "string" || !value || value.length > 255 || /[\x00-\x1f\x7f/\\]/.test(value)) return false;
  try { encodeURIComponent(value); return true; } catch { return false; }
}
export function attachmentScope(value: unknown): value is AttachmentScope {
  if (!value || typeof value !== "object") return false;
  const v = value as AttachmentScope;
  return typeof v.backendNamespace === "string" && names.test(v.backendNamespace) && typeof v.bindingName === "string" && names.test(v.bindingName);
}
export function attachmentUpload(value: unknown): value is AttachmentUpload {
  if (!attachmentScope(value)) return false;
  const v = value as AttachmentUpload;
  return typeof v.requestId === "string" && /^[A-Za-z0-9_.-]{8,120}$/.test(v.requestId) && filename(v.filename) && mime(v.contentType) && v.blob instanceof Blob && v.blob.size > 0 && v.blob.size <= ATTACHMENT_MAX_BYTES;
}
export function attachmentRead(value: unknown): value is AttachmentRead {
  return attachmentScope(value) && typeof (value as AttachmentRead).ref === "string" && /^dfile:[a-f0-9]{32}$/.test((value as AttachmentRead).ref);
}
export function attachmentReceipt(value: unknown): value is AttachmentReceipt {
  if (!value || typeof value !== "object") return false;
  const v = value as AttachmentReceipt;
  return typeof v.ref === "string" && /^dfile:[a-f0-9]{32}$/.test(v.ref) && filename(v.name) && mime(v.contentType) && Number.isSafeInteger(v.size) && v.size > 0 && v.size <= ATTACHMENT_MAX_BYTES && typeof v.url === "string" && v.url.startsWith("/") && !v.url.startsWith("//") && v.url.length <= 2048 && (v.replayed === undefined || v.replayed === true);
}
export function publicAttachmentReceipt(value: AttachmentReceipt): AttachmentReceipt {
  return { ref: value.ref, url: value.url, name: value.name, contentType: value.contentType, size: value.size, ...(value.replayed === true ? {replayed:true} : {}) };
}
