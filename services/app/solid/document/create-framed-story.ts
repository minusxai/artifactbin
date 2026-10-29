/**
 * THE FRAMED DOCUMENT'S MOUNT — the document page's one way to hold its document.
 *
 * The document runs in an iframe on its own origin (APP__PAGES_HOST, lib/http/pages-origin); this page reaches it
 * only through the bridge (lib/story-runtime/frame-bridge/parent). It answers `{ controller, nonce }`, so the page's
 * runtimeRef, edit lifecycle, annotation layer, selection actions and editor use the bridge's stand-in for the
 * document's controller. `nonce` stays null until the frame's controller runs (and again while a reloaded frame's
 * new controller starts).
 *
 * THE FRAME CONDITION is `framedDocumentFor`: the server drew one frame into the page (lib/document-serving/document-frame,
 * `iframe[data-mx-document-frame]`) and named the document's own origin in the page data (`surface.framedOrigin`).
 * The frame is the server's — it may have loaded before this code ran — so this adopts it and never draws or removes
 * one; the page owns its layout.
 */
import { createEffect, createSignal, getOwner, on, onCleanup, runWithOwner, type Accessor } from 'solid-js';
import type { JsxNode } from '@/lib/jsx/types';
import { retryingFetch } from '@/lib/http/retry-lazily';
import { createFrameBridgeParent, type FrameBridgeParent } from '@/lib/story-runtime/frame-bridge/parent';
import { withUrlValuesOf } from '@/lib/dataflow/url-values';
import { STORY_DOCUMENT_MESSAGE, STORY_FRAME_BRIDGE_MESSAGE, type IslandStoryController } from '@/lib/story-runtime/contract';

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
export async function fetchFrameNodes(id: string, search: string, signal?: AbortSignal): Promise<JsxNode[] | null> {
  const version = new URLSearchParams(search).get('version');
  const url = `/api/page/artifact/${encodeURIComponent(id)}?part=nodes${version ? `&version=${encodeURIComponent(version)}` : ''}`;
  try {
    const response = await retryingFetch(url, { credentials: 'same-origin', signal });
    if (!response.ok) return null;
    const part = await response.json() as { nodes?: unknown };
    return Array.isArray(part.nodes) ? part.nodes as JsxNode[] : null;
  } catch { return null; }
}

/**
 * The reader's first press into the framed document (a click, a tap, a selection starting there): all a page sees of a
 * frame on another origin is its own window losing focus to that frame. `act` runs once; the returned stop drops it.
 */
export function onFirstPressInto(frame: HTMLIFrameElement, act: () => void): () => void {
  const win = frame.ownerDocument.defaultView ?? window;
  let timer = 0;
  const stop = () => { win.removeEventListener('blur', onBlur); win.clearTimeout(timer); };
  // Where the focus went is settled a task after the window's blur in every browser.
  const onBlur = () => {
    win.clearTimeout(timer);
    timer = win.setTimeout(() => { if (frame.ownerDocument.activeElement === frame) { stop(); act(); } }, 0);
  };
  win.addEventListener('blur', onBlur);
  return stop;
}

interface FramedStoryOptions {
  id: string;
  framed: FramedDocument;
  /**
   * The version's SOURCE nodes, which comments and selections are classified against: at hand, or on their way
   * (fetchFrameNodes). The bridge attaches to the frame when they are here; until then the controller is null and
   * nothing the page draws waits (the frame draws itself), and one that never arrives leaves the bridge unmade.
   * `[]` for a reader the page gives no selection action yet: the bridge attaches at once without the tree (reading,
   * the mode pick and the `$` values need none of it), and `attachTree` brings it when an action can use it.
   */
  nodes: JsxNode[] | Promise<JsxNode[] | null>;
  /**
   * A bridge made without the tree: the frame reports the reader's first press, touch, key or selection in the
   * document (contract `pressed`), which a page that can use the tree answers with `attachTree`.
   */
  onPressed?: () => void;
  /** The head pointer drafts are previewed against, and the source the editor opened on (read live; sent on change). */
  editId: () => string;
  source: () => string | null;
  /** Trusted saved HTML revision and archive policy from the platform bootstrap. */
  htmlContext?: Parameters<typeof createFrameBridgeParent>[0]['htmlContext'];
  /**
   * The newest saved version the page's own stream delivered (createLiveArtifact's frame), and whether the page is
   * reading. The framed document draws that version itself, from its own stream; only its NODES — which comments,
   * the selection bubble and the document menu are classified against — come from here. Without them every path
   * the new version moved describes the first version's node, and the document's selection actions fall silent.
   */
  version?: Accessor<{ editId: string; nodes?: JsxNode[] } | null>;
  reading?: Accessor<boolean>;
}

