/**
 * WHAT IS SELECTED IN EDIT MODE, AND WHAT THE POINTER IS OVER.
 *
 * One half of the edit session (lib/story-runtime/edit/session): it decides what a click, a caret
 * move, a hover or a page request selects, stamps it for the selection chrome, and tells the page
 * over `post` (`mx:selection`). TYPING (a caret in text: no outline, no handles) and BLOCK SELECTED
 * (the block's outline, handles and toolbar options; no caret) are never both.
 *
 * Selection is classified against the SOURCE (`nodes()`), not the DOM. The session keeps the
 * text-host half (focus, typing, commit) and the keyboard; it reaches this half only through the
 * returned interface.
 */
import type { JsxNode } from '@/lib/jsx';
import type { EditorView } from 'prosemirror-view';
import { createNodeChrome, HOVER_GRIP_ATTR, NODE_CHROME_SELECTOR } from '@/lib/editor-v2/node-chrome';
import { createBlockSelection } from '@/lib/editor-v2/block-selection';
import { inlineStates } from '@/lib/editor-v2/model';
import { gridCols, gridRowHeight } from '@/lib/story-ui/grid-layout';
import { resolveJsxNodeAtPath } from '@/lib/story-ui/host-classify';
import { AST_PATH_ATTR } from '@/lib/story-ui/ast-path';
import { nodeName } from '@/lib/story-ui/node-names';
import {
  STORY_BLOCK_EDIT_MESSAGE,
  STORY_SELECTION_MESSAGE,
  type StoryEditParentMessage,
  type StoryEditSelection,
} from '../contract';
import { describeSelection } from './describe-selection';
import { captureSelection } from './selection-range';
import { canResize, editChromeKind, gripTarget, isComponentPart } from './edit-chrome';

/** Marks the selected node so the reader can see what the toolbar is pointed at. Value: 'block' when block-selected, else 'text' (typing). */
export const EDIT_SELECTED_ATTR = 'data-mx-selected';
/** Marks the selected COMPONENT. Its own attribute: two writers on one attribute take turns clearing each other. */
export const EDIT_EMBED_SELECTED_ATTR = 'data-mx-embed-selected';
/** Marks the selectable node under the pointer while edit mode is live. Value: its edit-chrome kind (drives the cursor only). */
export const EDIT_HOVER_ATTR = 'data-mx-edit-hover';
/** Marks nodes the page pointed at (STORY_SPOTLIGHT_MESSAGE) — outlined, never selected. */
export const EDIT_SPOTLIGHT_ATTR = 'data-mx-edit-spotlight';
/** The story root while editing: focusable, so a block selection keeps the keyboard in the document. */
export const EDIT_ROOT_ATTR = 'data-mx-edit-root';

/** The session's ProseMirror views, and the one a toolbar command acts on. Shared by reference. */
export interface EditViews {
  all: Set<EditorView>;
  last: EditorView | null;
}

type SelectMessage = Extract<StoryEditParentMessage, { type: 'mx:select' }>;

export interface HoverSelect {
  /** The selected node's body path, or null. */
  selectedPath(): string | null;
  /** Whether the selection is a BLOCK selection (outline and handles, no caret). */
  blockMode(): boolean;
  /** Whether a multi-block selection holds the keyboard (arrows move blocks, not the caret). */
  blockSelected(): boolean;
  /** The selectable node a click on `target` would select, excluding duplicate document chrome. */
  selectableAt(target: EventTarget | null): Element | null;
  /** BLOCK-select `el`: the caret goes and keyboard focus stays in the document. */
  selectBlock(el: Element): void;
  /** Select (or clear) and tell the page. */
  reportSelection(selection: StoryEditSelection | null, block?: boolean): void;
  /** `el` described for the page, with the words selected inside it when there are any. */
  describeWithQuote(el: Element): StoryEditSelection | null;
  /** Re-measure and re-send whatever is selected — the document scrolls itself. */
  republishRect(): void;
  /** The page asks for a selection by path (a breadcrumb, a panel, a just-inserted node). */
  select(message: SelectMessage): void;
  /** The page points at nodes without selecting them; the whole set each time. */
  setSpotlight(paths: string[]): void;
  /** The document changed: cancel any chrome gesture and drop a selection whose node is gone. */
  nodesChanged(): void;
  dispose(): void;
}

