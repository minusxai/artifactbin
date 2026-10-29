/**
 * THE IN-PLACE EDITING AND ANNOTATION PROTOCOL: every message the page and the document's frame exchange while a
 * document is edited or commented on in place. A leaf both sides import (the page's editor in solid/, the frame's
 * edit chunks, the frame bridge and the CLI preview), so it carries types and the two guards only.
 *
 * The message ids are not exported: a sender writes the wire string (`{ type: 'mx:select', path }`) and a receiver
 * narrows on it, and the two unions below are what check both. The type sets the guards read are built from the
 * unions, so a new message cannot be one without the other. The reader and controller wire (`mx:document`,
 * `mx:reader-mode`, the frame bridge, …) stays in lib/story-runtime/contract.
 */
import type { CommentViewState, HtmlNodeAnchor } from '@artifactbin/contracts';
import type { AnnotationRange } from '@/lib/document';
import type { EditorBookmark, EditorSelectionChange, BlockEdit } from '@/lib/editor-engine';

/* ────────────────────────────────────────────────────────────────────────────
 * IN-PLACE EDITING — edit mode is a mode the runtime enters, in the frame the
 * reader is already looking at (there is no second document).
 *
 * The PARENT keeps truth, session, network and composition; the FRAME makes
 * text hosts editable, reports what the user selected, stages what they typed,
 * and renders whatever `mx:document` says. Every frame → parent message below
 * carries the session `nonce`, minted by the runtime in ES-module scope BEFORE
 * the author's script is injected (RuntimeChannel, below) — the parent
 * drops anything without it, which is what makes a write relay safe beside a
 * script that shares the frame's realm. Parent → frame messages must be
 * `isTrusted`: a synthetic MessageEvent can spoof `source`, never that.
 * ──────────────────────────────────────────────────────────────────────────── */

/** Parent → frame: enter or leave edit mode. The frame lazy-loads its edit chunk on the first `on`. */
interface StoryEditModeMessage { type: 'mx:edit-mode'; on: boolean }

/** Frame → parent: edit mode is live (hosts are editable and listening). */
interface StoryEditReadyMessage { type: 'mx:edit-ready'; nonce: string }

/**
 * Frame → parent: the user finished editing a text host (blur), or is about to
 * have a format applied mid-word. `innerHtml` is the host's contenteditable
 * output — rich inline HTML, possibly hostile; the parent composes it through
 * the same sanitizing write-back the canvas used (lib/data/story/jsx-edit).
 */
export type MarkdownBlockKind = 'paragraph' | 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6' | 'quote' | 'bullet' | 'number' | 'code' | 'check' | 'hr' | 'table';
export type MarkdownTableAction = 'row-before' | 'row-after' | 'column-before' | 'column-after' | 'delete-row' | 'delete-column' | 'delete-table';
interface StoryMarkdownTableMessage { type: 'mx:markdown-table'; action: MarkdownTableAction }
interface StoryMarkdownBlockMessage { type: 'mx:markdown-block'; block: MarkdownBlockKind }
interface StoryInlineMessage {type:'mx:inline';tag:'strong'|'em'|'u'}
interface StoryPasteMessage {type:'mx:paste';value:string;kind:'markdown'|'text'}

interface StoryBlockEditMessage {type:'mx:block-edit';nonce:string;command:BlockEdit}
interface StoryHistoryMessage {type:'mx:history';nonce:string;direction:'undo'|'redo'}

interface StoryEditErrorMessage {type:'mx:edit-error';nonce:string;message:string}
interface StoryFlowEditMessage { selection?:EditorSelectionChange; type: 'mx:flow-edit'; nonce: string; path: string; expected: string; replacement: string; group?:string }

interface StoryTextEditMessage { type: 'mx:text-edit'; nonce: string; path: string; innerHtml: string }

/**
 * Frame → parent: the person pressed "Edit script" on a script component's mount badge (lib/frame-edit/dom-mounter).
 * `component` is the mount's name; the parent opens the Helmet script in the source editor at its export.
 */
interface StoryOpenScriptMessage { type: 'mx:open-script'; nonce: string; component: string }

/** Frame → parent: there is uncommitted typing (from the first `input` to the commit). Gates remote adoption. */
interface StoryTypingMessage { type: 'mx:typing'; nonce: string; active: boolean }

/** One ancestor in the toolbar's breadcrumb: enough to label it and re-select it. */
export interface StoryEditCrumb { path: string; tag: string; hint: string }

/** A rect in the FRAME's viewport coordinates; the parent adds the iframe's own box. */
export interface StoryEditRect { x: number; y: number; width: number; height: number }

