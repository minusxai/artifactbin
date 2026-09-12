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
import { createNodeChrome } from '@/lib/editor-v2/node-chrome';
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
  STORY_COMMIT_MESSAGE,
  STORY_COMMITTED_MESSAGE,
  STORY_LAYOUT_EDIT_MESSAGE,
  STORY_SLIDE_TITLE_MESSAGE,
  type StoryEditParentMessage,
  type StoryEditSelection,
} from '../contract';
import { describeSelection } from './describe-selection';
import { captureSelection } from './selection-range';
import { EditableHost } from './editable-host';
import { GridEdit } from './grid-edit';
import { imageFileFromTransfer } from './image-drop';
import { SELECTION_PRESENTATION } from '../selection-presentation';

/** Marks the selected node so the reader can see what the toolbar is pointed at. */
export const EDIT_SELECTED_ATTR = 'data-mx-selected';
/** Marks the selected COMPONENT. Its own attribute: two writers on one attribute take turns clearing each other. */
export const EDIT_EMBED_SELECTED_ATTR = 'data-mx-embed-selected';
/** Marks the selectable node under the pointer while edit mode is live. */
export const EDIT_HOVER_ATTR = 'data-mx-edit-hover';

/**
 * Selection chrome, injected on entering edit mode and removed on leaving.
 * NOT part of the document's served stylesheet: a reader must never download
 * or apply editor chrome.
 */
