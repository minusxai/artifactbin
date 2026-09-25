/**
 * ARROW KEYS ACROSS TEXT REGIONS, IN EDIT MODE.
 *
 * The edit session splits a document into many editable regions: one
 * ProseMirror flow per run of sibling prose, and one contentEditable host per
 * text element elsewhere (a card's paragraph, a table cell, a label). Inside a
 * region the browser (or ProseMirror) moves the caret; at a region's edge it
 * has nowhere to go, and the caret stuck there. This module moves it on to the
 * next region in reading order, as if the document were one text.
 *
 * It acts only on a plain arrow, a collapsed caret, and a caret already on the
 * edge line (↑/↓) or edge position (←/→) of the region the key was typed in.
 * Everything else — Shift selection, word/line motion, IME composition, a key
 * another handler already took, the first and last region — stays with the
 * browser. Layout reads and caret writes live behind `RegionGeometry`, so the
 * decision can be tested without a layout engine.
 */
import { Selection as ProseSelection, TextSelection } from 'prosemirror-state';
import type { Node as ProseNode } from 'prosemirror-model';
import type { EditorView } from 'prosemirror-view';

export type ArrowDirection = 'up' | 'down' | 'left' | 'right';

/** One editable text region: a ProseMirror flow (`view` set) or a single contentEditable host. */
export interface TextRegion {
  el: HTMLElement;
  view: EditorView | null;
}

/** Everything that needs layout or writes the caret. */
export interface RegionGeometry {
  /** Rendered at all (a hidden slide or collapsed section is not). */
  visible(region: TextRegion): boolean;
  /** The collapsed caret is on the region's last line (down), first line (up), very end (right) or very start (left). */
  atEdge(region: TextRegion, direction: ArrowDirection): boolean;
  /** The caret's horizontal position in viewport pixels, or null when it cannot be measured. */
  caretX(region: TextRegion): number | null;
  /**
   * Focus the region and put the caret where a move in `direction` arrives:
   * the first line (down) or last line (up) nearest `x`, the start (right) or
   * the end (left).
   */
  enter(region: TextRegion, direction: ArrowDirection, x: number | null): void;
}

const DIRECTIONS: Record<string, ArrowDirection> = {
  ArrowUp: 'up',
  ArrowDown: 'down',
  ArrowLeft: 'left',
  ArrowRight: 'right',
};

/** Chrome the document draws over itself re-renders its own nodes; those copies are never regions. */
const DOCUMENT_CHROME = '.mx-rail, .mx-present, [data-mx-node-chrome]';
/** A widget that owns the arrow keys while focus is inside it. */
const ARROW_OWNERS = '[role="listbox"], [role="menu"], [role="combobox"], [role="grid"], [role="tree"]';

const forward = (direction: ArrowDirection) => direction === 'down' || direction === 'right';
const vertical = (direction: ArrowDirection) => direction === 'up' || direction === 'down';

/** The move a plain arrow asks for, or null when this key is not ours to take. */
export function arrowDirection(event: KeyboardEvent): ArrowDirection | null {
  if (event.defaultPrevented || event.isComposing || event.keyCode === 229) return null;
  if (event.shiftKey || event.ctrlKey || event.metaKey || event.altKey) return null;
  return DIRECTIONS[event.key] ?? null;
}

/** The neighbour in reading order; null past either end (no wrap) or when `current` is not listed. */
export function adjacentRegion<T>(regions: readonly T[], current: T, direction: ArrowDirection): T | null {
  const index = regions.indexOf(current);
  if (index < 0) return null;
  return regions[index + (forward(direction) ? 1 : -1)] ?? null;
}

/**
 * The editable text regions under `scope`, in document order: the session's
 * ProseMirror views and the outermost contentEditable text hosts outside them.
 */
