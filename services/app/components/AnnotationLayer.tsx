import {useNotifications} from './notification-context';
import {useSession} from '@/web/session';
import {PersonMentionProvider} from './PersonMention';
'use client';

import {useNewCommentDraft} from './useNewCommentDraft';

import {replyMentionPrefix,hasReplyText,remoteWorkLabel} from '../lib/remote-reply';
import {REMOTE_COLOR_CSS,remoteColor} from '../../contracts/src/remote';

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
 *                       view-mode selection bubble, the editor's toolbar, or
 *                       the rail's PICK tool (`pick`): the edit-mode
 *                       hover-and-click, for a comment — the only way to
 *                       comment on a chart, an image or a whole list, which
 *                       have no words to select. One-shot, never in the URL.
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
 * Mounted for anyone who may comment (the owner, a named editor, or a
 * commenter — lib/share-roles' canAnnotate); a shared reader's document is
 * top-level with no parent window, so nothing here can even reach them.
 */
import { useConfirmation } from './ConfirmDialog';
import { CommentTimestamp } from './CommentTimestamp';
import { sendDocument, subscribeDocument, documentRect, type DocumentRuntimeRef } from '@/lib/story-runtime/document-endpoint';
import dynamic from '@/lib/dynamic';
import {useForegroundComposer} from './TrustedUi';
import type {ScreenshotDrawing} from './ScreenshotEditor';
import {useCommentCapture} from '@/lib/capture/use-comment-capture';
import CommentScreenshot from './CommentScreenshot';
import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown, ChevronRight, EllipsisVertical, MessageSquare, LoaderCircle, SquareDashedMousePointer, Trash2, X } from 'lucide-react';
import { useArtifactBackend, useOptionalArtifactBackend } from '@/lib/artifact-backend/context';
import { BackendRequestError } from '@/lib/artifact-backend/errors';
import { FeatureGate } from '@/components/FeatureUnavailable';
import type { AnnotationCommentWire, AnnotationWire } from '@/lib/annotations';
import Avatar from '@/components/Avatar';
import { ChatGPTIcon, ClaudeAIIcon, ClaudeCodeIcon, CodexIcon } from '@/components/brand-icons';
import { foldFromMeasure, isFolded, readFolds, toggleFold, unfold, type FoldKind, type Folds } from '@/lib/comment-folds';
import { loginHref } from '@/lib/login-href';
import MarkdownField from '@/components/MarkdownField';
import MarkdownLite from '@/components/MarkdownLite';
import MobileSheet, { useIsPhoneViewport } from '@/components/MobileSheet';
import { Tooltip } from '@/components/Tooltip';
import { parseMarkdownLite, plainText } from '@/lib/markdown-lite';
import { APP_BAR_H, RIGHT_RAIL_W } from '@/lib/story/edit-bar';
import {
  isEditFrameMessage, STORY_ANNOTATIONS_MESSAGE, STORY_ANNOTATION_HOVER_MESSAGE, STORY_ANNOTATION_LAYOUT_MESSAGE, STORY_ANNOTATION_PIN_MESSAGE,
  STORY_SELECTION_MESSAGE, STORY_SELECT_MESSAGE, STORY_SELECTION_ACTION_MESSAGE,
  type StoryAnnotationsMessage, type StoryEditRect, type StoryEditSelection,
} from '@/lib/story-runtime/contract';

// Keep the brush in its own chunk, preloaded when selection starts. Native permission
// remains in the eager capture module so it retains the user gesture.
let screenshotEditorModule: Promise<typeof import('./ScreenshotEditor')> | undefined;
const loadScreenshotEditor=()=>screenshotEditorModule??=(import('./ScreenshotEditor').catch(error=>{screenshotEditorModule=undefined;throw error;}));
const ScreenshotEditor=dynamic(loadScreenshotEditor);


interface AnnotationLayerProps {
  /** Every change to the list this layer holds — creates, replies, resolves — so the page's count can follow it. */
  onAnnotationsChange?: (annotations: AnnotationWire[]) => void;
  id: string;
  editId?: string;
  frameRef?: { current: HTMLIFrameElement | null };
  runtimeRef?: DocumentRuntimeRef;
  sessionNonce: string | null;
  /** The thread rail is open — a panel, not a mode, and true in either mode. */
  railOpen: boolean;
  /** The latest full open list from the live stream; null until the first frame. Replaces the fetch wholesale. */
  liveAnnotations: AnnotationWire[] | null;
  /** Open threads should mark the document edge (the ambient surface). */
  showViewComments: boolean;
  /** The rail wants to open (a pin click) or close (its own button). */
  onRailOpenChange: (open: boolean) => void;
  /** A text selection — from the view-mode bubble or the editor — that seeds the composer. */
  initialSelection?: StoryEditSelection | null;
  /**
   * May opening the rail open a PICK? The page's call, because only it knows
   * whether the editor holds the document's clicks: a pick takes them, so it
   * is never started under the editor, and one already on ends when the
   * editor opens. Default true. The tool in the header ignores this — an
   * explicit pick is always allowed.
   */
  pickOnOpen?: boolean;
  /** Where the rail starts: under the document's bar, plus the editor toolbar when one is up. */
  topOffset: number;
  /** What the rail leaves free on the right: the frame's own scrollbar, which stays at the window's edge. */
  rightInset?: number;
  /**
   * The editor's right panel hosts the rail (its Comments tab): the rail renders
   * INTO this element instead of as its own fixed column. `null` means hosted
   * but the tab is not showing, so the rail draws nowhere. Absent: its own home.
   */
  railHost?: HTMLElement | null;
  /** The rail is a bottom sheet at this width too (the editor below its panel breakpoint). */
  railSheet?: boolean;
  /**
   * The right-edge panel that is up whether or not comments are — the editor's
   * — so the composer and the markers keep clear of it. Absent: the rail's own
   * width while it is open.
   */
  panelWidth?: number;
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
  screenshot = false,
) {
  const viewportInset = VIEW_COMMENT_INSET;
  const narrowDocument = frameRect.width < 280;
  const minLeft = narrowDocument ? viewportInset : frameRect.left + viewportInset;
  const maxRight = narrowDocument
    ? viewportWidth - viewportInset
    : Math.min(viewportWidth - viewportInset, frameRect.left + frameRect.width - viewportInset);
  const width = Math.max(0, Math.min(screenshot ? 680 : COMPOSER_W, maxRight - minLeft));
  const anchorRight = frameRect.left + selection.rect.x + selection.rect.width;
  const left = Math.max(minLeft, Math.min(anchorRight + COMPOSER_GAP, maxRight - width));

  const minTop = Math.max(frameRect.top, screenshot ? APP_BAR_H : 0) + viewportInset;
  const preferredTop = frameRect.top + selection.rect.y
    + Math.min(selection.rect.height + COMPOSER_GAP, 56);
  const maxTop = Math.max(minTop, viewportHeight - (screenshot ? 720 : COMPOSER_ESTIMATED_H) - viewportInset);
  return { left, top: Math.max(minTop, Math.min(preferredTop, maxTop)), width };
}

/**
 * WHAT A CLAMPED SURFACE SHOWS. A comment body is markdown-lite, and the two
 * compact surfaces — the floating card and a collapsed rail thread — have two
 * lines to spend. Rendering the tree there would spend them on a fence or a
 * bullet; the RAIL, opened, is where the whole thing is read.
 */
const previewText = (body: string) => plainText(parseMarkdownLite(body));

/** What a folded comment or thread keeps: the sentence it opens with. */
const firstLine = (body: string) => previewText(body).split('\n', 1)[0] ?? '';

/** jsdom lays nothing out and an unstyled element reports `normal`; a comment
    body is `leading-snug` over the app's base size, so 20px is the honest floor. */
const DEFAULT_LINE_HEIGHT = 20;

/**
 * A BODY LONGER THAN TEN LINES CLAMPS ITSELF.
 *
 * The clamp is on the WRAPPER and the measurement is of the CHILD, which is
 * the whole trick: clamping the element you measure makes its own scrollHeight
 * agree with the clamp on the next render, and the fold quietly un-decides
 * itself — on a rail that re-renders on every live frame, that is a control
 * flickering in and out while an agent types.
 *
 * Clamped, never truncated: every word stays in the DOM, so find-in-page and a
 * screen reader still reach the end of the answer.
 */
