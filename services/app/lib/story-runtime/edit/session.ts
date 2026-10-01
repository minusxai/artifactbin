'use client';

/**
 * EDIT MODE, INSIDE THE DOCUMENT.
 *
 * This is the whole frame half of in-place editing, and it is deliberately
 * thin: it makes text hosts editable, says what the user selected, stages what
 * they typed, and applies a format the instant the toolbar asks. It owns no
 * truth. The parent holds the source, composes every edit through the same
 * sanitizing write-back the canvas used, and pushes new versions back as
 * `mx:document` — which this document already knew how to re-render in place.
 *
 * Everything it says goes out over the pristine channel with the session nonce
 * (lib/story-runtime/pristine): the author's script shares this realm, so
 * "the frame said so" is not evidence of anything.
 */
import type { JsxNode } from '@/lib/jsx';
import { captureBookmark, restoreBookmark, type EditorBookmark } from '@/lib/editor-v2/bookmark';
import { flushFlowView } from '@/lib/editor-v2/flow-view';
import { toggleInline, pasteFragment } from '@/lib/editor-v2/model';
import { clipboardAst } from '@/lib/editor-v2/clipboard';
import { SELECTION_PRESENTATION } from '../selection-presentation';
import { AST_PATH_ATTR } from '@/lib/story-ui/ast-path';
import type { RuntimeChannel } from '../pristine';
import {
  STORY_EDIT_KEY_MESSAGE,
  STORY_EDIT_READY_MESSAGE,
  STORY_INLINE_MESSAGE,
  STORY_PASTE_MESSAGE,
  STORY_FLOW_EDIT_MESSAGE,
  STORY_TEXT_EDIT_MESSAGE,
  STORY_TYPING_MESSAGE,
  STORY_APPLY_FORMAT_MESSAGE,
  STORY_APPLY_LINK_MESSAGE,
  STORY_SELECT_MESSAGE,
  STORY_SPOTLIGHT_MESSAGE,
  STORY_COMMIT_MESSAGE,
  STORY_COMMITTED_MESSAGE,
  STORY_LAYOUT_EDIT_MESSAGE,
  STORY_SLIDE_TITLE_MESSAGE,
  type StoryEditParentMessage,
} from '../contract';
import { ancestorCrumbs } from './describe-selection';
import { collectTextRegions, createRegionGeometry, navigateAcrossRegions } from './arrow-navigation';
import {
  createHoverSelect,
  EDIT_EMBED_SELECTED_ATTR,
  EDIT_HOVER_ATTR,
  EDIT_ROOT_ATTR,
  EDIT_SELECTED_ATTR,
  EDIT_SPOTLIGHT_ATTR,
  type EditViews,
} from './hover-select';
import { createImageTransfer, DROP_REPLACE_CSS, EDIT_DROP_REPLACE_ATTR } from './image-transfer';
import { createFormatLink } from './format-link';
import type { CompiledEditMount, CompiledEditCallbacks, HeldEditors, ReconcileOptions } from '@/solid/editor/dom-mounter';

/**
 * Selection chrome, injected on entering edit mode and removed on leaving.
 * NOT part of the document's served stylesheet: a reader must never download
 * or apply editor chrome.
 */
