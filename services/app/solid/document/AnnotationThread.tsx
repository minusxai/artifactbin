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
import { createEffect, createSignal, ErrorBoundary, For, lazy, onCleanup, Show, Suspense, type JSX } from 'solid-js';
import Check from 'lucide-solid/icons/check';
import ChevronDown from 'lucide-solid/icons/chevron-down';
import ChevronRight from 'lucide-solid/icons/chevron-right';
import EllipsisVertical from 'lucide-solid/icons/ellipsis-vertical';
import Pencil from 'lucide-solid/icons/pencil';
import Trash2 from 'lucide-solid/icons/trash-2';
import type { AnnotationWire } from '@/lib/annotations';
import type { AnnotationCommentWire } from '@artifactbin/contracts/annotation-comment';
import { BackendRequestError, type ArtifactBackend } from '@/lib/artifact-backend';
import { hasReplyText } from '@/lib/annotations/remote-reply';
import { Button } from '../ui/Button';
import { Tooltip } from '../ui/Tooltip';
import { useOptionalInbox } from '../lib/notifications';
import { useSession } from '../lib/session';
import { AuthorIdentity, CommentEdited, CommentTimestamp, firstLine, previewText, ThreadContinuation } from './AnnotationPreview';
import { AnnotationReplyBox } from './AnnotationReplyBox';
import { CommentFoldingBody } from './CommentFoldingBody';
import { CommentSubmitHint } from './CommentMarkdown';
import { CommentMarkdownField } from './LazyCommentField';
import { readDraft, writeDraft } from '../lib/draft-store';
import { isChunkLoadError, reloadForNewBuild } from '../lib/app-build';
// Reaction controls load with an opened comment, keeping the reader shell small.
const CommentReactions = lazy(() => import('./CommentReactions').then(module => ({default:module.CommentReactions})));
import { CommentScreenshot } from './CommentScreenshot';
import { createCommentImageDraft } from './CommentImageAttach';
import type { ThreadStore } from './annotation-threads';
import type { ReplyDrafts } from './reply-drafts';

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

/** What a card says about its target when the document cannot: the words it quoted, if any, and why. */
function TargetNote(props: { quote?: string | null; note: string }): JSX.Element {
  return <div class="border-b border-edge bg-surface/60 px-3 py-1.5">
    <Show when={props.quote}><p class="mb-1 border-l-2 border-edge-bright pl-2 font-sans text-xs leading-snug text-fg/80">{props.quote}</p></Show>
    <p class="font-mono text-micro text-faint">{props.note}</p>
  </div>;
}

/** Interactions that involve the layer outside this thread, shared by every card in the rail. */
export interface ThreadActions {
  openThread: (id: string) => void;
  hoverThread: (id: string | null) => void;
  askDelete: (commentId: string, thread: boolean) => void;
  signIn: () => void;
}

interface AnnotationThreadProps {
  row: AnnotationWire;
  threads: Pick<ThreadStore, 'openId' | 'justOpenedId' | 'folded' | 'toggleFold' | 'inspect' | 'busy' | 'act' | 'actOrThrow' | 'edit' | 'react'>;
  replies: ReplyDrafts;
  actions: ThreadActions;
  artifactId: string;
  backend: ArtifactBackend;
  mayCreate: boolean;
  /** The document owner may remove any comment; authorship for other viewers is checked below. */
  canDeleteAny?: boolean;
  targetMissing?: boolean;
  viewStateError?: string;
  hovered: boolean;
}

/**
 * Reading the newest comment of an open thread marks the thread's notifications read: once its read point is on screen
 * while the page is visible. `seen` names the thread while it is open with its newest comment showing, else null.
 */
