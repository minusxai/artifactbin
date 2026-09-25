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
import type { ReactElement, ReactNode } from 'react';
import { cloneElement, createElement } from 'react';
import { serializeJsx, type JsxElement, type JsxNode } from '@/lib/jsx';
import { restoreBookmark, type EditorBookmark, type EditorSelectionChange } from '@/lib/editor-v2/bookmark';
import { FlowEditor } from '@/lib/editor-v2/flow-editor';
import { createNodeChrome, HOVER_GRIP_ATTR, NODE_CHROME_SELECTOR } from '@/lib/editor-v2/node-chrome';
import { createBlockSelection } from '@/lib/editor-v2/block-selection';
import { gridCols, gridRowHeight } from '@/lib/story-ui/grid-layout';
import { resolveJsxNodeAtPath } from '@/lib/story-ui/host-classify';
import { isProseTree, inlineStates, toggleInline, pasteFragment, editorSchema } from '@/lib/editor-v2/model';
import { clipboardAst } from '@/lib/editor-v2/clipboard';
import type { EditorView } from 'prosemirror-view';
import { isEditableTextHost } from '@/lib/story-ui/host-classify';
import { normalizeLinkHref } from '@/lib/data/story/link-edit';
import { AST_PATH_ATTR } from '@/lib/story-ui/ast-path';
import type { RuntimeChannel } from '../pristine';
import {
  STORY_EDIT_KEY_MESSAGE,
  STORY_EDIT_READY_MESSAGE,
  STORY_IMAGE_DROP_MESSAGE,
  STORY_IMAGE_REPLACE_MESSAGE,
  STORY_SELECTION_MESSAGE,
  STORY_INLINE_MESSAGE,
  STORY_PASTE_MESSAGE,
  STORY_BLOCK_EDIT_MESSAGE,
  STORY_HISTORY_MESSAGE,
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
  type StoryEditSelection,
} from '../contract';
import { ancestorCrumbs, describeSelection } from './describe-selection';
import { captureSelection } from './selection-range';
import { EditableHost } from './editable-host';
import { GridEdit } from './grid-edit';
import { imageFileFromTransfer } from './image-drop';
import { collectTextRegions, createRegionGeometry, navigateAcrossRegions } from './arrow-navigation';
import { SELECTION_PRESENTATION } from '../selection-presentation';
import { canResize, editChromeKind, gripTarget, isComponentPart } from './edit-chrome';
import { nodeName } from '@/lib/story-ui/node-names';

/** Marks the selected node so the reader can see what the toolbar is pointed at. Value: 'block' when block-selected, else 'text' (typing). */
export const EDIT_SELECTED_ATTR = 'data-mx-selected';
/** Marks the selected COMPONENT. Its own attribute: two writers on one attribute take turns clearing each other. */
export const EDIT_EMBED_SELECTED_ATTR = 'data-mx-embed-selected';
/** Marks the selectable node under the pointer while edit mode is live. Value: its edit-chrome kind (drives the cursor only). */
export const EDIT_HOVER_ATTR = 'data-mx-edit-hover';
/** Marks nodes the page pointed at (STORY_SPOTLIGHT_MESSAGE) — outlined, never selected. */
export const EDIT_SPOTLIGHT_ATTR = 'data-mx-edit-spotlight';
/** Marks the image a dragged file would REPLACE if dropped now. */
export const EDIT_DROP_REPLACE_ATTR = 'data-mx-drop-replace';
/** The "Drop to replace" label drawn over that image — chrome, never document. */
const DROP_REPLACE_LABEL_ATTR = 'data-mx-drop-replace-label';
/** That image's mark: a dashed neutral line and a faint veil, so "drop here" never reads as selected. */
const DROP_REPLACE_CSS = 'outline: 2px dashed rgba(100, 116, 139, 0.9) !important; outline-offset: 3px !important; opacity: 0.75 !important;';

/** The story root while editing: focusable, so a block selection keeps the keyboard in the document. */
const EDIT_ROOT_ATTR = 'data-mx-edit-root';

/**
 * Selection chrome, injected on entering edit mode and removed on leaving.
 * NOT part of the document's served stylesheet: a reader must never download
 * or apply editor chrome.
 */
const EDIT_MODE_CSS = [
  '.ProseMirror { outline: none; white-space: pre-wrap; overflow-wrap: break-word; }',
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
  /** Wrap a rendered element for edit mode. Chained after the runtime's own decorator. */
  decorateChildren(children: ReactNode[], nodes: JsxNode[], parentPath: string): ReactNode;
  decorate(element: ReactElement, node: JsxElement, path: string): ReactNode;
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
  root?: HTMLElement;
  /** Ask the runtime to re-render (a new body epoch releases the focus guard). */
  requestRender: () => void;
}

