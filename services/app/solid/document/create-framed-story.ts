
import { createEffect, createSignal, on, onCleanup, type Accessor } from 'solid-js';
import { createFrameBridgeParent, type FrameBridgeParent } from '@/lib/html-reader/frame-bridge/parent';
import { withUrlValuesOf } from '@/lib/dataflow/url-values';
import { STORY_FRAME_BRIDGE_MESSAGE, type IslandStoryController } from '@/lib/html-reader/contract';

// The frame's light helpers live in ./frame-src, which the document page and the consent bar import without this module.
import { framedDocumentFor, freshFrameSrc, DOCUMENT_FRAME_SELECTOR, type FramedDocument } from './frame-src';
export { framedDocumentFor, freshFrameSrc, DOCUMENT_FRAME_SELECTOR };

/** Grace after a reloaded document's load event for its first message (its door normally says `hello` before it). */
const FRAME_HELLO_MS = 3_000;
/** At most this many fresh tickets per window: a document that stays unreachable is left as it is. */
const FRAME_REMINTS = 2;
const FRAME_REMINT_WINDOW_MS = 5 * 60_000;

interface FrameSessionOptions {
  win: Window;
  frame: HTMLIFrameElement;
  /** The document's own origin: the only one its messages count from. */
  origin: string;
  id: string;
  /** A fresh first URL (a new ticket); null when the app refuses one. */
  remint?: (id: string) => Promise<string | null>;
  /** Whether this page can read the frame's document — it is on the app's own origin, off the document's. */
  readable?: (frame: HTMLIFrameElement) => boolean;
}

const sameOriginAsPage = (frame: HTMLIFrameElement): boolean => {
  try { return Boolean(frame.contentWindow?.location.href); } catch { return false; }
};

/**
 * KEEP THE FRAME ON ITS DOCUMENT. The frame's session on the document's origin (server/pages-host) lasts 8 h; a tab
 * left open longer that reloads its frame — a new version it cannot morph to, a reload keeping its place — gets the
 * document origin's bare "Not found", or, behind a proxy, a redirect onto the app's own origin, where every message
 * this page posts to the document's origin goes nowhere. Every framed document's door says `hello` as it opens
 * (lib/islands/frame-door), before its load event; so a frame that reloads and stays silent, or whose document this
 * page can read (it is on the app's origin), is pointed at a fresh first URL — a new ticket, minted by the app
 * session (`freshFrameSrc`) — and the bridge re-attaches on the new document's hello (frame-bridge/parent). Only a
 * document that has spoken before is second-guessed, and only FRAME_REMINTS times per window: it never loops.
 * Returns the stop.
 */
export function keepFrameSession(options: FrameSessionOptions): () => void {
  const { win, frame, origin, id } = options;
  const remint = options.remint ?? ((documentId: string) => freshFrameSrc(documentId));
  const readable = options.readable ?? sameOriginAsPage;
  let spoke = false;
  let lastHello = -Infinity;
  let lastMessage = -Infinity;
  /** The frame's last load event: a hello after it belongs to the document that loaded next. */
  let previousLoad = -Infinity;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let reminting = false;
  let stopped = false;
  const remints: number[] = [];

  const recover = async () => {
    const now = Date.now();
    while (remints.length && now - remints[0]! > FRAME_REMINT_WINDOW_MS) remints.shift();
    if (reminting || stopped || remints.length >= FRAME_REMINTS) return;
    remints.push(now);
    reminting = true;
    try {
      const src = await remint(id);
      if (src && !stopped) frame.src = src;
    } finally { reminting = false; }
  };
  const onMessage = (event: MessageEvent) => {
    if (event.source !== frame.contentWindow || event.origin !== origin) return;
    spoke = true;
    lastMessage = Date.now();
    const data = event.data as { type?: unknown; payload?: { kind?: unknown } } | null;
    // `ready` answers an attach to this document's door, so it proves the door opened just as `hello` does — and it
    // still arrives when this watchdog started (lazily) after the door's hello, which would otherwise make the served
    // document's own first load look like a silent reload and re-navigate the frame, re-sending every query.
    const kind = data && typeof data === 'object' && data.type === STORY_FRAME_BRIDGE_MESSAGE ? data.payload?.kind : undefined;
    if (kind === 'hello' || kind === 'ready') lastHello = lastMessage;
  };
  const onLoad = () => {
    clearTimeout(timer);
    if (readable(frame)) { void recover(); return; }
    const loadedAt = Date.now();
    const before = previousLoad;
    previousLoad = loadedAt;
    if (!spoke) return;
    // The new document's door says hello as it opens — before its load event, which waits for every image — or, at
    // the latest, it speaks within the grace period after it.
    timer = setTimeout(() => {
      if (lastHello > before || lastMessage > loadedAt) return;
      void recover();
    }, FRAME_HELLO_MS);
  };
  win.addEventListener('message', onMessage);
  frame.addEventListener('load', onLoad);
  return () => {
    stopped = true;
    clearTimeout(timer);
    win.removeEventListener('message', onMessage);
    frame.removeEventListener('load', onLoad);
  };
}

