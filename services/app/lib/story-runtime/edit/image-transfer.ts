/**
 * AN IMAGE PASTED, DROPPED OR DOUBLE-CLICKED IN EDIT MODE.
 *
 * Part of the edit session (lib/story-runtime/edit/session). Paste and drop are ONE door: both
 * carry a DataTransfer, and an image in either means the same insert (`mx:image-drop`): onto a
 * plain `<img>` it replaces that image, elsewhere a drop lands in the gap it was dropped in and a
 * paste is placed by the page. A double-click on an image asks the page for its replace picker
 * (`mx:image-replace`). The page owns the upload and the source edit; this only says where.
 */
import type { JsxNode } from '@/lib/jsx';
import { resolveJsxNodeAtPath } from '@/lib/story-ui/host-classify';
import { AST_PATH_ATTR } from '@/lib/story-ui/ast-path';
import { STORY_IMAGE_DROP_MESSAGE, STORY_IMAGE_REPLACE_MESSAGE } from '../contract';
import { imageFileFromTransfer } from './image-drop';

/** Marks the image a dragged file would REPLACE if dropped now. */
export const EDIT_DROP_REPLACE_ATTR = 'data-mx-drop-replace';
/** That image's mark: a dashed neutral line and a faint veil, so "drop here" never reads as selected. */
export const DROP_REPLACE_CSS = 'outline: 2px dashed rgba(100, 116, 139, 0.9) !important; outline-offset: 3px !important; opacity: 0.75 !important;';
/** The "Drop to replace" label drawn over that image — chrome, never document. */
const DROP_REPLACE_LABEL_ATTR = 'data-mx-drop-replace-label';
/** Parts of a line: never a gap of their own — the block holding them is. */
const LINE_PARTS = new Set(['span', 'strong', 'b', 'em', 'i', 'a', 'code', 'br', 'small', 'sup', 'sub', 's', 'del', 'u', 'mark']);

export interface ImageTransferOptions {
  win: Window;
  root: HTMLElement;
  nodes: () => JsxNode[];
  /** The selected node's path: a paste while an image is selected replaces it. */
  selectedPath: () => string | null;
  /** The selectable node an event landed on (the session's click rule). */
  selectableAt: (target: EventTarget | null) => Element | null;
  /** Select the image a double-click is about to replace. */
  selectImage: (img: Element) => void;
  post: (message: Record<string, unknown>) => void;
}

/** Listens on the document until disposed. */
export function createImageTransfer({ win, root, nodes, selectedPath, selectableAt, selectImage, post }: ImageTransferOptions): { dispose(): void } {
  const doc = win.document;

  /** Whether the source node at a body path is a plain `<img>` — the only image this edits. */
  const isImagePath = (path: string | null): path is string => {
    const node = path ? resolveJsxNodeAtPath(nodes(), path) : null;
    return node?.type === 'element' && !node.isComponent && node.tag === 'img';
  };
  /** The plain `<img>` an event landed on, or null. Component-drawn images and CSS backgrounds are not. */
  const replaceableImageAt = (target: EventTarget | null): HTMLElement | null => {
    const el = selectableAt(target);
    return el && el.localName === 'img' && isImagePath(el.getAttribute(AST_PATH_ATTR)) ? (el as HTMLElement) : null;
  };

  /**
   * "Drop to replace": the image under a dragged file carries a mark, and a label sits over it. An
   * `<img>` cannot hold a pseudo-element, so the label is its own element — styled through CSSOM
   * (the document's CSP refuses a style attribute) and transparent to the pointer, so the drop
   * still lands on the image.
   */
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

  const isLinePart = (el: Element) => {
    const node = resolveJsxNodeAtPath(nodes(), el.getAttribute(AST_PATH_ATTR) ?? '');
    return node?.type === 'element' && LINE_PARTS.has(node.tag);
  };
  /**
   * The gap a file dropped at `clientY` over `target` lands in: over a block, the side of it the
   * pointer is on; over a container's own space (its padding, the space between its blocks), before
   * the first of its blocks below the pointer, or after the last. Null outside every block.
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
    selectImage(img);
    post({ type: STORY_IMAGE_REPLACE_MESSAGE, path: img.getAttribute(AST_PATH_ATTR)! });
  };

  /**
   * The event is taken over only when an image is actually there — a text paste is the common act
   * and must reach the text host untouched, and a file we do not accept is better left to the
   * browser than silently eaten.
   */
  const onImageTransfer = (event: ClipboardEvent | DragEvent) => {
    // A selected image holds no focus, so ⌘V lands on the unfocused <body> —
    // outside the story root, yet plainly meant for that image.
    const onBody = event.target === doc.body || event.target === doc.documentElement;
    const forSelectedImage = event.type === 'paste' && onBody && isImagePath(selectedPath());
    if (!root.contains(event.target as Node) && !forSelectedImage) return;
    const data = 'clipboardData' in event ? event.clipboardData : event.dataTransfer;
    const file = imageFileFromTransfer(data);
    if (event.type === 'drop') markDropTarget(null);
    if (!file) return;
    event.preventDefault();
    const selected = selectedPath();
    // Onto an image, or pasted while one is selected: that image is replaced.
    const target =
      event.type === 'drop'
        ? replaceableImageAt(event.target)?.getAttribute(AST_PATH_ATTR)
        : isImagePath(selected) ? selected : null;
    // Not onto an image: a drop lands in the gap it was dropped in; a paste is placed by the page.
    const at = !target && event.type === 'drop' ? { at: dropGapAt(event.target, (event as DragEvent).clientY) } : {};
    post({ type: STORY_IMAGE_DROP_MESSAGE, file, ...(target ? { target } : {}), ...at });
  };

  /**
   * A drop target only receives `drop` if `dragover` was prevented, but doing that unconditionally
   * would make the whole document swallow every drag — so it is prevented only while a FILE is
   * being dragged.
   */
  const onDragOver = (event: DragEvent) => {
    if (!root.contains(event.target as Node)) {
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

  doc.addEventListener('paste', onImageTransfer as EventListener, true);
  doc.addEventListener('drop', onImageTransfer as EventListener, true);
  doc.addEventListener('dragover', onDragOver as EventListener, true);
  doc.addEventListener('dragleave', onDragLeave as EventListener, true);
  doc.addEventListener('dragend', onDragEnd, true);
  doc.addEventListener('dblclick', onDoubleClick, true);

  return {
    dispose() {
      doc.removeEventListener('paste', onImageTransfer as EventListener, true);
      doc.removeEventListener('drop', onImageTransfer as EventListener, true);
      doc.removeEventListener('dragover', onDragOver as EventListener, true);
      doc.removeEventListener('dragleave', onDragLeave as EventListener, true);
      doc.removeEventListener('dragend', onDragEnd, true);
      doc.removeEventListener('dblclick', onDoubleClick, true);
      markDropTarget(null);
    },
  };
}
