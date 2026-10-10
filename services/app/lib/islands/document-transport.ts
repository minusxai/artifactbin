/**
 * Which transport a served document's store gets — decided ONCE, at entry (lib/islands/boot):
 *
 *  - a document on its OWN origin (APP__PAGES_HOST, the page data's `direct`): never here — boot gives
 *    it the fetch transport with `credentials: 'include'`, framed or not;
 *  - top-level with a `queryUrl` in its island: the fetch transport over that url, with the session
 *    when the page is signed in;
 *  - inside a parent window: the same url anonymously. A sandboxed copy's origin is opaque and carries
 *    no credential, so it fetches what anyone may — the parent page no longer relays its queries
 *    (documents that need their reader's session are framed on their own origin instead);
 *  - no `queryUrl`: no transport — values still change, tables stay as rendered.
 *
 * Pure over a window-shaped argument so it is testable without a browser.
 */
import { createFetchTransport, type FetchLike, type FetchTransportOptions } from '@/lib/story-runtime/fetch-transport';
import type { QueryTransport } from '@/lib/story-runtime/store';

interface DocumentWindow {
  parent: unknown;
  self?: unknown;
}

export function createDocumentTransport(
  win: DocumentWindow,
  queryUrl: string | undefined,
  fetchFn: FetchLike | undefined,
  mutateUrl: string | undefined,
  options: FetchTransportOptions = {},
): QueryTransport | null {
  if (!queryUrl) return null;
  const parent = win.parent;
  return createFetchTransport(queryUrl, fetchFn, mutateUrl, parent && parent !== win && parent !== win.self ? {} : options);
}
