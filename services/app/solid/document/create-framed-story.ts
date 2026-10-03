/**
 * THE FRAMED DOCUMENT'S MOUNT — create-island-story's twin for a document the app page FRAMES instead of adopting.
 *
 * The document runs in an iframe on its own origin; this page reaches it only through the bridge
 * (lib/story-runtime/frame-bridge/parent). It answers the same `{ controller, nonce }` as createIslandStory, so the
 * page's runtimeRef, edit lifecycle, annotation layer, selection actions and editor use the bridge's stand-in
 * exactly where they use the in-page controller. `nonce` stays null until the frame's controller runs.
 *
 * THE FRAME CONDITION is `framedDocumentFor`, the one place it is decided. Until documents are served on their own
 * origin (brief A: `APP__PAGES_HOST`, lib/serving/pages-origin `pagesOriginFor`), it is the development flag
 * `?mx-frame-edit=1`, which frames the sandboxed `/a/<id>/raw` copy (origin `'null'`). Brief A replaces the body:
 * `{ src: pagesOriginFor(id) + '/', origin: pagesOriginFor(id) }` when the pages host is configured.
 */
import { createEffect, createSignal, on, onCleanup } from 'solid-js';
import type { JsxNode } from '@/lib/jsx/types';
import { createFrameBridgeParent, type FrameBridgeParent } from '@/lib/story-runtime/frame-bridge/parent';
import type { IslandStory } from './create-island-story';

/** The development flag that frames `/a/<id>/raw` on the app page. */
export const FRAME_EDIT_PARAM = 'mx-frame-edit';

/** Where a framed document is loaded from, and the origin its messages must come from. */
export interface FramedDocument { src: string; origin: string }

/** The frame condition: whether (and where) the app page frames this document rather than adopting its story. */
export function framedDocumentFor(id: string, href: string): FramedDocument | null {
  const url = new URL(href);
  if (url.searchParams.get(FRAME_EDIT_PARAM) !== '1') return null;
  url.searchParams.delete(FRAME_EDIT_PARAM);
  return { src: `/a/${encodeURIComponent(id)}/raw${url.search}${url.hash}`, origin: 'null' };
}

export interface FramedStoryOptions {
  id: string;
  host: HTMLElement;
  frame: FramedDocument;
  /** The version's SOURCE nodes, which comments and selections are classified against. */
  nodes: JsxNode[];
  /** The head pointer drafts are previewed against, and the source the editor opened on (read live; sent on change). */
  editId: () => string;
  source: () => string | null;
  /** The frame's CSS height: the viewport below the page's bars. */
  height: () => string;
}

export interface FramedStory extends IslandStory {
  frame: HTMLIFrameElement;
}

export function createFramedStory(options: FramedStoryOptions): FramedStory {
  const iframe = document.createElement('iframe');
  iframe.title = 'Document';
  iframe.src = options.frame.src;
  Object.assign(iframe.style, { display: 'block', width: '100%', border: '0' });
  createEffect(() => { iframe.style.height = options.height(); });
  const [nonce, setNonce] = createSignal<string | null>(null);
  const [current, setCurrent] = createSignal<FrameBridgeParent | null>(null);
  const bridge = createFrameBridgeParent({
    win: window, frame: iframe, frameOrigin: options.frame.origin, id: options.id, nodes: options.nodes,
    editId: options.editId, source: options.source,
    onReady: setNonce,
    onClosed: (reason) => { if (reason !== 'disposed') console.warn(`[frame-bridge] ${reason}`); },
  });
  setCurrent(bridge);
  // Listening before the frame loads: its door's hello (or its load) attaches.
  options.host.append(iframe);
  createEffect(on([options.editId, options.source], ([editId, source]) => bridge.setContext(editId, source), { defer: true }));
  onCleanup(() => {
    setCurrent(null);
    setNonce(null);
    bridge.dispose();
    iframe.remove();
  });
  return { controller: current, nonce, frame: iframe };
}
