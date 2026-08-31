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
 * Loaded lazily on the first non-off `mx:annotations` (the edit-chunk
 * pattern): a reader never downloads it, and a shared reader's top-level
 * document has no parent channel so the message cannot even arrive.
 */
import type { JsxNode } from '@/lib/jsx';
import { AST_PATH_ATTR } from '@/lib/story-ui/ast-path';
import type { PristineChannel } from '../pristine';
import {
  STORY_ANNOTATION_HOVER_MESSAGE, STORY_ANNOTATION_LAYOUT_MESSAGE, STORY_ANNOTATION_PIN_MESSAGE, STORY_SELECTION_MESSAGE,
  type StoryAnnotationsMessage,
} from '../contract';
import { describeSelection } from './describe-selection';

/** Marks every node carrying an open annotation, in every mode the layer is on for. */
export const ANNOTATED_ATTR = 'data-mx-annotated';
/** Marks the node whose thread the page has open. Own attribute — the edit session clears its own. */
export const ANNOTATION_OPEN_ATTR = 'data-mx-annotation-open';
/** Marks the node under either the comment card or document pointer. */
export const ANNOTATION_HOVER_ATTR = 'data-mx-annotation-hover';
/** Marks the node the owner is currently COMPOSING on (annotate mode's selection). */
export const ANNOTATE_SELECTED_ATTR = 'data-mx-annotate-selected';

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
].join('\n');

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
  channel: PristineChannel;
  /**
   * Is the document editable right now? Read on every click, never cached: the
   * edit session comes and goes without the annotation layer hearing about it,
   * and a stale answer would either steal the caret or lose the thread click.
   */
  isEditing: () => boolean;
}

export function createFrameAnnotateSession({ win, channel, isEditing }: FrameAnnotateOptions): FrameAnnotateSession {
  const doc = win.document;
  let nodes: JsxNode[] = [];
  let state: StoryAnnotationsMessage | null = null;
  let selectedPath: string | null = null;
  /** Last pin hover reported upward, deduplicated across descendant transitions. */
  let reportedHoverId: string | null = null;
  /** The openId whose node was last scrolled to — scroll once per open, not per re-apply. */
  let scrolledTo: string | null = null;
  let rafPending = false;

  const post = (message: Record<string, unknown>) => channel.post({ ...message, nonce: channel.nonce });

  /**
   * Deck thumbnails re-render the slide's real nodes (and therefore duplicate
   * paths + annotation anchors). Geometry and selection always belong to the
   * main document copy, never its rail/presentation chrome.
   */
  const mainElementMatching = (selector: string): HTMLElement | null =>
    [...doc.querySelectorAll<HTMLElement>(selector)]
      .find((el) => !el.closest('.mx-rail, .mx-present')) ?? null;

  const elementFor = (path: string): HTMLElement | null =>
    mainElementMatching(`[${AST_PATH_ATTR}="${CSS.escape(path)}"]`);

  /**
   * A pin's element: by its opaque source anchor first — the durable identity, which a
   * plain tag carries straight into this DOM — then by path (components keep
   * the attribute in SOURCE only, so their rendered output is found
   * positionally).
   */
  const elementForPin = (pin: { path: string; key: string | null }): HTMLElement | null =>
    (pin.key
      ? mainElementMatching(`[data-annotation-anchor="${CSS.escape(pin.key)}"]`)
      : null) ?? elementFor(pin.path);

  const ensureCss = (on: boolean) => {
    const existing = doc.head.querySelector(`style[${ANNOTATE_CSS_ATTR}]`);
    if (!on) return void existing?.remove();
    if (existing) return;
    const style = doc.createElement('style');
    style.setAttribute(ANNOTATE_CSS_ATTR, '');
    style.textContent = ANNOTATE_CSS;
    doc.head.appendChild(style);
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
      const rect = el.getBoundingClientRect();
      return [{ id: pin.id, rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height } }];
    });
    post({ type: STORY_ANNOTATION_LAYOUT_MESSAGE, positions });
  };

  /** Stamp idempotent state: all annotate-mode tints, or only the transient view-mode hover. */
  const applyState = () => {
    for (const el of doc.querySelectorAll(`[${ANNOTATED_ATTR}], [${ANNOTATION_OPEN_ATTR}], [${ANNOTATION_HOVER_ATTR}], [${ANNOTATE_SELECTED_ATTR}]`)) {
      el.removeAttribute(ANNOTATED_ATTR);
      el.removeAttribute(ANNOTATION_OPEN_ATTR);
      el.removeAttribute(ANNOTATION_HOVER_ATTR);
      el.removeAttribute(ANNOTATE_SELECTED_ATTR);
    }
    if (!state || state.mode === 'off') return;
    for (const pin of state.pins) {
      const el = elementForPin(pin);
      if (!el) continue;
      el.setAttribute(ANNOTATED_ATTR, '');
      if (state.openId === pin.id) el.setAttribute(ANNOTATION_OPEN_ATTR, '');
    }
    if (selectedPath) elementFor(selectedPath)?.setAttribute(ANNOTATE_SELECTED_ATTR, '');
    const hovered = state.hoverId ? state.pins.find((pin) => pin.id === state!.hoverId) : null;
    if (hovered) elementForPin(hovered)?.setAttribute(ANNOTATION_HOVER_ATTR, '');
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
  const reportSelection = (el: Element | null) => {
    const selection = el ? describeSelection(el, nodes) : null;
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
    if (!state || state.mode === 'off' || isEditing()) return;
    const target = event.target as HTMLElement | null;
    if (!target) return;
    // Preview copies (deck rail, present mode) render the same paths; never select through them.
    if (target.closest('.mx-rail, .mx-present')) return;
    const el = target.closest(`[${AST_PATH_ATTR}]`);
    if (!el) return;
    const annotated = target.closest(`[${ANNOTATED_ATTR}]`);
    if (annotated) {
      event.preventDefault();
      const key = annotated.getAttribute('data-annotation-anchor');
      const path = annotated.getAttribute(AST_PATH_ATTR);
      const pin = state.pins.find((p) => (key && p.key === key) || p.path === path);
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
      const path = el.getAttribute(AST_PATH_ATTR);
      const pin = state?.pins.find((candidate) => (key && candidate.key === key) || candidate.path === path);
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

  const onPointerOver = (event: PointerEvent) => reportHover(event.target);
  const onPointerOut = (event: PointerEvent) => reportHover(event.relatedTarget);

  doc.addEventListener('click', onClick, true);
  doc.addEventListener('pointerover', onPointerOver, true);
  doc.addEventListener('pointerout', onPointerOut, true);
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
      if (message.mode === 'off') selectedPath = null;
      else if (message.selectedPath !== undefined) selectedPath = message.selectedPath;
      ensureCss(message.mode !== 'off');
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
          const r = el.getBoundingClientRect();
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
      ensureCss(false);
      applyState();
      doc.removeEventListener('click', onClick, true);
      doc.removeEventListener('pointerover', onPointerOver, true);
      doc.removeEventListener('pointerout', onPointerOut, true);
      doc.removeEventListener('input', scheduleSync, true);
      win.removeEventListener('scroll', scheduleSync);
      win.removeEventListener('resize', scheduleSync);
    },
  };
}
