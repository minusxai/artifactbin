'use client';

/**
 * THE PAGE HALF OF ANNOTATIONS — the Google-Docs shape.
 *
 * Commenting is a LAYER, not a mode. There is no `#annotate`: this mounts in
 * view mode and while editing alike, and its three surfaces are independent of
 * each other and of whatever mode the page is in —
 *
 *   · floating MARKS  — an author identity at each thread's anchor. It widens
 *                       into a preview on hover/focus and opens the rail on
 *                       click, so annotations stay ambient without becoming a
 *                       second reading column.
 *   · the COMPOSER    — a draft beside the words it is about, opened from a
 *                       view-mode selection bubble or the editor's toolbar.
 *   · the RAIL        — the full conversation, resolved history and replies.
 *                       A panel someone OPENS (`railOpen`), never a mode; the
 *                       page narrows the document's viewport by RIGHT_RAIL_W
 *                       while it is, so it never covers what it is about.
 *
 * The layer holds everything that must not enter the frame — thread content,
 * resolved history, the session — while the frame gets ids + BODY paths
 * (`mx:annotations`) and answers with pin clicks, hovers, geometry and node
 * selections, signed like every frame message.
 *
 * Mounted for anyone who may comment (the owner, or a named editor); a shared
 * reader's document is top-level with no parent window, so nothing here can
 * even reach them.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Check, EllipsisVertical, MessageSquare, Trash2, X } from 'lucide-react';
import type { AnnotationCommentWire, AnnotationWire } from '@/lib/annotations';
import { ChatGPTIcon, ClaudeAIIcon, ClaudeCodeIcon, CodexIcon } from '@/components/brand-icons';
import MobileSheet, { useIsPhoneViewport } from '@/components/MobileSheet';
import { Tooltip } from '@/components/Tooltip';
import { RIGHT_RAIL_W } from '@/lib/story/edit-bar';
import {
  isEditFrameMessage, STORY_ANNOTATIONS_MESSAGE, STORY_ANNOTATION_HOVER_MESSAGE, STORY_ANNOTATION_LAYOUT_MESSAGE, STORY_ANNOTATION_PIN_MESSAGE,
  STORY_SELECTION_MESSAGE, STORY_SELECT_MESSAGE,
  type StoryAnnotationsMessage, type StoryEditRect, type StoryEditSelection,
} from '@/lib/story-runtime/contract';

export interface AnnotationLayerProps {
  id: string;
  frameRef: { current: HTMLIFrameElement | null };
  sessionNonce: string | null;
  /** The thread rail is open — a panel, not a mode, and true in either mode. */
  railOpen: boolean;
  /** The head the page currently believes in — creates anchor against it. */
  currentEditId: string;
  /** The latest full open list from the live stream; null until the first frame. Replaces the fetch wholesale. */
  liveAnnotations: AnnotationWire[] | null;
  /** Open threads should mark the document edge (the ambient surface). */
  showViewComments: boolean;
  /** The rail wants to open (a pin click) or close (its own button). */
  onRailOpenChange: (open: boolean) => void;
  /** A text selection — from the view-mode bubble or the editor — that seeds the composer. */
  initialSelection?: StoryEditSelection | null;
  /** Where the document's viewport starts: the top bar, plus the edit bar when one is up. */
  topOffset: number;
  /**
   * Run to completion BEFORE the anchor is stamped. The stamp is a real CAS
   * edit and the editor answers a 409 by taking the server's document, so a
   * comment on the node someone is typing in would discard their typing unless
   * the editor's buffer is drained first. The same rule an image paste lives by.
   */
  beforeCreate?: () => Promise<void>;
}

const cardClass = 'rounded-[6px] border border-edge bg-raised text-sm';
const threadClass = 'rounded-[6px] border border-edge bg-comment text-sm';
const buttonClass = 'cursor-pointer rounded-[4px] border border-edge bg-raised px-2 py-1 text-muted hover:text-accent';
const VIEW_COMMENT_COLLAPSED_W = 36;
const VIEW_COMMENT_COUNTED_W = 44;
const VIEW_COMMENT_MANY_W = 48;
const VIEW_COMMENT_COLLAPSED_H = 36;
const VIEW_COMMENT_EXPANDED_H = 108;
const VIEW_COMMENT_GAP = 6;
const VIEW_COMMENT_INSET = 12;
const COMPOSER_W = 384;
const COMPOSER_ESTIMATED_H = 236;
const COMPOSER_GAP = 12;

/**
 * Put the draft beside its selected document node, using the frame-relative
 * rect the sandbox reports. Near the right edge it slides back over the node
 * instead of escaping into the thread rail; vertically it begins around the
 * lower half of the selection and remains reachable inside the viewport.
 */
function positionedComposer(
  selection: StoryEditSelection,
  frameRect: Pick<DOMRect, 'left' | 'top' | 'width'>,
  viewportWidth: number,
  viewportHeight: number,
) {
  const viewportInset = VIEW_COMMENT_INSET;
  const narrowDocument = frameRect.width < 280;
  const minLeft = narrowDocument ? viewportInset : frameRect.left + viewportInset;
  const maxRight = narrowDocument
    ? viewportWidth - viewportInset
    : Math.min(viewportWidth - viewportInset, frameRect.left + frameRect.width - viewportInset);
  const width = Math.max(0, Math.min(COMPOSER_W, maxRight - minLeft));
  const anchorRight = frameRect.left + selection.rect.x + selection.rect.width;
  const left = Math.max(minLeft, Math.min(anchorRight + COMPOSER_GAP, maxRight - width));

  const minTop = frameRect.top + viewportInset;
  const preferredTop = frameRect.top + selection.rect.y
    + Math.min(selection.rect.height + COMPOSER_GAP, 56);
  const maxTop = Math.max(minTop, viewportHeight - COMPOSER_ESTIMATED_H - viewportInset);
  return { left, top: Math.max(minTop, Math.min(preferredTop, maxTop)), width };
}

