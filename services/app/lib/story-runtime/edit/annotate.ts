'use client';

/**
 * THE ANNOTATION LAYER, INSIDE THE DOCUMENT — the frame half of annotations,
 * and even thinner than edit mode: it never makes anything editable and stages
 * nothing. It is a LAYER, not a mode: whenever it is on, commented nodes carry
 * a soft highlight TINT and their geometry is reported upward so the page can
 * float comment cards at their anchors — in view mode and while editing alike.
 * Clicking a highlight focuses its thread (`mx:annotation-pin`); the page holds
 * the annotation content, the session and the network, and ids + BODY paths are
 * the only annotation data that ever enters this realm.
 *
 * ONE thing varies with edit mode, and this module decides it rather than
 * being told: while an edit session exists a click belongs to the CARET, so
 * the layer never swallows one. That is why `isEditing` is a predicate the
 * caller owns — the frame already knows whether it is editable, and asking the
 * page to restate it on the wire is what made this a mode to begin with.
 *
 * THE PICK is the one exception, and it is one-shot. The rail's pick tool
 * (`picking` on the state message) is the edit-mode move for a comment: the
 * selectable node under the pointer carries an outline and a click on it IS
 * the selection — reported as `mx:selection`, the same report the breadcrumb
 * widening uses, so the page opens its composer there. A comment made by
 * selecting words cannot reach a chart, an image or a whole list; this can.
 * The click is taken even while editing, from a WINDOW-capture listener so the
 * edit session's document-capture listener never sees it, and `mousedown` is
 * cancelled so no host is focused and no text selection starts. Escape hands
 * back a null selection so the page can stand down; the page ends the pick
 * the moment either arrives.
 *
 * THE DRAWN AREA is the pick's second mode (`pick: 'area'`): a rubber band
 * over the document, whose anchor is the lowest common ancestor of the blocks
 * it touched (lib/story/annotation-range `areaTarget`) and whose box rides
 * the same `mx:selection` as an area RANGE — fractions of the anchor, so it
 * survives a reflow. A saved area thread is painted back as an overlay box
 * where a text thread has its highlight, and its layout report is the box.
 * The press is cancelled while drawing (no text selection under a band), and
 * a release with no drag is an ordinary block pick.
 *
 * Loaded lazily on the first non-off `mx:annotations` (the edit-chunk
 * pattern): a reader never downloads it, and a shared reader's top-level
 * document has no parent channel so the message cannot even arrive.
 */
import type { JsxNode } from '@/lib/jsx';
import { AST_PATH_ATTR } from '@/lib/story-ui/ast-path';
import type { RuntimeChannel } from '../pristine';
import {
  STORY_ANNOTATION_HOVER_MESSAGE, STORY_ANNOTATION_LAYOUT_MESSAGE, STORY_ANNOTATION_PIN_MESSAGE, STORY_SELECTION_MESSAGE,
  type StoryAnnotationsMessage,
} from '../contract';
import { describeSelection } from './describe-selection';
type AnnotationRangeOnWire = NonNullable<StoryAnnotationsMessage['pins'][number]['range']>;
import { resolveParts } from './selection-range';
import {
  ANNOTATION_AREA_MIN_PX, areaTarget, boxFromRects, isAreaRange, rectFromBox,
  type AnnotationBox, type AnnotationRect,
} from '@/lib/story/annotation-range';

/** Marks every node carrying an open annotation, in every mode the layer is on for. */
export const ANNOTATED_ATTR = 'data-mx-annotated';
/** Marks the node whose thread the page has open. Own attribute — the edit session clears its own. */
export const ANNOTATION_OPEN_ATTR = 'data-mx-annotation-open';
/** Marks the node under either the comment card or document pointer. */
export const ANNOTATION_HOVER_ATTR = 'data-mx-annotation-hover';
/** Marks the node the owner is currently COMPOSING on (annotate mode's selection). */
export const ANNOTATE_SELECTED_ATTR = 'data-mx-annotate-selected';
/**
 * Marks a node whose comment's own WORDS are painted instead of the whole
 * node. The behaviour attributes above stay exactly as they were — a click on
 * the paragraph still opens the thread — this only takes the node's background
 * away, because the highlight underneath it is more precise.
 */
export const ANNOTATION_RANGED_ATTR = 'data-mx-annotation-ranged';
/** One CSS highlight per thread: `mx-annotation-<id>`, so a rule can name it. */
export const ANNOTATION_HIGHLIGHT_PREFIX = 'mx-annotation-';
/** Marks the selectable node under the pointer WHILE PICKING (the rail's pick tool) — the edit-mode hover, for a comment. */
export const ANNOTATE_PICK_HOVER_ATTR = 'data-mx-annotate-pick-hover';
/** Stamped on the document element while a pick is on — its VALUE is the mode (`block` | `area`) — so a stylesheet can say "crosshair" everywhere. */
export const ANNOTATE_PICKING_ATTR = 'data-mx-annotate-picking';
/** The rubber band while an area is being drawn, and the drawn area while its comment is being composed. */
export const ANNOTATE_BAND_ATTR = 'data-mx-annotate-band';
/** One painted overlay per AREA thread, by thread id — the area's own box, where a text thread has its highlight. */
export const ANNOTATION_AREA_ATTR = 'data-mx-annotation-area';

