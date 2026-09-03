'use client';

/**
 * THE VIEW-MODE TEXT-SELECTION BUBBLE, inside the sandboxed document.
 *
 * The parent cannot inspect a Selection in an opaque iframe, so the document
 * owns its geometry and reports only the authorized action the user chose plus
 * the containing source node. Capabilities come from the parent; a shared
 * reader receives neither and therefore gets no chrome at all.
 */
import { AST_PATH_ATTR } from '@/lib/story-ui/ast-path';
import type { JsxNode } from '@/lib/jsx';
import type { StoryEditSelection, StorySelectionActionsMessage } from '../contract';
import { describeSelection } from './describe-selection';
import { anchorFor, describeRange } from './selection-range';

export const SELECTION_ACTIONS_ATTR = 'data-mx-selection-actions';
/** Stamped on the buttons when the pointer is coarse; the sheet grows them to a touch target. */
export const SELECTION_ACTION_COARSE_CLASS = 'mx-selection-action--coarse';
const SELECTION_ACTION_ATTR = 'data-mx-selection-action';
const SELECTION_ACTIONS_CSS_ATTR = 'data-mx-selection-actions-css';
/**
 * The reader's bottom dock, rendered into the served document itself
 * (lib/story/document renderReaderChrome). Named by its attribute rather than
 * imported: nothing in the reader's bundle may reach the server modules.
 */
const READER_CHROME_ATTR = 'data-mx-reader-chrome';
/**
 * How long a touch selection must sit still before the bubble appears.
 * Dragging a handle fires `selectionchange` continuously, and the bubble
 * belongs where the gesture ENDED — chasing every intermediate selection would
 * also make it flicker under the platform's own menu while that settles.
 */
const TOUCH_SETTLE_MS = 200;

const SELECTION_ACTIONS_CSS = `
[${SELECTION_ACTIONS_ATTR}] {
  all: initial; box-sizing: border-box; position: fixed; z-index: 2147483646;
  display: flex; align-items: center; overflow: hidden;
  border: 1px solid rgba(148, 163, 184, .48); border-radius: 7px;
  background: #fff; color: #344054;
  box-shadow: 0 7px 20px rgba(15, 23, 42, .16);
  font: 600 11px/1 ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  white-space: nowrap; animation: mx-selection-actions-in 90ms ease-out;
}
[${SELECTION_ACTIONS_ATTR}][hidden] { display: none !important; }
:root.dark [${SELECTION_ACTIONS_ATTR}] {
  border-color: rgba(148, 163, 184, .34); background: #17191d; color: #e5e7eb;
  box-shadow: 0 7px 22px rgba(0, 0, 0, .42);
}
[${SELECTION_ACTIONS_ATTR}] button {
  all: unset; box-sizing: border-box; display: inline-flex; align-items: center;
  gap: 5px; min-height: 28px; padding: 0 9px; cursor: pointer; color: inherit;
}
[${SELECTION_ACTIONS_ATTR}] button.${SELECTION_ACTION_COARSE_CLASS} { min-height: 44px; padding: 0 14px; gap: 7px; }
[${SELECTION_ACTIONS_ATTR}] svg { display: block; width: 13px; height: 13px; flex: none; }
[${SELECTION_ACTIONS_ATTR}] button + button { border-left: 1px solid rgba(148, 163, 184, .32); }
[${SELECTION_ACTIONS_ATTR}] button:hover,
[${SELECTION_ACTIONS_ATTR}] button:focus-visible { background: rgba(34, 197, 94, .11); color: #16a34a; outline: none; }
@keyframes mx-selection-actions-in { from { opacity: 0; } to { opacity: 1; } }
@media (prefers-reduced-motion: reduce) { [${SELECTION_ACTIONS_ATTR}] { animation: none; } }
`;

/**
 * Selecting with the keyboard is Shift+motion or select-all. Any OTHER keyup
 * cannot have changed a Selection, and answering one costs a Selection read
 * and two layout boxes — on every keystroke, in a document that may well have
 * a text input in it.
 */
const MOTION_KEYS = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown']);
const changesSelection = (event: KeyboardEvent) =>
  MOTION_KEYS.has(event.key)
  || event.key === 'Shift'
  || ((event.key === 'a' || event.key === 'A') && (event.ctrlKey || event.metaKey));

/**
 * A touch device, asked the only way a document can ask. jsdom answers no
 * matchMedia at all, so the call is optional and an unanswerable query keeps
 * the mouse placement.
 */
const isCoarsePointer = (win: Window) => win.matchMedia?.('(pointer: coarse)')?.matches === true;

