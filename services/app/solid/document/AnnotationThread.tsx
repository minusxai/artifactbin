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
import { createEffect, createSignal, ErrorBoundary, For, lazy, on, onCleanup, Show, Suspense, type JSX } from 'solid-js';
import Check from 'lucide-solid/icons/check';
import ChevronDown from 'lucide-solid/icons/chevron-down';
import ChevronRight from 'lucide-solid/icons/chevron-right';
import EllipsisVertical from 'lucide-solid/icons/ellipsis-vertical';
import Pencil from 'lucide-solid/icons/pencil';
import Trash2 from 'lucide-solid/icons/trash-2';
import type { AnnotationWire } from '@/lib/annotations/store';
import type { AnnotationCommentWire } from '@artifactbin/contracts';
import type { ArtifactBackend } from '@/lib/artifact-backend/types';
import { hasReplyText, remoteWorkLabel, remoteWorkActive } from '@/lib/annotations/remote-reply';
import { BackendRequestError } from '@/lib/artifact-backend/errors';
import { agentNameColor } from '../lib/agent-identity';
import { Button } from '../ui/Button';
import { Tooltip } from '../ui/Tooltip';
import { useOptionalInbox } from '../lib/notifications';
import { useSession } from '../lib/session';
import { AuthorIdentity, CommentEdited, CommentTimestamp, firstLine, previewText, ThreadContinuation } from './AnnotationPreview';
import { AnnotationReplyBox } from './AnnotationReplyBox';
import { CommentFoldingBody } from './CommentFoldingBody';
import { CommentSubmitHint } from './CommentMarkdown';
import { CommentMarkdownField } from './LazyCommentField';
import { persistedText, readDraft, writeDraft } from '../lib/draft-store';
import { isChunkLoadError, reloadForNewBuild } from '../lib/app-build';
import { CommentScreenshot } from './CommentScreenshot';
import { createCommentImageDraft, type CommentImageAttachment } from './CommentImageAttach';

/**
 * The delete menu is a lazy chunk (an intentional exception to top-level imports): it matters only once a thread is on
 * screen, so the reader page, which statically imports this layer, does not carry ui/Menu. Its trigger renders at once
 * as the plain fallback below, and the real Menu replaces it as the chunk lands (it starts loading with the first thread).
 */
const Menu = lazy(() => import('../ui/Menu').then((module) => ({ default: module.Menu })));
export const preloadThreadMenu = (): Promise<unknown> => Menu.preload();

const threadClass = 'rounded-panel border border-edge bg-comment text-sm';
const EDIT_FAILED = 'Could not save your edit. It is still here; try again.';

/** ONE fold affordance for a thread, wherever the card is putting it. */
function ThreadFoldControl(props: { folded: boolean; onToggle: () => void }): JSX.Element {
  return <Button type="button" variant="ghost" size="sm" icon aria-label={props.folded ? 'Expand thread' : 'Collapse thread'} aria-expanded={!props.folded} onClick={() => props.onToggle()}
    class="-ml-1">
    <Show when={props.folded} fallback={<ChevronDown size={13} strokeWidth={1.8} />}><ChevronRight size={13} strokeWidth={1.8} /></Show>
  </Button>;
}

interface AnnotationThreadProps {
  canCreateComment?: boolean;
  artifactId: string;
  backend: ArtifactBackend;
  a: AnnotationWire;
  /** The document owner may remove any comment; authorship for other viewers is checked below. */
  canDeleteAny?: boolean;
  open: boolean;
  resolved?: boolean;
  targetMissing?: boolean;
  viewStateError?: string;
  hovered: boolean;
  busy: boolean;
  /** This viewer folded the whole conversation away. */
  folded: boolean;
  /** This viewer just asked for this thread, so its NEWEST comment is shown whole however long. */
  justOpened: boolean;
  isCommentFolded: (commentId: string) => boolean;
  onOpen: () => void;
  onHover: (id: string | null) => void;
  /** A reply, with the image staged for it when it has one. */
  onReply: (body: string, attachment?: CommentImageAttachment) => Promise<boolean>;
  onResolve: () => void;
  onReopen: () => void;
  onDelete: (commentId: string) => void;
  /** Rewrite one comment's words; rejects with the backend's refusal, and the editor keeps the draft. Absent: no editing here. */
  onEdit?: (commentId: string, body: string) => Promise<void>;
  onToggleFold: () => void;
  onToggleComment: (commentId: string) => void;
  /** Whether this thread's reply box holds words; false again once they are sent, cleared or the thread is gone. */
  onReplyDraftChange?: (typed: boolean) => void;
}

