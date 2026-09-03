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
import type { JsxElement, JsxNode } from '@/lib/jsx';
import { isEditableTextHost } from '@/lib/story-ui/host-classify';
import { normalizeLinkHref } from '@/lib/data/story/link-edit';
import { AST_PATH_ATTR } from '@/lib/story-ui/ast-path';
import type { PristineChannel } from '../pristine';
import {
  STORY_EDIT_KEY_MESSAGE, STORY_EDIT_READY_MESSAGE, STORY_IMAGE_DROP_MESSAGE, STORY_SELECTION_MESSAGE,
  STORY_TEXT_EDIT_MESSAGE, STORY_TYPING_MESSAGE,
  STORY_APPLY_FORMAT_MESSAGE, STORY_APPLY_LINK_MESSAGE, STORY_SELECT_MESSAGE,
  STORY_COMMIT_MESSAGE, STORY_COMMITTED_MESSAGE, STORY_LAYOUT_EDIT_MESSAGE, STORY_SLIDE_TITLE_MESSAGE,
  type StoryEditParentMessage, type StoryEditSelection,
} from '../contract';
import { describeSelection } from './describe-selection';
import { captureSelection } from './selection-range';
import { EditableHost } from './editable-host';
import { GridEdit } from './grid-edit';
import { imageFileFromTransfer } from './image-drop';

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
  `[${EDIT_HOVER_ATTR}] { outline: 1px solid rgba(20, 184, 166, 0.52); outline-offset: 2px; border-radius: 2px; }`,
  `[${EDIT_SELECTED_ATTR}] { outline: 2px dashed #14b8a6; outline-offset: 2px; }`,
  `[${EDIT_EMBED_SELECTED_ATTR}] { outline: 2px solid #14b8a6; outline-offset: 2px; }`,
  '[contenteditable="true"]:focus { outline: 2px solid rgba(20, 184, 166, 0.55); outline-offset: 2px; }',
].join('\n');

const EDIT_CSS_ATTR = 'data-mx-edit-css';

export interface FrameEditSession {
  /** Wrap a rendered element for edit mode. Chained after the runtime's own decorator. */
  decorate(element: ReactElement, node: JsxElement, path: string): ReactNode;
  /** The nodes currently rendered — selection is classified against the SOURCE, not the DOM. */
  setNodes(nodes: JsxNode[]): void;
  /** A parent → frame edit message (already checked for direction and trust by the caller). */
  onParentMessage(message: StoryEditParentMessage): void;
  /** A slide was renamed in the deck's own rail. */
  renameSlide(path: string, title: string): void;
  dispose(): void;
}

interface ActiveHost { path: string; el: HTMLElement; snapshot: string; userEdited: boolean }

export interface FrameEditSessionOptions {
  win: Window;
  channel: PristineChannel;
  /** Ask the runtime to re-render (a new body epoch releases the focus guard). */
  requestRender: () => void;
}