// Persistent annotation chrome is a tint, while the transient cross-surface
// hover gets an outline so the relationship is unmistakable without shifting
// layout. The composing selection keeps its stronger cursor outline.
//
// The tint now shows while the document is EDITABLE too, where it shares a node
// with the edit selection's own outline — so it is deliberately quieter than
// the hover and the composing states, which are the ones a person is currently
// pointing at. `cursor: pointer` is not part of the base rule for the same
// reason: over an editable host the caret must still read as a caret.
export const ANNOTATE_CSS = [
  `[${ANNOTATED_ATTR}] { background: rgba(245, 158, 11, 0.10); border-radius: 3px; transition: background 120ms; }`,
  `[${ANNOTATED_ATTR}]:not([contenteditable]) { cursor: pointer; }`,
  `[${ANNOTATED_ATTR}]:hover { background: rgba(245, 158, 11, 0.20); }`,
  `[${ANNOTATION_OPEN_ATTR}] { background: rgba(245, 158, 11, 0.26); border-radius: 3px; }`,
  `[${ANNOTATION_HOVER_ATTR}] { background: rgba(245, 158, 11, 0.18); outline: 2px solid rgba(245, 158, 11, 0.82); outline-offset: 3px; border-radius: 3px; }`,
  `[${ANNOTATE_SELECTED_ATTR}] { outline: 2px solid rgba(245, 158, 11, 0.85); outline-offset: 3px; border-radius: 3px; }`,
  // The pick: a crosshair everywhere, and an outline on the block under it. The
  // doubled attribute is deliberate — it out-specifies the edit session's own
  // `[data-mx-edit-hover]` when both stamp the same node while editing.
  `[${ANNOTATE_PICKING_ATTR}], [${ANNOTATE_PICKING_ATTR}] * { cursor: crosshair !important; }`,
  // A finger drawing an area must draw, not scroll; and nothing under a band selects.
  `[${ANNOTATE_PICKING_ATTR}="area"], [${ANNOTATE_PICKING_ATTR}="area"] * { touch-action: none !important; user-select: none !important; }`,
  `[${ANNOTATE_PICK_HOVER_ATTR}][${ANNOTATE_PICK_HOVER_ATTR}] { outline: 2px solid rgba(245, 158, 11, 0.9); outline-offset: 3px; border-radius: 3px; background: rgba(245, 158, 11, 0.08); }`,
  // A node whose words are painted gives up its own background — the tint is
  // what a comment looks like when we cannot find the words, not as well as.
  `[${ANNOTATED_ATTR}][${ANNOTATION_RANGED_ATTR}],`
    + `[${ANNOTATED_ATTR}][${ANNOTATION_RANGED_ATTR}]:hover,`
    + `[${ANNOTATION_OPEN_ATTR}][${ANNOTATION_RANGED_ATTR}],`
    + `[${ANNOTATION_HOVER_ATTR}][${ANNOTATION_RANGED_ATTR}] { background: transparent; }`,
].join('\n');

/** What a thread's own words look like, by the state the page put it in. */
const HIGHLIGHT_FILL = {
  base: 'rgba(245, 158, 11, 0.28)',
  hover: 'rgba(245, 158, 11, 0.42)',
  open: 'rgba(245, 158, 11, 0.52)',
};
/**
 * The band being DRAWN, and the drawn area while its comment is composed:
 * blue, so it reads apart from the amber outline of the anchor node around
 * it — two rectangles in one colour were one rectangle to the eye.
 */
const BAND_STYLE = { background: 'rgba(59, 130, 246, 0.10)', outline: 'rgba(59, 130, 246, 0.9)' };
/** A SAVED area box is amber like every other mark of a comment, an OUTLINE first: it may cover a chart, and a fill as strong as the words' would hide it. */
const AREA_FILL = {
  base: { background: 'rgba(245, 158, 11, 0.12)', outline: '2px solid rgba(245, 158, 11, 0.6)' },
  hover: { background: 'rgba(245, 158, 11, 0.2)', outline: '2px solid rgba(245, 158, 11, 0.9)' },
  open: { background: 'rgba(245, 158, 11, 0.26)', outline: '2px solid rgba(245, 158, 11, 0.9)' },
};