function FoldingBody({ text, foldable }: { text: string; foldable: boolean }) {
  const measured = useRef<HTMLDivElement>(null);
  const [fold, setFold] = useState({ overflowing: false, lines: 0, maxHeight: 0 });
  const [shown, setShown] = useState(false);

  useEffect(() => {
    const element = measured.current;
    if (!element) return;
    // The line height of the element that LAYS THE TEXT OUT, not of the
    // wrapper: the rail is `text-sm` (20px lines) and a rendered paragraph is
    // `leading-normal` (21px), so measuring the wrapper clamps ten lines at
    // nine and a half and the tenth is cut through the middle.
    const line = element.querySelector('p, li, pre') ?? element;
    const styled = window.getComputedStyle(line);
    const lineHeight = parseFloat(styled.lineHeight) || DEFAULT_LINE_HEIGHT;
    const next = foldFromMeasure(element.scrollHeight, lineHeight);
    // Only when it MOVED: a setState on every render of an unchanged
    // measurement is a loop, and this measures after every render.
    setFold((current) => (
      current.overflowing === next.overflowing && current.lines === next.lines && current.maxHeight === next.maxHeight
        ? current
        : next
    ));
  }, [text]);

  const clamped = foldable && fold.overflowing && !shown;
  return (
    <div className="min-w-0">
      <div
        data-folded-body={clamped ? 'clamped' : undefined}
        className={clamped ? 'overflow-hidden' : undefined}
        style={clamped ? { maxHeight: fold.maxHeight } : undefined}
      >
        <div ref={measured}>
          <MarkdownLite text={text} />
        </div>
      </div>
      {foldable && fold.overflowing && (
        <button
          type="button"
          aria-label={clamped ? 'Show whole comment' : 'Show less of comment'}
          aria-expanded={!clamped}
          onClick={() => setShown((current) => !current)}
          className="mt-1 cursor-pointer rounded-[3px] font-mono text-[10px] text-muted hover:text-accent"
        >
          {clamped ? `show more (${fold.lines} lines)` : 'show less'}
        </button>
      )}
    </div>
  );
}

const authorLabel = (author: AnnotationCommentWire['author']) =>
  author.label?.trim() || (author.kind === 'human' ? 'You' : 'Agent');

/**
 * A person's face on a comment: their picture, else their initial on the
 * colour their ACCOUNT id picks. Only a person with no account falls back to
 * their label as the key — they have no colour anywhere else to agree with.
 */
