/**
 * THE FRAME HALF OF THE BRIDGE — the editor's document half, running INSIDE a framed document.
 *
 * Loaded by the door (./door, opened by lib/islands/page before the author's script) on the page's first
 * `attach`, as `@mx/frame-editor` (lib/islands/frame-editor). It creates the SAME controller the app page creates
 * over an adopted story root (lib/story-runtime/island-controller: comments, selections, reader mode, data, and
 * in-place editing — ProseMirror over the compiled DOM, whose chunks still load only on `mx:edit-mode` on) over
 * this document's root, and relays:
 *
 *  · page → controller: `send`, `update`, `restored`, and the live `context` the controller reads;
 *  · controller → page: every event, as the in-page controller emits it (signed with its nonce);
 *  · the controller's three app-origin requests (lib/story-runtime/island-controller `appFetch`): this document
 *    holds no app session and its CSP admits neither path, so the page makes them;
 *  · keys the page's editor listens for on ITS window, which a key pressed here never reaches: Mod-Z/Y as
 *    `mx:history`, Enter and focus leaving a text host as `mx:edit-flush`, ⌘⌥M as `mx:comment-key`;
 *  · this document's scroll, so geometry the page draws over it can follow;
 *  · the page's bars over this frame's top edge (`inset`: edit mode's toolbar is drawn OVER the frame, which never
 *    moves): reserved above the document and scrolled by in one task here (createTopInset), so nothing moves on screen.
 *
 * While the page edits, this document's own live stream (lib/islands/live, a document on its own origin holds one)
 * must not draw a newer version under the editor: the frame half claims STORY_ADOPT_HOOK from edit mode on until the
 * page's `restored` has drawn the saved version, as the app page's in-page mount does for its lifetime.
 */
import { createIslandController, type IslandStoryController } from '@/lib/story-runtime/island-controller';
import { writeUrlValues } from '@/lib/story/data/url-values';
import { islandDocumentOf } from '@/lib/islands/handover';
import { ISLANDS_READY_EVENT, STORY_ROOT_SELECTOR } from '@/lib/islands/contract';
import { ISLAND_DATA_ID, READER_READY_ATTR } from '@/lib/compiled-page/contract';
import { createTrustedOverlayHost } from '@/lib/story-runtime/trusted-overlay-host';
import { applyReaderChoice } from '@/lib/story-runtime/reader-actions';
import {
  STORY_ADOPT_HOOK, STORY_COMMENT_KEY_MESSAGE, STORY_EDIT_FLUSH_MESSAGE, STORY_EDIT_MODE_MESSAGE, STORY_HISTORY_MESSAGE, STORY_READER_MODE_MESSAGE,
  type FrameBridgeParentPayload,
} from '@/lib/story-runtime/contract';
import type { FrameBridgeSession, FrameBridgeStartOptions } from './door';

type FetchResult = Extract<FrameBridgeParentPayload, { kind: 'fetch-result' }>;

/** Run `work` once the islands have hydrated (the author's script has started with them); at once on a page without islands. */
function whenIslandsReady(win: Window, work: () => void): () => void {
  const doc = win.document;
  if (!doc.getElementById(ISLAND_DATA_ID) || doc.documentElement.hasAttribute(READER_READY_ATTR)) { work(); return () => {}; }
  doc.addEventListener(ISLANDS_READY_EVENT, work, { once: true });
  return () => doc.removeEventListener(ISLANDS_READY_EVENT, work);
}

/** The headers the relayed request carries, as a plain record. */
const headerRecord = (headers: HeadersInit | undefined): Record<string, string> => {
  const out: Record<string, string> = {};
  new Headers(headers).forEach((value, key) => { out[key] = value; });
  return out;
};

/** The most the page may reserve over the document's top edge: a bar or two, never the document. */
const MAX_INSET = 200;

/**
 * THE PAGE'S BARS OVER THIS DOCUMENT'S TOP EDGE. The app page draws edit mode's toolbar over the frame instead of
 * pushing the frame down — moving the frame and scrolling it to make up would be two processes' frames, a visible
 * jump between them. Here the same space is added above the document (the root's top padding, and the scroll
 * padding that keeps a caret scrolled into view clear of the bar) and the document scrolled to exactly that much
 * further IN THE SAME TASK, so what the reader sees does not move. 0 gives the space back the same way.
 */