export function createFrameEditSession({
  win,
  channel,
  requestRender,
  root,
}: FrameEditSessionOptions): FrameEditSession {
  const doc = win.document;
  const scope = root ?? doc;
  let nodes: JsxNode[] = [];
  let nodesContent = JSON.stringify(nodes);
  let active: ActiveHost | null = null;
  let selectedPath: string | null = null;
  /**
   * TYPING (a caret in text: no outline, no handles) or BLOCK SELECTED (the
   * block's outline, handles and toolbar options; no caret) — never both.
   */
  let blockMode = false;
  let hovered: Element | null = null;
  let typingReported = false;
  let bodyEpoch = 0;
  let disposed = false;
  let entering = true;
  const entryScroll = { x: win.scrollX, y: win.scrollY };
  const restoreScroll = (position: { x: number; y: number }) => {
    if (win.scrollX !== position.x || win.scrollY !== position.y) win.scrollTo(position.x, position.y);
  };
  const views = new Set<EditorView>();
  let pendingBookmark: EditorBookmark | undefined;
  const restorePending = () => {
    if (pendingBookmark)
      for (const view of views)
        if (restoreBookmark(view, pendingBookmark)) {
          pendingBookmark = undefined;
          break;
        }
  };
  let lastView: EditorView | null = null;

  const post = (message: Record<string, unknown>) => channel.post({ ...message, nonce: channel.nonce });

  const blockSelection = createBlockSelection(doc, scope, (command) =>
    post({ type: STORY_BLOCK_EDIT_MESSAGE, command }),
  );
  const chrome = createNodeChrome(
    doc,
    (command) => {
      commitHost(active);
      post({ type: STORY_BLOCK_EDIT_MESSAGE, command });
    },
    (el) => selectBlock(el),
  );

  // ── selection ─────────────────────────────────────────────────────────────
  const stampSelection = () => {
    for (const el of scope.querySelectorAll(`[${EDIT_SELECTED_ATTR}], [${EDIT_EMBED_SELECTED_ATTR}]`)) {
      el.removeAttribute(EDIT_SELECTED_ATTR);
      el.removeAttribute(EDIT_EMBED_SELECTED_ATTR);
    }
    const range = win.getSelection();
    const deselect = () => {
      chrome.select(null, null);
      refreshGrip();
    };
    if (!selectedPath || blockSelection.paths().length || (range && !range.isCollapsed && scope.contains(range.anchorNode)))
      return deselect();
    const el = scope.querySelector(`[${AST_PATH_ATTR}="${CSS.escape(selectedPath)}"]`);
    if (!el) return deselect();
    const kind = describeSelection(el, nodes)?.kind;
    el.setAttribute(kind === 'embed' ? EDIT_EMBED_SELECTED_ATTR : EDIT_SELECTED_ATTR, blockMode ? 'block' : 'text');
    if (!blockMode) return deselect();
    const node = resolveJsxNodeAtPath(nodes, selectedPath);
    const parent = resolveJsxNodeAtPath(nodes, selectedPath.split('.').slice(0, -1).join('.'));
    const props =
      parent?.type === 'element'
        ? Object.fromEntries(parent.attributes.flatMap((a) => (a.value.static ? [[a.name, a.value.json]] : [])))
        : {};
    const grid =
      node?.type === 'element' && node.tag === 'GridItem'
        ? {
            cols: gridCols(props.cols),
            rowHeight: gridRowHeight(props.rowHeight),
            width: el.parentElement?.getBoundingClientRect().width ?? el.getBoundingClientRect().width,
            positioned: props.mode !== 'flow',
          }
        : undefined;
    const inlineOrDrawingPart =
      node?.type === 'element' &&
      (['span', 'strong', 'b', 'em', 'i', 'a', 'code', 'br', 'small', 'sup', 'sub', 's', 'del', 'u'].includes(
        node.tag,
      ) ||
        (el.namespaceURI === 'http://www.w3.org/2000/svg' && node.tag !== 'svg'));
    chrome.select(inlineOrDrawingPart ? null : (el as HTMLElement), inlineOrDrawingPart ? null : selectedPath, grid, {
      resizable: node?.type === 'element' && canResize(node),
      label: node?.type === 'element' ? nodeName(node.tag) : 'Block',
      parent: parentName(selectedPath),
    });
    refreshGrip();
  };

  /** What the block's parent is called, a component's own parts folded into the component. */
  const parentName = (path: string) => {
    for (let at = path.split('.').slice(0, -1); at.length; at.pop()) {
      const node = resolveJsxNodeAtPath(nodes, at.join('.'));
      if (node?.type !== 'element') break;
      if (!isComponentPart(node, resolveJsxNodeAtPath(nodes, at.slice(0, -1).join('.')))) return nodeName(node.tag);
    }
    return 'document';
  };

  /** One grip: beside the block under the pointer, else (a touch screen has no hover) the block with the caret. */
  const refreshGrip = () => {
    const caret = !blockMode && selectedPath ? scope.querySelector(`[${AST_PATH_ATTR}="${CSS.escape(selectedPath)}"]`) : null;
    const under = hovered ?? caret;
    chrome.hover(under && gripTarget(under, nodes));
  };

  /**
   * BLOCK-select `el` (a grip, the breadcrumb, Esc, a click on a chart): the
   * caret goes, and keyboard focus stays in the document (on the story root)
   * so the next Esc climbs and Delete deletes.
   */
  const selectBlock = (el: Element) => {
    const target = gripTarget(el, nodes) ?? el;
    const focused = doc.activeElement as HTMLElement | null;
    if (focused && focused !== root && scope.contains(focused)) focused.blur();
    win.getSelection()?.removeAllRanges();
    if (root) {
      root.setAttribute(EDIT_ROOT_ATTR, '');
      if (!root.hasAttribute('tabindex')) root.tabIndex = -1;
      root.focus({ preventScroll: true });
    }
    reportSelection(describeSelection(target, nodes), true);
  };

  /**
   * An element described for the parent, WITH the words the user has selected
   * inside it when there are any. The editor's "Comment on selection" reaches
   * the same composer as the view-mode bubble, so it must hand it the same
   * quote — without this a comment made from the toolbar keeps the node and
   * loses the sentence. Absent for a bare caret, which has selected nothing.
   */
  const describeWithQuote = (el: Element): StoryEditSelection | null => {
    const selection = describeSelection(el, nodes);
    if (!selection) return null;
    for (const view of views)
      if (view.dom.contains(el)) {
        selection.inline = inlineStates(view.state);
        break;
      }
    const captured = captureSelection(win, el);
    if (captured) {
      selection.quote = captured.quote;
      selection.range = captured.range;
    }
    return selection;
  };

  const reportSelection = (selection: StoryEditSelection | null, block = false) => {
    selectedPath = selection?.path ?? null;
    blockMode = !!selection && block;
    if (selection) selection.mode = blockMode ? 'block' : 'typing';
    stampSelection();
    post({ type: STORY_SELECTION_MESSAGE, selection });
  };

  /** Re-measure and re-send whatever is selected — the document scrolls itself. */
  const republishRect = () => {
    if (!selectedPath && !active) return;
    const path = active?.path ?? selectedPath!;
    const el = scope.querySelector(`[${AST_PATH_ATTR}="${CSS.escape(path)}"]`);
    const selection = el ? describeWithQuote(el) : null;
    if (selection) selection.mode = blockMode && !active ? 'block' : 'typing';
    post({ type: STORY_SELECTION_MESSAGE, selection });
  };

  // ── typing ────────────────────────────────────────────────────────────────
  const reportTyping = (isTyping: boolean) => {
    if (isTyping === typingReported) return;
    typingReported = isTyping;
    post({ type: STORY_TYPING_MESSAGE, active: isTyping });
  };

  /** Send what a host now holds, if the user really changed it. */
  const commitHost = (host: ActiveHost | null) => {
    if (!host || !host.userEdited) return;
    const innerHtml = channel.innerHtmlOf(host.el);
    if (innerHtml === host.snapshot) return;
    host.snapshot = innerHtml;
    host.userEdited = false;
    reportTyping(false);
    post({ type: STORY_TEXT_EDIT_MESSAGE, path: host.path, innerHtml });
  };

  const hostSession = {
    isEditing: (path: string) => active?.path === path,
    onFocus(path: string, el: HTMLElement) {
      lastView = null;
      active = { path, el, snapshot: channel.innerHtmlOf(el), userEdited: false };
      reportSelection(describeWithQuote(el));
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
      requestRender(); // the focus guard is released; let React reconcile again
    },
  };

  // ── document listeners ────────────────────────────────────────────────────
  /** Resolve the same selectable node a click would, excluding duplicate document chrome. */
  const selectableAt = (target: EventTarget | null): Element | null => {
    const element = target as Element | null;
    if (
      !element?.closest ||
      (root && !root.contains(element)) ||
      element.closest(`.mx-rail, .mx-present, ${NODE_CHROME_SELECTOR}`)
    )
      return null;
    const stamped = element.closest(`[${AST_PATH_ATTR}]`);
    return stamped && describeSelection(stamped, nodes) ? stamped : null;
  };

  const setHovered = (next: Element | null) => {
    if (hovered === next) return;
    hovered?.removeAttribute(EDIT_HOVER_ATTR);
    hovered = next;
    hovered?.setAttribute(EDIT_HOVER_ATTR, editChromeKind(hovered));
    refreshGrip();
  };

  /** The whole set each time (the message is idempotent); the first found scrolls into view. */
  const setSpotlight = (paths: string[]) => {
    for (const el of scope.querySelectorAll(`[${EDIT_SPOTLIGHT_ATTR}]`)) el.removeAttribute(EDIT_SPOTLIGHT_ATTR);
    let first: Element | null = null;
    for (const path of paths) {
      const el = scope.querySelector(`[${AST_PATH_ATTR}="${CSS.escape(path)}"]`);
      if (!el) continue;
      el.setAttribute(EDIT_SPOTLIGHT_ATTR, '');
      first ??= el;
    }
    // jsdom has no scrollIntoView; a browser scrolls the nearest edge in.
    first?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' });
  };

  const onFocusIn = (event: FocusEvent) => {
    const target = event.target as Node;
    lastView = [...views].find((view) => view.dom.contains(target)) ?? lastView;
  };
  doc.addEventListener('focusin', onFocusIn);
  const onSelectionChange = () => {
    const selection = win.getSelection();
    const target = selection?.anchorNode?.parentElement;
    if (!target?.closest('.ProseMirror') || (root && !root.contains(target))) return;
    lastView = [...views].find((view) => view.dom.contains(target)) ?? lastView;
    const el = target.closest(`[${AST_PATH_ATTR}]`);
    if (el) reportSelection(describeWithQuote(el));
  };
  doc.addEventListener('selectionchange', onSelectionChange);

  // The margin grip sits beside the hovered block: travelling onto it keeps that hover.
  const onGrip = (target: EventTarget | null) => !!(target as Element | null)?.closest?.(`[${HOVER_GRIP_ATTR}]`);
  const onPointerOver = (event: PointerEvent) => {
    if (!onGrip(event.target)) setHovered(selectableAt(event.target));
  };
  const onPointerOut = (event: PointerEvent) => {
    if (!onGrip(event.relatedTarget)) setHovered(selectableAt(event.relatedTarget));
  };

  const onClick = (event: Event) => {
    const target = event.target as Element | null;
    if (root && (!target || !root.contains(target))) return;
    if (!target?.closest) return;
    // Chrome the document draws for itself (the deck rail and its slide
    // previews) re-renders the slide's own nodes, so ids and AST stamps appear
    // twice — a click there must never select the preview copy.
    if (target.closest(`.mx-rail, .mx-present, ${NODE_CHROME_SELECTOR}`)) return;
    if (target.closest('.ProseMirror') && target.closest('a')) event.preventDefault();
    // A drag ends with a click on the common ancestor. It is still a text
    // selection, never an instruction to resize that entire container.
    const native = win.getSelection();
    if (native && !native.isCollapsed && scope.contains(native.anchorNode)) {
      stampSelection();
      return;
    }
    const stamped = target.closest(`[${AST_PATH_ATTR}]`);
    if (!stamped) {
      reportSelection(null);
      return;
    }
    const chromeKind = editChromeKind(stamped);
    // Nothing to type in a chart or an image: a click selects it.
    if (chromeKind === 'block') {
      if (describeSelection(stamped, nodes)) selectBlock(stamped);
      return;
    }
    // A container's padding selects nothing (its grip, Esc and the breadcrumb
    // do) — unless the click put a caret in text inside it.
    if (chromeKind === 'container') {
      const anchor = native?.anchorNode;
      if (!(anchor && stamped.contains(anchor) && (doc.activeElement as HTMLElement | null)?.isContentEditable))
        reportSelection(null);
      return;
    }
    const selection = describeWithQuote(stamped);
    // A focused text host owns its own selection (reported on focus).
    if (selection?.kind === 'text' && active?.path === selection.path) return;
    reportSelection(selection);
  };

  const regionGeometry = createRegionGeometry(win);
  const onKeyDown = (event: KeyboardEvent) => {
    if (root && !root.contains(event.target as Node)) return;
    // An arrow on a region's edge line continues into the next text region.
    // Block selection keeps its own arrow behaviour.
    if (
      event.key.startsWith('Arrow') &&
      blockSelection.paths().length === 0 &&
      navigateAcrossRegions(event, {
        regions: collectTextRegions(scope, views),
        selection: win.getSelection(),
        geometry: regionGeometry,
      })
    )
      return;
    if ((event.ctrlKey || event.metaKey) && ['z', 'y'].includes(event.key.toLowerCase())) {
      event.preventDefault();
      commitHost(active);
      post({
        type: STORY_HISTORY_MESSAGE,
        direction: event.shiftKey || event.key.toLowerCase() === 'y' ? 'redo' : 'undo',
      });
      return;
    }
    if (event.key === 'Escape') {
      // A dialog or menu in the document closes itself first.
      if ((event.target as Element | null)?.closest?.('dialog, [role="dialog"], [role="menu"], [role="listbox"]')) return;
      // Esc CLIMBS: the caret's block, then each container up the breadcrumb,
      // then nothing. With nothing selected it keeps its old meaning.
      const el = selectedPath && scope.querySelector(`[${AST_PATH_ATTR}="${CSS.escape(selectedPath)}"]`);
      if (!el) {
        post({ type: STORY_EDIT_KEY_MESSAGE, key: 'Escape' });
        return;
      }
      event.preventDefault();
      if (!blockMode) {
        selectBlock(el);
        return;
      }
      const up = ancestorCrumbs(el, nodes).at(-1);
      const parent = up && scope.querySelector(`[${AST_PATH_ATTR}="${CSS.escape(up.path)}"]`);
      if (parent) selectBlock(parent);
      else reportSelection(null);
      return;
    }
    if (event.key !== 'Delete' && event.key !== 'Backspace') return;
    // Inside a text host those keys belong to the text.
    if (active) return;
    const el = doc.activeElement;
    if (el && (el as HTMLElement).isContentEditable) return;
    if (!selectedPath) return;
    event.preventDefault();
    post({ type: STORY_EDIT_KEY_MESSAGE, key: event.key });
  };

  // ── replacing an image ────────────────────────────────────────────────────
  /** Whether the source node at a body path is a plain `<img>` — the only image this edits. */
  const isImagePath = (path: string | null): path is string => {
    const node = path ? resolveJsxNodeAtPath(nodes, path) : null;
    return node?.type === 'element' && !node.isComponent && node.tag === 'img';
  };
  /** The plain `<img>` an event landed on, or null. Component-drawn images and CSS backgrounds are not. */
  const replaceableImageAt = (target: EventTarget | null): HTMLElement | null => {
    const el = selectableAt(target);
    return el && el.localName === 'img' && isImagePath(el.getAttribute(AST_PATH_ATTR)) ? (el as HTMLElement) : null;
  };

  /**
   * "Drop to replace": the image under a dragged file carries a mark, and a
   * label sits over it. An `<img>` cannot hold a pseudo-element, so the label
   * is its own element — styled through CSSOM (the document's CSP refuses a
   * style attribute) and transparent to the pointer, so the drop still lands
   * on the image.
   */
  /** The latest select request; a waiting reveal gives way to any newer one. */
  let selectRequest = 0;
  let dropTarget: HTMLElement | null = null;
  let dropLabel: HTMLElement | null = null;
  const markDropTarget = (el: HTMLElement | null) => {
    if (el !== dropTarget) {
      dropTarget?.removeAttribute(EDIT_DROP_REPLACE_ATTR);
      dropLabel?.remove();
      dropLabel = null;
      dropTarget = el;
      if (!el) return;
      el.setAttribute(EDIT_DROP_REPLACE_ATTR, '');
      dropLabel = doc.createElement('div');
      dropLabel.setAttribute(DROP_REPLACE_LABEL_ATTR, '');
      dropLabel.setAttribute('aria-hidden', 'true');
      dropLabel.textContent = 'Drop to replace';
      Object.assign(dropLabel.style, {
        position: 'fixed',
        zIndex: '46',
        pointerEvents: 'none',
        transform: 'translate(-50%, -50%)',
        padding: '4px 10px',
        borderRadius: '999px',
        background: 'rgba(15, 23, 42, 0.78)',
        color: '#fff',
        font: '500 12px/1.4 system-ui, sans-serif',
        whiteSpace: 'nowrap',
      });
      doc.body.append(dropLabel);
    }
    if (el && dropLabel) {
      const r = el.getBoundingClientRect();
      dropLabel.style.left = `${r.x + r.width / 2}px`;
      dropLabel.style.top = `${r.y + r.height / 2}px`;
    }
  };

  /** Parts of a line: never a gap of their own — the block holding them is. */
  const LINE_PARTS = new Set(['span', 'strong', 'b', 'em', 'i', 'a', 'code', 'br', 'small', 'sup', 'sub', 's', 'del', 'u', 'mark']);
  const isLinePart = (el: Element) => {
    const node = resolveJsxNodeAtPath(nodes, el.getAttribute(AST_PATH_ATTR) ?? '');
    return node?.type === 'element' && LINE_PARTS.has(node.tag);
  };
  /**
   * The gap a file dropped at `clientY` over `target` lands in: over a block,
   * the side of it the pointer is on; over a container's own space (its
   * padding, the space between its blocks), before the first of its blocks
   * below the pointer, or after the last. Null outside every block.
   */
  const dropGapAt = (target: EventTarget | null, clientY: number): { path: string; side: 'before' | 'after' } | null => {
    let block = selectableAt(target);
    while (block && isLinePart(block)) block = selectableAt(block.parentElement);
    if (!block) return null;
    const kids = [...block.querySelectorAll(`[${AST_PATH_ATTR}]`)].filter(
      (el) => el.parentElement?.closest(`[${AST_PATH_ATTR}]`) === block && !isLinePart(el),
    );
    const sideOf = (el: Element) => {
      const r = el.getBoundingClientRect();
      return clientY < r.top + r.height / 2 ? ('before' as const) : ('after' as const);
    };
    if (kids.length === 0) return { path: block.getAttribute(AST_PATH_ATTR)!, side: sideOf(block) };
    const below = kids.find((el) => sideOf(el) === 'before');
    return below
      ? { path: below.getAttribute(AST_PATH_ATTR)!, side: 'before' }
      : { path: kids[kids.length - 1].getAttribute(AST_PATH_ATTR)!, side: 'after' };
  };

  /** A double-click on an image opens the replace picker; the page owns the picker. */
  const onDoubleClick = (event: MouseEvent) => {
    const img = replaceableImageAt(event.target);
    if (!img) return;
    event.preventDefault();
    const path = img.getAttribute(AST_PATH_ATTR)!;
    reportSelection(describeWithQuote(img));
    post({ type: STORY_IMAGE_REPLACE_MESSAGE, path });
  };

  /**
   * Paste and drop are ONE door: both carry a DataTransfer, and an image in
   * either means the same insert. The event is taken over only when an image is
   * actually there — a text paste is the common act and must reach the text
   * host untouched, and a file we do not accept is better left to the browser
   * than silently eaten.
   */
  const onImageTransfer = (event: ClipboardEvent | DragEvent) => {
    // A selected image holds no focus, so ⌘V lands on the unfocused <body> —
    // outside a rooted session's story, yet plainly meant for that image.
    const onBody = event.target === doc.body || event.target === doc.documentElement;
    const forSelectedImage = event.type === 'paste' && onBody && isImagePath(selectedPath);
    if (root && !root.contains(event.target as Node) && !forSelectedImage) return;
    const data = 'clipboardData' in event ? event.clipboardData : event.dataTransfer;
    const file = imageFileFromTransfer(data);
    if (event.type === 'drop') markDropTarget(null);
    if (!file) return;
    event.preventDefault();
    // Onto an image, or pasted while one is selected: that image is replaced.
    const target =
      event.type === 'drop'
        ? replaceableImageAt(event.target)?.getAttribute(AST_PATH_ATTR)
        : isImagePath(selectedPath) ? selectedPath : null;
    // Not onto an image: a drop lands in the gap it was dropped in; a paste is placed by the page.
    const at = !target && event.type === 'drop' ? { at: dropGapAt(event.target, (event as DragEvent).clientY) } : {};
    post({ type: STORY_IMAGE_DROP_MESSAGE, file, ...(target ? { target } : {}), ...at });
  };

  /**
   * A drop target only receives `drop` if `dragover` was prevented, but doing
   * that unconditionally would make the whole document swallow every drag —
   * so it is prevented only while a FILE is being dragged.
   */
  const onDragOver = (event: DragEvent) => {
    if (root && !root.contains(event.target as Node)) {
      markDropTarget(null);
      return;
    }
    const files = !!event.dataTransfer?.types?.includes('Files');
    if (files) event.preventDefault();
    markDropTarget(files ? replaceableImageAt(event.target) : null);
  };
  /** Leaving the image (or the window) takes the mark; entering another element re-marks on its dragover. */
  const onDragLeave = (event: DragEvent) => {
    if (!dropTarget) return;
    const next = event.relatedTarget as Node | null;
    if (!next || !dropTarget.contains(next)) markDropTarget(null);
  };
  const onDragEnd = () => markDropTarget(null);

  let scrollQueued = false;
  const onScroll = () => {
    if (scrollQueued) return;
    scrollQueued = true;
    win.requestAnimationFrame(() => {
      scrollQueued = false;
      if (!disposed) republishRect();
    });
  };

  doc.addEventListener('click', onClick, true);
  doc.addEventListener('pointerover', onPointerOver, true);
  doc.addEventListener('pointerout', onPointerOut, true);
  doc.addEventListener('keydown', onKeyDown, true);
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
  doc.addEventListener('paste', onImageTransfer as EventListener, true);
  doc.addEventListener('paste', onLegacyPaste, true);
  doc.addEventListener('drop', onImageTransfer as EventListener, true);
  doc.addEventListener('dragover', onDragOver as EventListener, true);
  doc.addEventListener('dragleave', onDragLeave as EventListener, true);
  doc.addEventListener('dragend', onDragEnd, true);
  doc.addEventListener('dblclick', onDoubleClick, true);
  win.addEventListener('scroll', onScroll, { passive: true });
  win.addEventListener('resize', onScroll, { passive: true });

  const style = doc.createElement('style');
  style.setAttribute(EDIT_CSS_ATTR, '');
  style.textContent = EDIT_MODE_CSS;
  doc.head.appendChild(style);

  post({ type: STORY_EDIT_READY_MESSAGE });

  // ── parent → frame ────────────────────────────────────────────────────────
  const applyFormat = (path: string, className?: string, style_?: string) => {
    const el = scope.querySelector(`[${AST_PATH_ATTR}="${CSS.escape(path)}"]`);
    if (!el) return;
    const editor = [...views].find((view) => view.dom.contains(el));
    if (editor && className !== undefined) {
      let position: number | null = null;
      editor.state.doc.descendants((_node, pos) => {
        if (editor.nodeDOM(pos) === el) position = pos;
      });
      if (position !== null) {
        const node = editor.state.doc.nodeAt(position)!;
        const original = node.attrs.source as JsxElement | null;
        const attributes = (original?.attributes ?? []).filter((a) => !['class', 'className'].includes(a.name));
        if (className)
          attributes.push({ name: 'className', value: { static: true, json: className }, start: 0, end: 0 });
        editor.dispatch(
          editor.state.tr
            .setNodeMarkup(position, undefined, { ...node.attrs, source: { ...original, attributes } })
            .setMeta('mx-command', true),
        );
        republishRect();
        return;
      }
    }
    if (className !== undefined) {
      if (className.trim()) el.setAttribute('class', className);
      else el.removeAttribute('class');
    }
    if (style_ !== undefined) {
      if (style_.trim()) el.setAttribute('style', style_);
      else el.removeAttribute('style');
    }
    republishRect();
  };

  /**
   * Wrap or unwrap the live text selection in a link. Only this document holds
   * a Selection, so the parent asks and this answers with the host's new HTML
   * through the ordinary text-edit channel.
   */
  const applyLink = (path: string, href: string | null) => {
    if (lastView && views.has(lastView)) {
      const view = lastView,
        { from, to } = view.state.selection,
        tr = view.state.tr;
      const safe = href ? normalizeLinkHref(href) : null;
      if (href && !safe) return;
      view.state.doc.nodesBetween(from, to, (node) => {
        for (const mark of node.marks) if (mark.attrs.tag === 'a') tr.removeMark(from, to, mark);
      });
      if (safe)
        tr.addMark(
          from,
          to,
          editorSchema.marks.inline.create({
            tag: 'a',
            source: {
              type: 'element',
              tag: 'a',
              isComponent: false,
              attributes: [{ name: 'href', value: { static: true, json: safe }, start: 0, end: 0 }],
              children: [],
              selfClosing: false,
              start: 0,
              end: 0,
            },
          }),
        );
      view.dispatch(tr.setMeta('mx-command', true));
      view.focus();
      return;
    }
    const host = scope.querySelector(`[${AST_PATH_ATTR}="${CSS.escape(path)}"]`) as HTMLElement | null;
    if (!host) return;
    const selection = win.getSelection();
    if (!selection || selection.rangeCount === 0) return;
    const range = selection.getRangeAt(0);
    if (!host.contains(range.commonAncestorContainer)) return;
    if (href) {
      /*
       * VALIDATED HERE, not only where it was typed.
       *
       * The page asks for this link, and the page is trusted — but a URL that
       * becomes an `href` is executable if its scheme says so, and "somebody
       * upstream checked" is not a property this document can verify. The door
       * that rejects active-content schemes is pure and costs nothing, so it
       * runs on both sides. (The write-back sanitizes again before anything is
       * stored; this is about what the LIVE document carries in between.)
       */
      const safe = normalizeLinkHref(href);
      if (!safe) return;
      // Restated at the sink against literal prefixes. `normalizeLinkHref` is
      // the door and it is tested; this line is what a reader (and a scanner)
      // can check WITHOUT leaving the function that writes the attribute.
      if (!(
        safe.startsWith('https://') ||
        safe.startsWith('http://') ||
        safe.startsWith('mailto:') ||
        safe.startsWith('tel:') ||
        safe.startsWith('/') ||
        safe.startsWith('#')
      ))
        return;
      const anchor = doc.createElement('a');
      anchor.setAttribute('href', safe);
      anchor.setAttribute('target', '_blank');
      anchor.setAttribute('rel', 'noopener noreferrer');
      try {
        range.surroundContents(anchor);
      } catch {
        return;
      } // a partial selection across elements
    } else {
      const anchor =
        (range.commonAncestorContainer as Element).parentElement?.closest?.('a') ??
        (range.commonAncestorContainer as Element).closest?.('a');
      if (!anchor) return;
      anchor.replaceWith(...Array.from(anchor.childNodes));
    }
    post({ type: STORY_TEXT_EDIT_MESSAGE, path, innerHtml: channel.innerHtmlOf(host) });
  };

  return {
    decorateChildren(children: ReactNode[], source: JsxNode[], parentPath: string): ReactNode {
      const result: ReactNode[] = [];
      for (let index = 0; index < source.length;) {
        const start = index;
        // Inline children belong to their parent textblock, never nested editors.
        const isBlock = (n: JsxNode) =>
          n.type === 'element' &&
          ![
            'thead',
            'tbody',
            'tfoot',
            'tr',
            'td',
            'th',
            'span',
            'strong',
            'b',
            'em',
            'i',
            'a',
            'code',
            'br',
            'small',
            'sup',
            'sub',
            's',
            'del',
            'u',
          ].includes(n.tag) &&
          isProseTree(n);
        if (!isBlock(source[index])) {
          result.push(children[index++]);
          continue;
        }
        index++;
        while (
          index < source.length &&
          (isBlock(source[index]) ||
            (source[index].type === 'text' && !(source[index] as { value: string }).value.trim()))
        )
          index++;
        let previous = source.slice(start, index);
        const path = [parentPath, String(start)].filter(Boolean).join('.');
        const first = previous[0];
        const id = first.type === 'element' ? first.attributes.find((a) => a.name === 'id')?.value : null;
        let regionView: EditorView | null = null;
        result.push(
          createElement(FlowEditor, {
            key: id?.static ? String(id.json) : path,
            nodes: previous,
            path,
            onError(message: string) {
              post({ type: 'mx:edit-error', message });
            },
            onBusy: reportTyping,
            canEdit: () => blockSelection.paths().length === 0,
            onView(view: EditorView | null) {
              if (regionView) views.delete(regionView);
              regionView = view;
              if (view) {
                views.add(view);
                win.requestAnimationFrame(restorePending);
                if (view.hasFocus()) {
                  lastView = view;
                  win.queueMicrotask(() => {
                    const anchor = doc.getSelection()?.anchorNode;
                    const el = (anchor?.nodeType === 1 ? (anchor as Element) : anchor?.parentElement)?.closest(
                      '[data-mx-ast]',
                    );
                    if (el && view.dom.contains(el)) reportSelection(describeWithQuote(el));
                  });
                }
              }
              if (view && entering)
                win.requestAnimationFrame(() => {
                  restoreScroll(entryScroll);
                  entering = false;
                });
            },
            onChange(next: JsxNode[], group?: string, selection?: EditorSelectionChange) {
              post({
                type: STORY_FLOW_EDIT_MESSAGE,
                path,
                expected: serializeJsx(previous),
                replacement: serializeJsx(next),
                group,
                selection,
              });
              previous = next;
            },
          }),
        );
      }
      return result;
    },
    decorate(element: ReactElement, node: JsxElement, path: string): ReactNode {
      // A grid becomes draggable: only the document knows how wide its columns
      // are, so the drag happens here and the rects travel (edit/grid-edit).
      if (node.isComponent && node.tag === 'Grid') {
        // Flow uses the reader tree unchanged; overlay handles own its layout gestures.
        if (node.attributes.some((a) => a.name === 'mode' && a.value?.static && a.value.json === 'flow'))
          return element;
        return createElement(GridEdit, {
          key: (element as ReactElement).key ?? path,
          props: (element as ReactElement<Record<string, unknown>>).props,
          onLayout: (rects) => post({ type: STORY_LAYOUT_EDIT_MESSAGE, rects }),
        });
      }
      /*
       * A <Video> card is an <a> to the video's own page. While editing, that
       * link would swallow the click meant to SELECT the embed and take the
       * author out of their own document; the kit already has the seam for it.
       */
      if (node.isComponent && node.tag === 'Video') {
        return cloneElement(element as ReactElement<Record<string, unknown>>, { interactive: false });
      }
      if (node.isComponent || !isEditableTextHost(node)) return element;
      return createElement(EditableHost, {
        key: (element as ReactElement).key ?? path,
        path,
        session: hostSession,
        bodyEpoch,
        children: element as ReactElement<Record<string, unknown>>,
      });
    },
    renameSlide(path: string, title: string) {
      post({ type: STORY_SLIDE_TITLE_MESSAGE, path, title });
    },
    setNodes(next: JsxNode[]) {
      if (next === nodes) return;
      // A refetch can deserialize the same document into fresh objects. It is
      // not an edit and must not cancel a selection or an active resize.
      const nextContent = JSON.stringify(next);
      if (nextContent === nodesContent) {
        nodes = next;
        return;
      }
      nodesContent = nextContent;
      chrome.cancel();
      blockSelection.clear();
      nodes = next;
      bodyEpoch += 1; // a different document: focused hosts must reconcile
      // The selected node may not exist in the new document.
      if (
        selectedPath &&
        !describeSelection(
          scope.querySelector(`[${AST_PATH_ATTR}="${CSS.escape(selectedPath)}"]`) ?? doc.createElement('div'),
          nodes,
        )
      )
        selectedPath = null;
      stampSelection();
    },
    onParentMessage(message: StoryEditParentMessage) {
      switch (message.type) {
        case STORY_INLINE_MESSAGE:
          if (lastView && views.has(lastView)) {
            lastView.dispatch(toggleInline(lastView.state, message.tag).setMeta('mx-command', true));
            lastView.focus();
          }
          break;
        case STORY_PASTE_MESSAGE:
          if (lastView && views.has(lastView)) {
            try {
              const ast = clipboardAst(message.kind, message.value);
              const tr = lastView.state.tr;
              lastView.dispatch(
                (lastView.state.selection.$from.parent.attrs.tag === 'pre'
                  ? tr.insertText(message.value)
                  : tr.replaceSelection(pasteFragment(ast))
                ).setMeta('uiEvent', 'paste'),
              );
              lastView.focus();
            } catch (error) {
              post({
                type: 'mx:edit-error',
                message: error instanceof Error ? error.message : 'Paste could not be inserted.',
              });
            }
          } else post({ type: 'mx:edit-error', message: 'Select a regular text paragraph before inserting Markdown.' });
          break;
        case STORY_APPLY_FORMAT_MESSAGE:
          applyFormat(message.path, message.className, message.style);
          break;
        case STORY_APPLY_LINK_MESSAGE:
          applyLink(message.path, message.href);
          break;
        case STORY_COMMIT_MESSAGE:
          if (message.restore) {
            pendingBookmark = message.restore;
            win.requestAnimationFrame(restorePending);
            break;
          }
          // Whatever is half-typed, hand it over — the page is leaving.
          commitHost(active);
          post({ type: STORY_COMMITTED_MESSAGE });
          break;
        case STORY_SELECT_MESSAGE: {
          const request = ++selectRequest;
          if (!message.path) {
            reportSelection(null);
            break;
          }
          const path = message.path;
          const described = () => {
            const el = scope.querySelector(`[${AST_PATH_ATTR}="${CSS.escape(path)}"]`);
            return el && describeSelection(el, nodes) ? { el } : null;
          };
          /** Scroll it to the middle — and again once an image has its height, or it lands half-shown. */
          const bringIntoView = (el: Element) => {
            const go = () => el.scrollIntoView?.({ block: 'center', behavior: 'smooth' });
            if (el.localName === 'img' && !(el as HTMLImageElement).complete) el.addEventListener('load', go, { once: true });
            go();
          };
          const found = described();
          if (found || !message.reveal) {
            if (found) selectBlock(found.el);
            else reportSelection(null);
            if (found && message.reveal) bringIntoView(found.el);
            break;
          }
          // Just inserted: the new document may not be drawn yet. Wait for it, briefly.
          let tries = 0;
          const wait = () => {
            if (disposed || request !== selectRequest) return;
            const late = described();
            if (late) {
              selectBlock(late.el);
              bringIntoView(late.el);
            } else if (++tries < 60) win.setTimeout(wait, 25);
          };
          win.setTimeout(wait, 25);
          break;
        }
        case STORY_SPOTLIGHT_MESSAGE:
          setSpotlight(message.paths);
          break;
        default:
          break;
      }
    },
    dispose() {
      const leavingScroll = { x: win.scrollX, y: win.scrollY };
      win.requestAnimationFrame(() => restoreScroll(leavingScroll));
      disposed = true;
      chrome.dispose();
      blockSelection.dispose();
      doc.removeEventListener('selectionchange', onSelectionChange);
      doc.removeEventListener('focusin', onFocusIn);
      commitHost(active);
      active = null;
      reportTyping(false);
      doc.removeEventListener('click', onClick, true);
      doc.removeEventListener('pointerover', onPointerOver, true);
      doc.removeEventListener('pointerout', onPointerOut, true);
      doc.removeEventListener('keydown', onKeyDown, true);
      doc.removeEventListener('paste', onImageTransfer as EventListener, true);
      doc.removeEventListener('paste', onLegacyPaste, true);
      doc.removeEventListener('drop', onImageTransfer as EventListener, true);
      doc.removeEventListener('dragover', onDragOver as EventListener, true);
      doc.removeEventListener('dragleave', onDragLeave as EventListener, true);
      doc.removeEventListener('dragend', onDragEnd, true);
      doc.removeEventListener('dblclick', onDoubleClick, true);
      markDropTarget(null);
      win.removeEventListener('scroll', onScroll);
      win.removeEventListener('resize', onScroll);
      for (const el of scope.querySelectorAll(`[${EDIT_SELECTED_ATTR}], [${EDIT_EMBED_SELECTED_ATTR}]`)) {
        el.removeAttribute(EDIT_SELECTED_ATTR);
        el.removeAttribute(EDIT_EMBED_SELECTED_ATTR);
      }
      setHovered(null);
      setSpotlight([]);
      style.remove();
      selectedPath = null;
    },
  };
}
