/**
 * The page's one local-state document for this viewer, and its two faces: the StatePort `@afbin/apollo`'s client reads
 * and the Zustand store `@afbin/state` exports. Exactly one per page (./browser-state owns the call): a second port over
 * the same storage would not see this tab's own writes.
 *
 * The state block (or the runtime config's initialState) is the defaults; this viewer's saved overrides merge over
 * them (./viewer-overrides); `data-af-state-version` clears those once when it changes; an `#af-state=` address
 * replaces them. The comment view (./comment-view) snapshots and restores the same port.
 * Offline and exported copies run this too: their runtime block's page id (`local:<path>` when none) keys their own
 * origin's storage, so a downloaded file keeps its viewer's state like the hosted page, separately from it.
 */
import type { HtmlJsonObject } from '@artifactbin/contracts';
import type { StoreReceipt } from './apollo/apollo-contracts';
import { readStateFragment } from './apollo/state-url';
import { commentViewDeclaration, createHtmlCommentView } from './comment-view';
import { installHtmlCommentView } from '../html-bridge/comment-view-session';
import { createStateStore, type PageStore } from './state-store';
import { createViewerState } from './viewer-state';
import type { ViewerStatePort } from './viewer-state-contract';

export interface PageStateOptions {
  pageId: string;
  /** The page's defaults. */
  initial: HtmlJsonObject;
  /** The page's state version (`data-af-state-version`), when it declares a valid one. */
  version?: string | null;
  /** The page revision this load runs (config.revision): fences an older open version off a newer one's saved state. */
  revision?: string | null;
  /** The page address's fragment (`#af-state=` seeds the document). */
  hash: string;
  backends: readonly string[];
  /** The state block's attributes (its comment view declaration); null when the page has none. */
  stateBlock?: { getAttribute(name: string): string | null } | null;
  /** Where the comment view is installed (the document). */
  owner: object;
  storage: { getItem(key: string): string | null; setItem(key: string, value: string): void };
  /** `storage` events from this viewer's other tabs. */
  onStorage(listener: (key: string | null) => void): () => void;
  /** Navigator Locks: serializes compare-and-swap across this viewer's tabs. */
  lock?: (name: string, work: () => Promise<StoreReceipt>) => Promise<StoreReceipt>;
}
export interface PageState { port: ViewerStatePort; state: PageStore; dispose(): void }

export function createPageState(options: PageStateOptions): PageState {
  // The overrides live under their own key. The legacy key holds the full document older runtimes read and write (tabs
  // open across a deploy still do): it is only ever read, to migrate (./viewer-overrides).
  const key = `af:viewer:v2:${options.pageId}`, legacyKey = `af:viewer:${options.pageId}`;
  const carried = readStateFragment(options.hash);
  const port = createViewerState({
    defaults: options.initial, version: options.version ?? null, revision: options.revision ?? null, ...(carried.state ? { seed: carried.state } : {}),
    storage: { read: () => options.storage.getItem(key), write: (json) => options.storage.setItem(key, json) },
    legacy: () => options.storage.getItem(legacyKey),
    observe: (listener) => options.onStorage((changed) => { if (changed === key) listener(); }),
    ...(options.lock ? { lock: (work: () => Promise<StoreReceipt>) => options.lock!(key, work) } : {}),
  });
  // Saved comment views: the authored state block's fields. An invalid list saves nothing.
  const block = options.stateBlock;
  try {
    const declaration = block ? commentViewDeclaration({ initial: options.initial, attribute: (name) => block.getAttribute(name) }, options.backends) : undefined;
    installHtmlCommentView(options.owner, declaration && createHtmlCommentView({ state: port, backends: options.backends, declaration }));
  } catch {
    installHtmlCommentView(options.owner, { capture() { throw new Error('Invalid comment view declaration'); }, async restore() { throw new Error('Invalid comment view declaration'); } });
  }
  return { port, state: createStateStore(port, { initial: options.initial, name: key }), dispose: () => port.dispose() };
}
