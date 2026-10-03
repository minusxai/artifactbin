/**
 * THE FRAMED DOCUMENT'S MOUNT — the document page's one way to hold its document.
 *
 * The document runs in an iframe on its own origin (APP__PAGES_HOST, lib/serving/pages-origin); this page reaches it
 * only through the bridge (lib/story-runtime/frame-bridge/parent). It answers `{ controller, nonce }`, so the page's
 * runtimeRef, edit lifecycle, annotation layer, selection actions and editor use the bridge's stand-in for the
 * document's controller. `nonce` stays null until the frame's controller runs (and again while a reloaded frame's
 * new controller starts).
 *
 * THE FRAME CONDITION is `framedDocumentFor`: the server drew one frame into the page (lib/serving/document-frame,
 * `iframe[data-mx-document-frame]`) and named the document's own origin in the page data (`surface.framedOrigin`).
 * The frame is the server's — it may have loaded before this code ran — so this adopts it and never draws or removes
 * one; the page owns its layout.
 */
import { createEffect, createSignal, on, onCleanup, type Accessor } from 'solid-js';
import type { JsxNode } from '@/lib/jsx/types';
import { createFrameBridgeParent, type FrameBridgeParent } from '@/lib/story-runtime/frame-bridge/parent';
import type { IslandStoryController } from '@/lib/story-runtime/island-controller';

/** The served frame a consent grant reloads (brief C's CspConsentBar) and the bridge attaches to. */
export const DOCUMENT_FRAME_SELECTOR = 'iframe[data-mx-document-frame]';

/** The framed document: the server's frame, and the origin its messages must come from. */
export interface FramedDocument { frame: HTMLIFrameElement; origin: string }

/** The frame condition: the served story is one frame on the document's own origin, or the page holds the story itself. */
export function framedDocumentFor(story: HTMLElement, framedOrigin: string | null | undefined): FramedDocument | null {
  const frame = story.querySelector<HTMLIFrameElement>(DOCUMENT_FRAME_SELECTOR);
  return frame && framedOrigin ? { frame, origin: framedOrigin } : null;
}

/**
 * A fresh first URL for the document's frame (app/api/page/frame/[id]): a new one-time ticket carrying what only
 * this origin knows — the reader's "Allow once" grants (lib/trust/document-trust carriedTrust) — and the page's
 * `$` values. The served `src` cannot be reused: its ticket is spent.
 */
export async function freshFrameSrc(id: string, search = typeof window === 'undefined' ? '' : window.location.search): Promise<string | null> {
  try {
    const response = await fetch(`/api/page/frame/${encodeURIComponent(id)}${search}`, { credentials: 'same-origin', cache: 'no-store' });
    if (!response.ok) return null;
    const answer = await response.json() as { src?: unknown };
    return typeof answer.src === 'string' ? answer.src : null;
  } catch { return null; }
}

export interface FramedStoryOptions {
  id: string;
  framed: FramedDocument;
  /** The version's SOURCE nodes, which comments and selections are classified against. */
  nodes: JsxNode[];
  /** The head pointer drafts are previewed against, and the source the editor opened on (read live; sent on change). */
  editId: () => string;
  source: () => string | null;
}

export interface FramedStory {
  /** The bridge's stand-in for the document's controller: the page's runtimeRef, edit lifecycle, annotation layer and editor use it. */
  controller: Accessor<IslandStoryController | null>;
  /** The frame controller's secret, once it runs (null again while a reloaded frame's new controller starts). */
  nonce: Accessor<string | null>;
  frame: HTMLIFrameElement;
  /** How far the page's bars reach over the frame's top edge: the document reserves it without moving (bridge `inset`). */
  setTopInset(px: number): void;
}

export function createFramedStory(options: FramedStoryOptions): FramedStory {
  const { frame, origin } = options.framed;
  const [nonce, setNonce] = createSignal<string | null>(null);
  const [current, setCurrent] = createSignal<FrameBridgeParent | null>(null);
  const bridge = createFrameBridgeParent({
    win: window, frame, frameOrigin: origin, id: options.id, nodes: options.nodes,
    editId: options.editId, source: options.source,
    onReady: (next) => setNonce(next || null),
    onClosed: (reason) => { if (reason !== 'disposed') console.warn(`[frame-bridge] ${reason}`); },
  });
  setCurrent(bridge);
  createEffect(on([options.editId, options.source], ([editId, source]) => bridge.setContext(editId, source), { defer: true }));
  onCleanup(() => {
    setCurrent(null);
    setNonce(null);
    bridge.dispose();
  });
  return { controller: current, nonce, frame, setTopInset: (px) => bridge.setTopInset(px) };
}