/**
 * The framed document's link moved (lib/islands/url-sync → STORY_URL_VALUES_MESSAGE): this page's address takes
 * exactly its `$` params — the path, the hash and every other param kept, replaced rather than pushed — so the
 * address bar, a copied link and a reload carry the reader's selection (the server forwards the page's `$` params
 * into the frame's first URL, lib/document-serving/artifact-page).
 */
export function followFramedValues(win: Window, values: string): void {
  const { pathname, search, hash } = win.location;
  const next = withUrlValuesOf(search, values);
  if (next === search) return;
  win.history.replaceState(win.history.state, '', `${pathname}${next}${hash}`);
}

/**
 * The framed document's node tree (the page's NODES door, `?part=nodes`): a request of its own because the page draws nothing
 * from it — it is only relayed to the frame's edit controller — and on a large document it is most of the page's bytes.
 * `search` carries an archived version's `?version=N`, so the tree is that version's. A restart is ridden out by the shared
 * policy (lib/http/retry-lazily); a refusal is not. Null when it never arrives: the frame then has no edit controller, and says so nowhere.
 */
interface FramedStoryOptions {
  id: string;
  framed: FramedDocument;
  /** The head pointer drafts are previewed against, and the source the editor opened on (read live; sent on change). */
  editId: () => string;
  source: () => string | null;
  /** Trusted saved HTML revision and archive policy from the platform bootstrap. */
  htmlContext?: Parameters<typeof createFrameBridgeParent>[0]['htmlContext'];

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
  /** The bars' reach over the frame's top edge, kept for a bridge made after it was set. */
  let inset = 0;
  const start = () => {
    const bridge = createFrameBridgeParent({
      win: window, frame, frameOrigin: origin, id: options.id,
      editId: options.editId, source: options.source, htmlContext: options.htmlContext,
      onReady: (next) => setNonce(next || null),
      onClosed: (reason) => { if (reason !== 'disposed') console.warn(`[frame-bridge] ${reason}`); },
      onUrlValues: (values) => followFramedValues(window, values),
    });
    setCurrent(bridge);
    if (inset) bridge.setTopInset(inset);
    if(options.htmlContext)createEffect(()=>{options.htmlContext!();bridge.refreshUploadContext();});
    createEffect(on([options.editId, options.source], ([editId, source]) => bridge.setContext(editId, source), { defer: true }));

  };
  // A frame whose session ran out (or that a redirect took off its origin) gets a fresh ticket (keepFrameSession).
  onCleanup(keepFrameSession({ win: window, frame, origin, id: options.id }));
  start();
  onCleanup(() => {
    const bridge = current();
    setCurrent(null);
    setNonce(null);
    bridge?.dispose();
  });
  return {
    controller: current, nonce, frame,
    setTopInset: (px) => { inset = px; current()?.setTopInset(px); },

  };
}
