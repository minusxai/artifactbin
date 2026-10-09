/**
 * THE PARENT HALF OF THE BRIDGE — a stand-in for the island controller, for a document framed on its own origin.
 *
 * The app page uses this exactly where it uses the in-page controller (solid/document/create-island-story):
 * `runtimeRef.current`, the edit lifecycle's `restored()`, the annotation layer's `getViewportRect()`. Commands go
 * to the frame's controller (./frame) over postMessage; its events come back to `subscribe`rs unchanged, so the
 * editor, the comment layer and the selection actions keep checking the session nonce exactly as before.
 *
 * Trust, in both directions (lib/story-runtime/contract, THE FRAME BRIDGE):
 *  · the page mints `key` in its own realm and sends it only in envelopes addressed to the frame's origin; every
 *    envelope from the frame must carry it, come from THIS iframe's window and from `frameOrigin`;
 *  · the frame may load before this page's code runs (the app page server-renders it, brief A): the stand-in sends
 *    `attach` at once, again on the door's `hello` and on the frame's `load` (the door ignores a key it holds), and
 *    keeps every command until the frame's controller answers `ready` — so a door that opened first, or late, gets
 *    the same session in the same order;
 *  · a document on its own origin that loads again (a consent grant, a live reload) is re-attached under a fresh
 *    key: the origin check still tells it apart. `'null'` (a sandboxed `/a/<id>/raw` copy) cannot be addressed, so
 *    it is posted to `*`, and its second `load` closes the bridge for good rather than re-attach to a document
 *    whose origin cannot be told apart;
 *  · the frame may ask the page to make exactly three requests for this document (IslandControllerInput.appFetch):
 *    `GET|POST /a/<id>/draft-preview` and `GET /a/<id>/story` — nothing else, never another document's;
 *  · the document's link follower (lib/islands/url-sync) tells the page what its address's `$` params should say
 *    (STORY_URL_VALUES_MESSAGE): taken from this frame's window and origin only, outside any session (the author's
 *    script moves every value anyway), as a bounded query string with no hash — the page keeps only its `$` pairs.
 */
import type { JsxNode } from '@/lib/jsx/types';
import { runtimeId } from '@artifactbin/utils/runtime-id';
import { storyFragmentPath } from '@/lib/story-runtime/story-fragment';
import {
  STORY_DATA_MESSAGE, STORY_FRAME_BRIDGE_MESSAGE, STORY_URL_VALUES_MESSAGE, isFrameBridgeEnvelope,
  type FrameBridgeFramePayload, type FrameBridgeParentPayload, type IslandStoryController, type StoryDocumentUpdate,
} from '@/lib/story-runtime/contract';

export interface FrameBridgeParentOptions {
  win: Window;
  frame: HTMLIFrameElement;
  /** The framed document's origin: its pages origin, or `'null'` for the sandboxed `/raw` copy (development). */
  frameOrigin: string;
  id: string;
  /** The version's source nodes (createIslandController `nodes`). */
  nodes: JsxNode[];
  /** Read when attaching; later values go out through `setContext`. */
  editId: () => string;
  source: () => string | null;
  /** How the page makes a relayed request (default: its own same-origin fetch, with its session). */
  appFetch?: (path: string, init: RequestInit) => Promise<Response>;
  /** The frame's controller runs and signs its events with `nonce` ('' while a reloaded frame's new controller starts). */
  onReady?: (nonce: string) => void;
  /** The framed document scrolled. */
  onScroll?: (scroll: { x: number; y: number }) => void;
  /** The bridge closed itself (the frame navigated away, or reported it cannot run the editor). */
  onClosed?: (reason: string) => void;
  /** The document's link moved: `search` is what the page's address's `$` params should now say (`''` at rest). */
  onUrlValues?: (search: string) => void;
}

export interface FrameBridgeParent extends IslandStoryController {
  /** The editor's newer head pointer and source, which the frame's controller reads live. */
  setContext(editId: string, source: string | null): void;
  /**
   * How far the page's bars reach over the frame's top edge (contract `inset`). Kept, and sent again to every
   * controller that starts (a document that loads anew starts with none reserved).
   */
  setTopInset(px: number): void;
}

/** The longest `$` query a document may hand the page's address. */
const MAX_URL_VALUES = 8192;