/**
 * What the user has selected, described rather than referenced: the parent
 * has no element, only this. `className`/`style` are the element's current
 * attribute values, which is what the typography toolbar reasons over.
 */
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

/** Frame → parent: the selection changed, or moved (re-posted on in-frame scroll, throttled to a frame). */
interface StorySelectionMessage { type: 'mx:selection'; nonce: string; selection: StoryEditSelection | null }

/**
 * Frame → parent: the owner selected readable text in view mode and chose the
 * small contextual Edit/Annotate action. The containing source node travels
 * with the request so the destination mode opens on what they were reading.
 */
interface StorySelectionActionMessage {
  type: 'mx:selection-action';
  nonce: string;
  action: 'edit' | 'annotate' | 'select';
  selection: StoryEditSelection;
}

/** Parent → frame: which contextual actions this authorized viewer may use. */
export interface StorySelectionActionsMessage {
  type: 'mx:selection-actions';
  edit: boolean;
  annotate: boolean;
}

/**
 * Frame → parent: an image was pasted or dropped INTO the document while
 * editing. The listeners must live in the frame, because that is the realm the
 * event fires in — the document is a separate window and the parent's own
 * `paste`/`drop` never see it. The File itself travels by structured clone, and
 * the parent hands it to the SAME insert the file picker uses, so all three
 * doors share one ingest, one size cap and one type list.
 */
interface StoryImageDropMessage {
  type: 'mx:image-drop';
  nonce: string;
  file: File;
  /**
   * The BODY path of the plain `<img>` this file REPLACES — present when it was
   * dropped onto an image, or pasted while one was selected. Absent, the file
   * is inserted as before. Either way the parent composes the source; the frame
   * only says which image the person meant.
   */
  target?: string;
  /**
   * Where a DROPPED file lands when it is not replacing: the gap between the
   * blocks nearest the pointer, as a block and a side of it. Null when the drop
   * was outside every block (the page then appends). Absent on a paste, which
   * the page places at its own selection.
   */
  at?: { path: string; side: 'before' | 'after' | 'inside' } | null;
}

/**
 * Frame → parent: an image was double-clicked in edit mode — open the replace
 * file picker for it. Handled synchronously, while the click's user activation
 * still lets the page open a picker; the chosen file takes the same replace
 * path as the toolbar's "Upload file".
 */
interface StoryImageReplaceMessage { type: 'mx:image-replace'; nonce: string; path: string }

/** Frame → parent: Delete/Backspace pressed while NO text host had focus — the parent decides what it removes. */
interface StoryEditKeyMessage { type: 'mx:edit-key'; nonce: string; key: 'Delete' | 'Backspace' | 'Escape' }

/**
 * Parent → frame: apply a format to an element NOW, locally, without a
 * re-render — the toolbar's instant feedback. Each present field is the
 * attribute's full new value; '' removes it. The parent composes the same
 * edit into the source; the frame's DOM already shows it.
 */
interface StoryApplyFormatMessage { type: 'mx:apply-format'; path: string; className?: string; style?: string }

/**
 * Parent → frame: wrap the current text selection inside the host at `path`
 * in a link (or unwrap with href null). Only the frame holds the live
 * Selection; it answers with an `mx:text-edit` carrying the new innerHTML.
 */
interface StoryApplyLinkMessage { type: 'mx:apply-link'; path: string; href: string | null }

/** Parent → frame: put the caret back in the text it left for page chrome (a link box closed without a change). */
interface StoryFocusTextMessage { type: 'mx:focus-text' }

/**
 * Frame → parent: a `<GridItem>` was dragged or resized to a new rect.
 *
 * The grid is laid out in the document — only it knows the pixel width the
 * columns divide — so the drag happens there and the resulting rects come back
 * as source edits. Several arrive together: vertical compaction moves siblings,
 * so one drag repositions more than one tile.
 */
export interface StoryLayoutRect { path: string; x: number; y: number; w: number; h: number }
interface StoryLayoutEditMessage {
  type: 'mx:layout-edit';
  nonce: string;
  rects: StoryLayoutRect[];
}

/**
 * Frame → parent: a slide was renamed from the deck's own rail.
 *
 * The rail is the DOCUMENT's chrome (lib/reader-chrome/slides), so the
 * affordance has to live there; the write-back is the parent's as always.
 */
interface StorySlideTitleMessage {
  type: 'mx:slide-title';
  nonce: string;
  path: string;
  title: string;
}