/** Set by dom-mounter on a region wrapper whose authored parent is a flex or grid container. */
const EDIT_LAYOUT_ATTR = 'data-mx-parent-layout';
const EDIT_MODE_CSS = [
  '.ProseMirror { outline: none; white-space: pre-wrap; overflow-wrap: break-word; }',
  // A prose region's blocks sit inside the editor root (a focusable box: with `display: contents`
  // it cannot take focus), not in their authored parent. Under a flex or grid parent the root takes the
  // parent's place in full and inherits its layout through the box-less region wrappers, so a flex
  // column's gap, a card's centring and a grid's tracks lay the blocks out as in reading mode.
  `[${EDIT_LAYOUT_ATTR}="flex"], [${EDIT_LAYOUT_ATTR}="grid"], [${EDIT_LAYOUT_ATTR}] > .mx-prose-region, [${EDIT_LAYOUT_ATTR}="flex"] > .mx-prose-region > .ProseMirror, [${EDIT_LAYOUT_ATTR}="grid"] > .mx-prose-region > .ProseMirror { flex-direction: inherit; flex-wrap: inherit; justify-content: inherit; justify-items: inherit; align-items: inherit; align-content: inherit; row-gap: inherit; column-gap: inherit; grid-template-columns: inherit; grid-template-rows: inherit; grid-auto-flow: inherit; grid-auto-columns: inherit; grid-auto-rows: inherit; }`,
  `[${EDIT_LAYOUT_ATTR}="flex"] > .mx-prose-region > .ProseMirror { display: flex; flex: 1 1 auto; align-self: stretch; min-width: 0; }`,
  `[${EDIT_LAYOUT_ATTR}="grid"] > .mx-prose-region > .ProseMirror { display: grid; grid-column: 1 / -1; min-width: 0; }`,
  `[${EDIT_LAYOUT_ATTR}="item"] > .mx-prose-region > .ProseMirror { grid-column-start: var(--mx-place-grid-column-start, auto); grid-column-end: var(--mx-place-grid-column-end, auto); grid-row-start: var(--mx-place-grid-row-start, auto); grid-row-end: var(--mx-place-grid-row-end, auto); flex-grow: var(--mx-place-flex-grow, 0); flex-shrink: var(--mx-place-flex-shrink, 1); flex-basis: var(--mx-place-flex-basis, auto); align-self: var(--mx-place-align-self, auto); justify-self: var(--mx-place-justify-self, auto); order: var(--mx-place-order, 0); min-width: 0; }`,
  // A table in an editor region off screen is neither styled nor laid out: on a page of dozens of tables, inserting or
  // removing one block (a remount, a new paragraph) otherwise brought the WHOLE page's styles up to date (120-200 ms at
  // normal CPU). Tables only: the story's table is a block scroll box already (chrome-css STORY_TABLE_CSS), so the
  // containment this implies changes no margin — on the editor root it stopped its blocks' margins collapsing with the
  // page's and moved the reader. Held at its measured height (its region is the table alone), then its last rendered
  // one. Not under a flex or grid parent, where size containment would change how the item sizes.
  `[data-mx-edit-region]:not([${EDIT_LAYOUT_ATTR}]) > .mx-prose-region > .ProseMirror > table { content-visibility: auto; contain-intrinsic-block-size: auto var(--mx-region-h, 480px); }`,
  '[contenteditable="true"]:focus { outline: none; }',
  // Hover draws nothing: the cursor says what a click does, and one grip sits in the margin.
  `[${EDIT_HOVER_ATTR}="block"][${EDIT_HOVER_ATTR}] { cursor: pointer; }`,
  `[${EDIT_HOVER_ATTR}="container"][${EDIT_HOVER_ATTR}] { cursor: default; }`,
  // Block mode keeps keyboard focus on the story root; it is not a control to ring.
  `[${EDIT_ROOT_ATTR}]:focus { outline: none; }`,
  // Only a BLOCK selection is outlined; typing shows the caret and nothing else.
  `[${EDIT_SELECTED_ATTR}="block"][${EDIT_SELECTED_ATTR}], [${EDIT_EMBED_SELECTED_ATTR}="block"][${EDIT_EMBED_SELECTED_ATTR}] { ${SELECTION_PRESENTATION.editSelectedCss} }`,
  `[data-mx-block-selected][data-mx-block-selected] { ${SELECTION_PRESENTATION.editSelectedCss} }`,
  `[${EDIT_SPOTLIGHT_ATTR}][${EDIT_SPOTLIGHT_ATTR}] { ${SELECTION_PRESENTATION.spotlightCss} }`,
  `[${EDIT_DROP_REPLACE_ATTR}][${EDIT_DROP_REPLACE_ATTR}] { ${DROP_REPLACE_CSS} }`,
].join('\n');

const EDIT_CSS_ATTR = 'data-mx-edit-css';