/**
 * THE CSS CUSTOM HIGHLIGHT API, or nothing. It paints a live Range without
 * touching the DOM, which is the whole reason a comment can highlight the
 * exact words at all: a wrapping span would be read straight back into the
 * source by the editor's write-back. Where it is missing (jsdom, an older
 * browser) every thread simply keeps the whole-node tint.
 */
interface HighlightRegistry {
  set(name: string, highlight: object): void;
  delete(name: string): boolean;
  has(name: string): boolean;
}
type HighlightConstructor = new (...ranges: Range[]) => object;

const highlightApi = (win: Window): { registry: HighlightRegistry; Highlight: HighlightConstructor } | null => {
  const scope = win as unknown as { CSS?: { highlights?: HighlightRegistry }; Highlight?: HighlightConstructor };
  const registry = scope.CSS?.highlights;
  const Highlight = scope.Highlight;
  return registry && Highlight ? { registry, Highlight } : null;
};

/** A highlight name is a CSS identifier: anything else in an id cannot be selected. */
const highlightNameFor = (id: string): string => ANNOTATION_HIGHLIGHT_PREFIX + id.replace(/[^A-Za-z0-9_-]/g, '-');

/**
 * The union of a set of ranges' boxes — one rect per thread, still. `Range`'s
 * own `getBoundingClientRect` is CSSOM View: every browser has it and jsdom
 * does not, so a missing method means "cannot measure", which falls back to the
 * node rect exactly like a range that was not found.
 */
function unionRect(ranges: Range[]): { x: number; y: number; top: number; width: number; height: number } | null {
  const rects = ranges
    .filter((range) => typeof range.getBoundingClientRect === 'function')
    .map((range) => range.getBoundingClientRect());
  const real = rects.filter((rect) => rect.width > 0 || rect.height > 0);
  if (real.length === 0) return null;
  const left = Math.min(...real.map((r) => r.left));
  const top = Math.min(...real.map((r) => r.top));
  const right = Math.max(...real.map((r) => r.right));
  const bottom = Math.max(...real.map((r) => r.bottom));
  // `top` beside `y` so a union reads like the DOMRect the callers already take.
  return { x: left, y: top, top, width: right - left, height: bottom - top };
}

const ANNOTATE_CSS_ATTR = 'data-mx-annotate-css';

export interface FrameAnnotateSession {
  /** The whole highlight/mode state, idempotent — re-applied on every message and every re-render. */
  update(message: StoryAnnotationsMessage): void;
  /** The nodes currently rendered — selection is classified against the SOURCE. */
  setNodes(nodes: JsxNode[]): void;
  /** Select a node by path (a breadcrumb click on the page), or clear with null. Answers with `mx:selection`. */
  select(path: string | null): void;
  dispose(): void;
}

export interface FrameAnnotateOptions {
  win: Window;
  channel: RuntimeChannel;
  root?: HTMLElement;
  /**
   * Is the document editable right now? Read on every click, never cached: the
   * edit session comes and goes without the annotation layer hearing about it,
   * and a stale answer would either steal the caret or lose the thread click.
   */
  isEditing: () => boolean;
}