function markReadWhenSeen(seen: () => { id: string; revision: number; element: HTMLElement | undefined } | null) {
  const inbox = useOptionalInbox();
  const { session } = useSession();
  createEffect(() => {
    const userId = session()?.user?.id;
    const thread = seen();
    if (!thread || !userId || !inbox || !thread.element || typeof IntersectionObserver === 'undefined') return;
    const { id, revision, element } = thread;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting) && document.visibilityState === 'visible') {
        void inbox.load({ read: `thread:${id}:${userId}`, revision });
        observer.disconnect();
      }
    }, { threshold: 0.1 });
    queueMicrotask(() => { const latest = element.querySelector('[data-notification-read-point]'); if (latest) observer.observe(latest); });
    onCleanup(() => observer.disconnect());
  });
}

/**
 * ONE comment of a thread is edited at a time, in place of its body; the draft survives a refused save. The comment
 * being rewritten and its words are kept for this tab under `key`: a reload reopens the edit where it was. Starting an
 * edit opens the thread (`open`).
 */
function createCommentEdit(key: string, thread: { save: (commentId: string, body: string) => Promise<void>; open: () => void }) {
  const kept = (() => { try { return JSON.parse(readDraft(key) || 'null') as { comment?: unknown; body?: unknown } | null; } catch { return null; } })();
  const [editing, setEditing] = createSignal<string | null>(typeof kept?.comment === 'string' && typeof kept.body === 'string' ? kept.comment : null);
  const [draft, setDraft] = createSignal(editing() ? String(kept?.body) : '');
  createEffect(() => { const comment = editing(); writeDraft(key, comment ? JSON.stringify({ comment, body: draft() }) : ''); });
  const [error, setError] = createSignal('');
  const [saving, setSaving] = createSignal(false);
  const cancel = () => { if (saving()) return; setEditing(null); setDraft(''); setError(''); };
  return {
    editing, draft, setDraft, error, saving, cancel,
    start: (comment: AnnotationCommentWire) => { setDraft(comment.body); setError(''); setEditing(comment.id); thread.open(); },
    save: async (comment: AnnotationCommentWire) => {
      const body = draft();
      if (saving() || !hasReplyText(body)) return;
      if (body === comment.body) { cancel(); return; }
      setSaving(true); setError('');
      try { await thread.save(comment.id, body); setEditing(null); setDraft(''); }
      catch (cause) { setError(cause instanceof BackendRequestError && cause.code === 'annotation_conflict' ? cause.message : EDIT_FAILED); }
      finally { setSaving(false); }
    },
  };
}

