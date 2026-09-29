/**
 * Solid twin of lib/story/use-in-place-edit — THE PARENT HALF OF IN-PLACE EDITING.
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
 *
 * `options` is read LIVE (a Solid props object, not a spread copy): React's
 * ref-mirror pattern (`optionsRef.current`, `onXRef.current`) is exactly what
 * a live getter already gives for free, so none of it is needed here — every
 * callback reads `options.x` at the moment it fires. Only the two effects that
 * must re-subscribe on specific changes (never on every option) name their
 * dependencies explicitly, through `on([...])` — React's dependency array made
 * explicit instead of inferred from a render.
 */
import { createEffect, createSignal, on, onCleanup, type Accessor } from 'solid-js';
import {
  sendDocument,
  subscribeDocument,
  documentReady,
  type DocumentRuntimeRef,
} from '@/lib/story-runtime/document-endpoint';
import {
  isEditFrameMessage,
  STORY_APPLY_FORMAT_MESSAGE,
  STORY_APPLY_LINK_MESSAGE,
  STORY_EDIT_MODE_MESSAGE,
  STORY_SELECT_MESSAGE,
  STORY_SPOTLIGHT_MESSAGE,
  STORY_COMMIT_MESSAGE,
  STORY_DOCUMENT_MESSAGE,
  type StoryEditSelection,
  type StoryIslandDataflow,
} from '@/lib/story-runtime/contract';
import type { EditorBookmark, EditorSelectionChange } from '@/lib/editor-v2/bookmark';
import type { JsxNode } from '@/lib/jsx';
import { editBlock } from '@/lib/editor-v2/block-edit';
import { replaceProseRegion } from '@/lib/editor-v2/source-edit';
import { composeSource, type ComposableFormatEdit } from '@/lib/story/edit-compose';

/**
 * Where a pasted/dropped image goes: `replace` names the image it replaces;
 * `at` is the gap a drop landed in (null: outside every block, so append).
 * Absent, the page places it at its own selection.
 */
export interface ImageDropPlacement {
  replace?: string;
  at?: { path: string; side: 'before' | 'after' | 'inside' } | null;
}

const SIDES = new Set(['before', 'after', 'inside']);
function dropGap(at: unknown): ImageDropPlacement['at'] {
  const gap = at as { path?: unknown; side?: unknown } | null;
  return gap && typeof gap.path === 'string' && typeof gap.side === 'string' && SIDES.has(gap.side)
    ? { path: gap.path, side: gap.side as 'before' | 'after' | 'inside' }
    : null;
}

export interface InPlaceEditOptions {
  onError?: (message: string) => void;
  onRejectedEdit?: (fragment: string) => void;
  /** The live document's iframe. Never remounted — that is the whole point. */
  frameRef?: { current: HTMLIFrameElement | null };
  runtimeRef?: DocumentRuntimeRef;
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
  onSourceEdited: (next: string, render?: boolean, group?: string, selection?: EditorSelectionChange) => void;
  /** Delete/Backspace pressed with a selection, or Escape. */
  onEditKey?: (key: 'Delete' | 'Backspace' | 'Escape', selection: StoryEditSelection | null) => void;
  onHistory?: (direction: 'undo' | 'redo') => void;
  /** A slide was renamed from the deck's own rail. */
  onSlideTitle?: (path: string, title: string) => void;
  /**
   * An image was pasted or dropped INTO the document. The listeners live in the
   * frame (that is the realm the event fires in), so it arrives as a message;
   * the page runs the same insert the file picker does.
   */
  onImageDrop?: (file: File, where?: ImageDropPlacement) => void;
  /** An image was double-clicked: open the replace picker for the image at this BODY path. */
  onImageReplaceRequest?: (path: string) => void;
}