/**
 * Parent → frame: commit anything the reader has typed but not yet blurred,
 * NOW, and say when it is done.
 *
 * The document commits a text edit on BLUR, so between the last keystroke and
 * moving focus the work exists only in its DOM. Every way out of edit mode —
 * the done button, the back button, a tab being hidden — has to collect that
 * before it drains, or the last thing typed is exactly the thing that is lost.
 */
interface StoryCommitMessage { type: 'mx:commit'; restore?:EditorBookmark }
interface StoryCommittedMessage { type: 'mx:committed'; nonce: string }

/** Parent → frame: select an element by path (a breadcrumb click, a panel opening), or clear with null. */
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

/**
 * Parent → frame: SPOTLIGHT nodes by BODY path without selecting them — the
 * query notebook pointing at what a query powers. Selection would hand the
 * rail to the embed inspector and hide the notebook that asked; a spotlight
 * only outlines and scrolls the first one into view. Idempotent: the whole
 * set every time, `[]` clears. Unknown paths are ignored.
 */
interface StorySpotlightMessage { type: 'mx:spotlight'; paths: string[] }

/* ────────────────────────────────────────────────────────────────────────────
 * ANNOTATIONS — comments the owner pins to nodes; the frame only ever sees
 * ids + BODY paths (content, threads and the session stay on the page).
 * ──────────────────────────────────────────────────────────────────────────── */

/**
 * Parent → frame: the pin set, one idempotent message — re-posted whole
 * whenever the list changes, so the frame holds no annotation state it could
 * get out of step on. `pins` are the OPEN, non-orphaned roots by BODY path —
 * plus the ONE resolved root the reader has expanded in the rail, which is also
 * this message's `openId`: selecting a resolved comment is how somebody asks
 * what it was about, so its passage is painted and scrolled to like any other.
 * It travels in the SAME message as that `openId` (the frame records the scroll
 * as done on arrival and would never repeat it for a pin arriving later), and
 * leaves again when the card is collapsed, another thread is opened or the rail
 * closes. Recently resolved previews may retain `layoutOnly` pins for their
 * positions; those pins never paint or respond to document hover.
 *
 * `mode` is ON or OFF and nothing else. It used to carry a third value naming
 * which PAGE MODE was open ('pins' for view, 'annotate' for #annotate), which
 * was the wire admitting that commenting was a mode — and it made the frame
 * responsible for a decision it cannot see. Whenever the layer is on the frame
 * tints commented nodes and reports their geometry; what varies is whether it
 * may SWALLOW a click to focus a thread, and it answers that itself from
 * whether an edit session exists (a click in edit mode belongs to the caret).
 * 'off' is the hide-comments switch, and the only thing that stops either.
 */
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

/** Frame → parent: the owner clicked an annotated node to open its thread. */
interface StoryAnnotationPinMessage {
  type: 'mx:annotation-pin';
  nonce: string;
  id: string;
  rect: StoryEditRect;
}

/** Frame → parent: the pointer entered or left an annotated document node. */
interface StoryAnnotationHoverMessage {
  type: 'mx:annotation-hover';
  nonce: string;
  id: string | null;
}

/** Frame → parent: the current viewport geometry of every anchored open thread. */
interface StoryAnnotationLayoutMessage {
  viewStateError?: { id: string; message: string } | null;
  type: 'mx:annotation-layout';
  nonce: string;
  positions: Array<{ id: string; rect: StoryEditRect; status?: 'exact' | 'missing' | 'ambiguous' }>;
}

/* ────────────────────────────────────────────────────────────────────────────
 * KEYS A FRAMED DOCUMENT FORWARDS — the page's editor listens on its own window,
 * and a key pressed inside a framed document never reaches it. The frame half of
 * the bridge (lib/islands/frame-bridge) sends these instead, signed
 * like every other frame → parent message. Undo/redo travels as `mx:history`.
 * ──────────────────────────────────────────────────────────────────────────── */

/** Frame → parent: hand held typing to the document now (Enter pressed, or focus left a text host). */
interface StoryEditFlushMessage { type: 'mx:edit-flush'; nonce: string; reason: 'enter' | 'focusout' }

/** Frame → parent: the comment shortcut (⌘⌥M / Ctrl-Alt-M) pressed inside the document while editing. */
interface StoryCommentKeyMessage { type: 'mx:comment-key'; nonce: string }

/** Frame → parent: the link shortcut (⌘K / Ctrl-K) pressed in the document's text while editing. */
interface StoryLinkKeyMessage { type: 'mx:link-key'; nonce: string }

