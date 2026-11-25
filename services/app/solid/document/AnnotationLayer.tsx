/* @jsxImportSource solid-js */
/**
 * THE PAGE HALF OF ANNOTATIONS — components/AnnotationLayer in SOLID, the Google-Docs shape.
 *
 * Commenting is a LAYER, not a mode: it mounts in view mode and while editing alike, and its three
 * surfaces are independent of each other and of whatever mode the page is in —
 *
 *   · floating MARKS  — an author identity at each thread's anchor (AnnotationPreview). It widens
 *                       into a preview on hover/focus and opens the rail on click.
 *   · the COMPOSER    — a draft beside the words it is about, opened from the view-mode selection
 *                       bubble, the editor's toolbar, or the rail's PICK tool — the only way to
 *                       comment on a chart, an image or a whole list. One-shot, never in the URL.
 *   · the RAIL        — the full conversation, resolved history and replies (AnnotationRail +
 *                       AnnotationThread). A panel someone OPENS (`railOpen`), never a mode.
 *
 * The layer holds everything that must not enter the document runtime — thread content, resolved
 * history, the session — while the runtime gets ids + BODY paths (`mx:annotations`) and answers
 * with pin clicks, hovers, geometry and node selections, signed with the session nonce.
 *
 * Mounted for anyone who may comment (the owner, a named editor, or a commenter).
 */
import { useLocation } from '@solidjs/router';
import { batch, createEffect, createMemo, createSignal, For, on, onCleanup, onMount, Show, untrack, type Accessor, type JSX } from 'solid-js';
import SquareDashedMousePointer from 'lucide-solid/icons/square-dashed-mouse-pointer';
import X from 'lucide-solid/icons/x';
import type { AnnotationWire } from '@/lib/annotations';
import { createHttpBackend, type ArtifactBackend } from '@/lib/artifact-backend';
import { loginHref } from '@/lib/http/login-href';
import { APP_BAR_H, RIGHT_RAIL_W } from '@/lib/html-reader/edit-bar';
import { documentRect, sendDocument, type DocumentRuntimeRef } from '@/lib/html-reader/document-endpoint';
import type { StoryEditParentMessage, StoryEditSelection } from '@/lib/html-runtime/bridge/selection-contract';
import { Button } from '../ui/Button';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import { createIsPhoneViewport } from '../ui/MobileSheet';
import { AnnotationComposer, CAPTURE_CHROME_CSS } from './AnnotationComposer';
import { AnnotationPreview, CommentsOffline, positionedComments, VIEW_COMMENT_COLLAPSED_H, VIEW_COMMENT_INSET } from './AnnotationPreview';
import { CommentRail } from './AnnotationRail';
import { CommentImagesProvider } from './CommentImageAttach';
import { createReplyDrafts } from './reply-drafts';
import { PersonMentionProvider } from './PersonMention';
import { connectFrameAnnotations } from './annotation-frame';
import { createCommentLink } from './create-reader-discussion';
import { createCommentDraft } from './annotation-draft';
import { createThreadStore } from './annotation-threads';