export interface FrameEditSession {
  /** Attach the Solid edit regions and text-host listeners to a server-compiled story. */
  mountCompiledDom(): Promise<void>;
  /**
   * Before a compiled draft is drawn: keep the editors whose region `draft` (the draft's story root, off the page)
   * draws exactly as they stand in for it, and swap their blocks there for stand-ins. Returns the live editor roots
   * by stand-in path, for the morph to place (lib/islands/morph/engine `morphDraftDom`). `unmountCompiledDom` then
   * leaves them running and the next `mountCompiledDom` takes them over: a redraw rebuilds only what it changed.
   */
  holdUnchanged(next: JsxNode[], draft: HTMLElement): ReadonlyMap<string, HTMLElement>;
  /** Release Solid prose regions before a compiled DOM morph; the session and its commands stay live. */
  unmountCompiledDom(): void;
  /** A compiled draft may replace the DOM when no host text or composition is pending. */
  canApplyDraft(): boolean;
  /**
   * Adopt a draft that changes only the prose the editors already show, keeping every live editor
   * (solid/editor/dom-mounter `reconcile`); false when it must be drawn.
   */
  reconcileDraft(before: JsxNode[], after: JsxNode[], next: JsxNode[], draft: HTMLElement | null, options?: ReconcileOptions): boolean;
  /** The nodes currently rendered — selection is classified against the SOURCE, not the DOM. */
  setNodes(nodes: JsxNode[]): void;
  /** A parent → frame edit message (already checked for direction and trust by the caller). */
  onParentMessage(message: StoryEditParentMessage): void;
  /** A slide was renamed in the deck's own rail. */
  renameSlide(path: string, title: string): void;
  dispose(): void;
}

interface ActiveHost {
  path: string;
  el: HTMLElement;
  snapshot: string;
  userEdited: boolean;
}

interface FrameEditSessionOptions {
  win: Window;
  channel: RuntimeChannel;
  /** The story root: everything the session selects, edits or listens to is inside it. */
  root: HTMLElement;
  /** Ask the runtime to re-render (a new body epoch releases the focus guard). */
  requestRender: () => void;
  /** Browser-only Solid boundary (solid/editor/dom-mounter). */
  mountCompiled: (root: HTMLElement, nodes: JsxNode[], callbacks: CompiledEditCallbacks, held?: HeldEditors) => CompiledEditMount;
}

/**
 * The session composes three halves behind this one interface: what is selected and hovered
 * (./hover-select), an image pasted or dropped (./image-transfer), and the toolbar's format and
 * link (./format-link). It keeps the text hosts (focus, typing, commit), the keyboard, and the
 * mount of the Solid edit regions.
 *
 * Undo and redo are NOT handled here. Their one owner is the editor page's window-capture
 * Ctrl/Cmd-Z (solid/editor/InPlaceEditor): it runs before any document listener and steps aside
 * inside an `<input>` or `<textarea>`, where the key belongs to that field's own text.
 */
