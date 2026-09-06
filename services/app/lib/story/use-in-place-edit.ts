'use client';

/**
 * THE PARENT HALF OF IN-PLACE EDITING.
 *
 * The document the reader is looking at becomes editable where it stands; this
 * is the page's side of that conversation. It holds nothing about how editing
 * LOOKS — that is chrome — and everything about what is true: the source, and
 * which messages from the frame are allowed to change it.
 *
 * Trust: the author's `<script>` runs in the same realm as the runtime, so
 * `event.source === frame.contentWindow` proves only which FRAME spoke, never
 * which CODE. The session nonce does, and the runtime mints it before the
 * author's script exists (lib/story-runtime/pristine). Everything without it
 * is dropped — including a forgery posted through the unforgeable `top`.
 */
import {isDocumentPeerEvent, type DocumentPeer} from '@/lib/story/document-peer';
import { useCallback, useEffect, useRef, useState } from 'react';
import { isEditFrameMessage, STORY_APPLY_FORMAT_MESSAGE, STORY_APPLY_LINK_MESSAGE, STORY_EDIT_MODE_MESSAGE, STORY_SELECT_MESSAGE, STORY_COMMIT_MESSAGE, STORY_DOCUMENT_MESSAGE, type StoryEditSelection, type StoryIslandDataflow } from '@/lib/story-runtime/contract';
import type { JsxNode } from '@/lib/jsx';
import { composeSource, type ComposableFormatEdit } from '@/lib/story/edit-compose';

export interface InPlaceEditOptions {
  /** The live document's iframe. Never remounted — that is the whole point. */
  frameRef: { current: DocumentPeer | null };
  /** True while the owner is in edit mode. */
  editing: boolean;
  /**
   * The document's session secret. Learned by the PAGE at hydration, because
   * the runtime announces it before the author's script exists and long before
   * this controller is mounted — an editor-held listener would hear nothing.
   */
  sessionNonce: string | null;
  /** The current source, read at the moment an edit arrives. */
  sourceRef: { current: string };
  /** A frame-originated edit, already composed into the source. */
  onSourceEdited: (next: string) => void;
  /** Delete/Backspace pressed with a selection, or Escape. */
  onEditKey?: (key: 'Delete' | 'Backspace' | 'Escape', selection: StoryEditSelection | null) => void;
  /** A slide was renamed from the deck's own rail. */
  onSlideTitle?: (path: string, title: string) => void;
  /**
   * An image was pasted or dropped INTO the document. The listeners live in the
   * frame (that is the realm the event fires in), so it arrives as a message;
   * the page runs the same insert the file picker does.
   */
  onImageDrop?: (file: File) => void;
}

export interface InPlaceEditController {
  /** What the user has selected in the document, as the document described it. */
  selection: StoryEditSelection | null;
  /** True once the frame has edit mode running. */
  ready: boolean;
  /** True while there is typing the document has not committed — gates remote adoption. */
  isUserEditing: () => boolean;
  /** Apply a format NOW (locally, no re-render) and fold it into the source. */
  applyFormat: (path: string, edit: ComposableFormatEdit) => void;
  /** Ask the frame to link the live text selection; it answers with a text edit. */
  applyLink: (path: string, href: string | null) => void;
  /** Select a node by path (a breadcrumb click, a panel opening) or clear it. */
  select: (path: string | null) => void;
  /**
   * Collect anything typed but not yet blurred, and wait for it.
   *
   * Called by every way OUT of edit mode before it drains: the document
   * commits on blur, so the last thing typed lives only in its DOM until
   * somebody asks for it.
   */
  commitPending: () => Promise<void>;
  /** Show a new version of the document in the frame, without replacing it. */
  pushDocument: (update: {
    nodes: JsxNode[];
    authorCss?: string | null;
    compiledCss?: string | null;
    dataflow?: StoryIslandDataflow;
    colorMode?: 'light' | 'dark';
    theme?: string | null;
  }) => void;
}