export interface AnnotationLayerProps {
  id: string;
  /** Explicitly false for readers and archived versions; omitted by authoring surfaces. */
  canCreateComment?: boolean;
  /** Whether the rail offers sign-in instead of the read-only message. */
  offerSignIn?: boolean;
  /** The reader's sign-in action, also used if the server refuses an expired session. */
  onSignIn?: () => void;
  /** Every request the comments make; the page's surface backend when it has one. */
  backend?: ArtifactBackend;
  /** The document owner may delete any comment; other viewers may delete their own. */
  canDeleteAny?: boolean;
  editId?: string;
  /**
   * Called with the selection a new comment anchors to, before it is sent: an editor's page saves unsaved region text
   * first and answers the selection anchored to that version (create-framed-story `beforeComment`). A rejection fails
   * the comment and keeps the draft.
   */
  beforeComment?: (subject: StoryEditSelection) => Promise<StoryEditSelection>;
  runtimeRef?: DocumentRuntimeRef;
  sessionNonce?: string | null;
  /** The thread rail is open — a panel, not a mode, and true in either mode. */
  railOpen: boolean;
  /** The rail wants to open (a pin click) or close (its own button). */
  onRailOpenChange: (open: boolean) => void;
  /** The latest full open list from the live stream; null until the first frame. Replaces the read wholesale. */
  liveAnnotations?: AnnotationWire[] | null;
  /** Every change to the list this layer holds — creates, replies, resolves — so the page's count follows it. */
  onAnnotationsChange?: (annotations: AnnotationWire[]) => void;
  /** Changes whenever the document's membership does (the live `_members` event); mention statuses read again. */
  membershipRevision?: number;
  /** Open threads mark the document edge (the ambient surface). */
  showViewComments?: boolean;
  /** A text selection — from the view-mode bubble or the editor — that seeds the composer. */
  initialSelection?: StoryEditSelection | null;
  /** The handed-in selection is now the composer's; the page may forget it. */
  onSelectionConsumed?: () => void;
  /** Where the rail starts: under the document's bar, plus the editor toolbar when one is up. */
  topOffset?: number;
  /** App chrome laid over the document's top beside the rail (a live region's formatting toolbar): the pick's hint sits under it. */
  documentTopInset?: number;
  /**
   * The editor's right panel hosts the rail (its Comments tab): the rail renders INTO this element.
   * `null` means hosted but the tab is not showing, so the rail draws nowhere. Absent: its own home.
   */
  railHost?: HTMLElement | null;
  /** The document's Select was pressed before this layer arrived: start the pick on mount. */
  pickRequested?: boolean;
  /** The document's frame, when something other than the window can resize it (a host page's own panel): its marks follow. */
  frame?: Element;
  /** A notification target, when the reader composition already tracks the address. */
  linkedComment?: Accessor<string | null>;
  /** The thread the rail has open, open or resolved (null when none): a host page reports it. */
  onOpenThreadChange?: (id: string | null) => void;
}

const cardClass = 'rounded-panel border border-edge bg-raised text-sm';
const DELETE_THREAD_CONFIRMATION = { title: 'Delete this thread?', description: 'This thread and its replies will be permanently deleted. This cannot be undone.', action: 'Delete thread', confirmLabel: 'Confirm delete thread' };
const DELETE_REPLY_CONFIRMATION = { title: 'Delete this comment?', description: 'This comment will be removed. The rest of the thread will stay.', action: 'Delete comment', confirmLabel: 'Confirm delete comment' };
/** Standalone layers can follow the app router when they are rendered inside one. */
function standaloneLink() {
  let routerLocation: ReturnType<typeof useLocation> | undefined;
  try { routerLocation = useLocation(); } catch { /* no router */ }
  const link = createCommentLink(routerLocation ? () => routerLocation.search : undefined);
  return createMemo(() => link().target);
}