async function annotationFailure(res: Response): Promise<string> {
  const fallback = `Could not save comment (${res.status})`;
  try {
    const body = (await res.json()) as { error?: unknown; detail?: unknown; details?: unknown };
    const named = typeof body.error === 'string' ? body.error : fallback;
    const detail = typeof body.detail === 'string'
      ? body.detail
      : Array.isArray(body.details) && typeof body.details[0]?.message === 'string'
        ? body.details[0].message
        : null;
    return detail ? `${named}: ${detail}` : named;
  } catch {
    return fallback;
  }
}

/** "27 Aug" — enough to place a comment in time without a second line. */
const shortDate = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
};

const authorLabel = (author: AnnotationCommentWire['author']) =>
  author.label?.trim() || (author.kind === 'human' ? 'You' : 'Agent');

function AgentMark({ label, compact = false, decorative = false, borderless = false }: {
  label: string;
  compact?: boolean;
  decorative?: boolean;
  borderless?: boolean;
}) {
  const normalized = label.toLowerCase();
  const icon = normalized === 'codex'
    ? <CodexIcon size={compact ? 13 : 17} />
    : normalized === 'chatgpt'
      ? <ChatGPTIcon size={compact ? 12 : 16} />
      : normalized === 'claude code'
        ? <ClaudeCodeIcon size={compact ? 12 : 16} />
        : normalized === 'claude'
          ? <ClaudeAIIcon size={compact ? 12 : 16} />
          : <span aria-hidden="true" className={`${compact ? 'text-[10px]' : 'text-[12px]'} leading-none text-accent`}>✦</span>;
  return (
    <span
      aria-label={decorative ? undefined : `${label} agent`}
      aria-hidden={decorative || undefined}
      className={`inline-flex shrink-0 items-center justify-center rounded-full bg-surface text-fg ${borderless ? '' : 'border border-edge'} ${compact ? 'h-[18px] w-[18px]' : 'h-[22px] w-[22px]'}`}
    >
      {icon}
    </span>
  );
}

/** Google-Docs-shaped attribution: a profile avatar for people, a product mark for agents. */
function AuthorIdentity({ author }: { author: AnnotationCommentWire['author'] }) {
  const label = authorLabel(author);
  return (
    <span className="flex min-w-0 items-center gap-2">
      {author.kind === 'human' ? (
        <span
          aria-label={`${label} avatar`}
          className="inline-flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full border border-accent/25 bg-accent-soft text-[10px] font-semibold uppercase text-accent"
        >
          {label.charAt(0).toUpperCase()}
        </span>
      ) : (
        <AgentMark label={label} />
      )}
      {author.kind === 'human' && author.label ? (
        <a
          href={`/@${encodeURIComponent(author.label)}`}
          aria-label={`View @${author.label} profile`}
          className="pointer-events-auto truncate text-[11px] font-semibold text-fg underline-offset-2 hover:text-accent hover:underline"
        >
          {label}
        </a>
      ) : (
        <span className={`truncate text-[11px] font-semibold ${author.kind === 'agent' ? 'text-accent' : 'text-fg'}`}>
          {label}
        </span>
      )}
      {author.kind === 'agent' && author.transport !== 'unknown' && (
        <span
          aria-label={`Transport ${author.transport.toUpperCase()}`}
          className="shrink-0 font-mono text-[9px] uppercase tracking-[0.08em] text-faint"
        >
          · {author.transport}
        </span>
      )}
    </span>
  );
}

const authorKey = (author: AnnotationCommentWire['author']) =>
  `${author.kind}:${authorLabel(author).toLowerCase()}`;

/** Distinct people/agents who replied, oldest first. The root author is already named above. */
function replyParticipants(thread: AnnotationCommentWire[]): AnnotationCommentWire['author'][] {
  const seen = new Set<string>();
  return thread.slice(1).flatMap(({ author }) => {
    const key = authorKey(author);
    if (seen.has(key)) return [];
    seen.add(key);
    return [author];
  });
}

function ParticipantMark({ author }: { author: AnnotationCommentWire['author'] }) {
  const label = authorLabel(author);
  return author.kind === 'agent' ? (
    <AgentMark label={label} compact decorative />
  ) : (
    <span
      aria-hidden="true"
      className="inline-flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full border border-accent/25 bg-accent-soft text-[8px] font-semibold uppercase text-accent"
    >
      {label.charAt(0).toUpperCase()}
    </span>
  );
}

/** A thread's continuation cue: reply identities plus a count relative to the root comment. */
function ThreadContinuation({ thread }: { thread: AnnotationCommentWire[] }) {
  const replyCount = Math.max(0, thread.length - 1);
  const participants = replyParticipants(thread);
  return (
    <span className="flex min-w-0 items-center gap-1.5">
      {participants.length > 0 && (
        <span
          aria-label={`Reply participants: ${participants.map(authorLabel).join(', ')}`}
          className="flex shrink-0 -space-x-1 [&>*]:ring-1 [&>*]:ring-raised"
        >
          {participants.slice(0, 3).map((author) => <ParticipantMark key={authorKey(author)} author={author} />)}
        </span>
      )}
      <span className="truncate">{replyCount > 0 ? `+${replyCount} more` : '1 message'}</span>
    </span>
  );
}