export function AnnotationThread(props: AnnotationThreadProps): JSX.Element {
  let threadElement: HTMLDivElement | undefined;
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

  // The reply draft — words and image — belongs to the thread, so folding the thread away keeps it.
  // Kept for this tab too (solid/lib/draft-store): a reload — the page loading a new build — gives it back.
  const [reply, setReply] = persistedText(`${props.artifactId}:thread-reply:${props.a.id}`);
  const replyImage = createCommentImageDraft();
  createEffect(on(() => hasReplyText(reply()), (typed) => props.onReplyDraftChange?.(typed)));
  onCleanup(() => props.onReplyDraftChange?.(false));
  const visibleComments = () => props.open ? props.a.thread : props.a.thread.slice(0, 1);
  const first = () => props.a.thread[0];
  const replyCount = () => Math.max(0, props.a.thread.length - 1);
  const canDelete = (comment: AnnotationCommentWire) => {
    const userId = session()?.user?.id;
    return props.canCreateComment !== false && (props.canDeleteAny === true
      || (userId !== undefined && userId !== null && comment.author.user_id === userId)
      || props.backend.canDeleteLocalAnnotation?.(comment.id) === true);
  };

  /** Only the words' author may rewrite them: their account online, or the backend's word for a local comment. */
  const canEdit = (comment: AnnotationCommentWire) => {
    if (props.canCreateComment === false || !props.onEdit) return false;
    const userId = session()?.user?.id;
    return (userId !== undefined && userId !== null && comment.author.user_id === userId)
      || props.backend.canEditLocalComment?.(comment) === true;
  };
  // ONE comment of this thread is edited at a time, in place of its body; the draft survives a refused save.
  // The comment being rewritten and its words, kept for this tab: a reload reopens the edit where it was.
  const editKey = `${props.artifactId}:edit:${props.a.id}`;
  const kept = (() => { try { return JSON.parse(readDraft(editKey) || 'null') as { comment?: unknown; body?: unknown } | null; } catch { return null; } })();
  const [editing, setEditing] = createSignal<string | null>(typeof kept?.comment === 'string' && typeof kept.body === 'string' ? kept.comment : null);
  const [editDraft, setEditDraft] = createSignal(editing() ? String(kept?.body) : '');
  createEffect(() => { const comment = editing(); writeDraft(editKey, comment ? JSON.stringify({ comment, body: editDraft() }) : ''); });
  const [editError, setEditError] = createSignal('');
  const [saving, setSaving] = createSignal(false);
  const startEdit = (comment: AnnotationCommentWire) => {
    setEditDraft(comment.body); setEditError(''); setEditing(comment.id);
    if (!props.open) props.onOpen();
  };
  const cancelEdit = () => { if (saving()) return; setEditing(null); setEditDraft(''); setEditError(''); };
  const saveEdit = async (comment: AnnotationCommentWire) => {
    const body = editDraft();
    if (saving() || !props.onEdit || !hasReplyText(body)) return;
    if (body === comment.body) { cancelEdit(); return; }
    setSaving(true); setEditError('');
    try { await props.onEdit(comment.id, body); setEditing(null); setEditDraft(''); }
    catch (cause) { setEditError(cause instanceof BackendRequestError && cause.code === 'annotation_conflict' ? cause.message : EDIT_FAILED); }
    finally { setSaving(false); }
  };

  const agents = () => (props.a.remote_work ?? []).filter((work, index, all) => !all.slice(index + 1).some((next) => next.sessionId === work.sessionId));

  return <div ref={threadElement}
    aria-label={props.resolved ? 'Resolved annotation thread' : 'Annotation thread'}
    data-thread-id={props.a.id}
    data-hovered={props.hovered ? 'true' : undefined}
    onMouseEnter={() => props.onHover(props.a.id)}
    onMouseLeave={(event) => { if (!event.currentTarget.matches(':focus-within')) props.onHover(null); }}
    onFocusIn={() => props.onHover(props.a.id)}
    onFocusOut={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null) && !event.currentTarget.matches(':hover')) props.onHover(null); }}
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
          <span class="truncate font-mono text-micro text-faint">{props.a.snippet || 'this document'}</span>
        </div>
        <Show when={first()}>{(comment) => <>
          <p class="mt-1 truncate font-sans leading-snug text-fg/90">{firstLine(comment().body)}</p>
          <p class="mt-1 font-mono text-micro text-faint">{replyCount() === 1 ? '1 reply' : `${replyCount()} replies`}</p>
        </>}</Show>
      </div>
    </Show>
    <Show when={!props.folded}>
      <For each={agents()}>{(work) => (
        <p role="status" class="comment-agent-status border-b border-edge px-3 py-1.5 text-2xs text-muted">
          <a class="comment-agent-status-name" href={`/chat?session=${work.sessionId}`} target="_blank" rel="noopener noreferrer" style={{ color: agentNameColor(work.name) }}>@{work.name}</a>
          <Show when={remoteWorkActive(work)}><span class="comment-agent-spinner" aria-hidden="true" /></Show>
          <Tooltip content={remoteWorkLabel(work)}><span class="comment-agent-status-label" tabIndex={0}>{work.phase === 'delivered' && remoteWorkActive(work) ? 'Awaiting acknowledgment' : remoteWorkLabel(work)}</span></Tooltip>
        </p>
      )}</For>
      <Show when={props.a.view_state}>
        <div class="flex items-center justify-between gap-2 border-b border-edge px-3 py-1.5 text-2xs text-muted">
          <span role="status">{props.open && props.viewStateError ? props.viewStateError : 'Saved view attached'}</span>
          <Button type="button" variant="link" class="shrink-0" onClick={props.onOpen}>Restore saved view</Button>
        </div>
      </Show>
      <Show when={props.targetMissing && !props.a.orphaned}>
        <p class="border-b border-edge bg-surface/60 px-3 py-1.5 font-mono text-micro text-faint">Exact target is unavailable. This comment remains attached to its containing block.</p>
      </Show>
      {/* What this was about, when the document cannot say it: the node is gone, or its quoted words were edited away. */}
      <Show when={props.a.orphaned}>
        <div class="border-b border-edge bg-surface/60 px-3 py-1.5">
          <Show when={props.open && (props.a.quote ?? props.a.snippet)}>
            <p class="mb-1 border-l-2 border-edge-bright pl-2 font-sans text-xs leading-snug text-fg/80">{props.a.quote ?? props.a.snippet}</p>
          </Show>
          <p class="font-mono text-micro text-faint">This passage was removed from the document.</p>
        </div>
      </Show>
      <Show when={props.open && !props.a.orphaned && props.a.quote_found === false && props.a.quote}>
        <div class="border-b border-edge bg-surface/60 px-3 py-1.5">
          <p class="mb-1 border-l-2 border-edge-bright pl-2 font-sans text-xs leading-snug text-fg/80">{props.a.quote}</p>
          <p class="font-mono text-micro text-faint">These words have since been edited.</p>
        </div>
      </Show>
      <ul class="flex flex-col gap-3 px-3 py-3">
        {/* Keyed by comment id: a live frame replaces every row object, and must not remount a comment someone is reading. */}
        <For each={visibleComments().map((comment) => comment.id)}>{(commentId, index) => {
          const c = () => visibleComments().find((comment) => comment.id === commentId) ?? props.a.thread[0]!;
          const commentFolded = () => props.open && props.isCommentFolded(c().id);
          // ONE exemption to the auto-fold: the newest comment of a thread this viewer just asked to see.
          const newest = () => index() === visibleComments().length - 1;
          // `scroll-mb-14` is what the open-scroll aims at: on a phone the page's action bar floats over the sheet's bottom.
          return <li data-comment-id={c().id} class="scroll-mb-14 sm:scroll-mb-0">
            <div class="mb-1.5 flex min-w-0 items-center gap-2">
              {/* The author line is the comment's own toggle where there is a body to fold (an open thread). A span, not a ui/Button: it holds links, which a button cannot nest. */}
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
                class={`flex min-w-0 flex-1 items-center gap-2 rounded-chip ${props.open ? 'cursor-pointer' : ''}`}>
                <AuthorIdentity author={c().author} />
                <CommentTimestamp iso={c().created_at} class="ml-auto shrink-0 font-mono text-micro text-faint" />
              </span>
              <Show when={index() === 0}><ThreadFoldControl folded={false} onToggle={props.onToggleFold} /></Show>
              <Show when={index() === 0 && props.resolved}>
                <Tooltip content="resolved">
                  <span class="inline-flex h-5 w-5 items-center justify-center text-accent"><Check size={13} strokeWidth={2} /></span>
                </Tooltip>
              </Show>
              <Show when={index() === 0 && !props.resolved && props.canCreateComment !== false}>
                <Tooltip content="resolve thread">
                  <Button type="button" variant="ghost" size="sm" icon aria-label="Resolve annotation" disabled={props.busy} onClick={() => props.onResolve()} class="-mx-1">
                    <Check size={13} strokeWidth={2} />
                  </Button>
                </Tooltip>
              </Show>
              <Show when={index() === 0 && props.resolved && props.open}>
                <Button type="button" variant="ghost" size="sm" icon aria-label="Hide resolved conversation" aria-expanded="true" onClick={() => props.onOpen()}>↑</Button>
              </Show>
              <Show when={(canDelete(c()) || canEdit(c())) && (index() > 0 || !props.resolved || props.open)}>
                {(() => {
                  const trigger = (attrs?: object) => (
                    <Tooltip content={index() === 0 ? 'thread actions' : 'comment actions'}>
                      <Button aria-haspopup="menu" aria-expanded={false} {...attrs} type="button" variant="ghost" size="sm" icon aria-label={index() === 0 ? 'Annotation actions' : `Comment actions ${index()}`} class="-mr-1">
                        <EllipsisVertical size={13} strokeWidth={1.8} />
                      </Button>
                    </Tooltip>
                  );
                  // A chunk that cannot be fetched (the local preview restarted while it loaded, a dropped connection) leaves the
                  // trigger standing, unavailable until the page loads again, instead of an uncaught error. One a deploy removed
                  // loads the new build (solid/lib/app-build; the thread's drafts are kept).
                  return <ErrorBoundary fallback={(error) => { if (isChunkLoadError(error)) reloadForNewBuild(); return trigger({ disabled: true }); }}><Suspense fallback={trigger()}>
                    <Menu label={index() === 0 ? 'Annotation action menu' : 'Comment action menu'}
                      items={[
                        ...(canEdit(c()) ? [{ label: 'Edit comment', text: 'edit', icon: () => <Pencil size={12} strokeWidth={1.75} />, disabled: props.busy || saving(), onSelect: () => startEdit(c()) }] : []),
                        ...(canDelete(c()) ? [{ label: index() === 0 ? 'Delete thread' : 'Delete comment', text: index() === 0 ? 'delete thread' : 'delete comment', icon: () => <Trash2 size={12} strokeWidth={1.75} />, danger: true, disabled: props.busy, onSelect: () => props.onDelete(c().id) }] : []),
                      ]}
                      trigger={(attrs) => trigger(attrs)} />
                  </Suspense></ErrorBoundary>;
                })()}
              </Show>
            </div>
            <Show when={editing() !== c().id} fallback={
              // Escape cancels, from anywhere in the editor (a native listener: the rail may sit in a shadow root). The
              // editor's own keymap claims Escape (select parent node), so its defaultPrevented says nothing here; an
              // open mention picker stops the key before it bubbles this far.
              <div data-comment-editor on:keydown={(event) => { if (event.key !== 'Escape') return; event.preventDefault(); event.stopPropagation(); cancelEdit(); }}>
                <CommentMarkdownField backend={props.backend} artifactId={props.artifactId} label="Edit comment" busy={saving()}
                  value={editDraft()} onChange={setEditDraft} onSubmit={() => void saveEdit(c())} rows={3} autoFocus />
                <Show when={editError()}><p role="alert" class="text-xs text-danger">{editError()}</p></Show>
                <div class="mt-2 flex items-center justify-end gap-2">
                  <CommentSubmitHint action="save" />
                  <Button type="button" variant="ghost" size="sm" aria-label="Cancel edit" disabled={saving()} onClick={cancelEdit}>cancel</Button>
                  <Button type="button" size="sm" aria-label="Save edit" disabled={saving() || !hasReplyText(editDraft())} onClick={() => void saveEdit(c())}>save</Button>
                </div>
              </div>
            }>
            <Show when={commentFolded()} fallback={
              <Show when={props.open} fallback={<p class="line-clamp-2 font-sans leading-snug text-fg/90">{previewText(c().body)}</p>}>
                <CommentFoldingBody text={c().body} foldable={!(props.justOpened && newest())} />
              </Show>
            }>
              <p class="truncate font-sans leading-snug text-fg/90">{firstLine(c().body)}</p>
            </Show>
            </Show>
            {/* Below the words, not on the author line: that line is already full on a narrow rail. */}
            <Show when={editing() !== c().id && c().edited_at}>{(at) => <CommentEdited iso={at()} class="mt-0.5 inline-block font-mono text-micro text-faint" />}</Show>
            <Show when={c().image ?? (index() === 0 ? props.a.image : undefined)}>{(image) => <CommentScreenshot image={image()} />}</Show>
            <Show when={newest() && !commentFolded() && props.open}><span data-notification-read-point class="block h-px" aria-hidden="true" /></Show>
          </li>;
        }}</For>
      </ul>
      <Show when={!props.open}>
        <div class="border-t border-edge p-1">
          <Button type="button" variant="ghost" size="sm" aria-label={props.resolved ? 'Show resolved conversation' : 'Open annotation thread'} aria-expanded={props.resolved ? false : undefined}
            onClick={() => props.onOpen()} class="w-full">
            <span class="flex w-full min-w-0 items-center justify-between gap-2">
              <ThreadContinuation thread={props.a.thread} />
              <span class="shrink-0">open →</span>
            </span>
          </Button>
        </div>
      </Show>
      <Show when={props.open && !props.resolved && props.canCreateComment !== false}>
        <div class="border-t border-edge bg-raised p-3">
          <AnnotationReplyBox backend={props.backend} artifactId={props.artifactId} busy={props.busy}
            value={reply()} onChange={setReply} onSend={props.onReply} image={replyImage}
            actions={<Button type="button" variant="ghost" size="sm" aria-label="Cancel reply" onClick={() => { setReply(''); replyImage?.capture.reset(); props.onOpen(); }}>cancel</Button>} />
        </div>
      </Show>
      <Show when={props.open && props.resolved && props.canCreateComment !== false}>
        <div class="flex justify-end border-t border-edge px-3 py-2">
          <Button type="button" variant="secondary" size="sm" aria-label="Reopen annotation" disabled={props.busy} onClick={() => props.onReopen()}>↺ reopen</Button>
        </div>
      </Show>
    </Show>
  </div>;
}
