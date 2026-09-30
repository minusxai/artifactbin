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
 *
 * This module never imports the relay itself: a static import would put it in every
 * bundle that selects a transport, including the reader's first load. The caller
 * names the relay module — `eager` (a function it already holds) or `lazy` (a dynamic
 * import, fetched on the first framed request) — so the bundle it lands in is its choice.
 */
import { createFetchTransport, type FetchLike, type FetchTransportOptions } from './fetch-transport';
import type { QueryTransport } from './store';

type RelayFactory = (parent: Window, appOrigin: string, win: Window) => QueryTransport;

export type RelayMode = { eager: RelayFactory } | { lazy: () => Promise<RelayFactory> };

export interface DocumentTransportOptions extends FetchTransportOptions {
  relay: RelayMode;
}

interface DocumentWindow {
  parent: unknown;
  self?: unknown;
  addEventListener: Window['addEventListener'];
}

export function createDocumentTransport(
  win: DocumentWindow,
  queryUrl: string | undefined,
  appOrigin: string,
  fetchFn: FetchLike | undefined,
  mutateUrl: string | undefined,
  /** `relay` picks how the framed relay loads; the rest is for the top-level fetch transport only (the relay's page holds its own session). */
  { relay, ...options }: DocumentTransportOptions,
): QueryTransport | null {
  const parent = win.parent;
  if (parent && parent !== win && parent !== win.self) {
    const frame = parent as Window;
    const self = win as unknown as Window;
    if ('eager' in relay) return relay.eager(frame, appOrigin, self);
    // The framed reader retains the parent's session. It can wait for the relay module on its first
    // request; all requests share one instance and its message listeners.
    const loaded = relay.lazy().then((create) => create(frame, appOrigin, self));
    // A held public import is fetched through the document's scoped POST door; query and write calls stay relayed.
    const held = queryUrl ? createFetchTransport(queryUrl) : null;
    return {
      ...(held?.hold ? { hold: held.hold } : {}),
      run: async (...args) => (await loaded).run(...args),
      page: async (...args) => (await loaded).page(...args),
      mutate: async (...args) => (await loaded).mutate!(...args),
      importAsset: async (...args) => (await loaded).importAsset!(...args),
    };
  }
  if (queryUrl) return createFetchTransport(queryUrl, fetchFn, mutateUrl, options);
  return null;
}