/** Deleting a thread or one reply, once confirmed: a refusal stays in the dialog, which stays while it runs. */
function ConfirmDelete(props: { thread: boolean; remove: () => Promise<unknown>; onClose: () => void }): JSX.Element {
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  const confirm = async () => {
    if (busy()) return;
    setBusy(true); setError(null);
    try { await props.remove(); props.onClose(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not complete this action. Try again.'); }
    finally { setBusy(false); }
  };
  return <ConfirmDialog {...(props.thread ? DELETE_THREAD_CONFIRMATION : DELETE_REPLY_CONFIRMATION)} danger busy={busy()} error={error()}
    onCancel={() => { if (!busy()) props.onClose(); }} onConfirm={() => void confirm()} />;
}

export function AnnotationLayer(props: AnnotationLayerProps): JSX.Element {
  const backend = props.backend ?? createHttpBackend(props.id);
  // A Solid prop getter notifies whenever its source does, even for an equal value. These memos
  // are the dependency list: an effect keyed on one runs on a real change.
  const railOpen = createMemo(() => props.railOpen);
  const mayCreate = createMemo(() => props.canCreateComment !== false);
  const signIn = () => {
    if (props.onSignIn) props.onSignIn();
    else window.location.assign(loginHref(window.location, 'comment'));
  };
  const handedSelection = createMemo(() => props.initialSelection ?? null);
  const sessionNonce = createMemo(() => props.sessionNonce ?? null);
  const runtimeRef = createMemo(() => props.runtimeRef);
  const liveAnnotations = createMemo(() => props.liveAnnotations ?? null);
  const postToFrame = (message: StoryEditParentMessage) => { if (props.runtimeRef) sendDocument({ runtimeRef: props.runtimeRef }, message); };
  const documentBox = () => props.runtimeRef ? documentRect({ runtimeRef: props.runtimeRef }) : undefined;

  const threads = createThreadStore({ backend, artifactId: () => props.id, mayCreate, railOpen, live: liveAnnotations });
  // The page's count follows THIS list: a thread resolved here is reflected at once.
  createEffect(() => { props.onAnnotationsChange?.(threads.rows()); });
  const [hoverId, setHoverId] = createSignal<string | null>(null);
  let uiHoverId: string | null = null;
  const hoverUi = (id: string | null) => { uiHoverId = id; setHoverId(id); };
  /** The hover card someone is replying from: it outlasts the mouse and other markers until put away. */
  const [pinnedId, setPinnedId] = createSignal<string | null>(null);
  /** The hover card that shows: the pinned one, else the one under the pointer. */
  const previewId = () => pinnedId() ?? hoverId();
  const replies = createReplyDrafts(props.id);
  const closePreview = () => batch(() => { setPinnedId(null); hoverUi(null); });
  let threadsRoot: HTMLDivElement | undefined;
  /** On a phone the rail is a bottom sheet — a 320px rail over a 390px screen covers the document. */
  const phoneRail = createIsPhoneViewport();
  const [ambientResolveError, setAmbientResolveError] = createSignal<{ id: string; message: string } | null>(null);
  const [deleting, setDeleting] = createSignal<{ id: string; thread: boolean } | null>(null);
  const [viewport, setViewport] = createSignal({ width: innerWidth, height: innerHeight });
  onMount(() => {
    const resize = () => setViewport({ width: innerWidth, height: innerHeight });
    window.addEventListener('resize', resize);
    const observer = props.frame && typeof ResizeObserver === 'function' ? new ResizeObserver(resize) : null;
    if (props.frame) observer?.observe(props.frame);
    onCleanup(() => { window.removeEventListener('resize', resize); observer?.disconnect(); });
  });

  /** A pin, a marker, a link or a new comment opens its thread in the rail; no pick or composer stays up. */
  const openThread = (annId: string) => {
    batch(() => { frame.requestViewState(); draft.dismiss(); threads.open(annId); });
    draft.openRailForThread();
  };

  // Notification links identify a comment; resolve it through the authorised open/resolved indexes
  // so a reply opens its containing conversation.
  const linkedComment = props.linkedComment ?? standaloneLink();
  let followedLink = false;
  createEffect(on(linkedComment, () => { followedLink = false; }));
  createEffect(() => {
    const linked = linkedComment();
    const rows = [...threads.rows(), ...(threads.resolved() ?? [])];
    if (!linked || followedLink) return;
    const thread = rows.find((row) => row.id === linked || row.thread.some((comment) => comment.id === linked));
    untrack(() => {
      if (thread) { followedLink = true; openThread(thread.id); threads.unfoldComment(thread.id, linked); }
      else if (!props.railOpen) draft.openRailForThread();
    });
  });

  // The thread a pin opened may sit below the fold — bring it, then its newest comment, into view
  // after the rail has committed. `inline: 'nearest'`: scrollIntoView also scrolls the x-axis.
  createEffect(() => {
    const open = threads.openId();
    if (!open || !railOpen()) return;
    const raf = requestAnimationFrame(() => {
      const thread = [...(threadsRoot?.querySelectorAll<HTMLElement>('[data-thread-id]') ?? [])].find((node) => node.dataset.threadId === open);
      thread?.scrollIntoView?.({ block: 'start', inline: 'nearest' });
      const linked = untrack(linkedComment);
      const comment = linked ? [...(thread?.querySelectorAll<HTMLElement>('[data-comment-id]') ?? [])].find((node) => node.dataset.commentId === linked) : null;
      (comment ?? thread?.querySelector('li:last-child'))?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
    });
    onCleanup(() => cancelAnimationFrame(raf));
  });

  const draft = createCommentDraft({
    artifactId: props.id, backend, editId: () => props.editId, beforeComment: () => props.beforeComment, mayCreate, threads, signIn,
    rail: { open: railOpen, set: (open) => props.onRailOpenChange(open), phone: phoneRail },
    handed: handedSelection, consumed: () => props.onSelectionConsumed?.(), frameOffset: documentBox, post: postToFrame,
    pickRequested: Boolean(props.pickRequested),
  });
  createEffect(on(mayCreate, (allowed) => { if (!allowed) setDeleting(null); }));

  const frame = connectFrameAnnotations({
    runtimeRef, nonce: sessionNonce,
    state: () => ({ pins: threads.pinRows(), openId: threads.openId(), hoverId: previewId(), selected: draft.selection(), canComment: mayCreate(), pick: draft.pick(), capturing: draft.capture.busy() }),
    on: {
      select: () => draft.beginPick('block'),
      pin: openThread,
      hover: (id) => setHoverId(uiHoverId ?? id),
      selection: draft.receive,
    },
  });
  // Closing the rail drops what only the rail was showing; the pins stay.
  createEffect(on(railOpen, (open) => { if (!open) threads.focus(null); }));
  createEffect(on(threads.openId, (id) => props.onOpenThreadChange?.(id), { defer: true }));

  const resolveFromPreview = async (id: string) => {
    setAmbientResolveError(null);
    if (!await threads.act(id, { resolve: true })) setAmbientResolveError({ id, message: 'Could not resolve this thread. Try again.' });
  };
  const askDelete = (commentId: string, thread: boolean) => { if (!mayCreate() || deleting()) return; setDeleting({ id: commentId, thread }); };

  const threadActions = { openThread, hoverThread: hoverUi, askDelete, signIn };

  const topOffset = () => props.topOffset ?? 0;
  // The collapsed identity mark is small enough for phones too; its click opens the same rail as a sheet.
  const floating = () => !props.railOpen && Boolean(props.showViewComments) && threads.floatingRows().length > 0;
  const markerRect = () => {
    void viewport();
    return documentBox() ?? { top: topOffset(), height: innerHeight - topOffset() };
  };
  const placed = createMemo(() => floating() ? positionedComments(threads.floatingRows(), frame.anchorRects(), markerRect(), viewport().height) : []);
  const placedIds = createMemo(() => placed().map((item) => item.annotation.id), undefined, { equals: (a, b) => a.length === b.length && a.every((id, index) => id === b[index]) });
  const placement = (id: string) => placed().find((item) => item.annotation.id === id);
  // A pinned card whose marker is gone (the rail opened, the thread resolved, it scrolled away) is put away; its draft stays.
  createEffect(() => { const pinned = pinnedId(); if (pinned && !placedIds().includes(pinned)) setPinnedId(null); });

  // A thread resolved elsewhere counts down only while its mark is seen, not hovered and not open.
  const visibleResolved = createMemo(() => placed().filter((item) => item.top >= 0 && item.top + VIEW_COMMENT_COLLAPSED_H <= viewport().height).map((item) => item.annotation.id).join(','));
  createEffect(() => {
    if (!floating() || !threads.counting()) return;
    const visible = new Set(visibleResolved().split(','));
    const hover = hoverId();
    const open = threads.openId();
    let last = performance.now();
    const timer = setInterval(() => {
      const now = performance.now(), elapsed = Math.min(250, now - last);
      last = now;
      if (document.visibilityState !== 'visible') return;
      threads.countDown(elapsed, (id) => visible.has(id) && id !== hover && id !== open);
    }, 100);
    onCleanup(() => clearInterval(timer));
  });

  // The document is full-width under an open rail, so what the composer and the pill may use is the
  // document LESS the rail — never its own width.
  const railWidth = () => props.railOpen && !phoneRail() && props.railHost === undefined ? RIGHT_RAIL_W : 0;
  const frameRect = createMemo(() => {
    const { width } = viewport();
    const measured = documentBox();
    return measured
      ? { left: measured.left, top: measured.top, width: Math.max(0, measured.width - railWidth()) }
      : { left: 0, top: topOffset(), width: width - railWidth() };
  });

  return <CommentImagesProvider backend={backend} editId={() => props.editId}><PersonMentionProvider artifactId={props.id} backend={backend} revision={props.membershipRevision}>
    <CommentsOffline.Provider value={backend.mode === 'offline'}>
      <style>{CAPTURE_CHROME_CSS}</style>
      <Show when={draft.capture.busy() && !draft.selection()}>
        <div data-capture-chrome role="status" class="fixed bottom-4 left-4 z-50 flex items-center gap-3 rounded-panel bg-panel p-3 shadow">Preparing screenshot… <Button type="button" variant="secondary" size="sm" onClick={() => draft.capture.reset()}>Cancel capture</Button></div>
      </Show>

      {/* The ambient surface: tiny open-thread identities over the document's right edge, at their anchors. */}
      {/* The layer below is NOT an overlay or dialog: a box-less stacking layer that only carries the marks, each of which is fixed at its own anchor. */}
      <Show when={floating()}>
        <div data-capture-chrome aria-label="Open annotation comments" class="pointer-events-none fixed left-0 top-0 z-20 size-0">
          <For each={placedIds()}>{(id) => (
            <Show when={placement(id)}>{(item) => (
              <AnnotationPreview row={item().annotation} top={item().top} remaining={threads.recent()[id]?.remaining}
                hovered={previewId() === id} resolving={threads.busy()} resolveError={ambientResolveError()?.id === id ? ambientResolveError()?.message : undefined}
                onResolve={mayCreate() ? () => void resolveFromPreview(id) : undefined} onOpen={() => openThread(id)} onHover={hoverUi}
                onReply={mayCreate() && item().annotation.status === 'open' ? (body, attachment) => threads.actOrThrow(id, { reply: body, ...attachment }) : undefined}
                backend={backend} artifactId={props.id} busy={threads.busy()} draft={replies.get(id)} onDraftChange={(value) => replies.set(id, value)}
                pinned={pinnedId() === id} onPin={() => setPinnedId(id)} onClose={closePreview} />
            )}</Show>
          )}</For>
        </div>
      </Show>

      {/* The pick's only indicator once the rail is away, and the phone's only way out of it. */}
      <Show when={draft.pick()}>
        <div role="status" data-capture-chrome aria-label={draft.pick() === 'area' ? 'Screenshot tool active' : 'Select tool active'}
          class={`${cardClass} fixed z-30 flex items-center gap-2 border-edge-bright px-3 py-1.5 font-mono text-2xs text-muted shadow-xl`}
          style={{ left: `${frameRect().left + frameRect().width / 2}px`, top: `${Math.max(topOffset(), frameRect().top, phoneRail() ? APP_BAR_H : 0) + (props.documentTopInset ?? 0) + VIEW_COMMENT_INSET}px`, transform: 'translateX(-50%)' }}>
          <SquareDashedMousePointer size={12} strokeWidth={1.8} class="shrink-0 text-accent" />
          <span class="whitespace-nowrap">{draft.pick() === 'area' ? (draft.capture.busy() ? 'Choose this tab in the sharing dialog' : 'drag an area to screenshot') : 'click a block or highlight text to comment'}</span>
          <Button type="button" variant="ghost" size="sm" icon aria-label="Cancel picking" onClick={draft.endPick}>
            <X size={12} strokeWidth={1.8} />
          </Button>
        </div>
      </Show>

      {/* Drafts belong to the thing being discussed; the saved conversation moves to the rail. */}
      <AnnotationComposer draft={draft} show={mayCreate() && !!draft.selection() && !draft.pick()} busy={threads.busy()} frame={frameRect()} viewport={viewport()}
        backend={backend} artifactId={props.id} post={postToFrame} />

      {/* The rail — a panel, open in either mode; a bottom sheet on a phone. */}
      <Show when={props.railOpen && props.railHost !== null}>
        <CommentRail threads={threads} draft={draft} artifactId={props.id} backend={backend} mayCreate={mayCreate()} canDeleteAny={props.canDeleteAny}
          phone={phoneRail()} host={props.railHost ?? undefined} topOffset={topOffset()}
          onClose={() => props.onRailOpenChange(false)} offerSignIn={props.offerSignIn ?? false} hoverId={hoverId()}
          viewStateError={frame.viewStateError()} missing={frame.missing()} replies={replies} actions={threadActions}
          threadsRef={(element) => { threadsRoot = element; }} />
      </Show>

      <Show when={deleting()}>{(pending) => <ConfirmDelete thread={pending().thread} remove={() => threads.remove(pending().id)} onClose={() => setDeleting(null)} />}</Show>
    </CommentsOffline.Provider>
  </PersonMentionProvider></CommentImagesProvider>;
}