export function createTopInset(win: Window): { set(px: number): void } {
  let inset = 0;
  let base: { paddingTop: string; scrollPaddingTop: string; padding: number } | null = null;
  return {
    set(px: number) {
      const top = Number.isFinite(px) ? Math.min(MAX_INSET, Math.max(0, Math.round(px))) : 0;
      if (top === inset) return;
      const html = win.document.documentElement;
      // Added to the document's own top padding, which comes back as it was.
      base ??= { paddingTop: html.style.paddingTop, scrollPaddingTop: html.style.scrollPaddingTop, padding: parseFloat(win.getComputedStyle(html).paddingTop) || 0 };
      // Where the reader is now, read before the padding changes: the browser's own scroll anchoring may already
      // make up for the change when it lays the page out, so the document is put at an ABSOLUTE place, never moved by.
      const target = Math.max(0, win.scrollY + top - inset);
      inset = top;
      if (top) {
        html.style.paddingTop = `${base.padding + top}px`;
        html.style.scrollPaddingTop = `${top}px`;
      } else {
        html.style.paddingTop = base.paddingTop;
        html.style.scrollPaddingTop = base.scrollPaddingTop;
        base = null;
      }
      // Instant whatever the document's own scroll-behavior: a smooth scroll would be the move this prevents.
      try { win.scrollTo({ top: target, left: win.scrollX, behavior: 'instant' as ScrollBehavior }); } catch { /* no scrolling here */ }
    },
  };
}

const isUndoKey = (event: KeyboardEvent) => (event.ctrlKey || event.metaKey) && !event.altKey && ['z', 'y'].includes(event.key.toLowerCase());
const isCommentKey = (event: KeyboardEvent) => (event.ctrlKey || event.metaKey) && event.altKey && (event.key.toLowerCase() === 'm' || event.code === 'KeyM');