export interface FrameSelectionActions {
  update(capabilities: StorySelectionActionsMessage): void;
  setNodes(nodes: JsxNode[]): void;
  dispose(): void;
}

export function createFrameSelectionActions({
  win,
  onAction,
}: {
  win: Window;
  onAction: (action: 'edit' | 'annotate', selection: StoryEditSelection) => void;
}): FrameSelectionActions {
  const doc = win.document;
  let nodes: JsxNode[] = [];
  let capabilities: StorySelectionActionsMessage = {
    type: 'mx:selection-actions', edit: false, annotate: false,
  };
  /**
   * ONE Range, TWO answers. Edit opens on the deepest element the user touched
   * — the caret's own target — while a comment belongs to the BLOCK that holds
   * the whole selection, with the selected words travelling beside it. Both are
   * captured while the Range is live (the toolbar preserves the Selection, but
   * the two questions are asked of the geometry, not of the click).
   */
  let activeSelection: StoryEditSelection | null = null;
  let activeAnnotation: StoryEditSelection | null = null;
  let toolbar: HTMLDivElement | null = null;
  let receivedCapabilities = false;

  const style = doc.createElement('style');
  style.setAttribute(SELECTION_ACTIONS_CSS_ATTR, '');
  style.textContent = SELECTION_ACTIONS_CSS;
  doc.head.appendChild(style);

  /** The pending touch settle, if a selection is still moving. */
  let settle = 0;
  const cancelSettle = () => {
    if (!settle) return;
    win.clearTimeout(settle);
    settle = 0;
  };

  const hide = () => {
    cancelSettle();
    activeSelection = null;
    activeAnnotation = null;
    if (toolbar) toolbar.hidden = true;
  };

  const makeButton = (action: 'edit' | 'annotate') => {
    const button = doc.createElement('button');
    button.type = 'button';
    button.setAttribute(SELECTION_ACTION_ATTR, action);
    button.setAttribute('aria-label', action === 'edit' ? 'Edit selected text' : 'Annotate selected text');
    // A 28px row is under every touch-target floor there is; a thumb gets 44.
    if (isCoarsePointer(win)) button.classList.add(SELECTION_ACTION_COARSE_CLASS);
    // These are Lucide's Pencil and MessageSquare glyphs. Build their tiny SVG
    // nodes directly because this view-mode module deliberately has no React
    // dependency and stays a separate tiny lazy chunk.
    const svg = doc.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '2');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('class', `lucide lucide-${action === 'edit' ? 'pencil' : 'message-square'}`);
    const paths = action === 'edit'
      ? [
          'M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z',
          'm15 5 4 4',
        ]
      : ['M22 17a2 2 0 0 1-2 2H6.828a2 2 0 0 0-1.414.586l-2.202 2.202A.71.71 0 0 1 2 21.286V5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2z'];
    for (const d of paths) {
      const path = doc.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('d', d);
      svg.appendChild(path);
    }
    button.append(svg, doc.createTextNode(action));
    return button;
  };

  const ensureToolbar = () => {
    if (!toolbar) {
      toolbar = doc.createElement('div');
      toolbar.setAttribute(SELECTION_ACTIONS_ATTR, '');
      toolbar.setAttribute('role', 'toolbar');
      toolbar.setAttribute('aria-label', 'Text selection actions');
      toolbar.hidden = true;
      // Preserve the document Selection when a toolbar button takes the click.
      toolbar.addEventListener('pointerdown', (event) => event.preventDefault());
      toolbar.addEventListener('click', (event) => {
        const button = (event.target as Element | null)?.closest<HTMLButtonElement>(`[${SELECTION_ACTION_ATTR}]`);
        const action = button?.getAttribute(SELECTION_ACTION_ATTR);
        if (!activeSelection || (action !== 'edit' && action !== 'annotate')) return;
        event.preventDefault();
        event.stopPropagation();
        const chosen = (action === 'annotate' ? activeAnnotation : null) ?? activeSelection;
        hide();
        onAction(action, chosen);
      });
      doc.body.appendChild(toolbar);
    }
    toolbar.replaceChildren();
    if (capabilities.edit) toolbar.appendChild(makeButton('edit'));
    if (capabilities.annotate) toolbar.appendChild(makeButton('annotate'));
    return toolbar;
  };

  /*
   * The bottom of the space a touch bubble may occupy. The reader's dock is
   * `display: none` while the document is framed and only `position: fixed`
   * under 640px, so it counts only when it is really parked at the bottom of
   * the viewport — a dock in ordinary flow, scrolled into the upper half, must
   * not pull the bubble up off its words.
   */
  const clampToTouchSpace = (top: number, height: number) => {
    const dock = doc.querySelector(`[${READER_CHROME_ATTR}]`)?.getBoundingClientRect();
    const floor = dock && dock.height > 0 && dock.top > win.innerHeight / 2
      ? Math.min(win.innerHeight - 8, dock.top - 8)
      : win.innerHeight - 8;
    return Math.max(8, Math.min(top, floor - height));
  };

  const showForSelection = () => {
    if (!capabilities.edit && !capabilities.annotate) { hide(); return; }
    const nativeSelection = win.getSelection();
    if (!nativeSelection || nativeSelection.isCollapsed || nativeSelection.rangeCount === 0 || !nativeSelection.toString().trim()) {
      hide();
      return;
    }
    const range = nativeSelection.getRangeAt(0);
    const stampedAt = (node: Node): Element | null => {
      const element = node.nodeType === 1 ? node as Element : node.parentElement;
      return element?.closest(`[${AST_PATH_ATTR}]`) ?? null;
    };
    /*
     * An endpoint the selection does not actually COVER is not a candidate.
     *
     * A triple-click — and any drag that ends at the end of a line — leaves the
     * Range ending at offset 0 of the following block, so `endContainer` names
     * an element the user selected zero characters of. Preferring the deeper
     * path (below) then handed the action to whatever sat deeper in that next
     * subtree: on a deck slide, selecting the heading opened the composer on a
     * column label three elements away, and the tint landed there too.
     *
     * Written with `comparePoint` rather than `compareBoundaryPoints`, which
     * compares the ARGUMENT's boundary against `this` and reads backwards at
     * every call site — the first version of this guard had both comparisons
     * inverted and passed its own unit test anyway.
     */
    const coversText = (element: Element) => {
      const whole = doc.createRange();
      whole.selectNodeContents(element);
      const clipped = range.cloneRange();
      // Pull each end inward to the element's own bounds. comparePoint answers
      // -1 before / 0 inside / 1 after, about the point we hand it.
      if (whole.comparePoint(clipped.startContainer, clipped.startOffset) === -1) {
        clipped.setStart(whole.startContainer, whole.startOffset);
      }
      if (whole.comparePoint(clipped.endContainer, clipped.endOffset) === 1) {
        clipped.setEnd(whole.endContainer, whole.endOffset);
      }
      // Disjoint ranges collapse when clipped, and a collapsed one covers nothing.
      return !clipped.collapsed && clipped.toString().trim().length > 0;
    };
    const endpointElements = [stampedAt(range.startContainer), stampedAt(range.endContainer)]
      .filter((element): element is Element => element !== null)
      .filter(coversText);
    // A Range's common ancestor is intentionally broad: selecting across two
    // styled spans can make it the whole heading or layout wrapper. The action
    // should follow the most specific source element the user actually touched.
    // Compare both endpoints (selection direction must not matter), prefer the
    // deeper AST path, and use document order as the stable tie-breaker.
    const element = endpointElements.reduce<Element | null>((deepest, candidate) => {
      if (!deepest) return candidate;
      const deepestDepth = deepest.getAttribute(AST_PATH_ATTR)?.split('.').length ?? 0;
      const candidateDepth = candidate.getAttribute(AST_PATH_ATTR)?.split('.').length ?? 0;
      return candidateDepth > deepestDepth ? candidate : deepest;
    }, null) ?? stampedAt(range.commonAncestorContainer);
    if (!element || element.closest('.mx-rail, .mx-present') || element.closest(`[${SELECTION_ACTIONS_ATTR}]`)) {
      hide();
      return;
    }
    const described = describeSelection(element, nodes);
    if (!described) { hide(); return; }
    const rect = range.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) { hide(); return; }

    activeSelection = described;
    /*
     * The comment's own target: the block containing the selection, described
     * through the same door (so a stale path is still refused), plus the quote
     * and its anchor-relative parts. Null when the block is not in the source —
     * the annotate action then falls back to the edit target rather than
     * offering nothing.
     */
    const anchor = anchorFor(range);
    const annotated = anchor && !anchor.closest('.mx-rail, .mx-present') ? describeSelection(anchor, nodes) : null;
    if (annotated && anchor) {
      const captured = describeRange(range, anchor);
      annotated.quote = captured.quote;
      annotated.range = captured.range;
    }
    activeAnnotation = annotated;
    const surface = ensureToolbar();
    surface.hidden = false;
    const surfaceRect = surface.getBoundingClientRect();
    /*
     * ABOVE THE SELECTION IS THE PHONE'S OWN SPACE. Android and iOS draw their
     * Copy/Share menu there, and a multi-line selection's bounding box starts
     * at its FIRST line — so on a coarse pointer the bubble hangs below the
     * LAST line the gesture covered, where the thumb already is. A mouse keeps
     * today's placement, where above is out of the words' way and nothing else
     * is painted.
     *
     * Degenerate rects are skipped for the same reason `coversText` exists: a
     * Range ending at offset 0 of the following block carries a zero-width rect
     * belonging to a block the user selected nothing of, and anchoring to it
     * would drop the bubble far below the words.
     */
    const coarse = isCoarsePointer(win);
    const lines = coarse ? Array.from(range.getClientRects() ?? []) : [];
    const anchorRect = lines.filter((line) => line.width > 0 && line.height > 0).at(-1) ?? rect;
    const half = surfaceRect.width / 2;
    const left = Math.min(Math.max(anchorRect.left + anchorRect.width / 2, half + 8), win.innerWidth - half - 8);
    const above = !coarse && rect.top >= surfaceRect.height + 10;
    const top = above ? rect.top - 7 : anchorRect.bottom + 7;
    surface.style.left = `${Math.round(left)}px`;
    surface.style.top = `${Math.round(coarse ? clampToTouchSpace(top, surfaceRect.height) : top)}px`;
    surface.style.transform = above ? 'translate(-50%, -100%)' : 'translate(-50%, 0)';
  };

  const onPointerUp = (event: PointerEvent) => {
    if ((event.target as Element | null)?.closest?.(`[${SELECTION_ACTIONS_ATTR}]`)) return;
    win.queueMicrotask(showForSelection);
  };
  const onKeyUp = (event: KeyboardEvent) => { if (changesSelection(event)) showForSelection(); };
  /*
   * THE ONLY EVENT A TOUCH SELECTION FIRES. Android hands the long-press to its
   * own selection UI (the page sees `pointercancel` at best) and dragging the
   * handles is browser chrome that never reaches the page — so neither
   * `pointerup` nor a key ever arrives, and this listener, wired only to hide,
   * is what made the bubble unreachable on a phone. It SHOWS now, after a
   * settle that every further change re-arms, so a drag raises the bubble once,
   * where it ended. Collapsing still hides at once: a settle would leave the
   * bubble hanging over words that are no longer selected.
   */
  const onSelectionChange = () => {
    const selection = win.getSelection();
    if (!selection || selection.isCollapsed) { hide(); return; }
    if (!selection.toString().trim()) return;
    cancelSettle();
    settle = win.setTimeout(() => { settle = 0; showForSelection(); }, TOUCH_SETTLE_MS);
  };
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key !== 'Escape' || !toolbar || toolbar.hidden) return;
    hide();
    win.getSelection()?.removeAllRanges();
  };

  /*
   * A scroll or a resize MOVES the selected words; it does not change them. So
   * the bubble follows rather than hiding — hiding cost the reader their bubble
   * for a gesture that selected nothing, with no way back but selecting again.
   * Coalesced to one measurement per frame, and never a way to CREATE a bubble:
   * with nothing active there is nothing to follow.
   */
  let scheduled = 0;
  const reposition = () => {
    if (!activeSelection || scheduled) return;
    scheduled = win.requestAnimationFrame(() => {
      scheduled = 0;
      showForSelection();
    });
  };

  doc.addEventListener('pointerup', onPointerUp);
  doc.addEventListener('keyup', onKeyUp);
  doc.addEventListener('selectionchange', onSelectionChange);
  doc.addEventListener('keydown', onKeyDown);
  win.addEventListener('scroll', reposition, { passive: true });
  win.addEventListener('resize', reposition, { passive: true });

  return {
    update(next) {
      const firstUpdate = !receivedCapabilities;
      receivedCapabilities = true;
      capabilities = next;
      hide();
      if (toolbar) {
        toolbar.remove();
        toolbar = null;
      }
      // The first selection can finish while this tiny lazy chunk is loading.
      // Recover that still-live Range once, but never resurrect stale selected
      // text merely because the user later exits a mode.
      if (firstUpdate && (next.edit || next.annotate)) win.queueMicrotask(showForSelection);
    },
    setNodes(next) {
      nodes = next;
    },
    dispose() {
      hide();
      if (scheduled) win.cancelAnimationFrame(scheduled);
      toolbar?.remove();
      style.remove();
      doc.removeEventListener('pointerup', onPointerUp);
      doc.removeEventListener('keyup', onKeyUp);
      doc.removeEventListener('selectionchange', onSelectionChange);
      doc.removeEventListener('keydown', onKeyDown);
      win.removeEventListener('scroll', reposition);
      win.removeEventListener('resize', reposition);
    },
  };
}