function CompactAuthorMark({ author }: { author: AnnotationCommentWire['author'] }) {
  const label = authorLabel(author);
  return author.kind === 'agent' ? (
    <AgentMark label={label} compact decorative borderless />
  ) : (
    <span
      aria-hidden="true"
      className="inline-flex h-[22px] w-[22px] items-center justify-center rounded-full bg-accent text-[9px] font-semibold uppercase text-bg"
    >
      {label.charAt(0).toUpperCase()}
    </span>
  );
}

/** A quiet identity mark until intent is shown; then enough context to choose. */
function ThreadPreview({ a, top, hovered, onOpen, onHover }: {
  a: AnnotationWire;
  top: number;
  hovered: boolean;
  onOpen: () => void;
  onHover: (id: string | null) => void;
}) {
  const first = a.thread[0];
  const label = first ? authorLabel(first.author) : 'Unknown';
  const messages = a.thread.length;
  const compactWidth = messages > 9
    ? VIEW_COMMENT_MANY_W
    : messages > 1 ? VIEW_COMMENT_COUNTED_W : VIEW_COMMENT_COLLAPSED_W;
  return (
    <article
      data-annotation-id={a.id}
      data-hovered={hovered ? 'true' : undefined}
      onMouseEnter={() => onHover(a.id)}
      onMouseLeave={() => onHover(null)}
      className={`group pointer-events-auto overflow-hidden border text-left shadow-md transition-[top,width,height,border-color,background-color,box-shadow] duration-150 ${hovered ? 'z-10 border-edge-bright bg-comment-hover px-3 py-2.5 shadow-xl' : 'border-transparent bg-raised hover:bg-raised'}`}
      style={{
        position: 'fixed',
        top,
        right: VIEW_COMMENT_INSET,
        width: hovered ? 288 : compactWidth,
        maxWidth: `calc(100vw - ${VIEW_COMMENT_INSET * 2}px)`,
        height: hovered ? VIEW_COMMENT_EXPANDED_H : VIEW_COMMENT_COLLAPSED_H,
        borderRadius: hovered ? 5 : '50% 50% 50% 3px',
      }}
    >
      <button
        type="button"
        aria-label={`Open annotation conversation by ${label}, ${messages} message${messages === 1 ? '' : 's'}`}
        onClick={onOpen}
        onFocus={() => onHover(a.id)}
        onBlur={() => onHover(null)}
        className="absolute inset-0 z-0 cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-accent"
        style={{ borderRadius: hovered ? 5 : '50% 50% 50% 3px' }}
      />
      {first && !hovered && (
        <span className="pointer-events-none absolute inset-0 flex items-center justify-start pl-[7px]">
          <CompactAuthorMark author={first.author} />
          {messages > 1 && (
            <span data-thread-count aria-hidden="true" className="absolute right-1.5 top-1/2 -translate-y-1/2 font-mono text-[9px] font-bold leading-none text-fg">
              {messages > 9 ? '9+' : messages}
            </span>
          )}
        </span>
      )}
      {first && hovered && (
        <span className="pointer-events-none relative z-10 flex h-full animate-[rise_.12s_ease-out] flex-col">
          <span className="flex items-center justify-between gap-2">
            <AuthorIdentity author={first.author} />
            <span className="font-mono text-[10px] text-faint">{shortDate(first.created_at)}</span>
          </span>
          <span className="mt-1.5 line-clamp-2 block text-sm leading-snug text-fg/90">{first.body}</span>
          <span className="mt-auto flex items-center justify-between font-mono text-[10px] text-faint">
            <ThreadContinuation thread={a.thread} />
            <span className="transition-colors group-hover:text-accent">open →</span>
          </span>
        </span>
      )}
    </article>
  );
}

function positionedComments(
  annotations: AnnotationWire[],
  rects: Record<string, StoryEditRect>,
  frameRect: Pick<DOMRect, 'top' | 'height'>,
  viewportHeight: number,
): Array<{ annotation: AnnotationWire; top: number }> {
  const visible = annotations
    .flatMap((annotation) => {
      const rect = rects[annotation.id];
      if (!rect || rect.y + rect.height < 0 || rect.y > frameRect.height) return [];
      return [{ annotation, target: frameRect.top + rect.y }];
    })
    .sort((a, b) => a.target - b.target);
  if (visible.length === 0) return [];

  const minTop = frameRect.top + VIEW_COMMENT_INSET;
  let cursor = minTop;
  const placed = visible.map(({ annotation, target }) => {
    const top = Math.max(target, cursor);
    cursor = top + VIEW_COMMENT_COLLAPSED_H + VIEW_COMMENT_GAP;
    return { annotation, top };
  });

  // Keep a short cluster inside the viewport without breaking its spacing.
  // Leave room for the last marker to expand upward-free inside the viewport.
  const overflow = placed.at(-1)!.top + VIEW_COMMENT_EXPANDED_H + VIEW_COMMENT_INSET - viewportHeight;
  const availableShift = placed[0].top - minTop;
  const shift = Math.max(0, Math.min(overflow, availableShift));
  return shift > 0 ? placed.map((item) => ({ ...item, top: item.top - shift })) : placed;
}

