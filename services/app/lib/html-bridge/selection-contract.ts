/** Native HTML annotation and selection messages, signed by the frame session. */
import type { CommentViewState, HtmlNodeAnchor } from '@artifactbin/contracts';
import type { AnnotationRange } from '@/lib/document';
type MarkdownBlockKind = 'paragraph' | 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6' | 'quote' | 'bullet' | 'number' | 'code' | 'check' | 'hr' | 'table';
interface StoryEditCrumb { path: string; tag: string; hint: string }
export interface StoryEditRect { x: number; y: number; width: number; height: number }
export interface StoryEditSelection {
  /** Native HTML source identity. Never persisted as a compiler path. */
  anchor?: HtmlNodeAnchor;
  viewState?: CommentViewState;
  viewStateError?: string;
  /** Unclipped drag in this document viewport, separate from the node-relative anchor. */
  captureRect?: StoryEditRect;
  /** The prose engine owns formatting transactions and their source write-back. */
  editor?: 'prose' | 'markdown';
  /** Lexical block at the caret, or mixed when the range spans different block styles. */
  markdownBlock?: MarkdownBlockKind | 'mixed';
  customHeight?:boolean;
  inline?:Record<'strong'|'em'|'u',boolean|'mixed'>;
  /** Prose only: where the caret or selected words are, so link chrome can sit beside them. */
  textRect?: StoryEditRect;
  /** Prose only: the href of the link the caret is in or the selection covers. */
  link?: string;
  /** 'text': a focused editable host · 'element': a click-selected container · 'embed': a component. */
  kind: 'text' | 'element' | 'embed';
  /**
   * Why the text this node shows takes no caret, for the author (lib/story-ui/host-classify TEXT_LOCK_REASONS):
   * it comes from data, is computed, or is drawn by the component. Absent when the node is text to type in, or
   * shows no text of its own.
   */
  textLock?: string;
  /**
   * 'typing': a caret in text (the toolbar offers text tools). 'block': the node
   * itself is selected (grip, Esc, breadcrumb, a click on a chart) — the caret
   * is gone, so the toolbar offers block tools only. Absent from older frames:
   * treated as before.
   */
  mode?: 'typing' | 'block';
  path: string;
  /** Authored persistent DOM id of the source node. Absent until autosave has persisted one. */
  nodeId?: string;
  tag: string;
  rect: StoryEditRect;
  className: string;
  style: string;
  /** Selectable ancestors, OUTERMOST first. */
  ancestors: StoryEditCrumb[];
  /**
   * The words actually selected, canonical — present only when there IS a text
   * selection, which is why both of these are optional: the same struct rides
   * every caret move in an edit session, where nothing is selected at all.
   * A comment stores them beside its anchor (lib/publish/annotations/annotation-range).
   */
  quote?: string;
  /** Where those words are, addressed RELATIVE to `path` — never an absolute body path. */
  range?: AnnotationRange;
}
interface StorySelectionMessage { type: 'mx:selection'; nonce: string; selection: StoryEditSelection | null }
interface StorySelectionActionMessage {
  type: 'mx:selection-action';
  nonce: string;
  action: 'edit' | 'annotate' | 'select';
  selection: StoryEditSelection;
}
export interface StorySelectionActionsMessage {
  type: 'mx:selection-actions';
  edit: boolean;
  annotate: boolean;
}
interface StorySelectMessage {
  type: 'mx:select';
  path: string | null;
  /**
   * Something the page just inserted: the node may not be drawn yet (the new
   * document is still rendering), so wait briefly for it, then scroll it into view.
   */
  reveal?: boolean;
  /** Start typing in a just-inserted rich-text region once its editor mounts. */
  focusText?: boolean;
  /** With `reveal`: the id of the node meant — until the re-render lands, an OLD node sits at that path. */
  nodeId?: string;
}
export interface StoryAnnotationsMessage {
  canComment?: boolean;
  /** Explicit reopen, including a restore button on the already-open thread. */
  viewStateRequest?: number;
  type: 'mx:annotations';
  mode: 'off' | 'on';
  /**
   * The anchored nodes: `key` is the node's opaque annotation-anchor key (the
   * durable anchor — plain tags carry it into the DOM), `path` the body path
   * fallback (components keep the attribute in source only).
   */
  pins: Array<{
    anchor?: HtmlNodeAnchor;
    id: string;
    viewState?: CommentViewState;
    /** Position a resolved preview without painting or interacting with its former highlight. */
    layoutOnly?: boolean;
    path: string;
    key: string | null;
    /** Persistent authored node id; absent on historical anchor-only threads. */
    nodeId?: string | null;
    /**
     * The exact words the comment is on, addressed relative to the anchored
     * node — the frame re-finds them by TEXT and paints them. Absent on a
     * comment made before selections were kept, or one made from a caret;
     * the whole-node tint is the fallback. Still ONE pin per thread.
     */
    range?: AnnotationRange | null;
  }>;
  /** The thread the page has open — its node renders highlighted. */
  openId: string | null;
  /** The thread under either pointer — transient emphasis, never document state. */
  hoverId: string | null;
  /** The node the owner is composing on; replayed so lazy annotation startup cannot lose it. */
  selectedPath?: string | null;
  selected?: StoryEditSelection | null;
  /**
   * The Select tool (`select`) combines block hover/click and area drag.
   * Legacy modes remain accepted for existing runtime callers:
   * `block` — the selectable node under the pointer carries an outline and a
   * click takes it; `area` — a dragged rectangle, whose anchor is the lowest
   * common ancestor of the blocks it touched and whose box rides the
   * selection as an area range (lib/publish/annotations/annotation-range). Either answers
   * with `mx:selection` — the same report the breadcrumb widening uses — or a
   * null selection on escape. Null/absent is off. One-shot: the page clears
   * it the moment a selection arrives.
   */
  pick?: 'block' | 'area' | 'select' | null;
}
interface StoryAnnotationPinMessage {
  type: 'mx:annotation-pin';
  nonce: string;
  id: string;
  rect: StoryEditRect;
}
interface StoryAnnotationHoverMessage {
  type: 'mx:annotation-hover';
  nonce: string;
  id: string | null;
}
interface StoryAnnotationLayoutMessage {
  viewStateError?: { id: string; message: string } | null;
  type: 'mx:annotation-layout';
  nonce: string;
  positions: Array<{ id: string; rect: StoryEditRect; status?: 'exact' | 'missing' | 'ambiguous' }>;
}
export function isEditFrameMessage(data: unknown, nonce: string): data is StoryEditFrameMessage {
  if (!data || typeof data !== 'object') return false;
  const d = data as { type?: unknown; nonce?: unknown };
  return typeof d.type === 'string' && EDIT_FRAME_TYPES.has(d.type) && d.nonce === nonce;
}

export type StoryEditFrameMessage = StorySelectionMessage | StorySelectionActionMessage | StoryAnnotationPinMessage | StoryAnnotationHoverMessage | StoryAnnotationLayoutMessage;
export type StoryEditParentMessage = StorySelectMessage | StoryAnnotationsMessage | StorySelectionActionsMessage;
const EDIT_FRAME_TYPES: ReadonlySet<string> = new Set(Object.keys({
 'mx:selection': 0, 'mx:selection-action': 0, 'mx:annotation-pin': 0, 'mx:annotation-hover': 0, 'mx:annotation-layout': 0,
} satisfies Record<StoryEditFrameMessage['type'], 0>));