export interface FramedStory {
  /** The bridge's stand-in for the document's controller: the page's runtimeRef, edit lifecycle, annotation layer and editor use it. */
  controller: Accessor<IslandStoryController | null>;
  /** The frame controller's secret, once it runs (null again while a reloaded frame's new controller starts). */
  nonce: Accessor<string | null>;
  frame: HTMLIFrameElement;
  /** How far the page's bars reach over the frame's top edge: the document reserves it without moving (bridge `inset`). */
  setTopInset(px: number): void;
  /**
   * The tree for a bridge made without one (`nodes: []`), asked for once: when it arrives it goes to the running
   * frame controller (bridge `setNodes`) — the same session, so a selection the reader made while it was on its way
   * is described again and gets its bubble. Ignored for a bridge given its tree, and for one that never arrives.
   */
  attachTree(nodes: Promise<JsxNode[] | null>): void;
}

export function createFramedStory(options: FramedStoryOptions): FramedStory {
  const { frame, origin } = options.framed;
  const [nonce, setNonce] = createSignal<string | null>(null);
  const [current, setCurrent] = createSignal<FrameBridgeParent | null>(null);
  const owner = getOwner();
  let disposed = false;
  /** The bars' reach over the frame's top edge, kept for a bridge made after it was set. */
  let inset = 0;
  /** The bridge was made without the tree, and it has not been asked for yet. */
  let bare = Array.isArray(options.nodes) && options.nodes.length === 0;
  const start = (nodes: JsxNode[]) => {
    if (disposed || current()) return;
    const bridge = createFrameBridgeParent({
      win: window, frame, frameOrigin: origin, id: options.id, nodes,
      editId: options.editId, source: options.source, htmlContext: options.htmlContext,
      onReady: (next) => setNonce(next || null),
      onClosed: (reason) => { if (reason !== 'disposed') console.warn(`[frame-bridge] ${reason}`); },
      onUrlValues: (values) => followFramedValues(window, values),
      onPressed: () => { if (bare) options.onPressed?.(); },
    });
    setCurrent(bridge);
    if (inset) bridge.setTopInset(inset);
    if(options.htmlContext)createEffect(()=>{options.htmlContext!();bridge.refreshUploadContext();});
    createEffect(on([options.editId, options.source], ([editId, source]) => bridge.setContext(editId, source), { defer: true }));
    // Each saved version once, while reading: the editor's drafts (and Done's return to reading) draw their own.
    let forwarded: string | null = null;
    createEffect(() => {
      const version = options.version?.();
      if (!version?.nodes || !(options.reading?.() ?? true) || version.editId === forwarded) return;
      forwarded = version.editId;
      bridge.update({ type: STORY_DOCUMENT_MESSAGE, nodes: version.nodes });
    });
  };
  // A frame whose session ran out (or that a redirect took off its origin) gets a fresh ticket (keepFrameSession).
  onCleanup(keepFrameSession({ win: window, frame, origin, id: options.id }));
  if (Array.isArray(options.nodes)) start(options.nodes);
  else void options.nodes.then((nodes) => { if (nodes && !disposed) runWithOwner(owner, () => start(nodes)); });
  onCleanup(() => {
    disposed = true;
    const bridge = current();
    setCurrent(null);
    setNonce(null);
    bridge?.dispose();
  });
  return {
    controller: current, nonce, frame,
    setTopInset: (px) => { inset = px; current()?.setTopInset(px); },
    attachTree: (nodes) => {
      if (!bare || disposed) return;
      bare = false;
      void nodes.then((tree) => { if (tree && !disposed) current()?.setNodes(tree); });
    },
  };
}
