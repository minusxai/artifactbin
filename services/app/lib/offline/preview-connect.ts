/** A portable file hands a copy to a user-selected preview server without granting it network access. */
import { normalizeOrigin, PREVIEW_CONNECT_CHANNEL, PREVIEW_CONNECT_PATH, PREVIEW_CONNECT_MAX_BYTES, type PreviewConnectMessage } from '@artifactbin/contracts';

export function previewServerOrigin(value: string): string {
  const origin = normalizeOrigin(value.trim());
  if (!origin) throw new Error('Enter an HTTPS server address, or a local address such as http://localhost:7474. Use only the server address, without a path.');
  return origin;
}

/** The returned editor link must stay inside the chosen server's workspace. */
export function previewWorkspaceUrl(origin: string, path: string): string | null {
  if (!path.startsWith('/workspace/') || path.includes('\\') || /[\u0000-\u001f]/.test(path)) return null;
  let url: URL;
  try { url = new URL(path, origin); } catch { return null; }
  if (url.origin !== origin || !url.pathname.startsWith('/workspace/') || url.search || url.hash) return null;
  return url.href;
}

export interface PreviewConnectionOptions {
  origin: string;
  prepare(): Promise<{ html: string; filename: string }>;
  onStatus(message: string): void;
  onError(message: string): void;
  onOpened(url: string): void;
}

/** Call directly from the user's click: opening the tab must precede any asynchronous editing flush. */
export function connectPreview(options: PreviewConnectionOptions, browser: Window = window): () => void {
  const origin = previewServerOrigin(options.origin);
  const requestId = crypto.randomUUID();
  const popup = browser.open(`${origin}${PREVIEW_CONNECT_PATH}?request=${encodeURIComponent(requestId)}`, '_blank');
  if (!popup) throw new Error('The browser blocked the server tab. Allow popups for this file, or open the server and use “Import an HTML file” after saving this file.');
  let disposed = false;
  let offered = false;
  let sent = false;
  const finish = () => {
    if (disposed) return;
    disposed = true;
    browser.removeEventListener('message', receive);
    browser.clearTimeout(timeout);
    browser.clearInterval(closed);
  };
  const fail = (message: string) => { finish(); options.onError(message); };
  const receive = (event: MessageEvent) => {
    if (disposed || event.source !== popup || event.origin !== origin || !event.data || typeof event.data !== 'object') return;
    const message = event.data as Partial<PreviewConnectMessage>;
    if (message.channel !== PREVIEW_CONNECT_CHANNEL || message.requestId !== requestId) return;
    if (message.type === 'ready' && !offered) {
      offered = true;
      browser.clearTimeout(timeout);
      // Authentication and explicit review have no deadline. Closing/cancelling the receiver still ends the handoff.
      options.onStatus('Preparing this file. Review and confirm in the server tab.');
      void options.prepare().then((offer) => {
        if (disposed) return;
        if (new TextEncoder().encode(offer.html).byteLength > PREVIEW_CONNECT_MAX_BYTES) throw new Error('This file is too large to connect (maximum 25 MB).');
        sent = true;
        popup.postMessage({ channel: PREVIEW_CONNECT_CHANNEL, type: 'offer', requestId, ...offer } satisfies PreviewConnectMessage, origin);
      }).catch((error: unknown) => { if (!disposed) fail(error instanceof Error ? error.message : 'Could not prepare this file. Your edits are still here.'); });
    } else if (message.type === 'opened' && sent && typeof message.path === 'string') {
      const url = previewWorkspaceUrl(origin, message.path);
      if (!url) { fail('The server returned an invalid editor address. Your original file is unchanged.'); return; }
      finish(); options.onOpened(url);
    } else if (message.type === 'error' && typeof message.message === 'string') {
      fail(message.message || 'The server could not import this file. Your edits are still here.');
    }
  };
  browser.addEventListener('message', receive);
  let timeout = browser.setTimeout(() => fail('The connection timed out. Start the preview server, then try again. Your edits are still here.'), 30_000);
  const closed = browser.setInterval(() => { if (popup.closed) fail('The server tab was closed. Your edits are still here.'); }, 1000);
  options.onStatus('Opening the server. Review and confirm in its tab.');
  return () => { if (disposed) return; finish(); popup.close(); };
}