/** A document's `$` params as the page will take them (STORY_URL_VALUES_MESSAGE), or null: a bounded query, no hash or space. */
export function urlValuesOf(data: unknown): string | null {
  if (!data || typeof data !== 'object') return null;
  const { type, search } = data as { type?: unknown; search?: unknown };
  if (type !== STORY_URL_VALUES_MESSAGE || typeof search !== 'string' || search.length > MAX_URL_VALUES) return null;
  return /^\??[^#\s]*$/.test(search) ? search : null;
}

/** The response headers a relayed answer keeps: what the controller reads. */
const KEPT_HEADERS = ['content-type', 'retry-after'];
/** The request headers a relayed request may carry. */
const SENT_HEADERS = ['content-type', 'x-draft-sequence'];

const sameOriginFetch = (win: Window) => (path: string, init: RequestInit): Promise<Response> =>
  win.fetch(path, { ...init, credentials: 'same-origin', cache: 'no-store' });

/** The relayed request, checked: one of this document's three paths, on the page's own origin, or null. */
export function relayedRequest(win: Window, id: string, request: { path: unknown; method: unknown; headers: unknown; body: unknown }): { path: string; init: RequestInit } | null {
  if (typeof request.path !== 'string' || (request.method !== 'GET' && request.method !== 'POST')) return null;
  let url: URL;
  try { url = new URL(request.path, win.location.origin); } catch { return null; }
  if (url.origin !== win.location.origin) return null;
  const draft = `/a/${encodeURIComponent(id)}/draft-preview`;
  const allowed = url.pathname === draft || (url.pathname === storyFragmentPath(id) && request.method === 'GET');
  if (!allowed) return null;
  const headers: Record<string, string> = {};
  if (request.headers && typeof request.headers === 'object') {
    for (const [name, value] of Object.entries(request.headers as Record<string, unknown>)) {
      if (SENT_HEADERS.includes(name.toLowerCase()) && typeof value === 'string') headers[name] = value;
    }
  }
  const body = request.method === 'POST' && typeof request.body === 'string' ? request.body : undefined;
  return { path: url.pathname + url.search, init: { method: request.method, headers, ...(body !== undefined ? { body } : {}) } };
}

export function createFrameBridgeParent(options: FrameBridgeParentOptions): FrameBridgeParent {
  const { win, frame, frameOrigin, id } = options;
  const appFetch = options.appFetch ?? sameOriginFetch(win);
  const target = frameOrigin === 'null' ? '*' : frameOrigin;
  let key = runtimeId();
  let nonce = '';
  /** The frame's controller answered `ready` under the current key: commands go straight out. */
  let attached = false;
  let closed = false;
  let loads = 0;
  /** Commands the page sent before the frame's controller ran: posted on `ready`, in order. */
  const backlog: FrameBridgeParentPayload[] = [];
  const listeners = new Set<(event: unknown) => void>();
  let restoredCalls = 0;
  /** The page's bars over the frame's top edge (setTopInset): every new frame controller is told on `ready`. */
  let inset = 0;
  const restoring = new Map<number, { resolve: () => void; reject: (error: unknown) => void }>();

  const envelope = (payload: FrameBridgeParentPayload) => {
    try { frame.contentWindow?.postMessage({ type: STORY_FRAME_BRIDGE_MESSAGE, key, payload }, target); } catch { /* the frame went away */ }
  };
  const post = (payload: FrameBridgeParentPayload) => {
    if (closed) return;
    if (!attached) { backlog.push(payload); return; }
    envelope(payload);
  };
  /** (Re)send this session's attach: the door starts the frame half on the first one and ignores a key it holds. */
  const attach = () => {
    if (attached || closed || !frame.contentWindow) return;
    envelope({ kind: 'attach', id, nodes: options.nodes, editId: options.editId(), source: options.source() });
  };
  const reject = (reason: string) => {
    for (const waiting of restoring.values()) waiting.reject(new Error(`the framed document closed (${reason})`));
    restoring.clear();
  };
  /** A new document in the frame: its controller is gone, so a new session starts under a fresh key. */
  const reattach = () => {
    reject('the framed document loaded again');
    key = runtimeId();
    nonce = '';
    attached = false;
    // What the page sent to the old document's controller does not carry over to the new one's.
    backlog.length = 0;
    options.onReady?.('');
    attach();
  };
  const close = (reason: string) => {
    if (closed) return;
    try { frame.contentWindow?.postMessage({ type: STORY_FRAME_BRIDGE_MESSAGE, key, payload: { kind: 'detach' } }, target); } catch { /* gone */ }
    closed = true;
    key = '';
    reject(reason);
    options.onClosed?.(reason);
  };

  const relay = async (payload: Extract<FrameBridgeFramePayload, { kind: 'fetch' }>) => {
    const request = relayedRequest(win, id, payload);
    if (!request) { post({ kind: 'fetch-result', call: payload.call, error: 'refused' }); return; }
    try {
      const response = await appFetch(request.path, request.init);
      const headers: Record<string, string> = {};
      response.headers.forEach((value, name) => { if (KEPT_HEADERS.includes(name.toLowerCase())) headers[name.toLowerCase()] = value; });
      post({ kind: 'fetch-result', call: payload.call, status: response.status, headers, body: await response.text() });
    } catch (error) {
      post({ kind: 'fetch-result', call: payload.call, error: String(error instanceof Error ? error.message : error) });
    }
  };

  const onMessage = (event: MessageEvent) => {
    if (closed || event.source !== frame.contentWindow || event.origin !== frameOrigin) return;
    const values = urlValuesOf(event.data);
    if (values !== null) { options.onUrlValues?.(values); return; }
    if (!isFrameBridgeEnvelope(event.data)) return;
    const data = event.data as { key?: unknown; payload: FrameBridgeFramePayload };
    const payload = data.payload;
    if (payload.kind === 'hello') {
      // A door that opens after this session's controller ran is a new document (it reloaded).
      if (attached && frameOrigin !== 'null') reattach(); else attach();
      return;
    }
    if (data.key !== key) return;
    switch (payload.kind) {
      case 'ready':
        if (typeof payload.nonce !== 'string' || !payload.nonce) return;
        nonce = payload.nonce;
        attached = true;
        for (const queued of backlog.splice(0)) envelope(queued);
        if (inset) envelope({ kind: 'inset', top: inset });
        const values = urlValuesOf({ type: STORY_URL_VALUES_MESSAGE, search: payload.urlValues });
        if (values !== null) options.onUrlValues?.(values);
        options.onReady?.(nonce);
        return;
      case 'event':
        for (const listener of [...listeners]) listener(payload.event);
        return;
      case 'restored': {
        const waiting = restoring.get(payload.call);
        restoring.delete(payload.call);
        if (!waiting) return;
        if (payload.ok) waiting.resolve(); else waiting.reject(new Error(payload.error));
        return;
      }
      case 'fetch': void relay(payload); return;
      case 'scroll': options.onScroll?.({ x: Number(payload.scrollX) || 0, y: Number(payload.scrollY) || 0 }); return;
      case 'error': console.error('[frame-bridge]', payload.message); return;
      default: return;
    }
  };
  const onLoad = () => {
    loads++;
    // A second document in the frame. On `/raw` its origin says nothing, so the bridge closes.
    // On its own origin a new document's door says `hello` as it opens, which re-attaches; a load only re-sends.
    if (loads > 1 && frameOrigin === 'null') { close('the framed document navigated'); return; }
    attach();
  };
  win.addEventListener('message', onMessage);
  frame.addEventListener('load', onLoad);
  // The frame may already be there, its door open and its hello gone (the server drew it before this page ran).
  attach();

  const controller: FrameBridgeParent = {
    get nonce() { return nonce; },
    selectionReady() { /* the frame's controller makes its selection actions itself */ },
    send(command: unknown) { post({ kind: 'send', command }); },
    update(command: StoryDocumentUpdate) { post({ kind: 'update', command }); },
    invalidate(datasets: string[]) { post({ kind: 'send', command: { type: STORY_DATA_MESSAGE, datasets } }); },
    restored() {
      if (closed) return Promise.reject(new Error('the framed document closed'));
      const call = ++restoredCalls;
      return new Promise<void>((resolve, reject) => {
        restoring.set(call, { resolve, reject });
        post({ kind: 'restored', call });
      });
    },
    subscribe(listener: (event: unknown) => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    /** The frame's viewport in this page's viewport: its content box, inside the iframe's border. */
    getViewportRect() {
      const box = frame.getBoundingClientRect();
      return new DOMRect(box.left + frame.clientLeft, box.top + frame.clientTop, frame.clientWidth, frame.clientHeight);
    },
    setContext(editId: string, source: string | null) { post({ kind: 'context', editId, source }); },
    setTopInset(px: number) {
      const top = Number.isFinite(px) ? Math.max(0, Math.round(px)) : 0;
      if (top === inset) return;
      inset = top;
      // Not backlogged: `ready` sends the current one (a reloaded document's backlog is dropped, the inset is not).
      if (attached && !closed) envelope({ kind: 'inset', top });
    },
    dispose() {
      close('disposed');
      listeners.clear();
      win.removeEventListener('message', onMessage);
      frame.removeEventListener('load', onLoad);
    },
  };
  return controller;
}