export function createFrameEditSession({ win, channel, requestRender }: FrameEditSessionOptions): FrameEditSession {
  const doc = win.document;
  let nodes: JsxNode[] = [];
  let active: ActiveHost | null = null;
  let selectedPath: string | null = null;
  let hovered: Element | null = null;
  let typingReported = false;
  let bodyEpoch = 0;
  let disposed = false;

  const post = (message: Record<string, unknown>) => channel.post({ ...message, nonce: channel.nonce });

  // ── selection ─────────────────────────────────────────────────────────────
  const stampSelection = () => {
    for (const el of doc.querySelectorAll(`[${EDIT_SELECTED_ATTR}], [${EDIT_EMBED_SELECTED_ATTR}]`)) {
      el.removeAttribute(EDIT_SELECTED_ATTR);
      el.removeAttribute(EDIT_EMBED_SELECTED_ATTR);
    }
    if (!selectedPath) return;
    const el = doc.querySelector(`[${AST_PATH_ATTR}="${CSS.escape(selectedPath)}"]`);
    if (!el) return;
    const kind = describeSelection(el, nodes)?.kind;
    el.setAttribute(kind === 'embed' ? EDIT_EMBED_SELECTED_ATTR : EDIT_SELECTED_ATTR, '');
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
    const el = doc.querySelector(`[${AST_PATH_ATTR}="${CSS.escape(path)}"]`);
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
    post({ type: STORY_TEXT_EDIT_MESSAGE, path: host.path, innerHtml });
  };

  const hostSession = {
    isEditing: (path: string) => active?.path === path,
    onFocus(path: string, el: HTMLElement) {
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
      requestRender();   // the focus guard is released; let React reconcile again
    },
  };

  // ── document listeners ────────────────────────────────────────────────────
  /** Resolve the same selectable node a click would, excluding duplicate document chrome. */
  const selectableAt = (target: EventTarget | null): Element | null => {
    const element = target as Element | null;
    if (!element?.closest || element.closest('.mx-rail, .mx-present')) return null;
    const stamped = element.closest(`[${AST_PATH_ATTR}]`);
    return stamped && describeSelection(stamped, nodes) ? stamped : null;
  };

  const setHovered = (next: Element | null) => {
    if (hovered === next) return;
    hovered?.removeAttribute(EDIT_HOVER_ATTR);
    hovered = next;
    hovered?.setAttribute(EDIT_HOVER_ATTR, '');
  };

  const onPointerOver = (event: PointerEvent) => setHovered(selectableAt(event.target));
  const onPointerOut = (event: PointerEvent) => setHovered(selectableAt(event.relatedTarget));

  const onClick = (event: Event) => {
    const target = event.target as Element | null;
    if (!target?.closest) return;
    // Chrome the document draws for itself (the deck rail and its slide
    // previews) re-renders the slide's own nodes, so ids and AST stamps appear
    // twice — a click there must never select the preview copy.
    if (target.closest('.mx-rail, .mx-present')) return;
    const stamped = target.closest(`[${AST_PATH_ATTR}]`);
    if (!stamped) { reportSelection(null); return; }
    const selection = describeWithQuote(stamped);
    // A focused text host owns its own selection (reported on focus).
    if (selection?.kind === 'text' && active?.path === selection.path) return;
    reportSelection(selection);
  };

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Escape') { post({ type: STORY_EDIT_KEY_MESSAGE, key: 'Escape' }); return; }
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
    if (event.dataTransfer?.types?.includes('Files')) event.preventDefault();
  };

  let scrollQueued = false;
  const onScroll = () => {
    if (scrollQueued) return;
    scrollQueued = true;
    win.requestAnimationFrame(() => { scrollQueued = false; if (!disposed) republishRect(); });
  };

  doc.addEventListener('click', onClick, true);
  doc.addEventListener('pointerover', onPointerOver, true);
  doc.addEventListener('pointerout', onPointerOut, true);
  doc.addEventListener('keydown', onKeyDown, true);
  doc.addEventListener('paste', onImageTransfer as EventListener, true);
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
    const el = doc.querySelector(`[${AST_PATH_ATTR}="${CSS.escape(path)}"]`);
    if (!el) return;
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
    const host = doc.querySelector(`[${AST_PATH_ATTR}="${CSS.escape(path)}"]`) as HTMLElement | null;
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
      if (!(safe.startsWith('https://') || safe.startsWith('http://')
        || safe.startsWith('mailto:') || safe.startsWith('tel:')
        || safe.startsWith('/') || safe.startsWith('#'))) return;
      const anchor = doc.createElement('a');
      anchor.setAttribute('href', safe);
      anchor.setAttribute('target', '_blank');
      anchor.setAttribute('rel', 'noopener noreferrer');
      try { range.surroundContents(anchor); } catch { return; } // a partial selection across elements
    } else {
      const anchor = (range.commonAncestorContainer as Element).parentElement?.closest?.('a')
        ?? (range.commonAncestorContainer as Element).closest?.('a');
      if (!anchor) return;
      anchor.replaceWith(...Array.from(anchor.childNodes));
    }
    post({ type: STORY_TEXT_EDIT_MESSAGE, path, innerHtml: channel.innerHtmlOf(host) });
  };

  return {
    decorate(element: ReactElement, node: JsxElement, path: string): ReactNode {
      // A grid becomes draggable: only the document knows how wide its columns
      // are, so the drag happens here and the rects travel (edit/grid-edit).
      if (node.isComponent && node.tag === 'Grid') {
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
      nodes = next;
      bodyEpoch += 1;   // a different document: focused hosts must reconcile
      // The selected node may not exist in the new document.
      if (selectedPath && !describeSelection(
        doc.querySelector(`[${AST_PATH_ATTR}="${CSS.escape(selectedPath)}"]`) ?? doc.createElement('div'), nodes,
      )) selectedPath = null;
      stampSelection();
    },
    onParentMessage(message: StoryEditParentMessage) {
      switch (message.type) {
        case STORY_APPLY_FORMAT_MESSAGE:
          applyFormat(message.path, message.className, message.style);
          break;
        case STORY_APPLY_LINK_MESSAGE:
          applyLink(message.path, message.href);
          break;
        case STORY_COMMIT_MESSAGE:
          // Whatever is half-typed, hand it over — the page is leaving.
          commitHost(active);
          post({ type: STORY_COMMITTED_MESSAGE });
          break;
        case STORY_SELECT_MESSAGE: {
          if (!message.path) { reportSelection(null); break; }
          const el = doc.querySelector(`[${AST_PATH_ATTR}="${CSS.escape(message.path)}"]`);
          reportSelection(el ? describeWithQuote(el) : null);
          break;
        }
        default:
          break;
      }
    },
    dispose() {
      disposed = true;
      commitHost(active);
      active = null;
      reportTyping(false);
      doc.removeEventListener('click', onClick, true);
      doc.removeEventListener('pointerover', onPointerOver, true);
      doc.removeEventListener('pointerout', onPointerOut, true);
      doc.removeEventListener('keydown', onKeyDown, true);
      doc.removeEventListener('paste', onImageTransfer as EventListener, true);
      doc.removeEventListener('drop', onImageTransfer as EventListener, true);
      doc.removeEventListener('dragover', onDragOver as EventListener, true);
      win.removeEventListener('scroll', onScroll);
      win.removeEventListener('resize', onScroll);
      for (const el of doc.querySelectorAll(`[${EDIT_SELECTED_ATTR}], [${EDIT_EMBED_SELECTED_ATTR}]`)) {
        el.removeAttribute(EDIT_SELECTED_ATTR);
        el.removeAttribute(EDIT_EMBED_SELECTED_ATTR);
      }
      setHovered(null);
      style.remove();
      selectedPath = null;
    },
  };
}