export function collectTextRegions(scope: ParentNode, views: Iterable<EditorView>): TextRegion[] {
  const inScope = (el: Element) => scope.contains(el) && !el.closest(DOCUMENT_CHROME);
  const regions: TextRegion[] = [];
  for (const view of views) if (inScope(view.dom)) regions.push({ el: view.dom, view });
  for (const el of scope.querySelectorAll<HTMLElement>('[data-mx-ast][contenteditable="true"]')) {
    if (!inScope(el) || el.closest('.ProseMirror')) continue;
    const outer = el.parentElement?.closest('[contenteditable="true"]');
    if (outer && scope.contains(outer)) continue;
    regions.push({ el, view: null });
  }
  return regions.sort((a, b) =>
    a.el === b.el ? 0 : a.el.compareDocumentPosition(b.el) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1,
  );
}

/**
 * Take the key when it crosses a region boundary: decide the target, move the
 * caret there, and consume the event. Returns whether it did.
 */
export function navigateAcrossRegions(
  event: KeyboardEvent,
  { regions, selection, geometry }: { regions: readonly TextRegion[]; selection: Selection | null; geometry: RegionGeometry },
): boolean {
  const direction = arrowDirection(event);
  if (!direction || !selection || selection.rangeCount === 0 || !selection.isCollapsed) return false;
  const target = event.target as Element | null;
  if (!target?.closest || target.closest(ARROW_OWNERS)) return false;
  const current = regions.find((region) => region.el.contains(selection.anchorNode));
  if (!current || !current.el.contains(target)) return false;
  if (!geometry.atEdge(current, direction)) return false;
  const next = adjacentRegion(
    regions.filter((region) => region === current || geometry.visible(region)),
    current,
    direction,
  );
  if (!next) return false;
  const x = vertical(direction) ? geometry.caretX(current) : null;
  event.preventDefault();
  // The region the key was typed in must not also act on it.
  event.stopPropagation();
  geometry.enter(next, direction, x);
  return true;
}

// ── the browser's geometry ────────────────────────────────────────────────────

const clamp = (value: number, low: number, high: number) => Math.max(low, Math.min(high, value));

/** The first and last places a caret can sit in a flow's text (never a node selection on an atom). */
const firstText = (doc: ProseNode) => ProseSelection.findFrom(doc.resolve(0), 1, true);
const lastText = (doc: ProseNode) => ProseSelection.findFrom(doc.resolve(doc.content.size), -1, true);

function viewAtEdge(view: EditorView, direction: ArrowDirection): boolean {
  const { selection, doc } = view.state;
  if (!selection.empty || !(selection instanceof TextSelection)) return false;
  const edge = forward(direction) ? lastText(doc) : firstText(doc);
  if (!edge) return false;
  if (!vertical(direction)) return selection.head === edge.head;
  // The edge textblock, and the edge line of it.
  if (selection.$head.start() !== edge.$head.start()) return false;
  return view.endOfTextblock(direction);
}

function enterView(view: EditorView, direction: ArrowDirection, x: number | null): void {
  const { doc } = view.state;
  const edge = forward(direction) ? firstText(doc) : lastText(doc);
  if (!edge) return;
  let head = edge.head;
  if (x !== null && vertical(direction)) {
    try {
      // posAtCoords only resolves on-screen points: bring the edge line in first.
      const at = view.domAtPos(head).node;
      (at.nodeType === 1 ? (at as Element) : at.parentElement)?.scrollIntoView?.({ block: 'nearest' });
      const line = view.coordsAtPos(head);
      const box = view.dom.getBoundingClientRect();
      const hit = view.posAtCoords({ left: clamp(x, box.left + 1, box.right - 1), top: (line.top + line.bottom) / 2 });
      if (hit && doc.resolve(hit.pos).parent.isTextblock) head = hit.pos;
    } catch {
      // No layout to measure: the edge position is still the right landing.
    }
  }
  view.dispatch(view.state.tr.setSelection(TextSelection.create(doc, head)).scrollIntoView());
  view.focus();
}

/** Line boxes of `range`, ignoring the zero-width boxes of empty inline elements. */
const boxes = (range: Range): DOMRect[] =>
  typeof range.getClientRects === 'function' ? [...range.getClientRects()].filter((r) => r.width > 0 || r.height > 0) : [];

