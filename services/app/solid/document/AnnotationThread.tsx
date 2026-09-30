/* @jsxImportSource solid-js */
/**
 * ONE RAIL THREAD, from components/AnnotationLayer's `Thread` in SOLID.
 *
 * Closed, a thread is its root comment clamped to two lines and a continuation cue; open, it is the
 * whole conversation, a reply box, and its actions. Three folds keep a long answer from pushing a
 * short one off the rail — a body over ten laid-out lines clamps itself, the author line folds one
 * comment, the chevron folds the conversation — all per viewer (lib/comment-folds). A resolved card
 * is muted until hovered or focused, and says what it was about when the document no longer can.
 */
import { createEffect, createSignal, For, onCleanup, Show, type JSX } from 'solid-js';
import Check from 'lucide-solid/icons/check';
import ChevronDown from 'lucide-solid/icons/chevron-down';
import ChevronRight from 'lucide-solid/icons/chevron-right';
import EllipsisVertical from 'lucide-solid/icons/ellipsis-vertical';
import Trash2 from 'lucide-solid/icons/trash-2';
import type { AnnotationWire } from '@/lib/annotations';
import type { ArtifactBackend } from '@/lib/artifact-backend/types';
import { hasReplyText, remoteWorkLabel, replyMentionPrefix } from '@/lib/remote-reply';
import { REMOTE_COLOR_CSS } from '../../../contracts/src/remote';
import { Tooltip } from '../components/Tooltip';
import { useOptionalInbox } from '../lib/notifications';
import { useSession } from '../lib/session';
import { AuthorIdentity, CommentTimestamp, firstLine, previewText, ThreadContinuation } from './AnnotationPreview';
import { CommentFoldingBody } from './CommentFoldingBody';
import { CommentMarkdownField } from './CommentMarkdown';
import { CommentScreenshot } from './CommentScreenshot';

const threadClass = 'rounded-[6px] border border-edge bg-comment text-sm';
const buttonClass = 'cursor-pointer rounded-[4px] border border-edge bg-raised px-2 py-1 text-muted hover:text-accent';

/** ONE fold affordance for a thread, wherever the card is putting it. */
function ThreadFoldControl(props: { folded: boolean; onToggle: () => void }): JSX.Element {
  return <button type="button" aria-label={props.folded ? 'Expand thread' : 'Collapse thread'} aria-expanded={!props.folded} onClick={() => props.onToggle()}
    class="-ml-1 inline-flex h-5 w-5 shrink-0 cursor-pointer items-center justify-center rounded-[3px] text-faint hover:bg-raised hover:text-fg">
    <Show when={props.folded} fallback={<ChevronDown size={13} strokeWidth={1.8} />}><ChevronRight size={13} strokeWidth={1.8} /></Show>
  </button>;
}

export interface AnnotationThreadProps {
  artifactId: string;
  backend: ArtifactBackend;
  a: AnnotationWire;
  open: boolean;
  resolved?: boolean;
  targetMissing?: boolean;
  hovered: boolean;
  busy: boolean;
  /** This viewer folded the whole conversation away. */
  folded: boolean;
  /** This viewer just asked for this thread, so its NEWEST comment is shown whole however long. */
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
}