export function AnnotationThread(props: AnnotationThreadProps): JSX.Element {
  let threadElement: HTMLDivElement | undefined;
  const { session } = useSession();
  const { threads, actions, replies } = props;
  // The rail keys cards by thread id. Live rows can replace content without remounting the card.
  const id = props.row.id;
  const open = () => threads.openId() === id;
  const folded = () => threads.folded('threads', id);
  const receded = () => threads.openId() !== null && !open();
  const resolved = () => props.row.status === 'resolved';
  const busy = threads.busy;
  const isCommentFolded = (commentId: string) => threads.folded('comments', commentId);
  const toggleFold = () => threads.toggleFold('threads', id);
  // Resolved history toggles inspection; opening an active thread also restores its view in the document.
  const openConversation = () => { if (resolved()) threads.inspect(id); else actions.openThread(id); };
  const newestFolded = () => isCommentFolded(props.row.thread.at(-1)?.id ?? '');
  markReadWhenSeen(() => open() && !folded() && !newestFolded() ? { id, revision: props.row.revision ?? 1, element: threadElement } : null);

  // The rail's staged image survives folding the thread. The layer owns its text.
  const replyImage = createCommentImageDraft();
  const visibleComments = () => open() ? props.row.thread : props.row.thread.slice(0, 1);
  const first = () => props.row.thread[0];
  const replyCount = () => Math.max(0, props.row.thread.length - 1);
  const mine = (comment: AnnotationCommentWire) => { const userId = session()?.user?.id; return userId !== undefined && userId !== null && comment.author.user_id === userId; };
  const canDelete = (comment: AnnotationCommentWire) => props.mayCreate
    && (props.canDeleteAny === true || mine(comment) || props.backend.canDeleteLocalAnnotation?.(comment.id) === true);
  /** Only the words' author may rewrite them: their account online, or the backend's word for a local comment. */
  const canEdit = (comment: AnnotationCommentWire) => props.mayCreate
    && (mine(comment) || props.backend.canEditLocalComment?.(comment) === true);
  const edit = createCommentEdit(`${props.artifactId}:edit:${id}`, {
    save: (commentId, body) => threads.edit(id, commentId, body),
    open: () => { if (!open()) openConversation(); },
  });

  return <div ref={threadElement}
    aria-label={resolved() ? 'Resolved annotation thread' : 'Annotation thread'}
    data-thread-id={id}
    data-hovered={props.hovered ? 'true' : undefined}
    onMouseEnter={() => actions.hoverThread(id)}
    onMouseLeave={(event) => { if (!event.currentTarget.matches(':focus-within')) actions.hoverThread(null); }}
    onFocusIn={() => actions.hoverThread(id)}
    onFocusOut={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null) && !event.currentTarget.matches(':hover')) actions.hoverThread(null); }}
    onClick={(event) => {
      const target = event.target as Element;
      // `[role="button"]`: the author line is a toggle, and collapsing a comment in a closed thread must not open it.
      if (!open() && !folded() && !target.closest('a, button, textarea, input, [role="button"]')) openConversation();
    }}
    class={`${threadClass} shrink-0 overflow-hidden transition-[border-color,background-color,opacity] duration-150 ${open() || folded() ? '' : 'cursor-pointer'} ${open() || props.hovered ? 'border-edge-bright bg-comment-hover' : ''} ${resolved() ? 'opacity-55 hover:opacity-100 focus-within:opacity-100' : receded() ? 'opacity-60 hover:opacity-100 focus-within:opacity-100' : ''}`}>
    {/* Folded, the card IS its summary: what it is about, how it opens, and how much is underneath. Receded, its expand opens it. */}
    <Show when={folded() || receded()}>
      <div class="px-3 py-2">
        <div class="flex min-w-0 items-center gap-1.5">
          <ThreadFoldControl folded onToggle={folded() ? toggleFold : openConversation} />
          <span class="truncate font-mono text-micro text-faint">{props.row.snippet || 'this document'}</span>
        </div>
        <Show when={first()}>{(comment) => <>
          <p class="mt-1 truncate font-sans leading-snug text-fg/90">{firstLine(comment().body)}</p>
          <p class="mt-1 font-mono text-micro text-faint">{replyCount() === 1 ? '1 reply' : `${replyCount()} replies`}</p>
        </>}</Show>
      </div>
    </Show>
    <Show when={!folded() && !receded()}>
      <Show when={props.row.view_state}>
        <div class="flex items-center justify-between gap-2 border-b border-edge px-3 py-1.5 text-2xs text-muted">
          <span role="status">{open() && props.viewStateError ? props.viewStateError : 'Saved view attached'}</span>
          <Button type="button" variant="link" class="shrink-0" onClick={openConversation}>Restore saved view</Button>
        </div>
      </Show>
      <Show when={props.targetMissing && !props.row.orphaned}><TargetNote note="Exact target is unavailable. This comment remains attached to its containing block." /></Show>
      {/* What this was about, when the document cannot say it: the node is gone, or its quoted words were edited away. */}
      <Show when={props.row.orphaned}><TargetNote quote={open() ? props.row.quote ?? props.row.snippet : null} note="This passage was removed from the document." /></Show>
      <Show when={open() && !props.row.orphaned && props.row.quote_found === false && props.row.quote}><TargetNote quote={props.row.quote} note="These words have since been edited." /></Show>
      <ul class="flex flex-col gap-3 px-3 py-3">
        {/* Keyed by comment id: a live frame replaces every row object, and must not remount a comment someone is reading. */}
        <For each={visibleComments().map((comment) => comment.id)}>{(commentId, index) => {
          const c = () => visibleComments().find((comment) => comment.id === commentId) ?? props.row.thread[0]!;
          const commentFolded = () => open() && isCommentFolded(c().id);
          // ONE exemption to the auto-fold: the newest comment of a thread this viewer just asked to see.
          const newest = () => index() === visibleComments().length - 1;
          // `scroll-mb-14` is what the open-scroll aims at: on a phone the page's action bar floats over the sheet's bottom.
          return <li data-comment-id={c().id} class="scroll-mb-14 sm:scroll-mb-0">
            <div class="mb-1.5 flex min-w-0 items-center gap-2">
              {/* The author line is the comment's own toggle where there is a body to fold (an open thread). A span, not a ui/Button: it holds links, which a button cannot nest. */}
              <span role={open() ? 'button' : undefined} tabIndex={open() ? 0 : undefined}
                aria-label={open() ? (commentFolded() ? 'Expand comment' : 'Collapse comment') : undefined}
                aria-expanded={open() ? !commentFolded() : undefined}
                onClick={(event) => {
                  if (!open()) return;
                  if ((event.target as Element).closest('a, button')) return;
                  threads.toggleFold('comments', c().id);
                }}
                onKeyDown={(event) => {
                  if (!open() || (event.key !== 'Enter' && event.key !== ' ')) return;
                  event.preventDefault();
                  threads.toggleFold('comments', c().id);
                }}
                class={`flex min-w-0 flex-1 items-center gap-2 rounded-chip ${open() ? 'cursor-pointer' : ''}`}>
                <AuthorIdentity author={c().author} />
                {/* Only the room the name leaves: the time gives way first (an owner's header also holds resolve and actions). */}
                <CommentTimestamp iso={c().created_at} class="min-w-0 flex-[1_1_0%] truncate text-right font-mono text-micro text-faint" />
              </span>
              <Show when={index() === 0}>
                <ThreadFoldControl folded={false} onToggle={toggleFold} />
                <Show when={resolved()} fallback={<Show when={props.mayCreate}>
                  <Tooltip content="resolve thread">
                    <Button type="button" variant="ghost" size="sm" icon aria-label="Resolve annotation" disabled={busy()} onClick={() => void threads.act(id, { resolve: true })} class="-mx-1">
                      <Check size={13} strokeWidth={2} />
                    </Button>
                  </Tooltip>
                </Show>}>
                  <Tooltip content="resolved">
                    <span class="inline-flex h-5 w-5 items-center justify-center text-accent"><Check size={13} strokeWidth={2} /></span>
                  </Tooltip>
                  <Show when={open()}>
                    <Button type="button" variant="ghost" size="sm" icon aria-label="Hide resolved conversation" aria-expanded="true" onClick={openConversation}>↑</Button>
                  </Show>
                </Show>
              </Show>
              <Show when={(canDelete(c()) || canEdit(c())) && (index() > 0 || !resolved() || open())}>
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
                        ...(canEdit(c()) ? [{ label: 'Edit comment', text: 'edit', icon: () => <Pencil size={12} strokeWidth={1.75} />, disabled: busy() || edit.saving(), onSelect: () => edit.start(c()) }] : []),
                        ...(canDelete(c()) ? [{ label: index() === 0 ? 'Delete thread' : 'Delete comment', text: index() === 0 ? 'delete thread' : 'delete comment', icon: () => <Trash2 size={12} strokeWidth={1.75} />, danger: true, disabled: busy(), onSelect: () => actions.askDelete(c().id, c().id === id) }] : []),
                      ]}
                      trigger={(attrs) => trigger(attrs)} />
                  </Suspense></ErrorBoundary>;
                })()}
              </Show>
            </div>
            <Show when={edit.editing() !== c().id} fallback={
              // Escape cancels, from anywhere in the editor (a native listener: the rail may sit in a shadow root). The
              // editor's own keymap claims Escape (select parent node), so its defaultPrevented says nothing here; an
              // open mention picker stops the key before it bubbles this far.
              <div data-comment-editor on:keydown={(event) => { if (event.key !== 'Escape') return; event.preventDefault(); event.stopPropagation(); edit.cancel(); }}>
                <CommentMarkdownField backend={props.backend} artifactId={props.artifactId} label="Edit comment" busy={edit.saving()}
                  value={edit.draft()} onChange={edit.setDraft} onSubmit={() => void edit.save(c())} rows={3} autoFocus />
                <Show when={edit.error()}><p role="alert" class="text-xs text-danger">{edit.error()}</p></Show>
                <div class="mt-2 flex items-center justify-end gap-2">
                  <CommentSubmitHint action="save" />
                  <Button type="button" variant="ghost" size="sm" aria-label="Cancel edit" disabled={edit.saving()} onClick={edit.cancel}>cancel</Button>
                  <Button type="button" size="sm" aria-label="Save edit" disabled={edit.saving() || !hasReplyText(edit.draft())} onClick={() => void edit.save(c())}>save</Button>
                </div>
              </div>
            }>
            <Show when={commentFolded()} fallback={
              <Show when={open()} fallback={<p class="line-clamp-2 font-sans leading-snug text-fg/90">{previewText(c().body)}</p>}>
                <CommentFoldingBody visibleLines={6} text={c().body} foldable={!(threads.justOpenedId() === id && newest())} />
              </Show>
            }>
              <p class="truncate font-sans leading-snug text-fg/90">{firstLine(c().body)}</p>
            </Show>
            </Show>
            {/* Below the words, not on the author line: that line is already full on a narrow rail. */}
            <Show when={edit.editing() !== c().id && c().edited_at}>{(at) => <CommentEdited iso={at()} class="mt-0.5 inline-block font-mono text-micro text-faint" />}</Show>
            <Show when={edit.editing() !== c().id}>
              <Suspense><CommentReactions comment={c()} signedIn={!!session()?.user?.id} unavailable={props.backend.unavailable('commentReactions')}
                onSignIn={actions.signIn} onReact={(active) => threads.react(c().id, active)} /></Suspense>
            </Show>
            <Show when={c().image ?? (index() === 0 ? props.row.image : undefined)}>{(image) => <CommentScreenshot image={image()} />}</Show>
            <Show when={newest() && !commentFolded() && open()}><span data-notification-read-point class="block h-px" aria-hidden="true" /></Show>
          </li>;
        }}</For>
      </ul>
      <Show when={!open()}>
        <div class="border-t border-edge p-1">
          <Button type="button" variant="ghost" size="sm" aria-label={resolved() ? 'Show resolved conversation' : 'Open annotation thread'} aria-expanded={resolved() ? false : undefined}
            onClick={openConversation} class="w-full">
            <span class="flex w-full min-w-0 items-center justify-between gap-2">
              <ThreadContinuation thread={props.row.thread} />
              <span class="shrink-0">open →</span>
            </span>
          </Button>
        </div>
      </Show>
      <Show when={open() && !resolved() && props.mayCreate}>
        <div class="border-t border-edge bg-raised p-3">
          <AnnotationReplyBox backend={props.backend} artifactId={props.artifactId} busy={busy()}
            value={replies.get(id)} onChange={(value) => replies.set(id, value)}
            onSend={(body, attachment) => threads.actOrThrow(id, { reply: body, ...attachment })} image={replyImage}
            actions={<Button type="button" variant="ghost" size="sm" aria-label="Cancel reply" onClick={() => { replies.set(id, ''); replyImage?.capture.reset(); openConversation(); }}>cancel</Button>} />
        </div>
      </Show>
      <Show when={open() && resolved() && props.mayCreate}>
        <div class="flex justify-end border-t border-edge px-3 py-2">
          <Button type="button" variant="secondary" size="sm" aria-label="Reopen annotation" disabled={busy()} onClick={() => void threads.act(id, { reopen: true })}>↺ reopen</Button>
        </div>
      </Show>
    </Show>
  </div>;
}