function Thread({ a, open, resolved, hovered, busy, onOpen, onHover, onReply, onResolve, onReopen, onDelete }: {
  a: AnnotationWire;
  open: boolean;
  resolved?: boolean;
  hovered: boolean;
  busy: boolean;
  onOpen: () => void;
  onHover: (id: string | null) => void;
  onReply: (body: string) => void;
  onResolve: () => void;
  onReopen: () => void;
  onDelete: () => void;
}) {
  const [reply, setReply] = useState('');
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const visibleComments = open ? a.thread : a.thread.slice(0, 1);

  useEffect(() => {
    if (!menuOpen) return;
    const dismiss = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setMenuOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMenuOpen(false);
    };
    document.addEventListener('pointerdown', dismiss);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('pointerdown', dismiss);
      document.removeEventListener('keydown', escape);
    };
  }, [menuOpen]);

  return (
    <div
      aria-label={resolved ? 'Resolved annotation thread' : 'Annotation thread'}
      data-thread-id={a.id}
      data-hovered={hovered ? 'true' : undefined}
      onMouseEnter={() => onHover(a.id)}
      onMouseLeave={() => onHover(null)}
      onClick={(event) => {
        const target = event.target as Element;
        if (!open && !target.closest('a, button, textarea, input')) onOpen();
      }}
      className={`${threadClass} shrink-0 overflow-hidden transition-[border-color,background-color] duration-150 ${open ? '' : 'cursor-pointer'} ${open || hovered ? 'border-edge-bright bg-comment-hover' : ''} ${resolved ? 'opacity-70' : ''}`}
    >
      {a.orphaned && (
        <p className="border-b border-edge bg-surface/60 px-3 py-1.5 font-mono text-[10px] text-faint">
          annotated element was removed
        </p>
      )}
      <ul className="flex flex-col gap-3 px-3 py-3">
        {visibleComments.map((c, index) => (
          <li key={c.id + c.created_at}>
            <div className="mb-1.5 flex min-w-0 items-center gap-2">
              <AuthorIdentity author={c.author} />
              <span className="ml-auto shrink-0 font-mono text-[10px] text-faint">{shortDate(c.created_at)}</span>
              {index === 0 && resolved && (
                <Tooltip content="resolved">
                  <span className="inline-flex h-5 w-5 items-center justify-center text-accent">
                    <Check size={13} strokeWidth={2} />
                  </span>
                </Tooltip>
              )}
              {index === 0 && !resolved && (
                <Tooltip content="resolve thread">
                  <button
                    type="button"
                    aria-label="Resolve annotation"
                    disabled={busy}
                    onClick={onResolve}
                    className="inline-flex h-5 w-5 cursor-pointer items-center justify-center rounded-[3px] text-muted hover:bg-accent-soft hover:text-accent disabled:cursor-default disabled:opacity-40"
                  >
                    <Check size={13} strokeWidth={2} />
                  </button>
                </Tooltip>
              )}
              {index === 0 && resolved && open && (
                <button
                  type="button"
                  aria-label="Hide resolved conversation"
                  aria-expanded="true"
                  onClick={onOpen}
                  className="cursor-pointer rounded-[3px] px-1 font-mono text-[11px] text-faint hover:bg-raised hover:text-accent"
                >
                  ↑
                </button>
              )}
              {index === 0 && (!resolved || open) && (
                <div ref={menuRef} className="relative">
                  <Tooltip content="thread actions">
                    <button
                      type="button"
                      aria-label="Annotation actions"
                      aria-expanded={menuOpen}
                      onClick={() => setMenuOpen((current) => !current)}
                      className="inline-flex h-5 w-5 cursor-pointer items-center justify-center rounded-[3px] text-faint hover:bg-raised hover:text-fg"
                    >
                      <EllipsisVertical size={13} strokeWidth={1.8} />
                    </button>
                  </Tooltip>
                  {menuOpen && (
                    <div
                      role="menu"
                      aria-label="Annotation action menu"
                      className="absolute right-0 top-6 z-20 min-w-24 rounded-[5px] border border-edge-bright bg-surface p-1 shadow-lg"
                    >
                      <button
                        type="button"
                        role="menuitem"
                        aria-label="Delete annotation"
                        disabled={busy}
                        onClick={() => { setMenuOpen(false); onDelete(); }}
                        className="flex w-full cursor-pointer items-center gap-2 rounded-[3px] px-2 py-1.5 text-left font-mono text-[11px] text-danger hover:bg-raised disabled:cursor-default disabled:opacity-40"
                      >
                        <Trash2 size={12} strokeWidth={1.75} />
                        delete
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
            <p className={`leading-snug text-fg/90 ${open ? '' : 'line-clamp-2'}`}>{c.body}</p>
          </li>
        ))}
      </ul>
      {!open && (
        <button
          type="button"
          aria-label={resolved ? 'Show resolved conversation' : 'Open annotation thread'}
          aria-expanded={resolved ? false : undefined}
          onClick={onOpen}
          onFocus={() => onHover(a.id)}
          onBlur={() => onHover(null)}
          className="flex w-full cursor-pointer items-center justify-between gap-2 border-t border-edge px-3 py-1.5 font-mono text-[10px] text-faint transition-colors hover:bg-raised hover:text-accent"
        >
          <ThreadContinuation thread={a.thread} />
          <span className="shrink-0">open →</span>
        </button>
      )}
      {open && !resolved && (
        <div className="border-t border-edge px-3 py-2">
          <textarea
            aria-label="Reply to annotation"
            value={reply}
            onChange={(e) => setReply(e.target.value)}
            onKeyDown={(event) => {
              if (event.nativeEvent.isComposing || event.key !== 'Enter' || (!event.metaKey && !event.ctrlKey) || busy || !reply.trim()) return;
              event.preventDefault();
              onReply(reply);
              setReply('');
            }}
            rows={2}
            className="mb-2 w-full rounded-[4px] border border-edge bg-surface p-1.5 focus:border-edge-bright focus:outline-none"
            placeholder="reply…"
          />
          <div className="flex justify-end gap-2">
            <button
              type="button"
              aria-label="Cancel reply"
              onClick={() => { setReply(''); onOpen(); }}
              className="cursor-pointer rounded-[4px] bg-transparent px-2 py-1 text-muted hover:bg-surface hover:text-fg"
            >
              cancel
            </button>
            <button
              type="button" aria-label="Send reply" disabled={busy || !reply.trim()}
              onClick={() => { onReply(reply); setReply(''); }}
              className="cursor-pointer rounded-[4px] border border-accent bg-accent px-2 py-1 font-semibold text-bg hover:brightness-110 disabled:cursor-default disabled:opacity-40"
            >
              reply
            </button>
          </div>
        </div>
      )}
      {open && resolved && (
        <div className="flex justify-end border-t border-edge px-3 py-2">
          <button
            type="button"
            aria-label="Reopen annotation"
            disabled={busy}
            onClick={onReopen}
            className={buttonClass}
          >
            ↺ reopen
          </button>
        </div>
      )}
    </div>
  );
}

export default function AnnotationLayer({
  id, frameRef, sessionNonce, railOpen, currentEditId, liveAnnotations, showViewComments,
  onRailOpenChange, initialSelection = null, topOffset, beforeCreate,
}: AnnotationLayerProps) {
  const [annotations, setAnnotations] = useState<AnnotationWire[]>([]);
  const [resolvedList, setResolvedList] = useState<AnnotationWire[] | null>(null);
  const [openResolvedId, setOpenResolvedId] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [hoverId, setHoverId] = useState<string | null>(null);
  const [anchorRects, setAnchorRects] = useState<Record<string, StoryEditRect>>({});
  const [selection, setSelection] = useState<StoryEditSelection | null>(null);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  const nonceRef = useRef(sessionNonce);
  nonceRef.current = sessionNonce;
  // Read at SAVE time, not at render: the drain above can bump the head between
  // the click and the POST, and a captured value would spend a stale one.
  const currentEditIdRef = useRef(currentEditId);
  currentEditIdRef.current = currentEditId;
  const onRailOpenChangeRef = useRef(onRailOpenChange);
  onRailOpenChangeRef.current = onRailOpenChange;
  const beforeCreateRef = useRef(beforeCreate);
  beforeCreateRef.current = beforeCreate;
  /*
   * A selection report is only ours while a composer is already open — that is
   * the breadcrumb widening its target. Outside that, `mx:selection` is the
   * EDIT session narrating the caret, and following it would open a composer
   * on every click in the document.
   */
  const composingRef = useRef(false);
  composingRef.current = selection !== null;

  const postToFrame = useCallback((message: unknown) => {
    frameRef.current?.contentWindow?.postMessage(message, '*');
  }, [frameRef]);

  const openThread = useCallback((annId: string) => {
    setOpenId(annId);
    setSelection(null);
    onRailOpenChangeRef.current(true);
  }, []);

  // The rail lists every thread, so the one a pin click opened can sit below
  // the fold — especially in the phone HALF sheet. Bring it to the top of its
  // own scroller after the panel has committed (rAF: the rail may be mounting
  // in this very render). `inline: 'nearest'` on purpose — scrollIntoView
  // also scrolls the x-axis, the lesson the document's own scroll carries.
  useEffect(() => {
    if (!openId || !railOpen) return;
    const raf = requestAnimationFrame(() => {
      // Optional call: jsdom implements no scrollIntoView, and a missing
      // scroll is a cosmetic no-op, never an error.
      document.querySelector(`[data-thread-id="${CSS.escape(openId)}"]`)
        ?.scrollIntoView?.({ block: 'start', inline: 'nearest' });
    });
    return () => cancelAnimationFrame(raf);
  }, [openId, railOpen]);

  // Seed from the session's own read; the live stream replaces it wholesale.
  useEffect(() => {
    let gone = false;
    void fetch(`/api/my/artifacts/${id}/annotations`)
      .then(async (res) => (res.ok ? ((await res.json()) as { annotations: AnnotationWire[] }).annotations : []))
      .then((list) => { if (!gone) setAnnotations(list); })
      .catch(() => {});
    return () => { gone = true; };
  }, [id]);
  useEffect(() => {
    if (liveAnnotations) setAnnotations(liveAnnotations);
  }, [liveAnnotations]);

  // The resolved index is part of annotate mode: its rows stay collapsed until
  // one is clicked, so seeing history does not compete with open work.
  useEffect(() => {
    if (!railOpen) return;
    let gone = false;
    void fetch(`/api/my/artifacts/${id}/annotations?status=resolved`)
      .then(async (res) => (res.ok ? ((await res.json()) as { annotations: AnnotationWire[] }).annotations : []))
      .then((list) => { if (!gone) setResolvedList(list); })
      .catch(() => {});
    return () => { gone = true; };
  }, [id, railOpen, annotations]);

  // A selection handed down by the page — the view-mode bubble's Comment, or
  // the editor toolbar's — opens the composer on those exact words, so nobody
  // has to click the same text twice.
  useEffect(() => {
    if (!initialSelection) return;
    setSelection(initialSelection);
    setOpenId(null);
    setFailure(null);
  }, [initialSelection]);

  // The pin set, re-posted whole on every change — the frame holds no
  // annotation state it could get out of step on. Gated on the nonce: its
  // announcement is the signal that the runtime's listener exists.
  useEffect(() => {
    if (!sessionNonce) return;
    const message: StoryAnnotationsMessage = {
      type: STORY_ANNOTATIONS_MESSAGE,
      // Annotations are ambient whenever this capability exists. The frame
      // decides how pins/tints coexist with view and edit mode.
      mode: 'on',
      pins: annotations
        .filter((a) => !a.orphaned && a.anchor)
        // The range travels with the pin so the frame can paint the words
        // themselves; ids, body paths and the words' own positions are still
        // the only annotation data that enters that realm — never the comment.
        .map((a) => ({ id: a.id, path: a.anchor!.path, key: a.anchor!.key, range: a.range })),
      openId,
      hoverId,
      selectedPath: selection?.path ?? null,
    };
    postToFrame(message);
  }, [annotations, hoverId, openId, selection?.path, sessionNonce, postToFrame]);
  // Closing the rail drops what only the rail was showing; the pins stay.
  useEffect(() => {
    if (!railOpen) { setOpenResolvedId(null); setOpenId(null); }
  }, [railOpen]);
  useEffect(() => () => {
    frameRef.current?.contentWindow?.postMessage(
      { type: STORY_ANNOTATIONS_MESSAGE, mode: 'off', pins: [], openId: null, hoverId: null } satisfies StoryAnnotationsMessage, '*',
    );
  }, [frameRef]);

  // What the document says: pin clicks always; selections only in annotate mode.
  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      const frameWindow = frameRef.current?.contentWindow;
      if (!frameWindow || event.source !== frameWindow) return;
      const nonce = nonceRef.current;
      if (!nonce || !isEditFrameMessage(event.data, nonce)) return;
      if (event.data.type === STORY_ANNOTATION_LAYOUT_MESSAGE) {
        const next: Record<string, StoryEditRect> = {};
        for (const position of event.data.positions) next[position.id] = position.rect;
        setAnchorRects(next);
        return;
      }
      if (event.data.type === STORY_ANNOTATION_PIN_MESSAGE) {
        openThread(event.data.id);
        return;
      }
      if (event.data.type === STORY_ANNOTATION_HOVER_MESSAGE) {
        setHoverId(event.data.id);
        return;
      }
      if (event.data.type === STORY_SELECTION_MESSAGE && composingRef.current) {
        const reported = event.data.selection;
        /*
         * The frame re-reports the composing node's GEOMETRY on every scroll,
         * resize and re-render, and that report carries no quote — the words
         * live on this side. Taking it whole replaced the captured selection
         * with a quote-less one before the comment was ever saved, which is
         * how a two-paragraph comment quietly became a node again. The words
         * survive a report about the SAME node and only that: widening to an
         * ancestor is a different subject, and a range addressed from the old
         * anchor would not describe it.
         */
        setSelection((previous) => (
          reported && previous && reported.path === previous.path && previous.quote
            ? { ...reported, quote: previous.quote, range: previous.range }
            : reported
        ));
        setFailure(null);
        if (reported) setOpenId(null);
      }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [frameRef, openThread]);

  const act = useCallback(async (annId: string, body: { reply?: string; resolve?: boolean; reopen?: boolean }) => {
    setBusy(true);
    try {
      const res = await fetch(`/api/my/artifacts/${id}/annotations/${annId}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      });
      if (!res.ok) return;
      const wire = (await res.json()) as AnnotationWire;
      setAnnotations((prev) => {
        if (wire.status === 'resolved') return prev.filter((a) => a.id !== annId);
        return prev.some((a) => a.id === annId)
          ? prev.map((a) => (a.id === annId ? wire : a))
          : [...prev, wire];
      });
      setResolvedList((prev) => {
        if (!prev) return prev;
        if (wire.status === 'open') return prev.filter((a) => a.id !== annId);
        return prev.some((a) => a.id === annId)
          ? prev.map((a) => (a.id === annId ? wire : a))
          : [...prev, wire];
      });
      if (wire.status === 'resolved') setOpenId((cur) => (cur === annId ? null : cur));
      else if (body.reopen) {
        setOpenResolvedId(null);
        setOpenId(annId);
      }
    } finally { setBusy(false); }
  }, [id]);

  const remove = useCallback(async (annId: string) => {
    setBusy(true);
    try {
      const res = await fetch(`/api/my/artifacts/${id}/annotations/${annId}`, { method: 'DELETE' });
      if (!res.ok) return;
      setAnnotations((prev) => prev.filter((a) => a.id !== annId));
      setResolvedList((prev) => (prev ? prev.filter((a) => a.id !== annId) : prev));
      setOpenId((cur) => (cur === annId ? null : cur));
      setOpenResolvedId((cur) => (cur === annId ? null : cur));
    } finally { setBusy(false); }
  }, [id]);

  const save = useCallback(async () => {
    if (!selection || !draft.trim()) return;
    setBusy(true);
    setFailure(null);
    try {
      /*
       * THE INVARIANT. The anchor stamp below is a real edit through the same
       * CAS as every other write, and the editor answers a 409 by adopting the
       * server's document — so if someone comments on the paragraph they were
       * just typing in, the un-flushed keystrokes would be thrown away to make
       * room for the anchor. Drain first, then stamp against the fresh head.
       * (Bounded upstream; a drain that cannot reach the server must not strand
       * a comment that is already written.)
       */
      await beforeCreateRef.current?.();
      const post = (editId: string) => fetch(`/api/my/artifacts/${id}/annotations`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        // The exact words ride along when there are any: the frame captured
        // them from the live Range, and the page is the only side that can
        // store them. A caret comment simply carries neither key.
        body: JSON.stringify({
          path: selection.path, edit_id: editId, body: draft,
          ...(selection.quote ? { quote: selection.quote } : {}),
          ...(selection.range ? { range: selection.range } : {}),
        }),
      });
      // The drain may itself have moved the head; the 409 path below covers it.
      let res = await post(currentEditIdRef.current);
      if (res.status === 409) {
        // The document moved under the click; the refused answer carries head.
        const head = (await res.json()) as { edit_id?: string };
        if (head.edit_id) res = await post(head.edit_id);
      }
      if (!res.ok) {
        setFailure(await annotationFailure(res));
        return;
      }
      const wire = (await res.json()) as AnnotationWire;
      setAnnotations((prev) => [...prev, wire]);
      setSelection(null);
      setDraft('');
      setOpenId(wire.id);
      postToFrame({ type: STORY_SELECT_MESSAGE, path: null });
    } finally { setBusy(false); }
  }, [id, selection, draft, postToFrame]);

  const cancelCompose = useCallback(() => {
    setSelection(null);
    setDraft('');
    setFailure(null);
    postToFrame({ type: STORY_SELECT_MESSAGE, path: null });
  }, [postToFrame]);

  const submitDraft = useCallback(() => {
    if (busy || !draft.trim()) return;
    void save();
  }, [busy, draft, save]);

  /*
   * ESCAPE IS CANCEL. Bound on the window rather than the textarea: the draft
   * is a popover over someone else's document, and by the time they reach for
   * escape the focus may have moved to the breadcrumb, the buttons, or the
   * document behind it — a handler on the field would then do nothing and the
   * popover would just sit there. Only while a composer is actually open, so
   * escape keeps its other meanings everywhere else.
   */
  useEffect(() => {
    if (!selection) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.stopPropagation();
      cancelCompose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selection, cancelCompose]);

  /*
   * THREE INDEPENDENT SURFACES. None of them is a mode, so none of them is an
   * `else` of another: markers float unless the rail is showing the same threads,
   * the composer follows a selection whatever else is open, and the rail is a
   * panel someone asked for.
   */
  /** On a phone the rail is a bottom sheet — a 320px rail over a 390px screen
      is the whole document covered, with a strip too narrow to read. */
  const phoneRail = useIsPhoneViewport();

  // The collapsed 36px identity mark is small enough for phones too; clicking
  // it opens the same rail as a bottom sheet, with no hover dependency.
  const floating = !railOpen && showViewComments && annotations.length > 0;
  const markerRect = frameRef.current?.getBoundingClientRect()
    ?? { top: topOffset, height: window.innerHeight - topOffset };
  const placed = floating ? positionedComments(annotations, anchorRects, markerRect, window.innerHeight) : [];

  // The breadcrumb the edit toolbar taught: nearest ancestors, outermost first.
  const crumbs = selection ? [...selection.ancestors.slice(-2), { path: selection.path, tag: selection.tag, hint: '' }] : [];
  const frameRect = frameRef.current?.getBoundingClientRect() ?? {
    left: 0,
    top: topOffset,
    width: window.innerWidth - (railOpen ? RIGHT_RAIL_W : 0),
  };
  const composerPosition = selection
    ? positionedComposer(selection, frameRect, window.innerWidth, window.innerHeight)
    : null;

  return (
    <>
      {/* The ambient surface: tiny open-thread identities over the document's
          right edge, at their anchors. Present in view mode AND while editing —
          removing the `!editing` gate here is the whole feature. */}
      {floating && (
        <div aria-label="Open annotation comments" className="pointer-events-none fixed inset-0 z-20">
          {placed.map(({ annotation, top }) => (
            <ThreadPreview
              key={annotation.id}
              a={annotation}
              top={top}
              hovered={hoverId === annotation.id}
              onOpen={() => openThread(annotation.id)}
              onHover={setHoverId}
            />
          ))}
        </div>
      )}

      {/* Drafts belong to the thing being discussed. The saved conversation
          moves to the stable right rail after creation. */}
      {selection && composerPosition && (
        <section
          role="dialog"
          aria-label="Annotation composer"
          className={`${cardClass} fixed z-30 overflow-y-auto border-edge-bright shadow-xl`}
          style={{
            left: composerPosition.left,
            top: composerPosition.top,
            width: composerPosition.width,
            maxHeight: `calc(100vh - ${composerPosition.top + VIEW_COMMENT_INSET}px)`,
          }}
        >
          <div className="flex items-center gap-2 border-b border-edge px-3 py-2.5">
            <span className="inline-flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full border border-accent/25 bg-accent-soft text-accent">
              <MessageSquare size={12} strokeWidth={1.8} />
            </span>
            <span className="text-xs font-semibold text-fg">Add comment</span>
            <button
              type="button"
              aria-label="Close annotation composer"
              onClick={cancelCompose}
              className="ml-auto inline-flex h-6 w-6 cursor-pointer items-center justify-center rounded-[3px] text-muted hover:bg-surface hover:text-fg"
            >
              <X size={14} strokeWidth={1.8} />
            </button>
          </div>
          <div className="p-3">
            <div className="mb-2 flex min-w-0 flex-wrap items-center gap-1 font-mono text-[11px] text-muted">
              {crumbs.map((crumb, i) => (
                <span key={crumb.path} className="flex min-w-0 items-center gap-1">
                  {i > 0 && <span>›</span>}
                  {crumb.path === selection.path ? (
                    <span className="truncate text-accent">{crumb.tag}</span>
                  ) : (
                    <Tooltip content={crumb.hint || crumb.tag}>
                      <button
                        type="button"
                        aria-label={`Select ${crumb.tag}`}
                        onClick={() => postToFrame({ type: STORY_SELECT_MESSAGE, path: crumb.path })}
                        className="cursor-pointer truncate underline decoration-dotted hover:text-accent"
                      >
                        {crumb.tag}
                      </button>
                    </Tooltip>
                  )}
                </span>
              ))}
            </div>
            <textarea
              aria-label="Annotation comment"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(event) => {
                if (event.nativeEvent.isComposing || event.key !== 'Enter' || (!event.metaKey && !event.ctrlKey)) return;
                event.preventDefault();
                submitDraft();
              }}
              rows={4}
              autoFocus
              className="mb-2 w-full resize-y rounded-[4px] border border-edge bg-surface p-2 leading-snug focus:border-accent focus:outline-none"
              placeholder="Add a comment for your agent…"
            />
            {failure && <p role="alert" className="mb-2 font-mono text-[11px] text-danger">{failure}</p>}
            <div className="flex items-center justify-end gap-2">
              <span className="mr-auto hidden font-mono text-[9px] text-faint sm:inline">⌘↵ to send</span>
              <button
                type="button"
                aria-label="Cancel annotation"
                onClick={cancelCompose}
                className="cursor-pointer rounded-[4px] bg-transparent px-2 py-1 text-muted hover:bg-surface hover:text-fg"
              >
                cancel
              </button>
              <button
                type="button" aria-label="Save annotation" disabled={busy || !draft.trim()}
                onClick={submitDraft}
                className="cursor-pointer rounded-[4px] border border-accent bg-accent px-2 py-1 font-semibold text-bg hover:brightness-110 disabled:cursor-default disabled:opacity-40"
              >
                comment
              </button>
            </div>
          </div>
        </section>
      )}

      {/* The rail — a panel, open in either mode. On desktop the page narrows
          the document's viewport by exactly its width while it is up; on a
          phone it is a bottom sheet instead (RailChrome). */}
      {railOpen && (
      <RailChrome
        phone={phoneRail}
        topOffset={topOffset}
        onClose={() => onRailOpenChange(false)}
        header={
          <div className="flex items-center gap-2 px-1">
            <h2 className="font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-faint">comments</h2>
            <button
              type="button"
              aria-label="Close comments"
              onClick={() => onRailOpenChange(false)}
              className="ml-auto inline-flex h-6 w-6 cursor-pointer items-center justify-center rounded-[3px] text-muted hover:bg-surface hover:text-fg"
            >
              <X size={14} strokeWidth={1.8} />
            </button>
          </div>
        }
      >
        {annotations.length === 0 && !selection && (
          <p className="p-2 font-mono text-xs text-muted">no open comments — select text in the document to leave one</p>
        )}
        {annotations.map((a) => (
          <Thread
            key={a.id}
            a={a}
            open={openId === a.id}
            hovered={hoverId === a.id}
            busy={busy}
            onOpen={() => openThread(a.id)}
            onHover={setHoverId}
            onReply={(body) => void act(a.id, { reply: body })}
            onResolve={() => void act(a.id, { resolve: true })}
            onReopen={() => {}}
            onDelete={() => void remove(a.id)}
          />
        ))}
        <div
          role="separator"
          aria-labelledby="resolved-annotations-heading"
          className="mt-1 flex items-center gap-2 px-1"
        >
          <span aria-hidden="true" className="h-px flex-1 bg-edge" />
          <h2 id="resolved-annotations-heading" className="shrink-0 font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-faint">
            resolved
          </h2>
          <span aria-hidden="true" className="h-px flex-1 bg-edge" />
        </div>
        {(resolvedList ?? []).map((a) => (
          <Thread
            key={a.id}
            a={a}
            open={openResolvedId === a.id}
            resolved
            hovered={hoverId === a.id}
            busy={busy}
            onOpen={() => setOpenResolvedId((current) => current === a.id ? null : a.id)}
            onHover={setHoverId}
            onReply={() => {}}
            onResolve={() => {}}
            onReopen={() => void act(a.id, { reopen: true })}
            onDelete={() => void remove(a.id)}
          />
        ))}
        {(resolvedList?.length ?? 0) === 0 && (
          <p className="p-2 font-mono text-xs text-muted">nothing resolved yet</p>
        )}
      </RailChrome>
      )}
    </>
  );
}

/**
 * The conversation's two homes (the ShareLink rule): the fixed right rail on
 * desktop — the page narrows the document by its width — and a bottom sheet
 * on a phone. The content between them is identical; this wrapper is the only
 * thing that knows the difference.
 */
function RailChrome({ phone, topOffset, onClose, header, children }: {
  phone: boolean;
  topOffset: number;
  onClose: () => void;
  /** The title row + close control — pinned above the scroll in BOTH homes:
      the way out must stay reachable however long the list gets. */
  header: React.ReactNode;
  children: React.ReactNode;
}) {
  if (phone) {
    return (
      <MobileSheet label="Annotation sidebar" onClose={onClose} size="half" header={header}>
        <div className="flex flex-col gap-2.5">{children}</div>
      </MobileSheet>
    );
  }
  return (
    <aside
      aria-label="Annotation sidebar"
      className="fixed bottom-0 right-0 z-20 flex flex-col gap-2.5 border-l border-edge bg-bg p-2.5"
      style={{ top: topOffset, width: RIGHT_RAIL_W }}
    >
      <div className="shrink-0">{header}</div>
      <div className="flex min-h-0 flex-1 flex-col gap-2.5 overflow-y-auto">{children}</div>
    </aside>
  );
}