export function AnnotationThread(props: AnnotationThreadProps): JSX.Element {
  let threadElement: HTMLDivElement | undefined;
  let menuRoot: HTMLDivElement | undefined;
  const inbox = useOptionalInbox();
  const { session } = useSession();
  const newestFolded = () => props.isCommentFolded(props.a.thread.at(-1)?.id ?? '');
  // Reading the newest comment of an open thread marks the thread's notifications read.
  createEffect(() => {
    const userId = session()?.user?.id;
    if (!props.open || props.folded || newestFolded() || !userId || !inbox || !threadElement || typeof IntersectionObserver === 'undefined') return;
    const id = props.a.id, revision = props.a.revision ?? 1;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting) && document.visibilityState === 'visible') {
        void inbox.load({ read: `thread:${id}:${userId}`, revision });
        observer.disconnect();
      }
    }, { threshold: 0.1 });
    queueMicrotask(() => { const latest = threadElement?.querySelector('[data-notification-read-point]'); if (latest) observer.observe(latest); });
    onCleanup(() => observer.disconnect());
  });

  const prefix = () => replyMentionPrefix(props.a.thread);
  const [reply, setReply] = createSignal(prefix());
  let touched = false;
  let sending = false;
  const [replyError, setReplyError] = createSignal('');
  createEffect(() => { const next = prefix(); if (!touched) setReply(next); });
  const [replyPreviewing, setReplyPreviewing] = createSignal(false);
  const [menuOpen, setMenuOpen] = createSignal(false);
  const visibleComments = () => props.open ? props.a.thread : props.a.thread.slice(0, 1);
  const first = () => props.a.thread[0];
  const replyCount = () => Math.max(0, props.a.thread.length - 1);

  // ONE send for the button and for ⌘↵ — the field owns the key, the thread owns whether there is anything to send.
  const sendReply = async () => {
    if (props.busy || sending || !hasReplyText(reply())) return;
    sending = true; setReplyError('');
    try {
      if (!await props.onReply(reply())) throw new Error('Could not send reply. Your draft is saved here.');
      touched = false; setReply(prefix()); setReplyPreviewing(false);
    } catch { setReplyError('Could not send reply. Your draft is saved here.'); }
    finally { sending = false; }
  };

  createEffect(() => {
    if (!menuOpen()) return;
    const dismiss = (event: PointerEvent) => { if (!menuRoot || !event.composedPath().includes(menuRoot)) setMenuOpen(false); };
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') setMenuOpen(false); };
    document.addEventListener('pointerdown', dismiss);
    document.addEventListener('keydown', escape);
    onCleanup(() => { document.removeEventListener('pointerdown', dismiss); document.removeEventListener('keydown', escape); });
  });

  const agents = () => (props.a.remote_work ?? []).filter((work, index, all) => !all.slice(index + 1).some((next) => next.sessionId === work.sessionId));

  return <div ref={threadElement}
    aria-label={props.resolved ? 'Resolved annotation thread' : 'Annotation thread'}
    data-thread-id={props.a.id}
    data-hovered={props.hovered ? 'true' : undefined}
    onMouseEnter={() => props.onHover(props.a.id)}
    onMouseLeave={() => props.onHover(null)}
    onClick={(event) => {
      const target = event.target as Element;
      // `[role="button"]`: the author line is a toggle, and collapsing a comment in a closed thread must not open it.
      if (!props.open && !props.folded && !target.closest('a, button, textarea, input, [role="button"]')) props.onOpen();
    }}
    class={`${threadClass} shrink-0 overflow-hidden transition-[border-color,background-color,opacity] duration-150 ${props.open || props.folded ? '' : 'cursor-pointer'} ${props.open || props.hovered ? 'border-edge-bright bg-comment-hover' : ''} ${props.resolved ? 'opacity-55 hover:opacity-100 focus-within:opacity-100' : ''}`}>
    {/* Folded, the card IS its summary: what it is about, how it opens, and how much is underneath. */}
    <Show when={props.folded}>
      <div class="px-3 py-2">
        <div class="flex min-w-0 items-center gap-1.5">
          <ThreadFoldControl folded onToggle={props.onToggleFold} />
          <span class="truncate font-mono text-[10px] text-faint">{props.a.snippet || 'this document'}</span>
        </div>
        <Show when={first()}>{(comment) => <>
          <p class="mt-1 truncate font-sans leading-snug text-fg/90">{firstLine(comment().body)}</p>
          <p class="mt-1 font-mono text-[10px] text-faint">{replyCount() === 1 ? '1 reply' : `${replyCount()} replies`}</p>
        </>}</Show>
      </div>
    </Show>
    <Show when={!props.folded}>
      <For each={agents()}>{(work) => (
        <p role="status" class="flex items-center gap-1.5 border-b border-edge px-3 py-1.5 text-[11px] text-muted">
          <a href={`/chat?session=${work.sessionId}`} target="_blank" rel="noopener noreferrer" style={{ color: REMOTE_COLOR_CSS[work.color] }}>@{work.name}</a>
          <span>{remoteWorkLabel(work)}</span>
        </p>
      )}</For>
      <Show when={props.targetMissing && !props.a.orphaned}>
        <p class="border-b border-edge bg-surface/60 px-3 py-1.5 font-mono text-[10px] text-faint">Exact target is unavailable. This comment remains attached to its containing block.</p>
      </Show>
      {/* What this was about, when the document cannot say it: the node is gone, or its quoted words were edited away. */}
      <Show when={props.a.orphaned}>
        <div class="border-b border-edge bg-surface/60 px-3 py-1.5">
          <Show when={props.open && (props.a.quote ?? props.a.snippet)}>
            <p class="mb-1 border-l-2 border-edge-bright pl-2 font-sans text-[12px] leading-snug text-fg/80">{props.a.quote ?? props.a.snippet}</p>
          </Show>
          <p class="font-mono text-[10px] text-faint">This passage was removed from the document.</p>
        </div>
      </Show>
      <Show when={props.open && !props.a.orphaned && props.a.quote_found === false && props.a.quote}>
        <div class="border-b border-edge bg-surface/60 px-3 py-1.5">
          <p class="mb-1 border-l-2 border-edge-bright pl-2 font-sans text-[12px] leading-snug text-fg/80">{props.a.quote}</p>
          <p class="font-mono text-[10px] text-faint">These words have since been edited.</p>
        </div>
      </Show>
      <ul class="flex flex-col gap-3 px-3 py-3">
        {/* Keyed by comment id, as React keyed it: a live frame replaces every row object, and must not remount a comment someone is reading. */}
        <For each={visibleComments().map((comment) => comment.id)}>{(commentId, index) => {
          const c = () => visibleComments().find((comment) => comment.id === commentId) ?? props.a.thread[0]!;
          const commentFolded = () => props.open && props.isCommentFolded(c().id);
          // ONE exemption to the auto-fold: the newest comment of a thread this viewer just asked to see.
          const newest = () => index() === visibleComments().length - 1;
          // `scroll-mb-14` is what the open-scroll aims at: on a phone the page's action bar floats over the sheet's bottom.
          return <li data-comment-id={c().id} class="scroll-mb-14 sm:scroll-mb-0">
            <div class="mb-1.5 flex min-w-0 items-center gap-2">
              <Show when={index() === 0}><ThreadFoldControl folded={false} onToggle={props.onToggleFold} /></Show>
              {/* The author line is the comment's own toggle where there is a body to fold (an open thread). */}
              <span role={props.open ? 'button' : undefined} tabIndex={props.open ? 0 : undefined}
                aria-label={props.open ? (commentFolded() ? 'Expand comment' : 'Collapse comment') : undefined}
                aria-expanded={props.open ? !commentFolded() : undefined}
                onClick={(event) => {
                  if (!props.open) return;
                  if ((event.target as Element).closest('a, button')) return;
                  props.onToggleComment(c().id);
                }}
                onKeyDown={(event) => {
                  if (!props.open || (event.key !== 'Enter' && event.key !== ' ')) return;
                  event.preventDefault();
                  props.onToggleComment(c().id);
                }}
                class={`flex min-w-0 flex-1 items-center gap-2 rounded-[3px] ${props.open ? 'cursor-pointer' : ''}`}>
                <AuthorIdentity author={c().author} />
                <CommentTimestamp iso={c().created_at} class="ml-auto shrink-0 font-mono text-[10px] text-faint" />
              </span>
              <Show when={index() === 0 && props.resolved}>
                <Tooltip content="resolved">
                  <span class="inline-flex h-5 w-5 items-center justify-center text-accent"><Check size={13} strokeWidth={2} /></span>
                </Tooltip>
              </Show>
              <Show when={index() === 0 && !props.resolved}>
                <Tooltip content="resolve thread">
                  <button type="button" aria-label="Resolve annotation" disabled={props.busy} onClick={() => props.onResolve()}
                    class="inline-flex h-5 w-5 cursor-pointer items-center justify-center rounded-[3px] text-muted hover:bg-accent-soft hover:text-accent disabled:cursor-default disabled:opacity-40">
                    <Check size={13} strokeWidth={2} />
                  </button>
                </Tooltip>
              </Show>
              <Show when={index() === 0 && props.resolved && props.open}>
                <button type="button" aria-label="Hide resolved conversation" aria-expanded="true" onClick={() => props.onOpen()}
                  class="cursor-pointer rounded-[3px] px-1 font-mono text-[11px] text-faint hover:bg-raised hover:text-accent">↑</button>
              </Show>
              <Show when={index() === 0 && (!props.resolved || props.open)}>
                <div ref={menuRoot} class="relative">
                  <Tooltip content="thread actions">
                    <button type="button" aria-label="Annotation actions" aria-expanded={menuOpen()} onClick={() => setMenuOpen((current) => !current)}
                      class="inline-flex h-5 w-5 cursor-pointer items-center justify-center rounded-[3px] text-faint hover:bg-raised hover:text-fg">
                      <EllipsisVertical size={13} strokeWidth={1.8} />
                    </button>
                  </Tooltip>
                  <Show when={menuOpen()}>
                    <div role="menu" aria-label="Annotation action menu" class="absolute right-0 top-6 z-20 min-w-24 rounded-[5px] border border-edge-bright bg-surface p-1 shadow-lg">
                      <button type="button" role="menuitem" aria-label="Delete annotation" disabled={props.busy} onClick={() => { setMenuOpen(false); props.onDelete(); }}
                        class="flex w-full cursor-pointer items-center gap-2 rounded-[3px] px-2 py-1.5 text-left font-mono text-[11px] text-danger hover:bg-raised disabled:cursor-default disabled:opacity-40">
                        <Trash2 size={12} strokeWidth={1.75} />
                        delete
                      </button>
                    </div>
                  </Show>
                </div>
              </Show>
            </div>
            <Show when={commentFolded()} fallback={
              <Show when={props.open} fallback={<p class="line-clamp-2 font-sans leading-snug text-fg/90">{previewText(c().body)}</p>}>
                <CommentFoldingBody text={c().body} foldable={!(props.justOpened && newest())} />
              </Show>
            }>
              <p class="truncate font-sans leading-snug text-fg/90">{firstLine(c().body)}</p>
            </Show>
            <Show when={index() === 0 && props.a.image}>{(image) => <CommentScreenshot image={image()} />}</Show>
            <Show when={newest() && !commentFolded() && props.open}><span data-notification-read-point class="block h-px" aria-hidden="true" /></Show>
          </li>;
        }}</For>
      </ul>
      <Show when={!props.open}>
        <button type="button" aria-label={props.resolved ? 'Show resolved conversation' : 'Open annotation thread'} aria-expanded={props.resolved ? false : undefined}
          onClick={() => props.onOpen()} onFocus={() => props.onHover(props.a.id)} onBlur={() => props.onHover(null)}
          class="flex w-full cursor-pointer items-center justify-between gap-2 border-t border-edge px-3 py-1.5 font-mono text-[10px] text-faint transition-colors hover:bg-raised hover:text-accent">
          <ThreadContinuation thread={props.a.thread} />
          <span class="shrink-0">open →</span>
        </button>
      </Show>
      <Show when={props.open && !props.resolved}>
        <div class="border-t border-edge px-3 py-2">
          <CommentMarkdownField backend={props.backend} artifactId={props.artifactId}
            label="Reply to annotation" previewLabel="Reply preview" previewToggleLabel="Preview reply"
            value={reply()} onChange={(value) => { touched = true; setReply(value); }} onSubmit={() => void sendReply()}
            previewing={replyPreviewing()} onPreviewingChange={setReplyPreviewing} rows={2} placeholder="reply…" />
          <Show when={replyError()}><p role="alert" class="text-xs text-red-500">{replyError()}</p></Show>
          <div class="flex justify-end gap-2">
            <button type="button" aria-label="Cancel reply" onClick={() => { touched = true; setReply(''); setReplyPreviewing(false); props.onOpen(); }}
              class="cursor-pointer rounded-[4px] bg-transparent px-2 py-1 text-muted hover:bg-surface hover:text-fg">cancel</button>
            <button type="button" aria-label="Send reply" disabled={props.busy || !hasReplyText(reply())} onClick={() => void sendReply()}
              class="cursor-pointer rounded-[4px] border border-accent bg-accent px-2 py-1 font-semibold text-bg hover:brightness-110 disabled:cursor-default disabled:opacity-40">reply</button>
          </div>
        </div>
      </Show>
      <Show when={props.open && props.resolved}>
        <div class="flex justify-end border-t border-edge px-3 py-2">
          <button type="button" aria-label="Reopen annotation" disabled={props.busy} onClick={() => props.onReopen()} class={buttonClass}>↺ reopen</button>
        </div>
      </Show>
    </Show>
  </div>;
}