export function startFrameBridge({ win, post, attach }: FrameBridgeStartOptions): FrameBridgeSession {
  const doc = win.document;
  let disposed = false;
  let controller: IslandStoryController | null = null;
  let editing = false;
  const context = { editId: attach.editId, source: attach.source };
  const queue: FrameBridgeParentPayload[] = [];
  const cleanups: Array<() => void> = [];
  const topInset = createTopInset(win);
  cleanups.push(() => topInset.set(0));

  // ── the controller's app requests, made by the page ──
  let calls = 0;
  const pending = new Map<number, { resolve: (response: Response) => void; reject: (error: unknown) => void }>();
  const appFetch = (path: string, init: RequestInit): Promise<Response> => new Promise((resolve, reject) => {
    if (disposed) { reject(new TypeError('the bridge is closed')); return; }
    const call = ++calls;
    pending.set(call, { resolve, reject });
    post({ kind: 'fetch', call, path, method: init.method === 'POST' ? 'POST' : 'GET', headers: headerRecord(init.headers), body: typeof init.body === 'string' ? init.body : null });
  });
  const settleFetch = (result: FetchResult) => {
    const waiting = pending.get(result.call);
    pending.delete(result.call);
    if (!waiting) return;
    if ('error' in result) { waiting.reject(new TypeError(result.error)); return; }
    try { waiting.resolve(new Response(result.status === 204 ? null : result.body, { status: result.status, headers: result.headers })); }
    catch (error) { waiting.reject(error); }
  };

  // ── the live stream waits while the page edits (lib/islands/live skips a version while the hook is claimed) ──
  const hooks = win as unknown as Record<string, unknown>;
  const holding = () => {};
  const hold = () => { if (hooks[STORY_ADOPT_HOOK] === undefined) hooks[STORY_ADOPT_HOOK] = holding; };
  const release = () => { if (hooks[STORY_ADOPT_HOOK] === holding) delete hooks[STORY_ADOPT_HOOK]; };
  cleanups.push(release);

  const emit = (event: Record<string, unknown>) => { if (controller) post({ kind: 'event', event: { ...event, nonce: controller.nonce } }); };

  const receive = (payload: FrameBridgeParentPayload) => {
    if (disposed) return;
    if (payload.kind === 'fetch-result') { settleFetch(payload); return; }
    if (payload.kind === 'context') { context.editId = payload.editId; context.source = payload.source; return; }
    // Layout, not a controller command: applied at once, whether or not the controller runs yet.
    if (payload.kind === 'inset') { topInset.set(payload.top); return; }
    if (!controller) { queue.push(payload); return; }
    switch (payload.kind) {
      case 'send': {
        const command = payload.command as { type?: unknown; on?: unknown; mode?: unknown } | null;
        if (command?.type === STORY_EDIT_MODE_MESSAGE && typeof command.on === 'boolean') { editing = command.on; if (editing) hold(); }
        // The page's reader choice: the whole document follows it (the app page applies it to its own shell).
        if (command?.type === STORY_READER_MODE_MESSAGE && (command.mode === 'light' || command.mode === 'dark')) applyReaderChoice(win, doc, command.mode);
        controller.send(payload.command);
        return;
      }
      case 'update': controller.update(payload.command); return;
      case 'restored': {
        const { call } = payload;
        controller.restored().then(
          () => { if (!editing) release(); post({ kind: 'restored', call, ok: true }); },
          (error: unknown) => { if (!editing) release(); post({ kind: 'restored', call, ok: false, error: String(error instanceof Error ? error.message : error) }); },
        );
        return;
      }
      default: return;
    }
  };

  // ── keys and focus the page's editor would have heard on its own window ──
  const onKey = (event: KeyboardEvent) => {
    if (!editing || !event.isTrusted || !controller) return;
    if (isUndoKey(event)) {
      const target = (event.composedPath()[0] ?? event.target) as Element | null;
      if (target?.closest?.('input,textarea')) return;
      event.preventDefault();
      event.stopPropagation();
      emit({ type: STORY_HISTORY_MESSAGE, direction: event.shiftKey || event.key.toLowerCase() === 'y' ? 'redo' : 'undo' });
      return;
    }
    if (isCommentKey(event)) { event.preventDefault(); emit({ type: STORY_COMMENT_KEY_MESSAGE }); return; }
    // After the editor has handled the key: the paragraph it broke is what goes out.
    if (event.key === 'Enter') win.setTimeout(() => emit({ type: STORY_EDIT_FLUSH_MESSAGE, reason: 'enter' }), 0);
  };
  const onFocusOut = (event: FocusEvent) => { if (editing && event.isTrusted) queueMicrotask(() => emit({ type: STORY_EDIT_FLUSH_MESSAGE, reason: 'focusout' })); };

  // ── scroll: what the page placed over this document moves with it ──
  let scrollQueued = false;
  const onScroll = () => {
    if (scrollQueued) return;
    scrollQueued = true;
    win.requestAnimationFrame(() => { scrollQueued = false; if (!disposed) post({ kind: 'scroll', scrollX: win.scrollX, scrollY: win.scrollY }); });
  };

  const start = () => {
    if (disposed || controller) return;
    const root = doc.querySelector<HTMLElement>(STORY_ROOT_SELECTOR);
    if (!root) { post({ kind: 'error', message: 'this document has no story root' }); return; }
    const overlay = createTrustedOverlayHost({ doc, overlay: true, layer: 'selection' });
    cleanups.push(() => overlay.dispose());
    controller = createIslandController({
      win, root, islands: islandDocumentOf(root), nodes: attach.nodes, portal: { current: overlay.portal as HTMLElement },
      id: attach.id, editId: () => context.editId, initialSource: () => context.source,
      // The standalone copy's own fragment: this document wears its sheets, not the app page's.
      appFetch, fragmentSurface: 'raw',
    });
    controller.selectionReady();
    const unsubscribe = controller.subscribe((event) => post({ kind: 'event', event }));
    cleanups.push(unsubscribe);
    win.addEventListener('keydown', onKey, true);
    doc.addEventListener('focusout', onFocusOut, true);
    win.addEventListener('scroll', onScroll, { passive: true });
    cleanups.push(() => {
      win.removeEventListener('keydown', onKey, true);
      doc.removeEventListener('focusout', onFocusOut, true);
      win.removeEventListener('scroll', onScroll);
    });
    // Child controls can move before the app installs its listener. Replay only declared URL scalars
    // with each keyed ready receipt, including reattachment after a load; later changes still debounce.
    const store = islandDocumentOf(root)?.store;
    post({ kind: 'ready', nonce: controller.nonce, ...(store ? { urlValues: writeUrlValues('', store.flow, store.getState().values) } : {}) });
    for (const queued of queue.splice(0)) receive(queued);
  };
  cleanups.push(whenIslandsReady(win, start));

  return {
    receive,
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const cleanup of cleanups.splice(0).reverse()) cleanup();
      controller?.dispose();
      controller = null;
      for (const waiting of pending.values()) waiting.reject(new TypeError('the bridge is closed'));
      pending.clear();
    },
  };
}