export type StoryEditFrameMessage =
  | StoryEditErrorMessage | StoryBlockEditMessage | StoryHistoryMessage | StoryFlowEditMessage | StoryEditReadyMessage | StoryTextEditMessage | StoryTypingMessage | StorySelectionMessage
  | StorySelectionActionMessage
  | StoryEditKeyMessage | StoryCommittedMessage | StoryLayoutEditMessage | StorySlideTitleMessage
  | StoryImageDropMessage | StoryImageReplaceMessage | StoryAnnotationPinMessage | StoryAnnotationHoverMessage | StoryAnnotationLayoutMessage
  | StoryEditFlushMessage | StoryCommentKeyMessage | StoryLinkKeyMessage | StoryOpenScriptMessage;
export type StoryEditParentMessage =
  | StoryMarkdownTableMessage | StoryMarkdownBlockMessage | StoryInlineMessage | StoryPasteMessage | StoryEditModeMessage | StoryApplyFormatMessage | StoryApplyLinkMessage | StoryFocusTextMessage | StorySelectMessage | StorySpotlightMessage | StoryCommitMessage
  | StoryAnnotationsMessage | StorySelectionActionsMessage;

/** Frame → parent, before the channel signs it: what the frame's edit code hands its `post`, which adds the nonce. */
export type StoryEditFramePost = StoryEditFrameMessage extends infer M ? (M extends unknown ? Omit<M, 'nonce'> : never) : never;

/**
 * The two type sets the guards read, listed as records over the unions' `type`s: the compiler refuses a missing
 * member and a stray one, so a set and its union cannot drift. `mx:edit-error` has no constant anywhere; it is a
 * member like any other.
 */
const EDIT_FRAME_TYPES: ReadonlySet<string> = new Set(Object.keys({
  'mx:edit-error': 0, 'mx:block-edit': 0, 'mx:history': 0, 'mx:flow-edit': 0, 'mx:edit-ready': 0, 'mx:text-edit': 0, 'mx:typing': 0,
  'mx:selection': 0, 'mx:selection-action': 0, 'mx:edit-key': 0, 'mx:committed': 0, 'mx:layout-edit': 0, 'mx:slide-title': 0,
  'mx:image-drop': 0, 'mx:image-replace': 0, 'mx:annotation-pin': 0, 'mx:annotation-hover': 0, 'mx:annotation-layout': 0,
  'mx:edit-flush': 0, 'mx:comment-key': 0, 'mx:link-key': 0, 'mx:open-script': 0,
} satisfies Record<StoryEditFrameMessage['type'], 0>));
const EDIT_PARENT_TYPES: ReadonlySet<string> = new Set(Object.keys({
  'mx:markdown-block': 0, 'mx:markdown-table': 0, 'mx:inline': 0, 'mx:paste': 0, 'mx:edit-mode': 0, 'mx:apply-format': 0,
  'mx:apply-link': 0, 'mx:focus-text': 0, 'mx:select': 0, 'mx:spotlight': 0, 'mx:commit': 0, 'mx:annotations': 0,
  'mx:selection-actions': 0,
} satisfies Record<StoryEditParentMessage['type'], 0>));

/** A frame → parent edit message carrying THIS session's nonce. Anything else — including a forgery — is not one. */
export function isEditFrameMessage(data: unknown, nonce: string): data is StoryEditFrameMessage {
  if (!data || typeof data !== 'object') return false;
  const d = data as { type?: unknown; nonce?: unknown };
  return typeof d.type === 'string' && EDIT_FRAME_TYPES.has(d.type) && d.nonce === nonce;
}

export function isEditParentMessage(data: unknown): data is StoryEditParentMessage {
  if (!data || typeof data !== 'object') return false;
  const d = data as { type?: unknown };
  return typeof d.type === 'string' && EDIT_PARENT_TYPES.has(d.type);
}

/**
 * THE CHANNEL THE AUTHOR'S SCRIPT CANNOT REACH: how the runtime talks to the page that hosts it.
 *
 * The author's own `<script>` runs in the same realm as the runtime, so every runtime → page message
 * carries the session's `nonce` (lib/islands/island-controller mints it with `runtimeId`), and
 * the page drops anything without it. The nonce is never put on `window`; reading a host's content goes
 * through `innerHtmlOf` so the edit session has one place to read it.
 */
export interface RuntimeChannel {
  /** This session's secret. Every frame → parent message carries it; it is never put on `window`. */
  readonly nonce: string;
  /** Post to the page that hosts the runtime. */
  post(message: StoryEditFrameMessage): void;
  /** Read an element's innerHTML. */
  innerHtmlOf(el: Element): string;
}