function caretRect(selection: Selection): DOMRect | null {
  if (!selection.rangeCount) return null;
  const range = selection.getRangeAt(0);
  const [first] = boxes(range);
  if (first) return first;
  // An empty line has no box of its own; its element's box stands in.
  const node = range.startContainer;
  const el = node.nodeType === 1 ? (node as Element) : node.parentElement;
  const rect = el?.getBoundingClientRect?.();
  return rect && (rect.width > 0 || rect.height > 0) ? rect : null;
}

function hostAtEdge(win: Window, host: HTMLElement, direction: ArrowDirection): boolean {
  const selection = win.getSelection();
  if (!selection?.rangeCount) return false;
  const caret = selection.getRangeAt(0);
  // Everything between the caret and the host's edge in this direction.
  const beyond = win.document.createRange();
  beyond.selectNodeContents(host);
  if (forward(direction)) beyond.setStart(caret.endContainer, caret.endOffset);
  else beyond.setEnd(caret.startContainer, caret.startOffset);
  // Source whitespace is not rendered text: a caret before it is at the end.
  if (!beyond.toString().trim()) return true;
  if (!vertical(direction)) return false;
  const rect = caretRect(selection);
  if (!rect) return false;
  // On the edge line when no text beyond the caret sits on a line past it.
  return !boxes(beyond).some((box) => {
    const middle = box.top + box.height / 2;
    return direction === 'down' ? middle > rect.bottom : middle < rect.top;
  });
}

function caretRangeAt(doc: Document, x: number, y: number): Range | null {
  const position = (doc as Document & {
    caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
  }).caretPositionFromPoint?.(x, y);
  if (position) {
    const range = doc.createRange();
    range.setStart(position.offsetNode, position.offset);
    return range;
  }
  return (doc as Document & { caretRangeFromPoint?: (x: number, y: number) => Range | null }).caretRangeFromPoint?.(x, y) ?? null;
}

function enterHost(win: Window, host: HTMLElement, direction: ArrowDirection, x: number | null): void {
  const doc = win.document;
  host.scrollIntoView?.({ block: 'nearest' });
  // Focus first: the session reports the new selection on focus, as for a click.
  host.focus({ preventScroll: true });
  let range: Range | null = null;
  if (x !== null && vertical(direction)) {
    const all = doc.createRange();
    all.selectNodeContents(host);
    const lines = boxes(all);
    if (lines.length) {
      const line = forward(direction)
        ? lines.reduce((a, b) => (b.top < a.top ? b : a))
        : lines.reduce((a, b) => (b.bottom > a.bottom ? b : a));
      const box = host.getBoundingClientRect();
      const hit = caretRangeAt(doc, clamp(x, box.left + 1, box.right - 1), line.top + line.height / 2);
      if (hit && host.contains(hit.startContainer)) range = hit;
    }
  }
  if (!range) {
    // Inside the first/last text node, where a click would put it, rather than between elements.
    const walker = doc.createTreeWalker(host, NodeFilter.SHOW_TEXT);
    let edge: Text | null = null;
    for (let node = walker.nextNode() as Text | null; node; node = walker.nextNode() as Text | null) {
      if (!node.data.trim()) continue;
      edge = node;
      if (forward(direction)) break;
    }
    range = doc.createRange();
    range.selectNodeContents(edge ?? host);
    range.collapse(forward(direction));
  }
  range.collapse(true);
  const selection = win.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
}

/** The geometry of a real document. */
export function createRegionGeometry(win: Window): RegionGeometry {
  return {
    visible: ({ el }) => el.isConnected && ((el as HTMLElement & { checkVisibility?: () => boolean }).checkVisibility?.() ?? true),
    atEdge: (region, direction) =>
      region.view ? viewAtEdge(region.view, direction) : hostAtEdge(win, region.el, direction),
    caretX(region) {
      try {
        if (region.view) return region.view.coordsAtPos(region.view.state.selection.head).left;
        const selection = win.getSelection();
        return selection ? (caretRect(selection)?.left ?? null) : null;
      } catch {
        return null;
      }
    },
    enter: (region, direction, x) =>
      region.view ? enterView(region.view, direction, x) : enterHost(win, region.el, direction, x),
  };
}