function PersonFace({ author, size }: { author: AnnotationCommentWire['author']; size: number }) {
  const label = authorLabel(author);
  return <Avatar image={author.image} initial={label} userId={author.user_id ?? `label:${label}`} size={size} />;
}

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
  // Offline, a name is a label someone typed, not a profile to visit.
  const offline = useOptionalArtifactBackend()?.mode === 'offline';
  return (
    <span className="flex min-w-0 items-center gap-2">
      {author.kind === 'human' ? (
        <span aria-label={`${label} avatar`} className="inline-flex h-[22px] w-[22px] shrink-0 rounded-full">
          <PersonFace author={author} size={22} />
        </span>
      ) : (
        <AgentMark label={label} />
      )}
      {author.sessionId ? <a href={`/chat?session=${author.sessionId}`} target="_blank" rel="noopener noreferrer" className="truncate text-[11px] font-semibold" style={{color:REMOTE_COLOR_CSS[author.color??remoteColor(author.sessionId)]}}>@{label}</a> : author.kind === 'human' && author.label && !offline ? (
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
    // Bare, not wrapped: the stack's ring lands on its direct children.
    <PersonFace author={author} size={18} />
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
    <PersonFace author={author} size={22} />
  );
}

/** A quiet identity mark until intent is shown; then enough context to choose. */
function ThreadPreview({ a, top, hovered, onOpen, onHover, remaining }: {
  a: AnnotationWire;
  remaining?:number;
  top: number;
  hovered: boolean;
  onOpen: () => void;
  onHover: (id: string | null) => void;
}) {
  const [repliesExpanded, setRepliesExpanded] = useState(false);
  const continuationRef = useRef<HTMLButtonElement>(null);
  // Native events preserve hover targets inside TrustedUi's shadow root.
  // The preview owns the delay; leaving or unmounting always cancels it.
  useEffect(() => {
    if (!hovered) { setRepliesExpanded(false); return; }
    const button = continuationRef.current;
    if (!button) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const cancel = () => { clearTimeout(timer); };
    const enter = () => { cancel(); timer = setTimeout(() => setRepliesExpanded(true), 600); };
    button.addEventListener('mouseenter', enter);
    button.addEventListener('mouseleave', cancel);
    return () => {
      cancel();
      button.removeEventListener('mouseenter', enter);
      button.removeEventListener('mouseleave', cancel);
    };
  }, [hovered]);
  const first = a.thread[0];
  const label = first ? authorLabel(first.author) : 'Unknown';
  const messages = a.thread.length;
  const agents=(a.remote_work??[]).filter((w,i,all)=>!all.slice(i+1).some(next=>next.sessionId===w.sessionId));
  const activeAgents=agents.filter(w=>w.connection==='online'&&['queued','dispatching','delivered','acknowledged'].includes(w.phase)&&w.activity!=='unknown');
  const work=activeAgents.at(-1)??agents.at(-1);
  const inbox=useNotifications()?.state;
  const unread=inbox?.notifications.some(n=>!n.read_at&&n.source===`comment:${a.id}`);
  const working=activeAgents.length>0;
  const previewRoot=useRef<HTMLElement>(null);
  useEffect(()=>{
    const element=previewRoot.current;
    if(!element)return;
    // Native enter/leave retains the actual target across the portal's shadow
    // boundary; React's delegated enter synthesis sees the retargeted host.
    const enter=()=>onHover(a.id);
    const leave=()=>onHover(null);
    element.addEventListener('mouseenter',enter);
    element.addEventListener('mouseleave',leave);
    return()=>{element.removeEventListener('mouseenter',enter);element.removeEventListener('mouseleave',leave);};
  },[a.id,onHover]);
  const compactWidth = messages > 9
    ? VIEW_COMMENT_MANY_W
    : messages > 1 ? VIEW_COMMENT_COUNTED_W : VIEW_COMMENT_COLLAPSED_W;
  return (
    <article
      ref={previewRoot}
      onFocus={() => onHover(a.id)}
      onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) onHover(null); }}
      data-annotation-id={a.id}
      data-hovered={hovered ? 'true' : undefined}
      className={`${working?'motion-safe:animate-pulse':''} group pointer-events-auto overflow-hidden border text-left shadow-md transition-[top,width,height,border-color,background-color,box-shadow] duration-150 ${hovered ? 'z-10 border-edge-bright bg-comment-hover px-3 py-2.5 shadow-xl' : 'border-transparent bg-raised hover:bg-raised'}`}
      style={{
        position: 'fixed',
        outline:work?`2px solid ${REMOTE_COLOR_CSS[work.color]}`:undefined,
        top,
        right: VIEW_COMMENT_INSET,
        width: hovered ? 288 : compactWidth,
        maxWidth: `calc(100vw - ${VIEW_COMMENT_INSET * 2}px)`,
        height: hovered ? (repliesExpanded ? 'auto' : VIEW_COMMENT_EXPANDED_H) : VIEW_COMMENT_COLLAPSED_H,
        maxHeight: hovered && repliesExpanded ? `calc(100dvh - ${top + VIEW_COMMENT_INSET}px)` : undefined,
        overflowY: hovered && repliesExpanded ? 'auto' : undefined,
        borderRadius: hovered ? 5 : '50% 50% 50% 3px',
      }}
    >
      <button
        type="button"
        aria-label={`Open annotation conversation by ${label}, ${messages} message${messages === 1 ? '' : 's'}`}
        onClick={onOpen}
        className="absolute inset-0 z-0 cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-accent"
        style={{ borderRadius: hovered ? 5 : '50% 50% 50% 3px' }}
      />
      {unread&&<span aria-label="Unread reply" className="pointer-events-none absolute right-0 top-0 z-10 h-2 w-2 rounded-full bg-accent"/>}
      {a.status==='resolved'&&<span aria-label="Resolved" className="pointer-events-none absolute bottom-0 right-0 z-10 text-xs text-accent">✓</span>}
      {work&&<span className="sr-only">{remoteWorkLabel(work)}{agents.length>1?` · ${agents.length} agents`:null}</span>}
      {hovered&&agents.length>1&&<span className="absolute right-2 top-1 text-[10px] text-muted">{agents.length} agents</span>}
      {remaining!==undefined&&<span role="status" className="sr-only motion-reduce:not-sr-only">Resolved · {Math.ceil(remaining/1000)} seconds</span>}
      {first && !hovered && (
        <span className="pointer-events-none absolute inset-0 flex items-center justify-start pl-[7px]">
          <span className="relative flex h-[22px] w-[22px] shrink-0 items-center justify-center">
            {remaining!==undefined&&<svg aria-hidden="true" className="pointer-events-none absolute -left-1 -top-1 h-[30px] w-[30px] motion-reduce:hidden" viewBox="0 0 40 40"><circle cx="20" cy="20" r="18" fill="none" stroke="currentColor" strokeWidth="2" pathLength="100" strokeDasharray={`${remaining/100} 100`} transform="rotate(-90 20 20)"/></svg>}
            <CompactAuthorMark author={first.author} />
          </span>
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
            <CommentTimestamp iso={first.created_at} className="font-mono text-[10px] text-faint" />
          </span>
          <span className="mt-1.5 line-clamp-2 block font-sans text-sm leading-snug text-fg/90">{previewText(first.body)}</span>
          <span className="mt-auto flex items-center justify-between font-mono text-[10px] text-faint">
            {messages > 1 ? <button
              ref={continuationRef}
              type="button"
              aria-label="Expand replies"
              aria-expanded={repliesExpanded}
              onClick={() => setRepliesExpanded(true)}
              className="pointer-events-auto cursor-pointer rounded-sm text-left hover:text-accent focus-visible:outline-2 focus-visible:outline-accent"
            ><ThreadContinuation thread={a.thread} /></button> : <ThreadContinuation thread={a.thread} />}
            <span className="transition-colors group-hover:text-accent">open →</span>
          </span>
          {repliesExpanded && <span role="list" aria-label="Thread replies" className="pointer-events-auto mt-2 flex flex-col gap-3 border-t border-edge pt-2">
            {a.thread.slice(1).map(reply => <span role="listitem" key={reply.id} className="block">
              <AuthorIdentity author={reply.author} />
              <span className="mt-1 block whitespace-pre-wrap break-words font-sans text-sm leading-snug text-fg/90">{previewText(reply.body)}</span>
            </span>)}
          </span>}
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

/** ONE fold affordance for a thread, wherever the card is putting it. */
function ThreadFoldControl({ folded, onToggle }: { folded: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      aria-label={folded ? 'Expand thread' : 'Collapse thread'}
      aria-expanded={!folded}
      onClick={onToggle}
      className="-ml-1 inline-flex h-5 w-5 shrink-0 cursor-pointer items-center justify-center rounded-[3px] text-faint hover:bg-raised hover:text-fg"
    >
      {folded ? <ChevronRight size={13} strokeWidth={1.8} /> : <ChevronDown size={13} strokeWidth={1.8} />}
    </button>
  );
}

function Thread({
  artifactId, a, open, resolved, hovered, busy, folded, justOpened, isCommentFolded, targetMissing,
  onOpen, onHover, onReply, onResolve, onReopen, onDelete, onToggleFold, onToggleComment,
}: {
  artifactId:string;
  a: AnnotationWire;
  open: boolean;
  resolved?: boolean;
  targetMissing?: boolean;
  hovered: boolean;
  busy: boolean;
  /** This viewer folded the whole conversation away. */
  folded: boolean;
  /**
   * This viewer just asked for this thread (a pin, a message, their own new
   * comment), so its NEWEST comment is the answer they came for and is shown
   * whole however long it is.
   */
  justOpened: boolean;
  isCommentFolded: (commentId: string) => boolean;
  onOpen: () => void;
  onHover: (id: string | null) => void;
  onReply: (body: string) => Promise<boolean>;
  onResolve: () => void;
  onReopen: () => void;
  onDelete: () => void;
  onToggleFold: () => void;
  onToggleComment: (commentId: string) => void;
}) {
  const notifications=useNotifications();
  const {session}=useSession();
  const threadElement=useRef<HTMLDivElement>(null);
  const markRead=notifications?.load;
  const newestFolded=isCommentFolded(a.thread.at(-1)?.id??'');
  useEffect(()=>{
    if(!open||folded||newestFolded||!session?.user?.id||!markRead||!threadElement.current||typeof IntersectionObserver==='undefined')return;
    const userId=session.user.id;
    const observer=new IntersectionObserver(entries=>{if(entries.some(e=>e.isIntersecting)&&document.visibilityState==='visible'){void markRead({read:`thread:${a.id}:${userId}`,revision:a.revision??1});observer.disconnect();}},{threshold:0.1});
    const latest=threadElement.current.querySelector('[data-notification-read-point]');
    if(latest)observer.observe(latest);return()=>observer.disconnect();
  },[open,folded,newestFolded,a.id,a.revision,session?.user?.id,markRead]);
  const prefix=replyMentionPrefix(a.thread);
  const [reply, setReply] = useState(()=>prefix);
  const touched=useRef(false);
  const sending=useRef(false);
  const [replyError,setReplyError]=useState('');
  useEffect(()=>{if(!touched.current)setReply(prefix);},[prefix]);
  const [replyPreviewing, setReplyPreviewing] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const visibleComments = open ? a.thread : a.thread.slice(0, 1);
  const first = a.thread[0];
  const replyCount = Math.max(0, a.thread.length - 1);

  // ONE send for the button and for ⌘↵ — the field owns the key, the thread
  // owns whether there is anything to send.
  const sendReply = useCallback(async () => {
    if (busy || sending.current || !hasReplyText(reply)) return;
    sending.current=true;setReplyError('');
    try {
      if(!await onReply(reply))throw new Error('Could not send reply. Your draft is saved here.');
      touched.current=false;setReply(prefix);setReplyPreviewing(false);
    } catch {setReplyError('Could not send reply. Your draft is saved here.');}
    finally {sending.current=false;}
  }, [busy, reply, onReply,prefix]);

  useEffect(() => {
    if (!menuOpen) return;
    const dismiss = (event: PointerEvent) => {
      if (!menuRef.current || !event.composedPath().includes(menuRef.current)) setMenuOpen(false);
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
      ref={threadElement}
      aria-label={resolved ? 'Resolved annotation thread' : 'Annotation thread'}
      data-thread-id={a.id}
      data-hovered={hovered ? 'true' : undefined}
      onMouseEnter={() => onHover(a.id)}
      onMouseLeave={() => onHover(null)}
      onClick={(event) => {
        const target = event.target as Element;
        // `[role="button"]` earns its place here: the author line is a DIV
        // toggle, so without it collapsing a comment in a closed thread would
        // also open the thread.
        if (!open && !folded && !target.closest('a, button, textarea, input, [role="button"]')) onOpen();
      }}
      className={`${threadClass} shrink-0 overflow-hidden transition-[border-color,background-color,opacity] duration-150 ${open || folded ? '' : 'cursor-pointer'} ${open || hovered ? 'border-edge-bright bg-comment-hover' : ''} ${resolved ? 'opacity-55 hover:opacity-100 focus-within:opacity-100' : ''}`}
    >
      {/* The thread's own header: what it is about, and the way to fold it.
          Present open or closed, resolved or not — one affordance, one place. */}
      {folded && (
        <div className="px-3 py-2">
          {/* Folded, the card IS its summary: what the thread is about, how it
              opens, and how much is underneath. */}
          <div className="flex min-w-0 items-center gap-1.5">
            <ThreadFoldControl folded onToggle={onToggleFold} />
            <span className="truncate font-mono text-[10px] text-faint">{a.snippet || 'this document'}</span>
          </div>
          {first && (
            <>
              <p className="mt-1 truncate font-sans leading-snug text-fg/90">{firstLine(first.body)}</p>
              <p className="mt-1 font-mono text-[10px] text-faint">
                {replyCount === 1 ? '1 reply' : `${replyCount} replies`}
              </p>
            </>
          )}
        </div>
      )}
      {!folded && (a.remote_work??[]).filter((w,i,all)=>!all.slice(i+1).some(next=>next.sessionId===w.sessionId)).map(work=>(
        <p key={work.id} role="status" className="flex items-center gap-1.5 border-b border-edge px-3 py-1.5 text-[11px] text-muted">
          <a href={`/chat?session=${work.sessionId}`} target="_blank" rel="noopener noreferrer" style={{color:REMOTE_COLOR_CSS[work.color]}}>@{work.name}</a>
          <span>{remoteWorkLabel(work)}</span>
        </p>
      ))}
      {!folded && targetMissing && !a.orphaned && (
        <p className="border-b border-edge bg-surface/60 px-3 py-1.5 font-mono text-[10px] text-faint">
          Exact target is unavailable. This comment remains attached to its containing block.
        </p>
      )}
      {/*
        * WHAT THIS WAS ABOUT, when the document cannot say it. A live, quoted
        * passage is highlighted in the document itself and is never repeated
        * here — the rail would be showing the reader the same words twice. The
        * two cases where the document has nothing to show are these, and an
        * expanded card carries the original words for both: the node is gone,
        * or the node is there and the quoted words have been edited away.
        */}
      {!folded && a.orphaned && (
        <div className="border-b border-edge bg-surface/60 px-3 py-1.5">
          {open && (a.quote ?? a.snippet) && (
            <p className="mb-1 border-l-2 border-edge-bright pl-2 font-sans text-[12px] leading-snug text-fg/80">{a.quote ?? a.snippet}</p>
          )}
          <p className="font-mono text-[10px] text-faint">This passage was removed from the document.</p>
        </div>
      )}
      {!folded && open && !a.orphaned && a.quote_found === false && a.quote && (
        <div className="border-b border-edge bg-surface/60 px-3 py-1.5">
          <p className="mb-1 border-l-2 border-edge-bright pl-2 font-sans text-[12px] leading-snug text-fg/80">{a.quote}</p>
          <p className="font-mono text-[10px] text-faint">These words have since been edited.</p>
        </div>
      )}
      {!folded && (
      <ul className="flex flex-col gap-3 px-3 py-3">
        {visibleComments.map((c, index) => {
          const commentFolded = open && isCommentFolded(c.id);
          // ONE exemption to the auto-fold: the newest comment of a thread this
          // viewer just asked to see.
          const newest = index === visibleComments.length - 1;
          /*
           * `scroll-mb-14` below is not spacing — it is what the open-scroll
           * aims at. On a phone the page's own action bar floats OVER the
           * bottom of this sheet, so a comment scrolled flush to the
           * scrollport's edge lands behind it; a scroll margin is the one
           * mechanism scrollIntoView honours for chrome it cannot see.
           */
          return (
          <li data-comment-id={c.id} key={c.id + c.created_at} className="scroll-mb-14 sm:scroll-mb-0">
            <div className="mb-1.5 flex min-w-0 items-center gap-2">
              {/* The whole conversation's fold, at the top-left of the card —
                  a row of its own would cost the rail a line it does not have
                  to spend, which is the thing this feature is about. */}
              {index === 0 && <ThreadFoldControl folded={false} onToggle={onToggleFold} />}
              {/*
                * The author line is the comment's own toggle — but only where
                * there is a body to fold away (an open thread). A DIV rather
                * than a button because it holds the author's profile link;
                * clicks that land on real controls inside it are theirs.
                */}
              <span
                role={open ? 'button' : undefined}
                tabIndex={open ? 0 : undefined}
                aria-label={open ? (commentFolded ? 'Expand comment' : 'Collapse comment') : undefined}
                aria-expanded={open ? !commentFolded : undefined}
                onClick={(event) => {
                  if (!open) return;
                  if ((event.target as Element).closest('a, button')) return;
                  onToggleComment(c.id);
                }}
                onKeyDown={(event) => {
                  if (!open || (event.key !== 'Enter' && event.key !== ' ')) return;
                  event.preventDefault();
                  onToggleComment(c.id);
                }}
                className={`flex min-w-0 flex-1 items-center gap-2 rounded-[3px] ${open ? 'cursor-pointer' : ''}`}
              >
                <AuthorIdentity author={c.author} />
                <CommentTimestamp iso={c.created_at} className="ml-auto shrink-0 font-mono text-[10px] text-faint" />
              </span>
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
            {commentFolded
              ? <p className="truncate font-sans leading-snug text-fg/90">{firstLine(c.body)}</p>
              : open
                ? <FoldingBody text={c.body} foldable={!(justOpened && newest)} />
                : <p className="line-clamp-2 font-sans leading-snug text-fg/90">{previewText(c.body)}</p>}
            {index===0&&a.image&&<CommentScreenshot image={a.image}/>}
            {newest&&!commentFolded&&open&&<span data-notification-read-point className="block h-px" aria-hidden="true"/>}
          </li>
          );
        })}
      </ul>
      )}
      {!folded && !open && (
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
      {!folded && open && !resolved && (
        <div className="border-t border-edge px-3 py-2">
          <MarkdownField artifactId={artifactId}
            label="Reply to annotation"
            previewLabel="Reply preview"
            previewToggleLabel="Preview reply"
            value={reply}
            onChange={value=>{touched.current=true;setReply(value);}}
            onSubmit={sendReply}
            previewing={replyPreviewing}
            onPreviewingChange={setReplyPreviewing}
            rows={2}
            placeholder="reply…"
          />
          {replyError&&<p role="alert" className="text-xs text-red-500">{replyError}</p>}
          <div className="flex justify-end gap-2">
            <button
              type="button"
              aria-label="Cancel reply"
              onClick={() => { touched.current=true; setReply(''); setReplyPreviewing(false); onOpen(); }}
              className="cursor-pointer rounded-[4px] bg-transparent px-2 py-1 text-muted hover:bg-surface hover:text-fg"
            >
              cancel
            </button>
            <button
              type="button" aria-label="Send reply" disabled={busy || !hasReplyText(reply)}
              onClick={sendReply}
              className="cursor-pointer rounded-[4px] border border-accent bg-accent px-2 py-1 font-semibold text-bg hover:brightness-110 disabled:cursor-default disabled:opacity-40"
            >
              reply
            </button>
          </div>
        </div>
      )}
      {!folded && open && resolved && (
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
  id, editId, frameRef, runtimeRef, sessionNonce, railOpen, liveAnnotations, showViewComments,
  onRailOpenChange, initialSelection = null, topOffset, onAnnotationsChange, pickOnOpen = true, rightInset = 0,
  railHost, railSheet = false, panelWidth,
}: AnnotationLayerProps) {
  /** Every request the comments make (lib/artifact-backend), from the page's provider. */
  const backend = useArtifactBackend();
  /** Screenshots are stored by the backend; without that a comment carries none, and says why. */
  const imagesUnavailable = backend.unavailable('commentImages');
  const capture=useCommentCapture(backend,id,editId);
  const screenshotExport=useRef<(()=>Promise<ScreenshotDrawing>)|null>(null);
  const captureRef=useRef(capture);captureRef.current=capture;
  const startPickRef=useRef<()=>void>(()=>{});
  const mutationRef=useRef({signature:'',key:''});
  const [annotations, setAnnotations] = useState<AnnotationWire[]>([]);
  // The page's own count (the badge on the comment glyph) follows THIS list:
  // a thread resolved or opened here is reflected at once, not when the live
  // stream next says so — which in edit mode, with the stream off, is never.
  useEffect(() => { onAnnotationsChange?.(annotations); }, [annotations, onAnnotationsChange]);
  const [recentResolved,setRecentResolved]=useState<Record<string,{row:AnnotationWire;remaining:number}>>({});
  const previousOpen=useRef(new Set<string>());
  const [resolvedList, setResolvedList] = useState<AnnotationWire[] | null>(null);
  /*
   * ONE OPEN THREAD, open or resolved. A resolved thread somebody expands IS
   * the open thread: that is what makes the document highlight its passage and
   * scroll to it, and what stops two conversations claiming the document at
   * once. Its row is not in `annotations` — never dereference the open id
   * against that list without a fallback.
   */
  const [openId, setOpenId] = useState<string | null>(null);
  /*
   * WHAT THIS VIEWER FOLDED. Held here rather than in each Thread so a remount
   * of the rail — closing it, a live frame replacing the list — cannot lose it,
   * and read from the store on mount so a reload cannot either. It never leaves
   * the browser: no request body, no URL, nothing on the row.
   */
  const [folds, setFolds] = useState<Folds>(() => readFolds(id));
  /** The thread this viewer just asked for; its newest comment is never folded. */
  const [justOpenedId, setJustOpenedId] = useState<string | null>(null);
  const [hoverId, setHoverId] = useState<string | null>(null);
  const uiHoverId = useRef<string | null>(null);
  const hoverUi = (id:string|null) => { uiHoverId.current=id; setHoverId(id); };
  const [missingTargets, setMissingTargets] = useState<Set<string>>(new Set());
  const [anchorRects, setAnchorRects] = useState<Record<string, StoryEditRect>>({});
  const threadsRoot = useRef<HTMLDivElement>(null);
  const [selection, setSelection] = useState<StoryEditSelection | null>(null);
  useForegroundComposer(selection !== null);
  /**
   * Select outlines blocks under the pointer: a tap takes one, while a
   * drag draws an area anchored to the blocks' common ancestor. Its next `mx:selection` is the composer's
   * subject. Page state, never the URL — a fact about what someone is doing
   * right now, like a fold or the theme.
   */
  const [pick, setPick] = useState<'select' | null>(null);
  /** On a phone the rail is a bottom sheet — a 320px rail over a 390px screen
      is the whole document covered, with a strip too narrow to read. */
  const phoneRail = useIsPhoneViewport();
  const [draft, setDraft] = useNewCommentDraft(backend, selection !== null);
  /** Reading the draft as it will be read — a view of the same text, not a mode. */
  const [previewing, setPreviewing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const { confirmAction, confirmation } = useConfirmation();

  const nonceRef = useRef(sessionNonce);
  nonceRef.current = sessionNonce;
  const onRailOpenChangeRef = useRef(onRailOpenChange);
  onRailOpenChangeRef.current = onRailOpenChange;
  // A pin click arrives from a message listener that must not re-subscribe on
  // every list change, so the list it needs is read through a ref.
  const annotationsRef = useRef(annotations);
  annotationsRef.current = annotations;
  const hasRemoteWork=annotations.some(a=>a.remote_work?.length);
  useEffect(()=>{
    if(!hasRemoteWork||busy)return;
    const controller=new AbortController();
    const timer=setInterval(()=>{void backend.listAnnotations(undefined,{signal:controller.signal}).then(list=>{if(!controller.signal.aborted)setAnnotations(list);}).catch(()=>{});},15000);
    return ()=>{clearInterval(timer);controller.abort();};
  },[backend,railOpen,hasRemoteWork,busy]);

  /*
   * A selection report is only ours while a composer is already open — that is
   * the breadcrumb widening its target. Outside that, `mx:selection` is the
   * EDIT session narrating the caret, and following it would open a composer
   * on every click in the document.
   */
  const composingRef = useRef(false);
  composingRef.current = selection !== null;
  // Same shape, same reason: a pick's answer arrives on that listener too.
  const pickingRef = useRef(false);
  pickingRef.current = pick !== null;
  const railOpenRef = useRef(railOpen);
  railOpenRef.current = railOpen;
  /** The rail is about to open FOR A THREAD (a pin, a marker): that opening must not start a pick. */
  const openedForThreadRef = useRef(false);
  /** The sheet is being put away BY a pick (phone): that closing must not end it. */
  const sheetAwayForPickRef = useRef(false);

  const postToFrame = useCallback((message: unknown) => {
    sendDocument({ frameRef, runtimeRef }, message);
  }, [frameRef, runtimeRef]);

  /*
   * OPENING A THREAD UNFOLDS IT. Somebody who clicks a pin, follows a message
   * or has just written a comment came for an answer; handing them a folded
   * conversation would make the fold the thing they have to defeat first. The
   * thread and its newest comment open together, in one write.
   */
  const openThread = useCallback((annId: string) => {
    captureRef.current.reset();
    setPick(null);
    setOpenId(annId);
    setJustOpenedId(annId);
    setSelection(null);
    const thread = annotationsRef.current.find((a) => a.id === annId)?.thread;
    const newest = thread?.at(-1)?.id;
    setFolds(unfold(id, { threads: [annId], comments: newest ? [newest] : [] }));
    // Only an opening carries the mark: a rail already open sees no change,
    // and a stale mark would misread the next real opening.
    if (!railOpenRef.current) openedForThreadRef.current = true;
    onRailOpenChangeRef.current(true);
  }, [id]);

  // Notification links identify a comment; resolve it through the authorized
  // open/resolved indexes so replies open their containing conversation.
  const linkedComment = typeof window === 'undefined' ? null : new URLSearchParams(window.location.search).get('comment')??new URLSearchParams(window.location.search).get('thread');
  const followedLink = useRef(false);
  useEffect(()=>{followedLink.current=false;},[linkedComment,id]);
  useEffect(() => {
    if (!linkedComment || followedLink.current) return;
    const thread = [...annotations, ...(resolvedList ?? [])].find(a =>
      a.id === linkedComment || a.thread.some(c => c.id === linkedComment));
    if (thread) { followedLink.current = true; openThread(thread.id);setFolds(unfold(id,{threads:[thread.id],comments:[linkedComment]})); }
    else if (!railOpenRef.current) {
      openedForThreadRef.current = true;
      onRailOpenChangeRef.current(true);
    }
  }, [linkedComment, annotations, resolvedList, openThread]);

  const toggle = useCallback((kind: FoldKind, foldId: string) => {
    setFolds(toggleFold(id, kind, foldId));
  }, [id]);

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
      const thread = threadsRoot.current?.querySelector(`[data-thread-id="${CSS.escape(openId)}"]`);
      thread?.scrollIntoView?.({ block: 'start', inline: 'nearest' });
      /*
       * …and then the NEWEST comment, which is the answer somebody opened the
       * thread for. A conversation taller than its scroller — a folded long
       * reply on a phone half-sheet still is — shows its top and hides its
       * tail, so the last message lands just under the edge. `nearest` moves
       * nothing when the whole thread already fits, so the common case keeps
       * the top of the conversation exactly where it was.
       */
      const target=linkedComment?thread?.querySelector(`[data-comment-id="${CSS.escape(linkedComment)}"]`):null;
      (target??thread?.querySelector('li:last-child'))?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
    });
    return () => cancelAnimationFrame(raf);
  }, [openId, railOpen]);

  // Folds are per artifact: a different document's rail starts from its own.
  useEffect(() => { setFolds(readFolds(id)); }, [id]);

  // Seed from the session's own read; the live stream replaces it wholesale.
  useEffect(() => {
    let gone = false;const abort=new AbortController();
    void backend.listAnnotations(undefined,{signal:abort.signal})
      .then((list) => { if (!gone) setAnnotations(list); })
      .catch(() => {});
    return () => { gone = true;abort.abort(); };
  }, [backend]);
  useEffect(() => {
    if (liveAnnotations) setAnnotations(liveAnnotations);
  }, [liveAnnotations]);
  // Refresh the authorised resolved index when open threads disappear. Never infer
  // resolution from absence: deletion/revocation must remove the content instead.
  useEffect(() => {
    const before=previousOpen.current;
    previousOpen.current=new Set(annotations.map(a=>a.id));
    const removed=[...before].filter(id=>!previousOpen.current.has(id));
    if(!railOpen&&!removed.length&&!Object.keys(recentResolved).length)return;
    const abort=new AbortController();
    void backend.listAnnotations('resolved',{signal:abort.signal}).then(list=>{
      if(abort.signal.aborted)return;
      list=list.filter(row=>!annotations.some(open=>open.id===row.id));
      setResolvedList(list);
      setRecentResolved(current=>{
        const next:typeof current={};
        for(const row of list){const old=current[row.id];
          if(removed.includes(row.id)||old)next[row.id]={row,remaining:old&&old.row.revision===row.revision?old.remaining:10000};
        }
        return next;
      });
      setOpenId(cur=>cur&&(removed.includes(cur)||recentResolved[cur])&&!list.some(a=>a.id===cur)&&!previousOpen.current.has(cur)?null:cur);
    }).catch(()=>{if(!abort.signal.aborted){setRecentResolved({});setResolvedList(null);setOpenId(null);}});
    return()=>abort.abort();
  }, [backend, railOpen, annotations]);

  /*
   * OPENING THE RAIL OPENS A PICK. Someone who presses "comments" is about to
   * leave one, so the document is ready for the click at once; the tool in
   * the header stays as the explicit way back in. Not for a rail opened FOR A THREAD —
   * a pin click came for an answer — not while a composer is already open
   * (the subject is chosen), not under the editor (`pickOnOpen`), and not on
   * a phone, whose sheet covers the document. Closing the rail ends the pick
   * it opened, unless a pick is what put the sheet away.
   *
   * DECLARED BEFORE the seeded-selection effect below on purpose: a rail that
   * opens in the same commit as a handed-in selection must end with the
   * composer, not the pick, and effects run in declaration order.
   */
  useEffect(() => {
    if (railOpen) {
      const forThread = openedForThreadRef.current;
      openedForThreadRef.current = false;
      if (!editId && !forThread && !composingRef.current && pickOnOpen && !phoneRail) setPick('select');
      return;
    }
    if (sheetAwayForPickRef.current) { sheetAwayForPickRef.current = false; return; }
    setPick(null);
  }, [railOpen, pickOnOpen, phoneRail]);
  useEffect(() => { if (!pickOnOpen) {setPick(null);captureRef.current.reset();} }, [pickOnOpen]);

  // A selection handed down by the page — the view-mode bubble's Comment, or
  // the editor toolbar's — opens the composer on those exact words, so nobody
  // has to click the same text twice.
  useEffect(() => {
    if (!initialSelection) return;
    captureRef.current.reset();
    setSelection(initialSelection);
    setOpenId(null);
    setFailure(null);
    setPick(null);   // the subject was chosen another way
  }, [initialSelection]);

  const retainedPinIds=Object.values(recentResolved).filter(v=>v.remaining>0).map(v=>v.row.id).join(',');
  // The pin set, re-posted whole on every change — the frame holds no
  // annotation state it could get out of step on. Gated on the nonce: its
  // announcement is the signal that the runtime's listener exists.
  useEffect(() => {
    if (!sessionNonce) return;
    /*
     * The ONE resolved thread this viewer expanded rides along with the open
     * roots — in the SAME post as its `openId`, because the frame records the
     * scroll as done the moment an open id arrives and would never repeat it
     * for a pin that landed a message later. Nothing resolved is painted at
     * rest: collapsing the card, or opening another thread, takes it out again.
     */
    const openResolved = openId ? (resolvedList ?? []).find((a) => a.id === openId) ?? recentResolved[openId]?.row ?? null : null;
    const message: StoryAnnotationsMessage = {
      type: STORY_ANNOTATIONS_MESSAGE,
      // Annotations are ambient whenever this capability exists. The frame
      // decides how pins/tints coexist with view and edit mode.
      mode: capture.busy ? 'off' : 'on',
      pins: [...annotations, ...(openResolved ? [openResolved] : []), ...Object.values(recentResolved).filter(v=>v.remaining>0&&v.row.id!==openResolved?.id&&!annotations.some(a=>a.id===v.row.id)).map(v=>v.row)]
        .filter((a) => !a.orphaned && a.anchor)
        // The range travels with the pin so the frame can paint the words
        // themselves; ids, body paths and the words' own positions are still
        // the only annotation data that enters that realm — never the comment.
        .map((a) => {
          const anchor = a.anchor! as typeof a.anchor & { nodeId?: string | null };
          return { id: a.id, path: anchor.path, key: anchor.key, nodeId: anchor.nodeId, range: a.range };
        }),
      openId,
      hoverId,
      selectedPath: selection?.path ?? null,
      selected: selection,
      canComment: true,
      pick,
    };
    postToFrame(message);
  }, [annotations, hoverId, openId, pick, resolvedList, retainedPinIds, selection, sessionNonce, postToFrame, capture.busy]);
  // Closing the rail drops what only the rail was showing; the pins stay.
  useEffect(() => {
    if (!railOpen) setOpenId(null);
  }, [railOpen]);
  useEffect(() => () => {
    sendDocument({ frameRef, runtimeRef }, 
      { type: STORY_ANNOTATIONS_MESSAGE, mode: 'off', pins: [], openId: null, hoverId: null } satisfies StoryAnnotationsMessage,
    );
  }, [frameRef, runtimeRef]);

  // What the document says: pin clicks always; selections only while a pick or
  // a composer is open.
  useEffect(() => {
    const onMessage = (event: { data: unknown }) => {
      const nonce = nonceRef.current;
      if (!nonce || !isEditFrameMessage(event.data, nonce)) return;
      if (event.data.type === STORY_SELECTION_ACTION_MESSAGE && event.data.action === 'select') {
        if (!pickOnOpen) return;
        startPickRef.current();
        return;
      }
      if (event.data.type === STORY_ANNOTATION_LAYOUT_MESSAGE) {
        const next: Record<string, StoryEditRect> = {};
        for (const position of event.data.positions) next[position.id] = position.rect;
        setMissingTargets(new Set(event.data.positions.filter((p) => p.status === 'missing' || p.status === 'ambiguous').map((p) => p.id)));
        setAnchorRects(next);
        return;
      }
      if (event.data.type === STORY_ANNOTATION_PIN_MESSAGE) {
        openThread(event.data.id);
        return;
      }
      if (event.data.type === STORY_ANNOTATION_HOVER_MESSAGE) {
        setHoverId(uiHoverId.current ?? event.data.id);
        return;
      }
      if (event.data.type === STORY_SELECTION_MESSAGE && pickingRef.current) {
        /*
         * THE PICK'S ANSWER, and the pick is over either way. A block: the
         * composer opens on it (a draft already typed stays, exactly as the
         * breadcrumb re-target keeps it). Null: escape in the document —
         * stand down, and leave whatever composer was open alone. Never fall
         * through to the composing branch, which would read a null as "close".
         */
        const picked = event.data.selection;
        setPick(null);
        if (picked) {
          setSelection(picked);
          const origin=runtimeRef?{left:0,top:0}:frameRef?.current?.getBoundingClientRect();
          const rect=picked.captureRect??picked.rect;
          void captureRef.current.capture({...rect,x:rect.x+(origin?.left??0),y:rect.y+(origin?.top??0)});
          setOpenId(null);
          setFailure(null);
        } else captureRef.current.reset();
        return;
      }
      if (event.data.type === STORY_SELECTION_MESSAGE && composingRef.current) {
        const reported = event.data.selection;
        if(captureRef.current.draft || captureRef.current.busy)return;
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
        setSelection((previous) => {
          if (JSON.stringify(previous) === JSON.stringify(reported)) return previous;
          const sameIdentity = reported?.nodeId && previous?.nodeId && reported.nodeId === previous.nodeId;
          if (!sameIdentity || reported?.range) return reported;
          // The words, or the drawn area — whichever this comment is about.
          const merged = {
            ...reported,
            ...(previous.quote ? { quote: previous.quote } : {}),
            ...(previous.range ? { range: previous.range } : {}),
          };
          // Geometry echoes omit refinements on older runtimes. Compare the
          // restored value so an unchanged echo cannot start a replay loop.
          return JSON.stringify(previous) === JSON.stringify(merged) ? previous : merged;
        });
        setFailure(null);
        if (reported) setOpenId(null);
      }
    };
    return subscribeDocument({ frameRef, runtimeRef }, onMessage);
  }, [frameRef, runtimeRef, sessionNonce, openThread, phoneRail, pickOnOpen]);

  const act = useCallback(async (annId: string, body: { reply?: string; resolve?: boolean; reopen?: boolean }) => {
    setBusy(true);
    try {
      const wire = await backend.actOnAnnotation(annId, body);
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
        // It was the open thread while it was resolved history; it stays the
        // open thread now that the list it lives in has changed underneath it.
        setOpenId(annId);
        setJustOpenedId(annId);
      }
      return true;
    } catch {return false;} finally { setBusy(false); }
  }, [backend]);

  const remove = useCallback(async (annId: string) => {
    setBusy(true);
    try {
      await backend.deleteAnnotation(annId);
      setAnnotations((prev) => prev.filter((a) => a.id !== annId));
      setResolvedList((prev) => (prev ? prev.filter((a) => a.id !== annId) : prev));
      setOpenId((cur) => (cur === annId ? null : cur));
    } finally { setBusy(false); }
  }, [backend]);

  const save = useCallback(async () => {
    if (!selection || !hasReplyText(draft) || capture.busy || (capture.required&&!capture.draft)) return;
    if (!selection.nodeId) {
      setFailure('Wait for this change to save before commenting. Your draft is still here.');
      return;
    }
    setBusy(true);
    setFailure(null);
    try {
      if(capture.draft&&!screenshotExport.current)throw new Error('The screenshot is still loading. Please try again.');
      const attachmentId=await capture.stage(capture.draft?await screenshotExport.current!():undefined);
      const signature=JSON.stringify([selection,draft,attachmentId]);
      if(mutationRef.current.signature!==signature)mutationRef.current={signature,key:crypto.randomUUID()};
      let wire: AnnotationWire;
      try {
        wire = await backend.createAnnotation({
          // The exact words ride along when there are any: the frame captured
          // them from the live Range, and the page is the only side that can
          // store them. A caret comment simply carries neither key.
          path: selection.path, node_id: selection.nodeId, body: draft,
          ...(attachmentId?{attachment_id:attachmentId,edit_id:capture.draft!.editId}:{}),
          ...(selection.quote ? { quote: selection.quote } : {}),
          ...(selection.range ? { range: selection.range } : {}),
        }, mutationRef.current.key);
      } catch (error) {
        if (!(error instanceof BackendRequestError)) throw error;
        // A guest may READ a thread and may not start one, and the door says so
        // by name: the login page, and back to this document with the ask — the
        // same move the heart and the fork button make (lib/story/sign-in-required).
        if (error.signInRequired) window.location.assign(loginHref(window.location, 'comment'));
        else setFailure(error.message);
        return;
      }
      capture.reset();
      setAnnotations((prev) => [...prev.filter(item=>item.id!==wire.id), wire]);
      setSelection(null);
      setDraft('');
      setPreviewing(false);
      setOpenId(wire.id);
      setJustOpenedId(wire.id);
      postToFrame({ type: STORY_SELECT_MESSAGE, path: null });
    } catch(error){setFailure(error instanceof Error?error.message:'Could not save the comment. Your draft is still here.');} finally { setBusy(false); }
  }, [backend, selection, draft, postToFrame,capture]);

  const cancelCompose = useCallback(() => {
    captureRef.current.reset();
    setSelection(null);
    setDraft('');
    setPreviewing(false);
    setFailure(null);
    postToFrame({ type: STORY_SELECT_MESSAGE, path: null });
  }, [postToFrame]);

  const submitDraft = useCallback(() => {
    if (busy || !hasReplyText(draft)) return;
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
      // A pick in progress is what escape cancels first; the draft stays.
      if (pickingRef.current) return;
      event.stopPropagation();
      cancelCompose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selection, cancelCompose]);

  // Escape ON THE PAGE stands a pick down; escape in the document arrives as
  // the frame's null selection above. Bound only while picking, like the
  // composer's, so the key keeps its other meanings everywhere else.
  useEffect(() => {
    if (!pick) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.stopPropagation();
      captureRef.current.reset();
      setPick(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [pick]);

  /*
   * THREE INDEPENDENT SURFACES. None of them is a mode, so none of them is an
   * `else` of another: markers float unless the rail is showing the same threads,
   * the composer follows a selection whatever else is open, and the rail is a
   * panel someone asked for.
   */

  /*
   * Starting a pick clears the open thread (the composer is about to move to
   * a new subject). ON A PHONE the rail is a sheet whose backdrop covers the
   * document, so nothing could be tapped until it goes — the pill below is
   * then the only chrome, and carries the way out. On desktop the rail stays;
   * closing it does not cancel a pick for the same reason.
   */
  const beginPick = async (mode: 'select') => {
    if(editId&&!imagesUnavailable){
      const preparation=capture.start(); // Native permission still starts in this gesture.
      void loadScreenshotEditor().catch(()=>{}); // Overlap the lazy chunk with permission/selection.
      if(!await preparation)return;
    }
    setPick(mode);
    setOpenId(null);
    if (phoneRail && railOpenRef.current) {
      sheetAwayForPickRef.current = true;
      onRailOpenChangeRef.current(false);
    }
  };
  startPickRef.current=()=>{void beginPick('select');};
  const endPick = () => {capture.reset();setPick(null);};
  /** The header tool: pressing it while it is active is the way out. */
  const toggleTool = (mode: 'select') => (pick === mode ? endPick() : beginPick(mode));

  // The collapsed 36px identity mark is small enough for phones too; clicking
  // it opens the same rail as a bottom sheet, with no hover dependency.
  const floatingRows=[...annotations,...Object.values(recentResolved).filter(v=>v.remaining>0&&!annotations.some(a=>a.id===v.row.id)).map(v=>v.row)];
  const floating = !railOpen && showViewComments && floatingRows.length > 0;
  const markerRect = documentRect({ frameRef, runtimeRef })
    ?? { top: topOffset, height: window.innerHeight - topOffset };
  const placed = floating ? positionedComments(floatingRows, anchorRects, markerRect, window.innerHeight) : [];

  const visibleResolved=placed.filter(p=>p.top>=0&&p.top+VIEW_COMMENT_COLLAPSED_H<=window.innerHeight).map(p=>p.annotation.id).join(',');
  useEffect(()=>{
    if(!floating||!Object.values(recentResolved).some(v=>v.remaining>0))return;
    let last=performance.now();
    const timer=setInterval(()=>{
      const now=performance.now(),elapsed=Math.min(250,now-last);last=now;
      if(document.visibilityState!=='visible')return;
      const visible=new Set(visibleResolved.split(','));
      setRecentResolved(current=>{
        let changed=false;
        const next=Object.fromEntries(Object.entries(current).map(([key,value])=>{
          if(value.remaining<=0||!visible.has(key)||key===hoverId||key===openId)return [key,value];
          changed=true;return [key,{...value,remaining:Math.max(0,value.remaining-elapsed)}];
        }));return changed?next:current;
      });
    },100);
    return()=>clearInterval(timer);
  },[floating,visibleResolved,hoverId,openId,Object.values(recentResolved).some(v=>v.remaining>0)]);

  // The breadcrumb the edit toolbar taught: nearest ancestors, outermost first.
  const crumbs = selection ? [...selection.ancestors.slice(-2), { path: selection.path, tag: selection.tag, hint: '' }] : [];
  // The frame is full-width under an open rail (the rail overlays its right
  // edge below the bar), so what the composer and the pill may use is the
  // frame LESS the rail — never the frame's own width.
  const railWidth = panelWidth ?? (railOpen && !phoneRail && !railSheet && railHost === undefined ? RIGHT_RAIL_W : 0);
  const measured = documentRect({ frameRef, runtimeRef });
  const frameRect = measured
    ? { left: measured.left, top: measured.top, width: Math.max(0, measured.width - railWidth) }
    : { left: 0, top: topOffset, width: window.innerWidth - railWidth };
  const composerPosition = selection
    ? positionedComposer(selection, frameRect, window.innerWidth, window.innerHeight, capture.required)
    : null;

  return (
    <PersonMentionProvider artifactId={id}>
      {confirmation}
      <style>{`:host-context(.mx-taking-screenshot) [data-capture-chrome],.mx-taking-screenshot [data-capture-chrome]{visibility:hidden!important}`}</style>
      {capture.busy&&!selection&&<div data-capture-chrome role="status" className="fixed bottom-4 left-4 z-50 rounded bg-panel p-3 shadow">Preparing screenshot… <button type="button" onClick={capture.reset}>Cancel capture</button></div>}


      {/* The ambient surface: tiny open-thread identities over the document's
          right edge, at their anchors. Present in view mode AND while editing. */}
      {floating && (
        <div data-capture-chrome aria-label="Open annotation comments" className="pointer-events-none fixed inset-0 z-20">
          {placed.map(({ annotation, top }) => (
            <ThreadPreview
              key={annotation.id}
              a={annotation}
              top={top}
              remaining={recentResolved[annotation.id]?.remaining}
              hovered={hoverId === annotation.id}
              onOpen={() => openThread(annotation.id)}
              onHover={hoverUi}
            />
          ))}
        </div>
      )}

      {/* The pick's only indicator once the rail is away, and the phone's only
          way out of it. Over the document, never in it: the frame is opaque. */}
      {pick && (
        <div
          role="status"
          data-capture-chrome aria-label="Select tool active"
          className={`${cardClass} fixed z-30 flex items-center gap-2 border-edge-bright px-3 py-1.5 font-mono text-[11px] text-muted shadow-xl`}
          style={{ left: frameRect.left + frameRect.width / 2, top: Math.max(topOffset, frameRect.top, phoneRail ? APP_BAR_H : 0) + VIEW_COMMENT_INSET, transform: 'translateX(-50%)' }}
        >
          <SquareDashedMousePointer size={12} strokeWidth={1.8} className="shrink-0 text-accent" />
          <span className="whitespace-nowrap">tap a block or drag an area to comment</span>
          <button
            type="button"
            aria-label="Cancel picking"
            onClick={endPick}
            className="inline-flex h-5 w-5 shrink-0 cursor-pointer items-center justify-center rounded-[3px] text-muted hover:bg-surface hover:text-fg"
          >
            <X size={12} strokeWidth={1.8} />
          </button>
        </div>
      )}

      {/* Drafts belong to the thing being discussed. The saved conversation
          moves to the stable right rail after creation. */}
      {selection && composerPosition && (
        <section
          data-capture-chrome
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
            {capture.busy&&<div role="status" className="mb-3 flex items-center gap-2 rounded-lg border border-edge bg-surface p-4 text-sm text-muted"><LoaderCircle size={16} className="animate-spin"/>Preparing screenshot…</div>}
            {capture.draft&&<ScreenshotEditor image={capture.draft.image} initialStrokes={capture.draft.strokes} exportRef={screenshotExport} busy={busy} onRetake={()=>void beginPick('select')}/>}
            {capture.required&&!capture.draft&&!capture.busy&&<div className="mb-3 space-y-3 rounded-lg border border-edge bg-surface p-3 text-xs"><p role="alert" className="leading-relaxed text-muted">{capture.error||'A screenshot is required for this selection.'}</p><button type="button" className="rounded-lg border border-edge bg-panel px-3 py-2 font-medium hover:border-accent" onClick={()=>void beginPick('select')}>Retry screenshot</button><label className="block space-y-2 font-medium">Upload screenshot<input className="block w-full text-xs text-muted file:mr-2 file:rounded-md file:border-0 file:bg-panel file:px-3 file:py-2 file:text-fg" type="file" accept="image/png,image/jpeg,image/webp" aria-label="Upload screenshot" onChange={event=>{const file=event.target.files?.[0];if(file)void capture.upload(file);event.target.value='';}}/></label><button type="button" className="text-muted underline underline-offset-4 hover:text-fg" onClick={capture.skip}>Continue without screenshot</button></div>}
            {editId&&imagesUnavailable&&<div className="mb-3"><FeatureGate reason={imagesUnavailable}>{(gate)=><button type="button" className="rounded-lg border border-edge bg-panel px-3 py-2 text-xs font-medium disabled:opacity-50" {...gate}>Attach screenshot</button>}</FeatureGate></div>}
            <MarkdownField artifactId={id}
              label="Annotation comment"
              previewLabel="Comment preview"
              previewToggleLabel="Preview comment"
              value={draft}
              onChange={setDraft}
              onSubmit={submitDraft}
              previewing={previewing}
              onPreviewingChange={setPreviewing}
              rows={4}
              autoFocus={!capture.busy}
              placeholder="Add a comment for your agent…"
            >
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
                          disabled={!!capture.draft||capture.busy} onClick={() => postToFrame({ type: STORY_SELECT_MESSAGE, path: crumb.path })}
                          className="cursor-pointer truncate underline decoration-dotted hover:text-accent"
                        >
                          {crumb.tag}
                        </button>
                      </Tooltip>
                    )}
                  </span>
                ))}
              </div>
            </MarkdownField>
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
                type="button" aria-label="Save annotation" disabled={busy || capture.busy || (capture.required&&!capture.draft) || !hasReplyText(draft)}
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
      {railOpen && railHost !== null && (
      <RailChrome
        phone={phoneRail || railSheet}
        host={railHost}
        topOffset={topOffset}
        rightInset={rightInset}
        onClose={() => onRailOpenChange(false)}
        header={
          <div className="flex items-center gap-2 px-1">
            <h2 className="font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-faint">comments</h2>
            <Tooltip content="Select a block or drag an area to comment">
              <button type="button" aria-label="Select" aria-pressed={pick === 'select'}
                onClick={() => toggleTool('select')}
                className={`ml-auto inline-flex h-7 cursor-pointer items-center justify-center gap-1 rounded-[3px] px-1.5 hover:bg-surface hover:text-fg ${pick ? 'bg-accent-soft text-accent' : 'text-muted'}`}>
                <SquareDashedMousePointer size={14} strokeWidth={1.8} />
                <span className="text-xs">Select</span>
              </button>
            </Tooltip>
            <button
              type="button"
              aria-label="Close comments"
              onClick={() => onRailOpenChange(false)}
              className="inline-flex h-6 w-6 cursor-pointer items-center justify-center rounded-[3px] text-muted hover:bg-surface hover:text-fg"
            >
              <X size={14} strokeWidth={1.8} />
            </button>
          </div>
        }
      >
        <div ref={threadsRoot} className="contents">
        {annotations.length === 0 && !selection && (
          <p className="p-2 font-mono text-xs text-muted">no open comments — select text in the document, or pick a block, to leave one</p>
        )}
        {annotations.map((a) => (
          <Thread artifactId={id}
            targetMissing={missingTargets.has(a.id)}
            key={a.id}
            a={a}
            open={openId === a.id}
            hovered={hoverId === a.id}
            busy={busy}
            folded={isFolded(folds, 'threads', a.id)}
            justOpened={justOpenedId === a.id}
            isCommentFolded={(commentId) => isFolded(folds, 'comments', commentId)}
            onOpen={() => openThread(a.id)}
            onHover={hoverUi}
            onReply={(body) => act(a.id, { reply: body })}
            onResolve={() => void act(a.id, { resolve: true })}
            onReopen={() => {}}
            onDelete={() => void confirmAction({ title: 'Delete this comment?', description: 'This comment and its replies will be permanently deleted. This cannot be undone.', action: 'Delete comment', confirmLabel: 'Confirm delete comment', danger: true }, () => remove(a.id))}
            onToggleFold={() => toggle('threads', a.id)}
            onToggleComment={(commentId) => toggle('comments', commentId)}
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
          <Thread artifactId={id}
            targetMissing={missingTargets.has(a.id)}
            key={a.id}
            a={a}
            open={openId === a.id}
            resolved
            hovered={hoverId === a.id}
            busy={busy}
            folded={isFolded(folds, 'threads', a.id)}
            justOpened={justOpenedId === a.id}
            isCommentFolded={(commentId) => isFolded(folds, 'comments', commentId)}
            onOpen={() => {
              // Expanding it makes it the open thread — the document highlights
              // its passage and scrolls there, and the rail brings the row up.
              setJustOpenedId(a.id);
              setOpenId((current) => current === a.id ? null : a.id);
            }}
            onHover={hoverUi}
            onReply={async() => false}
            onResolve={() => {}}
            onReopen={() => void act(a.id, { reopen: true })}
            onDelete={() => void confirmAction({ title: 'Delete this comment?', description: 'This comment and its replies will be permanently deleted. This cannot be undone.', action: 'Delete comment', confirmLabel: 'Confirm delete comment', danger: true }, () => remove(a.id))}
            onToggleFold={() => toggle('threads', a.id)}
            onToggleComment={(commentId) => toggle('comments', commentId)}
          />
        ))}
        {(resolvedList?.length ?? 0) === 0 && (
          <p className="p-2 font-mono text-xs text-muted">nothing resolved yet</p>
        )}
        </div>
      </RailChrome>
      )}
    </PersonMentionProvider>
  );
}

/**
 * The conversation's two homes: the fixed right rail on
 * desktop — the page narrows the document by its width — and a bottom sheet
 * on a phone. The content between them is identical; this wrapper is the only
 * thing that knows the difference.
 */
function RailChrome({ phone, host, topOffset, rightInset, onClose, header, children }: {
  phone: boolean;
  /** The editor's panel, when it hosts the rail: rendered into it, not as a column of its own. */
  host?: HTMLElement;
  topOffset: number;
  rightInset: number;
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
  if (host) {
    return createPortal(
      <section data-capture-chrome aria-label="Annotation sidebar" className="flex min-h-0 flex-1 flex-col gap-2.5 bg-bg p-2.5">
        <div className="shrink-0">{header}</div>
        <div className="flex min-h-0 flex-1 flex-col gap-2.5 overflow-y-auto">{children}</div>
      </section>,
      host,
    );
  }
  return (
    <aside
      data-capture-chrome aria-label="Annotation sidebar"
      className="fixed bottom-0 z-20 flex flex-col gap-2.5 border-l border-edge bg-bg p-2.5"
      style={{ top: topOffset, right: rightInset, width: RIGHT_RAIL_W }}
    >
      <div className="shrink-0">{header}</div>
      <div className="flex min-h-0 flex-1 flex-col gap-2.5 overflow-y-auto">{children}</div>
    </aside>
  );
}