export const EDIT_MODE_CSS = [
  '[data-mx-block-selected] { outline: 1px solid rgba(100,116,139,.18); outline-offset: 2px; }',
  '.ProseMirror { outline: none; white-space: pre-wrap; overflow-wrap: break-word; }',
  '[contenteditable="true"]:focus { outline: none; }',
  `[${EDIT_SELECTED_ATTR}][${EDIT_SELECTED_ATTR}], [${EDIT_EMBED_SELECTED_ATTR}][${EDIT_EMBED_SELECTED_ATTR}] { ${SELECTION_PRESENTATION.selectedCss} }`,
  `[${EDIT_HOVER_ATTR}][${EDIT_HOVER_ATTR}] { ${SELECTION_PRESENTATION.hoverCss} }`,
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

export interface FrameEditSessionOptions {
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
  const chrome = createNodeChrome(doc, (command) => {
    commitHost(active);
    post({ type: STORY_BLOCK_EDIT_MESSAGE, command });
  });

  // ── selection ─────────────────────────────────────────────────────────────
  const stampSelection = () => {
    for (const el of scope.querySelectorAll(`[${EDIT_SELECTED_ATTR}], [${EDIT_EMBED_SELECTED_ATTR}]`)) {
      el.removeAttribute(EDIT_SELECTED_ATTR);
      el.removeAttribute(EDIT_EMBED_SELECTED_ATTR);
    }
    const range = win.getSelection();
    if (!selectedPath || blockSelection.paths().length || (range && !range.isCollapsed && scope.contains(range.anchorNode))) {
      chrome.select(null, null);
      return;
    }
    const el = scope.querySelector(`[${AST_PATH_ATTR}="${CSS.escape(selectedPath)}"]`);
    if (!el) {
      chrome.select(null, null);
      return;
    }
    const kind = describeSelection(el, nodes)?.kind;
    el.setAttribute(kind === 'embed' ? EDIT_EMBED_SELECTED_ATTR : EDIT_SELECTED_ATTR, '');
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
    chrome.select(inlineOrDrawingPart ? null : (el as HTMLElement), inlineOrDrawingPart ? null : selectedPath, grid);
  };

  /**
   * An element described for the parent, WITH the words the user has selected
   * inside it when there are any. The editor's "Comment on selection" reaches
   * the same composer as the view-mode bubble, so it must hand it the same
   * quote — a comment made from the toolbar used to keep the node and lose the
   * sentence. Absent for a bare caret, which has selected nothing.
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

  const reportSelection = (selection: StoryEditSelection | null) => {
    selectedPath = selection?.path ?? null;
    stampSelection();
    post({ type: STORY_SELECTION_MESSAGE, selection });
  };

  /** Re-measure and re-send whatever is selected — the document scrolls itself. */
  const republishRect = () => {
    if (!selectedPath && !active) return;
    const path = active?.path ?? selectedPath!;
    const el = scope.querySelector(`[${AST_PATH_ATTR}="${CSS.escape(path)}"]`);
    const selection = el ? describeWithQuote(el) : null;
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
      element.closest('.mx-rail, .mx-present, [data-mx-node-chrome]')
    )
      return null;
    const stamped = element.closest(`[${AST_PATH_ATTR}]`);
    return stamped && describeSelection(stamped, nodes) ? stamped : null;
  };

  const setHovered = (next: Element | null) => {
    if (hovered === next) return;
    hovered?.removeAttribute(EDIT_HOVER_ATTR);
    hovered = next;
    hovered?.setAttribute(EDIT_HOVER_ATTR, '');
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

  const onPointerOver = (event: PointerEvent) => setHovered(selectableAt(event.target));
  const onPointerOut = (event: PointerEvent) => setHovered(selectableAt(event.relatedTarget));

  const onClick = (event: Event) => {
    const target = event.target as Element | null;
    if (root && (!target || !root.contains(target))) return;
    if (!target?.closest) return;
    // Chrome the document draws for itself (the deck rail and its slide
    // previews) re-renders the slide's own nodes, so ids and AST stamps appear
    // twice — a click there must never select the preview copy.
    if (target.closest('.mx-rail, .mx-present, [data-mx-node-chrome]')) return;
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
    const selection = describeWithQuote(stamped);
    // A focused text host owns its own selection (reported on focus).
    if (selection?.kind === 'text' && active?.path === selection.path) return;
    reportSelection(selection);
  };

  const onKeyDown = (event: KeyboardEvent) => {
    if (root && !root.contains(event.target as Node)) return;
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
      post({ type: STORY_EDIT_KEY_MESSAGE, key: 'Escape' });
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

  /**
   * Paste and drop are ONE door: both carry a DataTransfer, and an image in
   * either means the same insert. The event is taken over only when an image is
   * actually there — a text paste is the common act and must reach the text
   * host untouched, and a file we do not accept is better left to the browser
   * than silently eaten.
   */
  const onImageTransfer = (event: ClipboardEvent | DragEvent) => {
    if (root && !root.contains(event.target as Node)) return;
    const data = 'clipboardData' in event ? event.clipboardData : event.dataTransfer;
    const file = imageFileFromTransfer(data);
    if (!file) return;
    event.preventDefault();
    post({ type: STORY_IMAGE_DROP_MESSAGE, file });
  };

  /**
   * A drop target only receives `drop` if `dragover` was prevented, but doing
   * that unconditionally would make the whole document swallow every drag —
   * so it is prevented only while a FILE is being dragged.
   */
  const onDragOver = (event: DragEvent) => {
    if (root && !root.contains(event.target as Node)) return;
    if (event.dataTransfer?.types?.includes('Files')) event.preventDefault();
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
          if (!message.path) {
            reportSelection(null);
            break;
          }
          const el = scope.querySelector(`[${AST_PATH_ATTR}="${CSS.escape(message.path)}"]`);
          reportSelection(el ? describeWithQuote(el) : null);
          break;
        }
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
      win.removeEventListener('scroll', onScroll);
      win.removeEventListener('resize', onScroll);
      for (const el of scope.querySelectorAll(`[${EDIT_SELECTED_ATTR}], [${EDIT_EMBED_SELECTED_ATTR}]`)) {
        el.removeAttribute(EDIT_SELECTED_ATTR);
        el.removeAttribute(EDIT_EMBED_SELECTED_ATTR);
      }
      setHovered(null);
      style.remove();
      selectedPath = null;
    },
  };
}