export function createFrameAnnotateSession({ win, channel, isEditing, root }: FrameAnnotateOptions): FrameAnnotateSession {
  const doc = win.document;
  const scope = root ?? doc;
  let nodes: JsxNode[] = [];
  let state: StoryAnnotationsMessage | null = null;
  let selectedPath: string | null = null;
  /** Last pin hover reported upward, deduplicated across descendant transitions. */
  let reportedHoverId: string | null = null;
  /** The openId whose node was last scrolled to — scroll once per open, not per re-apply. */
  let scrolledTo: string | null = null;
  /** The ranges currently painted for each thread — the layout rect follows the WORDS when there are any. */
  let painted = new Map<string, Range[]>();
  /** The pick mode (the rail's tools). Read from the state message; never inferred. */
  let pick: 'block' | 'area' | null = null;
  /** The selectable node under the pointer while block-picking — one at a time. */
  let pickHovered: Element | null = null;
  /** An area being drawn: where the press landed. The band element exists once the drag is real. */
  let drawing: { startX: number; startY: number; target: EventTarget | null } | null = null;
  /** The drawn area whose comment is being composed — repainted from its anchor on every sync, gone with the selection. */
  let composingArea: { path: string; box: AnnotationBox } | null = null;
  /** The rects painted for AREA threads this sync — the layout rect is the box, not the node. */
  let paintedAreas = new Map<string, AnnotationRect>();
  /** Highlight names this session registered, so it can take back exactly its own. */
  const registeredHighlights = new Set<string>();
  let rafPending = false;

  const post = (message: Record<string, unknown>) => channel.post({ ...message, nonce: channel.nonce });

  /**
   * Deck thumbnails re-render the slide's real nodes (and therefore duplicate
   * paths + annotation anchors). Geometry and selection always belong to the
   * main document copy, never its rail/presentation chrome.
   */
  const mainElementMatching = (selector: string): HTMLElement | null =>
    [...scope.querySelectorAll<HTMLElement>(selector)]
      .find((el) => !el.closest('.mx-rail, .mx-present')) ?? null;

  const elementFor = (path: string): HTMLElement | null =>
    mainElementMatching(`[${AST_PATH_ATTR}="${CSS.escape(path)}"]`);

  /**
   * A pin's element: current authored id first, then the historical opaque
   * source-anchor attribute. A durable identity that no longer resolves is an
   * orphan; only old payloads with neither identity may use their path.
   */
  const elementForPin = (pin: { path: string; key: string | null; nodeId?: string | null }): HTMLElement | null => {
    if (pin.nodeId) return mainElementMatching(`#${CSS.escape(pin.nodeId)}`);
    if (pin.key) return mainElementMatching(`[data-annotation-anchor="${CSS.escape(pin.key)}"]`);
    // Only genuinely keyless historical payloads may use a positional address.
    // A missing durable target is orphaned, never whichever node inherited its path.
    return elementFor(pin.path);
  };

  /**
   * The layer's stylesheet, base rules plus one `::highlight()` rule per
   * painted thread. Regenerated with the state rather than patched: a highlight
   * name cannot be matched by a wildcard, so the rules ARE the state, and the
   * open/hovered thread simply gets a stronger fill in its own rule.
   */
  let ownedStyle: HTMLStyleElement | null = null;
  const ensureCss = (on: boolean, highlightRules: string[] = []) => {
    if (!on) { ownedStyle?.remove(); ownedStyle = null; return; }
    const style = ownedStyle ?? doc.createElement('style');
    const next = [ANNOTATE_CSS, ...highlightRules].join('\n');
    if (style.textContent !== next) style.textContent = next;
    if (!ownedStyle) {
      ownedStyle = style;
      style.setAttribute(ANNOTATE_CSS_ATTR, '');
      doc.head.appendChild(style);
    }
  };

  /** Take back every highlight this session registered — on 'off', on dispose, and before each rebuild. */
  const clearHighlights = () => {
    const api = highlightApi(win);
    for (const name of registeredHighlights) api?.registry.delete(name);
    registeredHighlights.clear();
    painted = new Map();
    paintedAreas = new Map();
    for (const overlay of scope.querySelectorAll(`[${ANNOTATION_AREA_ATTR}]`)) overlay.remove();
  };

  // ── area overlays ─────────────────────────────────────────────────────────
  /** One absolutely-positioned box, page coordinates, transparent to the pointer. */
  const placeOverlay = (el: HTMLElement, rect: AnnotationRect) => {
    el.style.position = 'absolute';
    el.style.left = `${rect.x + win.scrollX}px`;
    el.style.top = `${rect.y + win.scrollY}px`;
    el.style.width = `${rect.width}px`;
    el.style.height = `${rect.height}px`;
    el.style.pointerEvents = 'none';
    el.style.borderRadius = '3px';
    el.style.boxSizing = 'border-box';
    el.style.zIndex = '2147483000';
  };

  /**
   * Paint each AREA thread's box from its anchor's CURRENT rect. Rebuilt from
   * the stored fractions on every sync like the text highlights: a reflow
   * moves the anchor, and the box must follow it rather than the viewport.
   */
  const paintAreas = () => {
    if (!state || state.mode === 'off') return;
    for (const pin of state.pins) {
      if (!isAreaRange(pin.range)) continue;
      const el = elementForPin(pin);
      if (!el) continue;
      const rect = rectFromBox(el.getBoundingClientRect(), pin.range.box);
      const overlay = doc.createElement('div');
      overlay.setAttribute(ANNOTATION_AREA_ATTR, pin.id);
      placeOverlay(overlay, rect);
      const emphasis = state.openId === pin.id ? 'open' : state.hoverId === pin.id ? 'hover' : 'base';
      overlay.style.background = AREA_FILL[emphasis].background;
      overlay.style.outline = AREA_FILL[emphasis].outline;
      overlay.style.outlineOffset = '1px';
      (root ?? doc.body).appendChild(overlay);
      paintedAreas.set(pin.id, rect);
      el.setAttribute(ANNOTATION_RANGED_ATTR, '');
    }
  };

  /** The band: while a drag is in progress, and then the drawn area while its comment is composed. */
  const bandElement = (): HTMLElement => {
    let band = scope.querySelector<HTMLElement>(`[${ANNOTATE_BAND_ATTR}]`);
    if (!band) {
      band = doc.createElement('div');
      band.setAttribute(ANNOTATE_BAND_ATTR, '');
      band.style.background = BAND_STYLE.background;
      band.style.outline = `2px dashed ${BAND_STYLE.outline}`;
      (root ?? doc.body).appendChild(band);
    }
    return band;
  };
  const removeBand = () => scope.querySelector(`[${ANNOTATE_BAND_ATTR}]`)?.remove();

  /** The composing area follows its anchor and leaves with the selection. */
  const paintComposingArea = () => {
    if (!composingArea || !state || state.mode === 'off' || selectedPath !== composingArea.path) {
      composingArea = null;
      if (!drawing) removeBand();
      return;
    }
    const el = elementFor(composingArea.path);
    if (!el) { composingArea = null; removeBand(); return; }
    const band = bandElement();
    band.style.outlineStyle = 'solid';
    placeOverlay(band, rectFromBox(el.getBoundingClientRect(), composingArea.box));
  };

  /**
   * Paint each thread's own words, REBUILT FROM THE STORED RANGE EVERY TIME.
   * Never set once: a Highlight holds live Ranges, and a live update replaces
   * the text nodes underneath them, so a highlight that is not rebuilt after an
   * adopt points at nodes the document no longer has. This runs from
   * `applyState`, which is also what re-stamps the pins after a re-render.
   */
  const paintRanges = (): string[] => {
    clearHighlights();
    const api = highlightApi(win);
    if (!api || !state || state.mode === 'off') return [];
    const rules: string[] = [];
    for (const pin of state.pins) {
      if (!pin.range || isAreaRange(pin.range)) continue;   // areas are painted as boxes below
      const el = elementForPin(pin);
      if (!el) continue;
      const ranges = resolveParts(el, pin.range.parts);
      // EVERY part or none — the same rule the wire's `quote_found` answers by.
      // Not found is not an error: the words were edited away, and the node
      // tint says "there is a comment here" just as it always did, while a
      // highlight over the surviving half would point at a fragment nobody
      // commented on.
      if (ranges.length !== pin.range.parts.length) continue;
      const name = highlightNameFor(pin.id);
      api.registry.set(name, new api.Highlight(...ranges));
      registeredHighlights.add(name);
      painted.set(pin.id, ranges);
      el.setAttribute(ANNOTATION_RANGED_ATTR, '');
      const fill = state.openId === pin.id
        ? HIGHLIGHT_FILL.open
        : state.hoverId === pin.id ? HIGHLIGHT_FILL.hover : HIGHLIGHT_FILL.base;
      rules.push(`::highlight(${name}) { background-color: ${fill}; }`);
    }
    return rules;
  };

  /**
   * Report every anchored thread's geometry whenever the layer is on. The page
   * decides what to do with it — float a card, align a rail row, or ignore it —
   * because the page is the only side that knows whether a rail is open.
   */
  const reportLayout = () => {
    if (!state || state.mode === 'off') return;
    const positions = state.pins.flatMap((pin) => {
      const el = elementForPin(pin);
      if (!el) return [];
      // The card belongs beside the WORDS when we found them, or beside the
      // drawn AREA; the node is what a comment is about only when we could not.
      const words = painted.get(pin.id);
      const union = words ? unionRect(words) : null;
      const rect = paintedAreas.get(pin.id) ?? union ?? el.getBoundingClientRect();
      return [{ id: pin.id, rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height } }];
    });
    post({ type: STORY_ANNOTATION_LAYOUT_MESSAGE, positions });
  };

  /** Stamp idempotent state: all annotate-mode tints, or only the transient view-mode hover. */
  const applyState = () => {
    for (const el of scope.querySelectorAll(`[${ANNOTATED_ATTR}], [${ANNOTATION_OPEN_ATTR}], [${ANNOTATION_HOVER_ATTR}], [${ANNOTATE_SELECTED_ATTR}], [${ANNOTATION_RANGED_ATTR}]`)) {
      el.removeAttribute(ANNOTATED_ATTR);
      el.removeAttribute(ANNOTATION_OPEN_ATTR);
      el.removeAttribute(ANNOTATION_HOVER_ATTR);
      el.removeAttribute(ANNOTATE_SELECTED_ATTR);
      el.removeAttribute(ANNOTATION_RANGED_ATTR);
    }
    if (!state || state.mode === 'off') {
      clearHighlights();
      return;
    }
    for (const pin of state.pins) {
      const el = elementForPin(pin);
      if (!el) continue;
      el.setAttribute(ANNOTATED_ATTR, '');
      if (state.openId === pin.id) el.setAttribute(ANNOTATION_OPEN_ATTR, '');
    }
    if (selectedPath) elementFor(selectedPath)?.setAttribute(ANNOTATE_SELECTED_ATTR, '');
    const hovered = state.hoverId ? state.pins.find((pin) => pin.id === state!.hoverId) : null;
    if (hovered) elementForPin(hovered)?.setAttribute(ANNOTATION_HOVER_ATTR, '');
    // The words last, so their rules follow the state that was just stamped.
    ensureCss(true, paintRanges());
    paintAreas();
    paintComposingArea();
  };

  /** Keep the page-level draft popover attached while the document moves. */
  const reportSelectedGeometry = () => {
    if (!state || state.mode === 'off' || !selectedPath) return;
    const el = elementFor(selectedPath);
    if (!el) return;
    const selection = describeSelection(el, nodes);
    if (!selection) return;
    post({ type: STORY_SELECTION_MESSAGE, selection });
  };

  const scheduleSync = () => {
    if (rafPending) return;
    rafPending = true;
    win.requestAnimationFrame(() => {
      rafPending = false;
      applyState();
      reportLayout();
      reportSelectedGeometry();
    });
  };

  /** Report a selection: stamp the node so the owner sees what they picked, tell the page. */
  const reportSelection = (el: Element | null, extra: { range?: AnnotationRangeOnWire } = {}) => {
    const selection = el ? describeSelection(el, nodes) : null;
    if (selection && extra.range) selection.range = extra.range;
    selectedPath = selection?.path ?? null;
    applyState();
    post({ type: STORY_SELECTION_MESSAGE, selection });
  };

  /**
   * A click on a highlighted node focuses its thread — the Docs
   * click-the-highlight move. Never a rect update: `mx:annotation-pin` means
   * "someone asked for this thread" and nothing else.
   *
   * WHILE EDITING THIS DOES NOTHING. The click belongs to the caret, and a
   * capture-phase `preventDefault` here would make every commented paragraph
   * unselectable in the editor.
   */
  const onClick = (event: MouseEvent) => {
    if (root && !root.contains(event.target as Node)) return;
    // While picking, a click is the window listener's (below): a selectable
    // target was already taken there, and anything else is nobody's business.
    if (!state || state.mode === 'off' || pick || isEditing()) return;
    const target = event.target as HTMLElement | null;
    if (!target) return;
    // Preview copies (deck rail, present mode) render the same paths; never select through them.
    if (target.closest('.mx-rail, .mx-present')) return;
    const el = target.closest(`[${AST_PATH_ATTR}]`);
    if (!el) return;
    const annotated = target.closest(`[${ANNOTATED_ATTR}]`);
    if (annotated) {
      event.preventDefault();
      const nodeId = annotated.id || null;
      const key = annotated.getAttribute('data-annotation-anchor');
      const path = annotated.getAttribute(AST_PATH_ATTR);
      const pin = state.pins.find((p) =>
        (p.nodeId ? p.nodeId === nodeId : p.key ? p.key === key : p.path === path));
      if (pin) {
        const r = annotated.getBoundingClientRect();
        post({ type: STORY_ANNOTATION_PIN_MESSAGE, id: pin.id, rect: { x: r.x, y: r.y, width: r.width, height: r.height } });
        return;
      }
    }
  };

  /** Resolve a pointer target through annotated ancestors without stamping every view-mode pin. */
  const pinAt = (target: EventTarget | null) => {
    const start = target as HTMLElement | null;
    if (!start || typeof start.closest !== 'function' || start.closest('.mx-rail, .mx-present')) return null;
    let el = start.closest<HTMLElement>(`[${AST_PATH_ATTR}]`);
    while (el) {
      const key = el.getAttribute('data-annotation-anchor');
      const nodeId = el.id || null;
      const path = el.getAttribute(AST_PATH_ATTR);
      const pin = state?.pins.find((candidate) =>
        (candidate.nodeId ? candidate.nodeId === nodeId : candidate.key ? candidate.key === key : candidate.path === path));
      if (pin) return pin;
      el = el.parentElement?.closest<HTMLElement>(`[${AST_PATH_ATTR}]`) ?? null;
    }
    return null;
  };

  const reportHover = (target: EventTarget | null) => {
    if (!state || state.mode === 'off') return;
    const id = pinAt(target)?.id ?? null;
    if (id === reportedHoverId) return;
    reportedHoverId = id;
    post({ type: STORY_ANNOTATION_HOVER_MESSAGE, id });
  };

  // ── the pick ──────────────────────────────────────────────────────────────
  /** The same selectable node a pick would take: stamped, known to the source, never deck chrome. */
  const selectableAt = (target: EventTarget | null): Element | null => {
    const element = target as Element | null;
    if (!element?.closest || element.closest('.mx-rail, .mx-present')) return null;
    const stamped = element.closest(`[${AST_PATH_ATTR}]`);
    return stamped && describeSelection(stamped, nodes) ? stamped : null;
  };

  const setPickHovered = (next: Element | null) => {
    if (pickHovered === next) return;
    pickHovered?.removeAttribute(ANNOTATE_PICK_HOVER_ATTR);
    pickHovered = next;
    pickHovered?.setAttribute(ANNOTATE_PICK_HOVER_ATTR, '');
  };

  /** Set the pick mode: the crosshair stamp on the root carries it, and the hover and any drag leave with it. Idempotent. */
  const setPick = (mode: 'block' | 'area' | null) => {
    pick = mode;
    if (mode) (root ?? doc.documentElement).setAttribute(ANNOTATE_PICKING_ATTR, mode);
    else (root ?? doc.documentElement).removeAttribute(ANNOTATE_PICKING_ATTR);
    if (mode !== 'block') setPickHovered(null);
    if (mode !== 'area' && drawing) { drawing = null; removeBand(); }
  };

  /**
   * WHILE EDITING, cancelling the press is what keeps the pick from becoming
   * an edit: focus moves on mousedown, not on click, so an editable host under
   * the pointer would otherwise take the caret first. In view mode the press
   * is left alone — a pick is on whenever the rail is, and the reader must
   * still be able to DRAG across words for the selection bubble.
   */
  const onPickMouseDown = (event: MouseEvent) => {
    if (root && !root.contains(event.target as Node)) return;
    if (pick !== 'block' || !isEditing() || !selectableAt(event.target)) return;
    event.preventDefault();
  };

  /** A drag ended here with words selected: the words are the subject (the bubble's), not the block. */
  const draggedWords = (): boolean => {
    const selection = win.getSelection();
    return !!selection && !selection.isCollapsed && selection.toString().length > 0;
  };

  /** The pick itself. On `win` in the capture phase: it runs BEFORE the edit session's document listener. */
  const onPickClick = (event: MouseEvent) => {
    if (root && !root.contains(event.target as Node)) return;
    if (!pick) return;
    const el = selectableAt(event.target);
    if (!el) return;
    // In area mode the release already decided (a drawn area, or a block for
    // a bare click); the click that follows is swallowed so it can neither
    // focus a thread nor follow a link.
    if (pick === 'area') { event.preventDefault(); event.stopPropagation(); return; }
    if (draggedWords()) return;
    event.preventDefault();
    event.stopPropagation();
    setPickHovered(null);
    reportSelection(el);
  };

  /** Escape stands the pick down: a null selection, and NOT `reportSelection(null)` — a composer already open keeps its node. */
  const onPickKeyDown = (event: KeyboardEvent) => {
    if (root && !root.contains(event.target as Node)) return;
    if (!pick || event.key !== 'Escape') return;
    event.preventDefault();
    event.stopPropagation();
    if (drawing) { drawing = null; removeBand(); }
    post({ type: STORY_SELECTION_MESSAGE, selection: null });
  };

  // ── the drawn area ────────────────────────────────────────────────────────
  const bandRect = (from: { startX: number; startY: number }, to: { clientX: number; clientY: number }): AnnotationRect => ({
    x: Math.min(from.startX, to.clientX),
    y: Math.min(from.startY, to.clientY),
    width: Math.abs(to.clientX - from.startX),
    height: Math.abs(to.clientY - from.startY),
  });

  /**
   * Every selectable node with its rect and BODY path — what a band is
   * measured against. An authored `<svg>` counts as a block; the paths and
   * circles INSIDE it are drawing, not blocks, and a band that grazes one
   * must anchor to the picture, not to a stroke of it.
   */
  const areaCandidates = (): Array<{ path: string; rect: AnnotationRect }> =>
    [...scope.querySelectorAll<HTMLElement>(`[${AST_PATH_ATTR}]`)]
      .filter((el) => !el.closest('.mx-rail, .mx-present') && !el.parentElement?.closest('svg') && describeSelection(el, nodes))
      .map((el) => ({ path: el.getAttribute(AST_PATH_ATTR)!, rect: el.getBoundingClientRect() }));

  const onAreaPointerDown = (event: PointerEvent) => {
    if (root && !root.contains(event.target as Node)) return;
    if (pick !== 'area' || event.button !== 0) return;
    const target = event.target as Element | null;
    if (target?.closest?.('.mx-rail, .mx-present')) return;
    // Nothing selects and no host focuses under a band.
    event.preventDefault();
    drawing = { startX: event.clientX, startY: event.clientY, target: event.target };
  };

  const onAreaPointerMove = (event: PointerEvent) => {
    if (!drawing) return;
    const rect = bandRect(drawing, event);
    const real = rect.width >= ANNOTATION_AREA_MIN_PX || rect.height >= ANNOTATION_AREA_MIN_PX;
    if (!real && !scope.querySelector(`[${ANNOTATE_BAND_ATTR}]`)) return;
    const band = bandElement();
    band.style.outlineStyle = 'dashed';
    placeOverlay(band, rect);
  };

  /**
   * The release decides. No drag: the block under the press, exactly as a
   * block pick. A drag: the lowest common ancestor of what it touched, with
   * the band as fractions of that anchor. Nothing touched: nothing, and the
   * mode stays on.
   */
  const onAreaPointerUp = (event: PointerEvent) => {
    if (!drawing) return;
    const from = drawing;
    drawing = null;
    removeBand();
    const rect = bandRect(from, event);
    if (rect.width < ANNOTATION_AREA_MIN_PX && rect.height < ANNOTATION_AREA_MIN_PX) {
      const el = selectableAt(from.target);
      if (el) reportSelection(el);
      return;
    }
    const path = areaTarget(areaCandidates(), rect);
    const el = path ? elementFor(path) : null;
    if (!el || !path) return;
    const box = boxFromRects(el.getBoundingClientRect(), rect);
    if (!box) return;
    composingArea = { path, box };
    reportSelection(el, { range: { v: 1, kind: 'area', box } });
  };

  const onPointerOver = (event: PointerEvent) => {
    reportHover(event.target);
    if (pick === 'block') setPickHovered(selectableAt(event.target));
  };
  const onPointerOut = (event: PointerEvent) => {
    reportHover(event.relatedTarget);
    if (pick === 'block') setPickHovered(selectableAt(event.relatedTarget));
  };

  doc.addEventListener('click', onClick, true);
  doc.addEventListener('pointerover', onPointerOver, true);
  doc.addEventListener('pointerout', onPointerOut, true);
  win.addEventListener('mousedown', onPickMouseDown, true);
  win.addEventListener('click', onPickClick, true);
  win.addEventListener('keydown', onPickKeyDown, true);
  win.addEventListener('pointerdown', onAreaPointerDown, true);
  win.addEventListener('pointermove', onAreaPointerMove, true);
  win.addEventListener('pointerup', onAreaPointerUp, true);
  win.addEventListener('scroll', scheduleSync, { passive: true });
  win.addEventListener('resize', scheduleSync, { passive: true });
  /*
   * Typing REFLOWS the document without re-rendering it — the engine commits
   * text on blur, so nothing upstream fires while a paragraph grows a line and
   * pushes every anchor below it down. Without this the cards sit where the
   * words used to be, which is only visible once comments are allowed to stay
   * on while editing. Coalesced into the same frame as scroll and resize.
   */
  doc.addEventListener('input', scheduleSync, true);

  return {
    update(message) {
      state = message;
      setPick(message.mode === 'off' ? null : message.pick ?? null);
      if (message.mode === 'off') selectedPath = null;
      else if (message.selectedPath !== undefined) selectedPath = message.selectedPath;
      if (message.mode === 'off') ensureCss(false);
      applyState();
      if (message.mode === 'off') post({ type: STORY_ANNOTATION_LAYOUT_MESSAGE, positions: [] });
      else reportLayout();
      reportSelectedGeometry();
      // The Docs move: opening a thread brings its node to the reader. Once
      // per open, VERTICALLY only — scrollIntoView also scrolls the x-axis,
      // and centering a node near the document's right edge shoved the whole
      // page sideways the moment the sidebar narrowed the viewport.
      if (message.mode !== 'off' && message.openId && message.openId !== scrolledTo) {
        const pin = message.pins.find((p) => p.id === message.openId);
        const el = pin ? elementForPin(pin) : null;
        if (el) {
          const words = pin ? painted.get(pin.id) : undefined;
          const r = (words ? unionRect(words) : null) ?? el.getBoundingClientRect();
          win.scrollTo({ top: r.top + win.scrollY - (win.innerHeight - r.height) / 2, behavior: 'smooth' });
        }
      }
      scrolledTo = message.openId;
    },
    setNodes(next) {
      nodes = next;
      // A re-render may have replaced every host — re-stamp.
      scheduleSync();
    },
    select(path) {
      if (!state || state.mode === 'off') return;
      reportSelection(path ? elementFor(path) : null);
    },
    dispose() {
      state = null;
      selectedPath = null;
      reportedHoverId = null;
      setPick(null);
      composingArea = null;
      removeBand();
      clearHighlights();
      ensureCss(false);
      applyState();
      doc.removeEventListener('click', onClick, true);
      doc.removeEventListener('pointerover', onPointerOver, true);
      doc.removeEventListener('pointerout', onPointerOut, true);
      win.removeEventListener('mousedown', onPickMouseDown, true);
      win.removeEventListener('click', onPickClick, true);
      win.removeEventListener('keydown', onPickKeyDown, true);
      win.removeEventListener('pointerdown', onAreaPointerDown, true);
      win.removeEventListener('pointermove', onAreaPointerMove, true);
      win.removeEventListener('pointerup', onAreaPointerUp, true);
      doc.removeEventListener('input', scheduleSync, true);
      win.removeEventListener('scroll', scheduleSync);
      win.removeEventListener('resize', scheduleSync);
    },
  };
}