export interface HoverSelectOptions {
  win: Window;
  root: HTMLElement;
  nodes: () => JsxNode[];
  views: EditViews;
  /** The text host being typed in; it owns its own selection, reported on focus. */
  activePath: () => string | null;
  /** Hand over half-typed text before a structural command runs. */
  commitActive: () => void;
  post: (message: Record<string, unknown>) => void;
}

/** Parts of a line and drawing parts: selectable, but never given block chrome. */
const INLINE_TAGS = new Set(['span', 'strong', 'b', 'em', 'i', 'a', 'code', 'br', 'small', 'sup', 'sub', 's', 'del', 'u']);
/** Chrome the document draws for itself (the deck rail, presenter view, node chrome). */
const DOCUMENT_CHROME = `.mx-rail, .mx-present, ${NODE_CHROME_SELECTOR}`;

export function createHoverSelect({ win, root, nodes, views, activePath, commitActive, post }: HoverSelectOptions): HoverSelect {
  const doc = win.document;
  let selectedPath: string | null = null;
  let blockMode = false;
  let hovered: Element | null = null;
  let disposed = false;
  /** The latest select request; a waiting reveal gives way to any newer one. */
  let selectRequest = 0;
  const at = (path: string) => root.querySelector(`[${AST_PATH_ATTR}="${CSS.escape(path)}"]`);

  const blockSelection = createBlockSelection(doc, root, (command) => post({ type: STORY_BLOCK_EDIT_MESSAGE, command }));
  const chrome = createNodeChrome(
    doc,
    (command) => {
      commitActive();
      post({ type: STORY_BLOCK_EDIT_MESSAGE, command });
    },
    (el) => selectBlock(el),
  );

  const clearStamps = () => {
    for (const el of root.querySelectorAll(`[${EDIT_SELECTED_ATTR}], [${EDIT_EMBED_SELECTED_ATTR}]`)) {
      el.removeAttribute(EDIT_SELECTED_ATTR);
      el.removeAttribute(EDIT_EMBED_SELECTED_ATTR);
    }
  };

  const stampSelection = () => {
    clearStamps();
    const range = win.getSelection();
    const deselect = () => {
      chrome.select(null, null);
      refreshGrip();
    };
    if (!selectedPath || blockSelection.paths().length || (range && !range.isCollapsed && root.contains(range.anchorNode)))
      return deselect();
    const el = at(selectedPath);
    if (!el) return deselect();
    const kind = describeSelection(el, nodes())?.kind;
    el.setAttribute(kind === 'embed' ? EDIT_EMBED_SELECTED_ATTR : EDIT_SELECTED_ATTR, blockMode ? 'block' : 'text');
    if (!blockMode) return deselect();
    const node = resolveJsxNodeAtPath(nodes(), selectedPath);
    const parent = resolveJsxNodeAtPath(nodes(), selectedPath.split('.').slice(0, -1).join('.'));
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
      (INLINE_TAGS.has(node.tag) || (el.namespaceURI === 'http://www.w3.org/2000/svg' && node.tag !== 'svg'));
    chrome.select(inlineOrDrawingPart ? null : (el as HTMLElement), inlineOrDrawingPart ? null : selectedPath, grid, {
      resizable: node?.type === 'element' && canResize(node),
      label: node?.type === 'element' ? nodeName(node.tag) : 'Block',
      parent: parentName(selectedPath),
    });
    refreshGrip();
  };

  /** What the block's parent is called, a component's own parts folded into the component. */
  const parentName = (path: string) => {
    for (let parts = path.split('.').slice(0, -1); parts.length; parts.pop()) {
      const node = resolveJsxNodeAtPath(nodes(), parts.join('.'));
      if (node?.type !== 'element') break;
      if (!isComponentPart(node, resolveJsxNodeAtPath(nodes(), parts.slice(0, -1).join('.')))) return nodeName(node.tag);
    }
    return 'document';
  };

  /** One grip: beside the block under the pointer, else (a touch screen has no hover) the block with the caret. */
  const refreshGrip = () => {
    const caret = !blockMode && selectedPath ? at(selectedPath) : null;
    const under = hovered ?? caret;
    chrome.hover(under && gripTarget(under, nodes()));
  };

  const selectBlock = (el: Element) => {
    const target = gripTarget(el, nodes()) ?? el;
    const focused = doc.activeElement as HTMLElement | null;
    if (focused && focused !== root && root.contains(focused)) focused.blur();
    win.getSelection()?.removeAllRanges();
    root.setAttribute(EDIT_ROOT_ATTR, '');
    if (!root.hasAttribute('tabindex')) root.tabIndex = -1;
    root.focus({ preventScroll: true });
    reportSelection(describeSelection(target, nodes()), true);
  };

  /**
   * The editor's "Comment on selection" reaches the same composer as the view-mode bubble, so it
   * must hand it the same quote — without this a comment made from the toolbar keeps the node and
   * loses the sentence. Absent for a bare caret, which has selected nothing.
   */
  const describeWithQuote = (el: Element): StoryEditSelection | null => {
    const selection = describeSelection(el, nodes());
    if (!selection) return null;
    for (const view of views.all)
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

  const republishRect = () => {
    const active = activePath();
    if (!selectedPath && !active) return;
    const el = at(active ?? selectedPath!);
    const selection = el ? describeWithQuote(el) : null;
    if (selection) selection.mode = blockMode && !active ? 'block' : 'typing';
    post({ type: STORY_SELECTION_MESSAGE, selection });
  };

  const selectableAt = (target: EventTarget | null): Element | null => {
    const element = target as Element | null;
    if (!element?.closest || !root.contains(element) || element.closest(DOCUMENT_CHROME)) return null;
    const stamped = element.closest(`[${AST_PATH_ATTR}]`);
    return stamped && describeSelection(stamped, nodes()) ? stamped : null;
  };

  const setHovered = (next: Element | null) => {
    if (hovered === next) return;
    hovered?.removeAttribute(EDIT_HOVER_ATTR);
    hovered = next;
    hovered?.setAttribute(EDIT_HOVER_ATTR, editChromeKind(hovered));
    refreshGrip();
  };

  const setSpotlight = (paths: string[]) => {
    for (const el of root.querySelectorAll(`[${EDIT_SPOTLIGHT_ATTR}]`)) el.removeAttribute(EDIT_SPOTLIGHT_ATTR);
    let first: Element | null = null;
    for (const path of paths) {
      const el = at(path);
      if (!el) continue;
      el.setAttribute(EDIT_SPOTLIGHT_ATTR, '');
      first ??= el;
    }
    // jsdom has no scrollIntoView; a browser scrolls the nearest edge in.
    first?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' });
  };

  // ── document listeners ────────────────────────────────────────────────────
  const viewHolding = (target: Node) => [...views.all].find((view) => view.dom.contains(target));
  const onFocusIn = (event: FocusEvent) => {
    views.last = viewHolding(event.target as Node) ?? views.last;
  };
  const onSelectionChange = () => {
    const target = win.getSelection()?.anchorNode?.parentElement;
    if (!target?.closest('.ProseMirror') || !root.contains(target)) return;
    views.last = viewHolding(target) ?? views.last;
    const el = target.closest(`[${AST_PATH_ATTR}]`);
    if (el) reportSelection(describeWithQuote(el));
  };

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
    if (!target?.closest || !root.contains(target)) return;
    // Chrome the document draws for itself (the deck rail and its slide previews) re-renders the
    // slide's own nodes, so ids and AST stamps appear twice — a click there must never select the copy.
    if (target.closest(DOCUMENT_CHROME)) return;
    if (target.closest('.ProseMirror') && target.closest('a')) event.preventDefault();
    // A drag ends with a click on the common ancestor. It is still a text selection, never an
    // instruction to resize that entire container.
    const native = win.getSelection();
    if (native && !native.isCollapsed && root.contains(native.anchorNode)) {
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
      if (describeSelection(stamped, nodes())) selectBlock(stamped);
      return;
    }
    // A container's padding selects nothing (its grip, Esc and the breadcrumb do) — unless the
    // click put a caret in text inside it.
    if (chromeKind === 'container') {
      const anchor = native?.anchorNode;
      if (!(anchor && stamped.contains(anchor) && (doc.activeElement as HTMLElement | null)?.isContentEditable))
        reportSelection(null);
      return;
    }
    const selection = describeWithQuote(stamped);
    // A focused text host owns its own selection (reported on focus).
    if (selection?.kind === 'text' && activePath() === selection.path) return;
    reportSelection(selection);
  };

  let scrollQueued = false;
  const onScroll = () => {
    if (scrollQueued) return;
    scrollQueued = true;
    win.requestAnimationFrame(() => {
      scrollQueued = false;
      if (!disposed) republishRect();
    });
  };

  doc.addEventListener('focusin', onFocusIn);
  doc.addEventListener('selectionchange', onSelectionChange);
  doc.addEventListener('click', onClick, true);
  doc.addEventListener('pointerover', onPointerOver, true);
  doc.addEventListener('pointerout', onPointerOut, true);
  win.addEventListener('scroll', onScroll, { passive: true });
  win.addEventListener('resize', onScroll, { passive: true });

  const select = (message: SelectMessage) => {
    const request = ++selectRequest;
    if (!message.path) {
      reportSelection(null);
      return;
    }
    const path = message.path;
    const described = () => {
      const el = at(path);
      if (el && message.nodeId && el.id !== message.nodeId) return null; // the old document, still drawn
      return el && describeSelection(el, nodes()) ? el : null;
    };
    /** Scroll it to the middle — and again once an image has its height, or it lands half-shown. */
    const bringIntoView = (el: Element) => {
      const go = () => el.scrollIntoView?.({ block: 'center', behavior: 'smooth' });
      if (el.localName === 'img' && !(el as HTMLImageElement).complete) el.addEventListener('load', go, { once: true });
      go();
    };
    const found = described();
    if (found || !message.reveal) {
      if (found) selectBlock(found);
      else reportSelection(null);
      if (found && message.reveal) bringIntoView(found);
      return;
    }
    // Just inserted: the new document may not be drawn yet. Wait for it, briefly.
    let tries = 0;
    const wait = () => {
      if (disposed || request !== selectRequest) return;
      const late = described();
      if (late) {
        selectBlock(late);
        bringIntoView(late);
      } else if (++tries < 60) win.setTimeout(wait, 25);
    };
    win.setTimeout(wait, 25);
  };

  return {
    selectedPath: () => selectedPath,
    blockMode: () => blockMode,
    blockSelected: () => blockSelection.paths().length > 0,
    selectableAt,
    selectBlock,
    reportSelection,
    describeWithQuote,
    republishRect,
    select,
    setSpotlight,
    nodesChanged() {
      chrome.cancel();
      blockSelection.clear();
      // The selected node may not exist in the new document.
      if (selectedPath && !describeSelection(at(selectedPath) ?? doc.createElement('div'), nodes())) selectedPath = null;
      stampSelection();
    },
    dispose() {
      disposed = true;
      chrome.dispose();
      blockSelection.dispose();
      doc.removeEventListener('focusin', onFocusIn);
      doc.removeEventListener('selectionchange', onSelectionChange);
      doc.removeEventListener('click', onClick, true);
      doc.removeEventListener('pointerover', onPointerOver, true);
      doc.removeEventListener('pointerout', onPointerOut, true);
      win.removeEventListener('scroll', onScroll);
      win.removeEventListener('resize', onScroll);
      clearStamps();
      setHovered(null);
      setSpotlight([]);
      selectedPath = null;
    },
  };
}
