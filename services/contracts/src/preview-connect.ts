/** Explicit browser handoff. requestId correlates windows; it is never an access credential. */
export const PREVIEW_CONNECT_CHANNEL = 'afbin-preview-connect-v1';
export const PREVIEW_CONNECT_PATH = '/connect';
export const PREVIEW_CONNECT_IMPORT_PATH = '/connect/import';
export const PREVIEW_CONNECT_INSPECT_PATH = '/connect/inspect';
export const PREVIEW_CONNECT_MAX_BYTES = 25 * 1024 * 1024;
export type PreviewConnectMessage =
  | { channel: typeof PREVIEW_CONNECT_CHANNEL; type: 'ready'; requestId: string }
  | { channel: typeof PREVIEW_CONNECT_CHANNEL; type: 'offer'; requestId: string; html: string; filename: string }
  | { channel: typeof PREVIEW_CONNECT_CHANNEL; type: 'opened'; requestId: string; path: string }
  | { channel: typeof PREVIEW_CONNECT_CHANNEL; type: 'error'; requestId: string; message: string };

/** The returned editor link must stay inside the chosen server's workspace. */
export function previewWorkspaceUrl(origin: string, path: string): string | null {
  if (!path.startsWith('/workspace/') || path.includes('\\') || /[\u0000-\u001f]/.test(path)) return null;
  let url: URL;
  try { url = new URL(path, origin); } catch { return null; }
  if (url.origin !== origin || !url.pathname.startsWith('/workspace/') || url.search || url.hash) return null;
  return url.href;
}
