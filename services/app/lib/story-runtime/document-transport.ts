/**
 * Which transport a served document's store gets — decided ONCE, at entry:
 *
 *  - inside a parent window (the owner's shell, the editor's canvas, a
 *    capture): the postMessage RELAY — the page holds the session, so a
 *    private document's queries are answered there;
 *  - top-level with a `queryUrl` in its island (the reader's document, which
 *    proxy.ts serves at the artifact's own URL): a direct GET of that url —
 *    the sandboxed document fetches its own re-runs, no parent needed;
 *  - neither: no transport — values still change, tables stay as rendered.
 *
 * Pure over a window-shaped argument so it is testable without a browser.
 */
import { createFetchTransport, type FetchLike } from './fetch-transport';
import { createRelayTransport } from './relay-transport';
import type { QueryTransport } from './store';

export interface DocumentWindow {
  parent: unknown;
  self?: unknown;
  addEventListener: Window['addEventListener'];
}

export function createDocumentTransport(
  win: DocumentWindow,
  queryUrl: string | undefined,
  appOrigin: string,
  fetchFn?: FetchLike,
  mutateUrl?: string,
): QueryTransport | null {
  const parent = win.parent;
  if (parent && parent !== win && parent !== win.self) return createRelayTransport(parent as Window, appOrigin, win as unknown as Window);
  if (queryUrl) return createFetchTransport(queryUrl, fetchFn, mutateUrl);
  return null;
}