export function useInPlaceEdit(options: InPlaceEditOptions): InPlaceEditController {
  const { frameRef, editing, sessionNonce, sourceRef, onSourceEdited, onEditKey, onSlideTitle, onImageDrop } = options;
  const [selection, setSelection] = useState<StoryEditSelection | null>(null);
  const [ready, setReady] = useState(false);
  const nonceRef = useRef<string | null>(sessionNonce);
  nonceRef.current = sessionNonce;
  const typingRef = useRef(false);
  /** Resolves the in-flight commitPending, if there is one. */
  const committedRef = useRef<(() => void) | null>(null);
  const selectionRef = useRef<StoryEditSelection | null>(null);
  selectionRef.current = selection;

  const onSourceEditedRef = useRef(onSourceEdited);
  onSourceEditedRef.current = onSourceEdited;
  const onEditKeyRef = useRef(onEditKey);
  onEditKeyRef.current = onEditKey;
  const onSlideTitleRef = useRef(onSlideTitle);
  onSlideTitleRef.current = onSlideTitle;
  const onImageDropRef = useRef(onImageDrop);
  onImageDropRef.current = onImageDrop;
  /** commitPending is defined below; the listener reaches it through this. */
  const commitPendingRef = useRef<(() => Promise<void>) | null>(null);

  const postToFrame = useCallback((message: Record<string, unknown>) => {
    frameRef.current?.contentWindow?.postMessage(message, '*');
  }, [frameRef]);

  // ── listening ─────────────────────────────────────────────────────────────
  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      const frameWindow = frameRef.current?.contentWindow;
      if (!isDocumentPeerEvent(frameRef.current, event)) return;

      const nonce = nonceRef.current;
      if (!nonce || !isEditFrameMessage(event.data, nonce)) return;

      switch (event.data.type) {
        case 'mx:edit-ready':
          setReady(true);
          break;
        case 'mx:typing':
          typingRef.current = event.data.active;
          break;
        case 'mx:selection':
          setSelection(event.data.selection);
          break;
        case 'mx:text-edit': {
          const next = composeSource(sourceRef.current, {
            text: new Map([[event.data.path, event.data.innerHtml]]),
            format: new Map(),
            layout: new Map(),
          });
          if (next !== sourceRef.current) onSourceEditedRef.current(next);
          break;
        }
        case 'mx:committed':
          committedRef.current?.();
          break;
        case 'mx:layout-edit': {
          // A drag moves several tiles at once (vertical compaction), so they
          // compose as ONE edit against the current source.
          const next = composeSource(sourceRef.current, {
            text: new Map(),
            format: new Map(),
            layout: new Map(event.data.rects.map((r) => [r.path, { x: r.x, y: r.y, w: r.w, h: r.h }])),
          });
          if (next !== sourceRef.current) onSourceEditedRef.current(next);
          break;
        }
        case 'mx:slide-title':
          onSlideTitleRef.current?.(event.data.path, event.data.title);
          break;
        case 'mx:edit-key':
          onEditKeyRef.current?.(event.data.key, selectionRef.current);
          break;
        case 'mx:image-drop': {
          // A structural insert composes against sourceRef, and a paste never
          // blurs the host it happened in — so anything typed or pasted a
          // moment ago is still only in the frame's DOM. Ask for it first, or
          // the insert writes a source that never had it.
          const file = event.data.file;
          const drain = commitPendingRef.current?.() ?? Promise.resolve();
          drain.then(() => onImageDropRef.current?.(file));
          break;
        }
        default:
          break;
      }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [frameRef, sourceRef]);

  // ── entering and leaving ──────────────────────────────────────────────────
  useEffect(() => {
    postToFrame({ type: STORY_EDIT_MODE_MESSAGE, on: editing });
    if (!editing) { setReady(false); setSelection(null); typingRef.current = false; }
    return () => {
      // Leaving unmounts this; the document must not stay editable.
      if (editing) postToFrame({ type: STORY_EDIT_MODE_MESSAGE, on: false });
    };
  }, [editing, postToFrame]);

  /*
   * A frame that has only just painted has not heard the request to enter edit
   * mode — its listener does not exist yet. Repeat briefly rather than assume:
   * the cost of asking twice is nothing, and the cost of being early is an
   * editor that never becomes editable.
   */
  useEffect(() => {
    if (!editing || ready) return;
    const timer = window.setInterval(() => postToFrame({ type: STORY_EDIT_MODE_MESSAGE, on: true }), 250);
    return () => window.clearInterval(timer);
  }, [editing, ready, postToFrame]);

  const applyFormat = useCallback((path: string, edit: ComposableFormatEdit) => {
    // Locally first, so the change is on screen in the same frame the user
    // clicked; then folded into the source, which is what actually persists.
    postToFrame({ type: STORY_APPLY_FORMAT_MESSAGE, path, ...edit });
    const next = composeSource(sourceRef.current, {
      text: new Map(),
      format: new Map([[path, edit]]),
      layout: new Map(),
    });
    if (next !== sourceRef.current) onSourceEditedRef.current(next);
  }, [postToFrame, sourceRef]);

  const applyLink = useCallback((path: string, href: string | null) => {
    // Only the document holds a live Selection; it answers with a text edit.
    postToFrame({ type: STORY_APPLY_LINK_MESSAGE, path, href });
  }, [postToFrame]);

  const select = useCallback((path: string | null) => {
    /*
     * DESELECTING NEEDS NO ANSWER. Selecting does — only the document can
     * describe what is at a path (its rect, its classes, its ancestors), so
     * that waits for `mx:selection`. Clearing is the page's own decision, and
     * routing it through the frame meant `close` landed a message round-trip
     * after the click: the panel visibly outlived the button that shut it.
     * The document is still told, so it drops its own selected stamp.
     */
    if (path === null) setSelection(null);
    postToFrame({ type: STORY_SELECT_MESSAGE, path });
  }, [postToFrame]);

  const commitPending = useCallback(() => new Promise<void>((resolve) => {
    if (!frameRef.current?.contentWindow) { resolve(); return; }
    // Bounded: a document that cannot answer must not strand the reader in an
    // editor they have already left.
    const timer = window.setTimeout(finish, 1200);
    function finish() {
      window.clearTimeout(timer);
      committedRef.current = null;
      resolve();
    }
    committedRef.current = finish;
    postToFrame({ type: STORY_COMMIT_MESSAGE });
  }), [frameRef, postToFrame]);

  commitPendingRef.current = commitPending;

  const pushDocument = useCallback((update: Parameters<InPlaceEditController['pushDocument']>[0]) => {
    postToFrame({ type: STORY_DOCUMENT_MESSAGE, ...update });
  }, [postToFrame]);

  return {
    selection,
    ready,
    isUserEditing: useCallback(() => typingRef.current, []),
    applyFormat,
    applyLink,
    select,
    commitPending,
    pushDocument,
  };
}