export interface InPlaceEditController {
  discardRejectedEdit: () => void;
  /** What the user has selected in the document, as the document described it. */
  selection: Accessor<StoryEditSelection | null>;
  /** True once the frame has edit mode running. */
  ready: Accessor<boolean>;
  /** True while there is typing the document has not committed — gates remote adoption. */
  isUserEditing: () => boolean;
  /** Apply a format NOW (locally, no re-render) and fold it into the source. */
  applyFormat: (path: string, edit: ComposableFormatEdit) => void;
  /** Ask the frame to link the live text selection; it answers with a text edit. */
  applyLink: (path: string, href: string | null) => void;
  applyInline: (tag: 'strong' | 'em' | 'u') => void;
  pasteMarkdown: (value: string) => void;
  restoreSelection: (bookmark: EditorBookmark) => void;
  /** Select a node by path (a breadcrumb click, a panel opening) or clear it. */
  select: (path: string | null, options?: { reveal?: boolean; nodeId?: string }) => void;
  /** Outline nodes by path WITHOUT selecting them (the query notebook pointing at what a query powers); [] clears. */
  spotlight: (paths: string[]) => void;
  /**
   * Collect anything typed but not yet blurred, and wait for it.
   *
   * Called by every way OUT of edit mode before it drains: the document
   * commits on blur, so the last thing typed lives only in its DOM until
   * somebody asks for it.
   */
  commitPending: (requireAcknowledgement?: boolean) => Promise<void>;
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

export function createInPlaceEdit(options: InPlaceEditOptions): InPlaceEditController {
  const [selection, setSelection] = createSignal<StoryEditSelection | null>(null);
  const [ready, setReady] = createSignal(false);
  let typing = false;
  let rejected = false;
  /** Resolves the in-flight commitPending, if there is one. */
  let committed: ((acknowledged?: boolean) => void) | null = null;
  let commitRequest: Promise<boolean> | null = null;

  const postToFrame = (message: Record<string, unknown>) => {
    sendDocument({ frameRef: options.frameRef, runtimeRef: options.runtimeRef }, message);
  };

  // ── listening ─────────────────────────────────────────────────────────────
  createEffect(
    on(
      [() => options.frameRef, () => options.runtimeRef, () => options.sourceRef, () => options.sessionNonce],
      ([frameRef, runtimeRef, sourceRef]) => {
        const onMessage = (event: { data: unknown }) => {
          const nonce = options.sessionNonce;
          if (!nonce || !isEditFrameMessage(event.data, nonce)) return;

          switch (event.data.type) {
            case 'mx:history':
              options.onHistory?.(event.data.direction);
              break;
            case 'mx:block-edit': {
              const next = editBlock(sourceRef.current, event.data.command);
              if (next !== sourceRef.current) {
                options.onSourceEdited(next, true);
                sourceRef.current = next;
              }
              break;
            }
            case 'mx:edit-error':
              options.onError?.(event.data.message);
              break;
            case 'mx:edit-ready':
              setReady(true);
              break;
            case 'mx:typing':
              typing = event.data.active;
              break;
            case 'mx:selection':
              setSelection(event.data.selection);
              break;
            case 'mx:flow-edit': {
              const { path, expected, replacement } = event.data;
              const next = replaceProseRegion(sourceRef.current, path, expected, replacement);
              if (next !== sourceRef.current) {
                options.onSourceEdited(next, true, event.data.group, event.data.selection);
                sourceRef.current = next;
              } else if (expected !== replacement) {
                rejected = true;
                options.onRejectedEdit?.(replacement);
              }
              break;
            }
            case 'mx:text-edit': {
              const next = composeSource(sourceRef.current, {
                text: new Map([[event.data.path, event.data.innerHtml]]),
                format: new Map(),
                layout: new Map(),
              });
              if (next !== sourceRef.current) options.onSourceEdited(next);
              break;
            }
            case 'mx:committed':
              committed?.();
              break;
            case 'mx:layout-edit': {
              // A drag moves several tiles at once (vertical compaction), so they
              // compose as ONE edit against the current source.
              const next = composeSource(sourceRef.current, {
                text: new Map(),
                format: new Map(),
                layout: new Map(event.data.rects.map((r) => [r.path, { x: r.x, y: r.y, w: r.w, h: r.h }])),
              });
              if (next !== sourceRef.current) options.onSourceEdited(next);
              break;
            }
            case 'mx:slide-title':
              options.onSlideTitle?.(event.data.path, event.data.title);
              break;
            case 'mx:edit-key':
              options.onEditKey?.(event.data.key, selection());
              break;
            case 'mx:image-drop': {
              // A structural insert composes against sourceRef, and a paste never
              // blurs the host it happened in — so anything typed or pasted a
              // moment ago is still only in the frame's DOM. Ask for it first, or
              // the insert writes a source that never had it.
              const file = event.data.file;
              // A drop ONTO an image, or a paste while one is selected, replaces it.
              const target = typeof event.data.target === 'string' ? event.data.target : null;
              const where: ImageDropPlacement | null = target
                ? { replace: target }
                : 'at' in event.data ? { at: dropGap(event.data.at) } : null;
              const drain = commitPending();
              drain.then(() => (where ? options.onImageDrop?.(file, where) : options.onImageDrop?.(file)));
              break;
            }
            case 'mx:image-replace':
              // Synchronously: the page may open a file picker only while the
              // double-click's activation lasts. Draining happens before the commit.
              if (typeof event.data.path === 'string') options.onImageReplaceRequest?.(event.data.path);
              break;
            default:
              break;
          }
        };
        onCleanup(subscribeDocument({ frameRef, runtimeRef }, onMessage));
      },
    ),
  );

  // ── entering and leaving ──────────────────────────────────────────────────
  createEffect(
    on([() => options.editing, () => options.sessionNonce], ([editing]) => {
      postToFrame({ type: STORY_EDIT_MODE_MESSAGE, on: editing });
      if (!editing) {
        setReady(false);
        setSelection(null);
        typing = false;
      }
      onCleanup(() => {
        // Leaving disposes this; the document must not stay editable.
        if (editing) postToFrame({ type: STORY_EDIT_MODE_MESSAGE, on: false });
      });
    }),
  );

  /*
   * A frame that has only just painted has not heard the request to enter edit
   * mode — its listener does not exist yet. Repeat briefly rather than assume:
   * the cost of asking twice is nothing, and the cost of being early is an
   * editor that never becomes editable.
   */
  createEffect(() => {
    if (!options.editing || ready()) return;
    const timer = window.setInterval(() => postToFrame({ type: STORY_EDIT_MODE_MESSAGE, on: true }), 250);
    onCleanup(() => window.clearInterval(timer));
  });

  const applyFormat = (path: string, edit: ComposableFormatEdit) => {
    // The engine publishes its checked source transaction. Legacy hosts still
    // need the parent to compose their class/style change. Never do both.
    const current = selection();
    const engineOwns = current?.path === path && current.editor === 'prose';
    postToFrame({ type: STORY_APPLY_FORMAT_MESSAGE, path, ...edit });
    if (engineOwns) return;
    const next = composeSource(options.sourceRef.current, {
      text: new Map(),
      format: new Map([[path, edit]]),
      layout: new Map(),
    });
    if (next !== options.sourceRef.current) options.onSourceEdited(next);
  };

  const applyLink = (path: string, href: string | null) => {
    // Only the document holds a live Selection; it answers with a text edit.
    postToFrame({ type: STORY_APPLY_LINK_MESSAGE, path, href });
  };

  const select = (path: string | null, opts?: { reveal?: boolean; nodeId?: string }) => {
    /*
     * DESELECTING NEEDS NO ANSWER. Selecting does — only the document can
     * describe what is at a path (its rect, its classes, its ancestors), so
     * that waits for `mx:selection`. Clearing is the page's own decision, and
     * routing it through the frame meant `close` landed a message round-trip
     * after the click: the panel visibly outlived the button that shut it.
     * The document is still told, so it drops its own selected stamp.
     */
    if (path === null) setSelection(null);
    postToFrame({
      type: STORY_SELECT_MESSAGE,
      path,
      ...(opts?.reveal ? { reveal: true } : {}),
      ...(opts?.nodeId ? { nodeId: opts.nodeId } : {}),
    });
  };

  const commitPending = async (requireAcknowledgement = false): Promise<void> => {
    if (rejected) throw new Error('Recover the uncommitted text before leaving the editor.');
    if (!documentReady({ frameRef: options.frameRef, runtimeRef: options.runtimeRef })) {
      if (requireAcknowledgement) throw new Error('editor is unavailable');
      return;
    }
    // Visibility, navigation and image insertion can request the same commit.
    // Share its acknowledgement rather than overwriting a caller's resolver.
    if (!commitRequest) {
      commitRequest = new Promise<boolean>((resolve) => {
        const timer = window.setTimeout(() => finish(false), 1200);
        function finish(acknowledged = true) {
          window.clearTimeout(timer);
          committed = null;
          commitRequest = null;
          resolve(acknowledged);
        }
        committed = finish;
        postToFrame({ type: STORY_COMMIT_MESSAGE });
      });
    }
    const acknowledged = await commitRequest;
    if (requireAcknowledgement && !acknowledged) throw new Error('editor commit timed out');
  };

  const pushDocument = (update: Parameters<InPlaceEditController['pushDocument']>[0]) => {
    postToFrame({ type: STORY_DOCUMENT_MESSAGE, ...update });
  };

  return {
    selection,
    ready,
    discardRejectedEdit: () => { rejected = false; },
    isUserEditing: () => typing || rejected,
    applyFormat,
    applyLink,
    applyInline: (tag: 'strong' | 'em' | 'u') => postToFrame({ type: 'mx:inline', tag }),
    pasteMarkdown: (value: string) => postToFrame({ type: 'mx:paste', kind: 'markdown', value }),
    select,
    spotlight: (paths: string[]) => postToFrame({ type: STORY_SPOTLIGHT_MESSAGE, paths }),
    commitPending,
    pushDocument,
    restoreSelection: (restore: EditorBookmark) => postToFrame({ type: STORY_COMMIT_MESSAGE, restore }),
  };
}