/** Two JSON-shaped values hold the same data (what equal JSON.stringify output meant, without building it). */
function sameData(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  if (Array.isArray(a)) {
    if (!Array.isArray(b) || a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (!sameData(a[i], b[i])) return false;
    return true;
  }
  if (Array.isArray(b)) return false;
  const left = Object.keys(a).filter((key) => (a as Record<string, unknown>)[key] !== undefined);
  const right = Object.keys(b).filter((key) => (b as Record<string, unknown>)[key] !== undefined);
  if (left.length !== right.length) return false;
  for (const key of left) if (!sameData((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key])) return false;
  return true;
}

export function createFrameEditSession({
  win,
  channel,
  requestRender,
  root,
  mountCompiled,
}: FrameEditSessionOptions): FrameEditSession {
  const doc = win.document;
  let nodes: JsxNode[] = [];
  let active: ActiveHost | null = null;
  let typingReported = false;
  let disposed = false;
  const restoreScroll = (position: { x: number; y: number }) => {
    if (win.scrollX !== position.x || win.scrollY !== position.y) win.scrollTo(position.x, position.y);
  };
  const views: EditViews = { all: new Set(), last: null };
  let compiledMount: CompiledEditMount | null = null;
  /** Editors held across the redraw in progress (`holdUnchanged`), for the next mount. */
  let held: HeldEditors | null = null;
  let pendingBookmark: EditorBookmark | undefined;
  /*
   * The Undo/Redo target, held for the redraw the history step always causes. The painted draft may still
   * hold the same block (same id) in its old shape — a heading the undo turns back into its literal `### `
   * paragraph — so restoring there alone is not enough: the redraw would capture that stale caret and put
   * it back. Typing first lets the person's own caret win.
   */
  let historyBookmark: EditorBookmark | undefined;
  /** Where that target landed in the stale draft: moving the caret from there afterwards is the person's own choice. */
  let historyLanded: string | undefined;
  const restorePending = () => {
    if (pendingBookmark)
      for (const view of views.all)
        if (restoreBookmark(view, pendingBookmark)) {
          if (historyBookmark) historyLanded = JSON.stringify(captureBookmark(view.state));
          pendingBookmark = undefined;
          break;
        }
  };

  const post = (message: Record<string, unknown>) => channel.post({ ...message, nonce: channel.nonce });
  const at = (path: string) => root.querySelector(`[${AST_PATH_ATTR}="${CSS.escape(path)}"]`);

  const selection = createHoverSelect({
    win,
    root,
    nodes: () => nodes,
    views,
    activePath: () => active?.path ?? null,
    commitActive: () => commitHost(active),
    post,
  });

  // ── typing ────────────────────────────────────────────────────────────────
  const reportTyping = (isTyping: boolean) => {
    if (isTyping === typingReported) return;
    typingReported = isTyping;
    post({ type: STORY_TYPING_MESSAGE, active: isTyping });
  };

  /** Send what a host now holds, if the user really changed it. */
  const commitHost = (host: ActiveHost | null): boolean => {
    if (!host || !host.userEdited) return false;
    const innerHtml = channel.innerHtmlOf(host.el);
    if (innerHtml === host.snapshot) return false;
    host.snapshot = innerHtml;
    host.userEdited = false;
    reportTyping(false);
    post({ type: STORY_TEXT_EDIT_MESSAGE, path: host.path, innerHtml });
    return true;
  };

  /** A text host's focus, typing and blur, as solid/editor/dom-mounter reports them. */
  const hostSession = {
    onFocus(path: string, el: HTMLElement) {
      views.last = null;
      active = { path, el, snapshot: channel.innerHtmlOf(el), userEdited: false };
      selection.reportSelection(selection.describeWithQuote(el));
    },
    onInput(_path: string) {
      if (active) active.userEdited = true;
      reportTyping(true);
    },
    onBlur(_path: string) {
      const host = active;
      active = null;
      commitHost(host);
      reportTyping(false);
      requestRender(); // Keep a changed host's DOM until its source update reaches the runtime.
    },
  };

  // ── keyboard ──────────────────────────────────────────────────────────────
  const regionGeometry = createRegionGeometry(win);
  const onKeyDown = (event: KeyboardEvent) => {
    if (!root.contains(event.target as Node)) return;
    // An arrow on a region's edge line continues into the next text region.
    // Block selection keeps its own arrow behaviour.
    if (
      event.key.startsWith('Arrow') &&
      !selection.blockSelected() &&
      navigateAcrossRegions(event, {
        regions: collectTextRegions(root, views.all),
        selection: win.getSelection(),
        geometry: regionGeometry,
      })
    )
      return;
    if (event.key === 'Escape') {
      // A dialog or menu in the document closes itself first.
      if ((event.target as Element | null)?.closest?.('dialog, [role="dialog"], [role="menu"], [role="listbox"]')) return;
      // Esc CLIMBS: the caret's block, then each container up the breadcrumb,
      // then nothing. With nothing selected it keeps its old meaning.
      const selectedPath = selection.selectedPath();
      const el = selectedPath && at(selectedPath);
      if (!el) {
        post({ type: STORY_EDIT_KEY_MESSAGE, key: 'Escape' });
        return;
      }
      event.preventDefault();
      if (!selection.blockMode()) {
        selection.selectBlock(el);
        return;
      }
      const up = ancestorCrumbs(el, nodes).at(-1);
      const parent = up && at(up.path);
      if (parent) selection.selectBlock(parent);
      else selection.reportSelection(null);
      return;
    }
    if (event.key !== 'Delete' && event.key !== 'Backspace') return;
    // Inside a text host those keys belong to the text.
    if (active) return;
    const el = doc.activeElement;
    if (el && (el as HTMLElement).isContentEditable) return;
    if (!selection.selectedPath()) return;
    event.preventDefault();
    post({ type: STORY_EDIT_KEY_MESSAGE, key: event.key });
  };
  doc.addEventListener('keydown', onKeyDown, true);

  // ── paste ─────────────────────────────────────────────────────────────────
  // The image door listens first: a pasted image is taken over before the legacy-host check sees it.
  const images = createImageTransfer({
    win,
    root,
    nodes: () => nodes,
    selectedPath: selection.selectedPath,
    selectableAt: selection.selectableAt,
    selectImage: (img) => selection.reportSelection(selection.describeWithQuote(img)),
    post,
  });
  const onLegacyPaste = (event: ClipboardEvent) => {
    if (
      event.defaultPrevented ||
      !active?.el.contains(event.target as Node) ||
      !event.clipboardData?.getData('text/html')
    )
      return;
    event.preventDefault();
    post({
      type: 'mx:edit-error',
      message: 'This element supports typing and plain-text paste. Use a regular paragraph for formatted paste.',
    });
  };
  doc.addEventListener('paste', onLegacyPaste, true);

  const style = doc.createElement('style');
  style.setAttribute(EDIT_CSS_ATTR, '');
  style.textContent = EDIT_MODE_CSS;
  doc.head.appendChild(style);

  post({ type: STORY_EDIT_READY_MESSAGE });

  // ── parent → frame ────────────────────────────────────────────────────────
  const format = createFormatLink({ win, root, views, channel, post, republishRect: selection.republishRect });

  return {
    canApplyDraft() { return !typingReported && !active?.userEdited; },
    reconcileDraft(before, after, next, draft, options) { return !disposed && !!compiledMount?.reconcile(before, after, next, draft, options); },
    holdUnchanged(next, draft) {
      held?.dispose();
      held = null;
      if (disposed || !compiledMount) return new Map();
      // What is half-typed is handed over first: an editor is held for the prose it has handed over.
      for (const view of views.all) flushFlowView(view);
      held = compiledMount.hold(next, draft);
      return held.stands;
    },
    unmountCompiledDom() {
      for (const view of views.all) flushFlowView(view);
      const toolbarFocus = doc.activeElement instanceof HTMLElement
        && !!doc.activeElement.closest('[aria-label="Typography toolbar"]');
      const focused = [...views.all].find((view) => view.hasFocus()) ?? (toolbarFocus ? views.last : null);
      // An explicit Undo/Redo target may name blocks that do not exist in the
      // currently painted draft. Keep it until the replacement DOM is mounted.
      const caret = focused ? captureBookmark(focused.state) : undefined;
      if (historyBookmark && (historyLanded === undefined || historyLanded === JSON.stringify(caret))) pendingBookmark = historyBookmark;
      else if (caret && !pendingBookmark) pendingBookmark = caret;
      historyBookmark = historyLanded = undefined;
      compiledMount?.dispose(); compiledMount = null;
      views.all.clear();
    },
    async mountCompiledDom() {
      if (disposed) return;
      const readerScroll = { x: win.scrollX, y: win.scrollY };
      compiledMount?.dispose();
      const keep = held ?? undefined;
      held = null;
      compiledMount = mountCompiled(root, nodes, {
        onFlow(path, expected, replacement, group, change) {
          historyBookmark = historyLanded = undefined;
          post({ type: STORY_FLOW_EDIT_MESSAGE, path, expected, replacement, group, selection: change });
        },
        onLayout(rects) { post({ type: STORY_LAYOUT_EDIT_MESSAGE, rects }); },
        onSlideTitle(path, title) { post({ type: STORY_SLIDE_TITLE_MESSAGE, path, title }); },
        onError(message) { post({ type: 'mx:edit-error', message }); },
        onBusy: reportTyping,
        onView(view) {
          if (view) { views.all.add(view); views.last = view; win.requestAnimationFrame(restorePending); }
          else { for (const entry of [...views.all]) if (!entry.dom.isConnected) views.all.delete(entry); }
        },
        onHostFocus: hostSession.onFocus,
        onHostInput: hostSession.onInput,
        onHostBlur: hostSession.onBlur,
      }, keep);
      // Replacing prose with ProseMirror briefly shortens the page. Put the reader back after
      // layout settles; a draft recompile uses this same mounter and keeps its visible place.
      win.requestAnimationFrame(() => win.requestAnimationFrame(() => {
        if (!disposed) restoreScroll(readerScroll);
      }));
    },
    renameSlide(path: string, title: string) {
      post({ type: STORY_SLIDE_TITLE_MESSAGE, path, title });
    },
    setNodes(next: JsxNode[]) {
      if (next === nodes) return;
      // A refetch can deserialize the same document into fresh objects. It is
      // not an edit and must not cancel a selection or an active resize.
      // Compared in place, stopping at the first difference: serializing a report's tree at every pause was most
      // of the pause.
      if (sameData(next, nodes)) {
        nodes = next;
        return;
      }
      nodes = next;
      selection.nodesChanged();
    },
    onParentMessage(message: StoryEditParentMessage) {
      const view = views.last && views.all.has(views.last) ? views.last : null;
      switch (message.type) {
        case STORY_INLINE_MESSAGE:
          if (view) {
            view.dispatch(toggleInline(view.state, message.tag).setMeta('mx-command', true));
            view.focus();
          }
          break;
        case STORY_PASTE_MESSAGE:
          if (view) {
            try {
              const ast = clipboardAst(message.kind, message.value);
              const tr = view.state.tr;
              view.dispatch(
                (view.state.selection.$from.parent.attrs.tag === 'pre'
                  ? tr.insertText(message.value)
                  : tr.replaceSelection(pasteFragment(ast))
                ).setMeta('uiEvent', 'paste'),
              );
              view.focus();
            } catch (error) {
              post({
                type: 'mx:edit-error',
                message: error instanceof Error ? error.message : 'Paste could not be inserted.',
              });
            }
          } else post({ type: 'mx:edit-error', message: 'Select a regular text paragraph before inserting Markdown.' });
          break;
        case STORY_APPLY_FORMAT_MESSAGE:
          format.applyFormat(message.path, message.className, message.style);
          break;
        case STORY_APPLY_LINK_MESSAGE:
          format.applyLink(message.path, message.href);
          break;
        case STORY_COMMIT_MESSAGE:
          if (message.restore) {
            pendingBookmark = historyBookmark = message.restore;
            win.requestAnimationFrame(restorePending);
            break;
          }
          // Whatever is half-typed, hand it over — the page is leaving.
          for (const entry of views.all) flushFlowView(entry);
          commitHost(active);
          post({ type: STORY_COMMITTED_MESSAGE });
          break;
        case STORY_SELECT_MESSAGE:
          selection.select(message);
          break;
        case STORY_SPOTLIGHT_MESSAGE:
          selection.setSpotlight(message.paths);
          break;
        default:
          break;
      }
    },
    dispose() {
      compiledMount?.dispose();
      compiledMount = null;
      held?.dispose();
      held = null;
      // No scroll is put back here: leaving edit mode, the page moves the document itself as its chrome changes
      // (solid/pages/Document `keepReadingPlace`), and restoring this moment's scroll a frame later undid that.
      disposed = true;
      selection.dispose();
      commitHost(active);
      active = null;
      reportTyping(false);
      doc.removeEventListener('keydown', onKeyDown, true);
      doc.removeEventListener('paste', onLegacyPaste, true);
      images.dispose();
      style.remove();
    },
  };
}
