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
import { runtimeId } from '@/lib/story-runtime/runtime-id';
import { useLocation } from '@solidjs/router';
import { batch, createEffect, createMemo, createSignal, For, lazy, on, onCleanup, onMount, Show, Suspense, untrack, type JSX } from 'solid-js';
import Camera from 'lucide-solid/icons/camera';
import LoaderCircle from 'lucide-solid/icons/loader-circle';
import MessageSquare from 'lucide-solid/icons/message-square';
import SquareDashedMousePointer from 'lucide-solid/icons/square-dashed-mouse-pointer';
import X from 'lucide-solid/icons/x';
import type { AnnotationWire } from '@/lib/annotations/store';
import type { ArtifactBackend } from '@/lib/artifact-backend/types';
import { createHttpBackend } from '@/lib/artifact-backend/http';
import { BackendRequestError } from '@/lib/artifact-backend/errors';
import { isFolded, readFolds, toggleFold, unfold, type FoldKind, type Folds } from '@/lib/annotations/comment-folds';
import { loginHref } from '@/lib/http/login-href';
import { hasReplyText } from '@/lib/annotations/remote-reply';
import { APP_BAR_H, RIGHT_RAIL_W } from '@/lib/story/reader/edit-bar';
import { documentRect, sendDocument, subscribeDocument, type DocumentRuntimeRef } from '@/lib/story-runtime/document-endpoint';
import {
  isEditFrameMessage, STORY_ANNOTATIONS_MESSAGE, STORY_ANNOTATION_HOVER_MESSAGE, STORY_ANNOTATION_LAYOUT_MESSAGE, STORY_ANNOTATION_PIN_MESSAGE,
  STORY_SELECTION_ACTION_MESSAGE, STORY_SELECTION_MESSAGE, STORY_SELECT_MESSAGE,
  type StoryAnnotationsMessage, type StoryEditRect, type StoryEditSelection,
} from '@/lib/story-runtime/contract';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { FeatureGate } from '../components/FeatureGate';
import { createIsPhoneViewport } from '../components/MobileSheet';
import { Tooltip } from '../components/Tooltip';
import { createForegroundComposer } from '../components/TrustedUi';
import { positionedComposer } from './AnnotationComposerPosition';
import { AnnotationPreview, CommentsOffline, positionedComments, VIEW_COMMENT_COLLAPSED_H, VIEW_COMMENT_INSET } from './AnnotationPreview';
import { RailChrome } from './AnnotationRail';
import { AnnotationThread } from './AnnotationThread';
import { createCommentCapture } from './CommentCapture';
import { CommentMarkdownField, CommentSubmitHint } from './CommentMarkdown';
import { PersonMentionProvider } from './PersonMention';
import type { ScreenshotDrawing } from './ScreenshotEditor';

// The brush is its own chunk, preloaded when Screenshot is pressed. Native permission stays in the
// eager capture module so it keeps the user gesture. It renders under its OWN Suspense boundary:
// the nearest one otherwise is the app's, and a first render would put the whole page on hold.
const ScreenshotEditor = lazy(() => import('./ScreenshotEditor').then((module) => ({ default: module.ScreenshotEditor })));
const loadScreenshotEditor = () => ScreenshotEditor.preload();

export interface AnnotationLayerProps {
  id: string;
  /** Every request the comments make; the page's surface backend when it has one. */
  backend?: ArtifactBackend;
  editId?: string;
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
  /** Open threads mark the document edge (the ambient surface). */
  showViewComments?: boolean;
  /** A text selection — from the view-mode bubble or the editor — that seeds the composer. */
  initialSelection?: StoryEditSelection | null;
  /** The handed-in selection is now the composer's; the page may forget it. */
  onSelectionConsumed?: () => void;
  /** May opening the rail open a PICK? False under the editor, which holds the document's clicks. */
  pickOnOpen?: boolean;
  /** Where the rail starts: under the document's bar, plus the editor toolbar when one is up. */
  topOffset?: number;
  /** What the rail leaves free on the right. */
  rightInset?: number;
  /**
   * The editor's right panel hosts the rail (its Comments tab): the rail renders INTO this element.
   * `null` means hosted but the tab is not showing, so the rail draws nowhere. Absent: its own home.
   */
  railHost?: HTMLElement | null;
  /** The rail is a bottom sheet at this width too (the editor below its panel breakpoint). */
  railSheet?: boolean;
  /** The right-edge panel that is up whether or not comments are — the editor's. */
  panelWidth?: number;
  /** The document's Select was pressed before this layer arrived: start the pick on mount. */
  pickRequested?: boolean;
  /** A notification's comment or thread id; read from `?comment=`/`?thread=` when absent. */
  linkTarget?: string | null;
}

const cardClass = 'rounded-[6px] border border-edge bg-raised text-sm';
const CAPTURE_CHROME_CSS = ':host-context(.mx-taking-screenshot) [data-capture-chrome],.mx-taking-screenshot [data-capture-chrome]{visibility:hidden!important}';
const DELETE_CONFIRMATION = { title: 'Delete this comment?', description: 'This comment and its replies will be permanently deleted. This cannot be undone.', action: 'Delete comment', confirmLabel: 'Confirm delete comment' };
const linkedFrom = (search: string | undefined) => {
  if (search === undefined) return null;
  const query = new URLSearchParams(search);
  return query.get('comment') ?? query.get('thread');
};
/** The app router's location where the layer is inside one (the document page); none in isolation. */
const optionalRouterLocation = () => { try { return useLocation(); } catch { return null; } };

export function AnnotationLayer(props: AnnotationLayerProps): JSX.Element {
  const backend = props.backend ?? createHttpBackend(props.id);
  // A Solid prop getter notifies whenever its source does, even for an equal value. These memos
  // are the dependency list: an effect keyed on one runs on a real change.
  const railOpen = createMemo(() => props.railOpen);
  const pickOnOpen = createMemo(() => props.pickOnOpen !== false);
  const handedSelection = createMemo(() => props.initialSelection ?? null);
  const sessionNonce = createMemo(() => props.sessionNonce ?? null);
  const runtimeRef = createMemo(() => props.runtimeRef);
  const liveAnnotations = createMemo(() => props.liveAnnotations ?? null);
  /** Screenshots are stored by the backend; without that a comment carries none, and says why. */
  const imagesUnavailable = backend.unavailable('commentImages');
  const capture = createCommentCapture(backend, () => props.editId);
  const screenshotExport: { current: (() => Promise<ScreenshotDrawing>) | null } = { current: null };
  let mutation = { signature: '', key: '' };
  const postToFrame = (message: unknown) => { if (props.runtimeRef) sendDocument({ runtimeRef: props.runtimeRef }, message); };

  const [annotations, setAnnotations] = createSignal<AnnotationWire[]>([]);
  const [recentResolved, setRecentResolved] = createSignal<Record<string, { row: AnnotationWire; remaining: number }>>({});
  let previousOpen = new Set<string>();
  const [resolvedList, setResolvedList] = createSignal<AnnotationWire[] | null>(null);
  /*
   * ONE OPEN THREAD, open or resolved. A resolved thread somebody expands IS the open thread: that
   * is what makes the document highlight its passage and scroll to it. Its row is not in
   * `annotations` — never dereference the open id against that list without a fallback.
   */
  const [openId, setOpenId] = createSignal<string | null>(null);
  const [inspectedResolvedId, setInspectedResolvedId] = createSignal<string | null>(null);
  /** What this viewer folded — read from the store, so a remount or a reload cannot lose it. */
  const [folds, setFolds] = createSignal<Folds>(readFolds(props.id));
  /** The thread this viewer just asked for; its newest comment is never folded. */
  const [justOpenedId, setJustOpenedId] = createSignal<string | null>(null);
  const [hoverId, setHoverId] = createSignal<string | null>(null);
  let uiHoverId: string | null = null;
  const hoverUi = (id: string | null) => { uiHoverId = id; setHoverId(id); };
  const [viewStateRequest, setViewStateRequest] = createSignal(0);
  const [viewStateError, setViewStateError] = createSignal<{ id: string; message: string } | null>(null);
  const [missingTargets, setMissingTargets] = createSignal<Set<string>>(new Set());
  const [anchorRects, setAnchorRects] = createSignal<Record<string, StoryEditRect>>({});
  let threadsRoot: HTMLDivElement | undefined;
  let chromeAnchor: HTMLStyleElement | undefined;
  const [selection, setSelection] = createSignal<StoryEditSelection | null>(null);
  /** Select keeps native text selection and outlines blocks; Screenshot draws an area. Page state, never the URL. */
  const [pick, setPick] = createSignal<'block' | 'area' | null>(null);
  // Picking is suspended while its composer is open; finishing the draft resumes it.
  let resumeSelectAfterCompose = false;
  /** On a phone the rail is a bottom sheet — a 320px rail over a 390px screen covers the document. */
  const phoneRail = createIsPhoneViewport();
  const [draft, setDraft] = createSignal('');
  const replaceDraft = setDraft;
  const [availableAgents, setAvailableAgents] = createSignal(0);
  /** Reading the draft as it will be read — a view of the same text, not a mode. */
  const [busy, setBusy] = createSignal(false);
  const [failure, setFailure] = createSignal<string | null>(null);
  const [deleting, setDeleting] = createSignal<string | null>(null);
  const [confirmBusy, setConfirmBusy] = createSignal(false);
  const [confirmError, setConfirmError] = createSignal<string | null>(null);
  const [viewport, setViewport] = createSignal({ width: innerWidth, height: innerHeight });
  onMount(() => {
    const resize = () => setViewport({ width: innerWidth, height: innerHeight });
    window.addEventListener('resize', resize);
    onCleanup(() => window.removeEventListener('resize', resize));
  });
  createForegroundComposer(() => selection() !== null, () => chromeAnchor);

  /** The rail is about to open FOR A THREAD (a pin, a marker): that opening must not start a pick. */
  let openedForThread = false;
  /** The sheet is being put away BY a pick (phone): that closing must not end it. */
  let sheetAwayForPick = false;

  // The page's count follows THIS list: a thread resolved here is reflected at once.
  createEffect(() => { props.onAnnotationsChange?.(annotations()); });
  createEffect(on(annotations, (list) => setInspectedResolvedId((current) => list.some((row) => row.id === current) ? null : current)));
  const hasRemoteWork = createMemo(() => annotations().some((row) => row.remote_work?.length));
  createEffect(() => {
    void railOpen();
    if (!hasRemoteWork() || busy()) return;
    const abort = new AbortController();
    const timer = setInterval(() => {
      void backend.listAnnotations(undefined, { signal: abort.signal }).then((list) => { if (!abort.signal.aborted) setAnnotations(list); }).catch(() => {});
    }, 15000);
    onCleanup(() => { clearInterval(timer); abort.abort(); });
  });

  /*
   * OPENING A THREAD UNFOLDS IT. Somebody who clicks a pin, follows a message or has just written a
   * comment came for an answer; the thread and its newest comment open together, in one write.
   */
  const openThread = (annId: string) => {
    batch(() => {
      setViewStateRequest(value => value + 1);
      capture.reset();
      setPick(null);
      setOpenId(annId);
      setInspectedResolvedId(untrack(annotations).some((row) => row.id === annId) ? null : annId);
      setJustOpenedId(annId);
      setSelection(null);
      const newest = untrack(annotations).find((row) => row.id === annId)?.thread.at(-1)?.id;
      setFolds(unfold(props.id, { threads: [annId], comments: newest ? [newest] : [] }));
    });
    // Only an opening carries the mark: a rail already open sees no change.
    if (!untrack(() => props.railOpen)) openedForThread = true;
    props.onRailOpenChange(true);
  };

  // Notification links identify a comment; resolve it through the authorised open/resolved indexes
  // so a reply opens its containing conversation.
  // A notification followed inside the app changes the query without reloading this page: follow
  // the router's location when there is one, and history navigation either way.
  const routerLocation = optionalRouterLocation();
  const currentSearch = () => routerLocation ? routerLocation.search : typeof location === 'undefined' ? undefined : location.search;
  const [linkedComment, setLinkedComment] = createSignal<string | null>(props.linkTarget ?? linkedFrom(untrack(currentSearch)));
  createEffect(() => { if (props.linkTarget !== undefined) setLinkedComment(props.linkTarget); });
  createEffect(on(currentSearch, (search) => { if (props.linkTarget === undefined) setLinkedComment(linkedFrom(search)); }, { defer: true }));
  onMount(() => {
    const navigate = () => { if (props.linkTarget === undefined) setLinkedComment(linkedFrom(location.search)); };
    window.addEventListener('popstate', navigate);
    onCleanup(() => window.removeEventListener('popstate', navigate));
  });
  let followedLink = false;
  createEffect(on(linkedComment, () => { followedLink = false; }));
  createEffect(() => {
    const linked = linkedComment();
    const rows = [...annotations(), ...(resolvedList() ?? [])];
    if (!linked || followedLink) return;
    const thread = rows.find((row) => row.id === linked || row.thread.some((comment) => comment.id === linked));
    untrack(() => {
      if (thread) { followedLink = true; openThread(thread.id); setFolds(unfold(props.id, { threads: [thread.id], comments: [linked] })); }
      else if (!props.railOpen) { openedForThread = true; props.onRailOpenChange(true); }
    });
  });

  const toggle = (kind: FoldKind, foldId: string) => setFolds(toggleFold(props.id, kind, foldId));

  // The thread a pin opened may sit below the fold — bring it, then its newest comment, into view
  // after the rail has committed. `inline: 'nearest'`: scrollIntoView also scrolls the x-axis.
  createEffect(() => {
    const open = openId();
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

  // Folds are per artifact: a different document's rail starts from its own.
  createEffect(on(() => props.id, (id) => setFolds(readFolds(id)), { defer: true }));

  // The session's own read; the live stream replaces it wholesale.
  onMount(() => {
    const abort = new AbortController();
    void backend.listAnnotations(undefined, { signal: abort.signal }).then((list) => { if (!abort.signal.aborted) setAnnotations(list); }).catch(() => {});
    onCleanup(() => abort.abort());
  });
  createEffect(() => { const live = liveAnnotations(); if (live) setAnnotations(live); });

  // Refresh the authorised resolved index when open threads disappear. Never infer resolution from
  // absence: deletion or revocation must remove the content instead.
  createEffect(() => {
    const open = annotations();
    const railIsOpen = railOpen();
    const before = previousOpen;
    previousOpen = new Set(open.map((row) => row.id));
    const removed = [...before].filter((id) => !previousOpen.has(id));
    const recent = untrack(recentResolved);
    if (!railIsOpen && !removed.length && !Object.keys(recent).length) return;
    const abort = new AbortController();
    void backend.listAnnotations('resolved', { signal: abort.signal }).then((fetched) => {
      if (abort.signal.aborted) return;
      const list = fetched.filter((row) => !open.some((item) => item.id === row.id));
      batch(() => {
        setResolvedList(list);
        setRecentResolved((current) => {
          const next: typeof current = {};
          for (const row of list) {
            const old = current[row.id];
            if (removed.includes(row.id) || old) next[row.id] = { row, remaining: old && old.row.revision === row.revision ? old.remaining : 10000 };
          }
          return next;
        });
        setOpenId((current) => current && (removed.includes(current) || recent[current]) && !list.some((row) => row.id === current) && !previousOpen.has(current) ? null : current);
      });
    }).catch(() => { if (!abort.signal.aborted) batch(() => { setRecentResolved({}); setResolvedList(null); setOpenId(null); }); });
    onCleanup(() => abort.abort());
  });

  /*
   * OPENING THE RAIL OPENS A PICK. Someone who presses "comments" is about to leave one. Not for a
   * rail opened FOR A THREAD, not while a composer is open, not when the page says so (`pickOnOpen`:
   * the editor's narrow comments sheet, which covers the document),
   * and not on a phone, whose sheet covers the document. Closing the rail ends the pick it opened,
   * unless a pick is what put the sheet away. DECLARED BEFORE the handed-in selection below, so a
   * rail opening together with a selection ends with the composer, not the pick.
   */
  const beginPick = (mode: 'block' | 'area') => {
    if (mode === 'block') capture.reset();
    setPick(mode);
    setOpenId(null);
    if (phoneRail() && untrack(() => props.railOpen)) {
      sheetAwayForPick = true;
      props.onRailOpenChange(false);
    }
  };
  const startPick = () => beginPick('block');
  createEffect(on([railOpen, pickOnOpen, phoneRail], ([isOpen, mayPick, phone]) => {
    const composing = untrack(selection) !== null;
    if (isOpen) {
      const forThread = openedForThread;
      openedForThread = false;
      if (!forThread && !untrack(handedSelection) && !composing && mayPick && !phone) startPick();
      return;
    }
    if (sheetAwayForPick) { sheetAwayForPick = false; return; }
    if (untrack(pick) || !composing) capture.reset();
    setPick(null);
  }));
  createEffect(on(pickOnOpen, (mayPick) => {
    if (mayPick) return;
    resumeSelectAfterCompose = false; setPick(null); capture.reset();
  }));

  // A selection handed down by the page opens the composer on those exact words.
  createEffect(() => {
    const handed = handedSelection();
    if (!handed) return;
    untrack(() => {
      resumeSelectAfterCompose = pick() === 'block';
      capture.reset();
      batch(() => { setSelection(handed); setOpenId(null); setFailure(null); setPick(null); });
      props.onSelectionConsumed?.();
    });
  });

  const retainedPinIds = createMemo(() => Object.values(recentResolved()).filter((value) => value.remaining > 0).map((value) => value.row.id).join(','));
  // The pin set, re-posted whole on every change — the runtime holds no annotation state it could
  // get out of step on. Gated on the nonce: its announcement means the runtime's listener exists.
  createEffect(() => {
    if (!sessionNonce()) return;
    void retainedPinIds();
    const open = openId();
    const inspected = inspectedResolvedId();
    const recent = untrack(recentResolved);
    const current = annotations();
    // The ONE resolved thread this viewer expanded rides with the open roots, in the SAME post as
    // its `openId`: the runtime records the scroll as done when an open id arrives.
    const openResolved = open ? (resolvedList() ?? []).find((row) => row.id === open) ?? recent[open]?.row ?? null : null;
    const pins = [...current, ...(openResolved ? [openResolved] : []), ...Object.values(recent).filter((value) => value.remaining > 0 && value.row.id !== openResolved?.id && !current.some((row) => row.id === value.row.id)).map((value) => value.row)]
      .filter((row) => !row.orphaned && row.anchor)
      .map((row) => {
        const anchor = row.anchor! as typeof row.anchor & { nodeId?: string | null };
        return { id: row.id, path: anchor.path, key: anchor.key, nodeId: anchor.nodeId, range: row.range, ...(row.view_state ? {viewState: row.view_state} : {}),
          ...(row.status === 'resolved' && (row.id !== inspected || row.id !== open) ? { layoutOnly: true } : {}) };
      });
    const selected = selection();
    postToFrame({
      type: STORY_ANNOTATIONS_MESSAGE, viewStateRequest: viewStateRequest(), mode: capture.busy() ? 'off' : 'on', pins, openId: open, hoverId: hoverId(),
      selectedPath: selected?.path ?? null, selected, canComment: true, pick: pick(),
    } satisfies StoryAnnotationsMessage);
  });
  // Closing the rail drops what only the rail was showing; the pins stay.
  createEffect(on(railOpen, (open) => { if (!open) setOpenId(null); }));
  onCleanup(() => postToFrame({ type: STORY_ANNOTATIONS_MESSAGE, mode: 'off', pins: [], openId: null, hoverId: null } satisfies StoryAnnotationsMessage));

  // What the document says: pin clicks always; selections only while a pick or a composer is open.
  createEffect(() => {
    const nonce = sessionNonce();
    const runtime = runtimeRef();
    if (!nonce || !runtime) return;
    const unsubscribe = subscribeDocument({ runtimeRef: runtime }, (event) => {
      const data = event.data;
      if (!isEditFrameMessage(data, nonce)) return;
      if (data.type === STORY_SELECTION_ACTION_MESSAGE && data.action === 'select') {
        if (props.pickOnOpen === false) return;
        startPick();
        return;
      }
      if (data.type === STORY_ANNOTATION_LAYOUT_MESSAGE) {
        setViewStateError(data.viewStateError ?? null);
        const next: Record<string, StoryEditRect> = {};
        for (const position of data.positions) next[position.id] = position.rect;
        batch(() => {
          setMissingTargets(new Set(data.positions.filter((position) => position.status === 'missing' || position.status === 'ambiguous').map((position) => position.id)));
          setAnchorRects(next);
        });
        return;
      }
      if (data.type === STORY_ANNOTATION_PIN_MESSAGE) { openThread(data.id); return; }
      if (data.type === STORY_ANNOTATION_HOVER_MESSAGE) { setHoverId(uiHoverId ?? data.id); return; }
      const picking = untrack(pick);
      if (data.type === STORY_SELECTION_MESSAGE && picking) {
        // THE PICK'S ANSWER, and the pick is over either way. Null: escape in the document.
        const picked = data.selection;
        resumeSelectAfterCompose = Boolean(picked) && picking === 'block';
        batch(() => {
          setPick(null);
          if (picked) {
            setSelection(picked);
            const rect = picked.captureRect ?? picked.rect;
            // The rect is in the document's viewport: the page's capture adds where that viewport sits (an inline
            // runtime's is the page's own, at 0,0; a framed document's is the iframe's box).
            const at = props.runtimeRef ? documentRect({ runtimeRef: props.runtimeRef }) : undefined;
            if (picking === 'area') void capture.capture({ ...rect, x: rect.x + (at?.left ?? 0), y: rect.y + (at?.top ?? 0) });
            setOpenId(null);
            setFailure(null);
          } else capture.reset();
        });
        return;
      }
      if (data.type === STORY_SELECTION_MESSAGE && untrack(selection) !== null) {
        const reported = data.selection;
        if (capture.draft() || capture.busy()) return;
        /*
         * The runtime re-reports the composing node's GEOMETRY on every scroll and re-render, with no
         * quote. The words survive a report about the SAME node only: widening to an ancestor is a
         * different subject, and a range addressed from the old anchor would not describe it.
         */
        batch(() => {
          setSelection((previous) => {
            if (JSON.stringify(previous) === JSON.stringify(reported)) return previous;
            const sameIdentity = reported?.nodeId && previous?.nodeId && reported.nodeId === previous.nodeId;
            if (!sameIdentity || reported?.range) return reported;
            const merged = { ...reported, ...(previous.quote ? { quote: previous.quote } : {}), ...(previous.range ? { range: previous.range } : {}), ...(previous.viewState ? {viewState: previous.viewState} : {}), ...(previous.viewStateError ? {viewStateError: previous.viewStateError} : {}) };
            return JSON.stringify(previous) === JSON.stringify(merged) ? previous : merged;
          });
          setFailure(null);
          if (reported) setOpenId(null);
        });
      }
    });
    onCleanup(unsubscribe);
  });

  const act = async (annId: string, body: { reply?: string; resolve?: boolean; reopen?: boolean }) => {
    setBusy(true);
    try {
      const wire = await backend.actOnAnnotation(annId, body);
      batch(() => {
        setAnnotations((prev) => {
          if (wire.status === 'resolved') return prev.filter((row) => row.id !== annId);
          return prev.some((row) => row.id === annId) ? prev.map((row) => (row.id === annId ? wire : row)) : [...prev, wire];
        });
        setResolvedList((prev) => {
          if (!prev) return prev;
          if (wire.status === 'open') return prev.filter((row) => row.id !== annId);
          return prev.some((row) => row.id === annId) ? prev.map((row) => (row.id === annId ? wire : row)) : [...prev, wire];
        });
        if (wire.status === 'resolved') setOpenId((current) => (current === annId ? null : current));
        else if (body.reopen) {
          // It was the open thread while it was resolved history; it stays the open thread.
          setOpenId(annId);
          setJustOpenedId(annId);
        }
      });
      return true;
    } catch { return false; } finally { setBusy(false); }
  };

  const remove = async (annId: string) => {
    setBusy(true);
    try {
      await backend.deleteAnnotation(annId);
      batch(() => {
        setAnnotations((prev) => prev.filter((row) => row.id !== annId));
        setResolvedList((prev) => (prev ? prev.filter((row) => row.id !== annId) : prev));
        setOpenId((current) => (current === annId ? null : current));
      });
    } finally { setBusy(false); }
  };
  const confirmDelete = async () => {
    const annId = deleting();
    if (!annId || confirmBusy()) return;
    setConfirmBusy(true); setConfirmError(null);
    try { await remove(annId); setDeleting(null); }
    catch (cause) { setConfirmError(cause instanceof Error ? cause.message : 'Could not complete this action. Try again.'); }
    finally { setConfirmBusy(false); }
  };
  const askDelete = (annId: string) => { if (deleting()) return; setConfirmError(null); setDeleting(annId); };

  const save = async () => {
    const subject = selection();
    if (!subject || !hasReplyText(draft()) || capture.busy() || (capture.required() && !capture.draft())) return;
    if (!subject.nodeId) {
      setFailure('Wait for this change to save before commenting. Your draft is still here.');
      return;
    }
    setBusy(true);
    setFailure(null);
    try {
      const shot = capture.draft();
      if (shot && !screenshotExport.current) throw new Error('The screenshot is still loading. Please try again.');
      const attachmentId = await capture.stage(shot ? await screenshotExport.current!() : undefined);
      const body = draft();
      const signature = JSON.stringify([subject, body, attachmentId]);
      if (mutation.signature !== signature) mutation = { signature, key: runtimeId() };
      let wire: AnnotationWire;
      try {
        // The exact words ride along when there are any; a caret comment carries neither key.
        wire = await backend.createAnnotation({
          path: subject.path, node_id: subject.nodeId, body,
          ...(attachmentId ? { attachment_id: attachmentId, edit_id: shot!.editId } : {}),
          ...(subject.quote ? { quote: subject.quote } : {}),
          ...(subject.range ? { range: subject.range } : {}),
          ...(subject.viewState ? { view_state: subject.viewState, edit_id: shot?.editId ?? props.editId } : {}),
        }, mutation.key);
      } catch (error) {
        if (!(error instanceof BackendRequestError)) throw error;
        // A guest may READ a thread and may not start one: the login page, and back here with the ask.
        if (error.signInRequired) window.location.assign(loginHref(window.location, 'comment'));
        else setFailure(error.message);
        return;
      }
      capture.reset();
      const resume = resumeSelectAfterCompose;
      resumeSelectAfterCompose = false;
      batch(() => {
        setAnnotations((prev) => [...prev.filter((item) => item.id !== wire.id), wire]);
        setSelection(null);
        replaceDraft('');

        setOpenId(wire.id);
        setJustOpenedId(wire.id);
        if (resume) setPick('block');
      });
      if (!resume) postToFrame({ type: STORY_SELECT_MESSAGE, path: null });
    } catch (error) { setFailure(error instanceof Error ? error.message : 'Could not save the comment. Your draft is still here.'); }
    finally { setBusy(false); }
  };

  const cancelCompose = () => {
    capture.reset();
    batch(() => { setSelection(null); replaceDraft(''); setFailure(null); });
    if (resumeSelectAfterCompose) {
      resumeSelectAfterCompose = false;
      // The next annotation state clears the old target without a null-selection echo cancelling the new pick.
      startPick();
    } else postToFrame({ type: STORY_SELECT_MESSAGE, path: null });
  };

  const submitDraft = () => {
    if (busy() || !hasReplyText(draft())) return;
    void save();
  };

  // ESCAPE IS CANCEL, bound on the window while a composer is open: by the time someone reaches
  // for it the focus may be on the breadcrumb, the buttons, or the document behind.
  createEffect(() => {
    if (!selection()) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      // A pick in progress is what escape cancels first; the draft stays.
      if (untrack(pick)) return;
      event.stopPropagation();
      cancelCompose();
    };
    window.addEventListener('keydown', onKey);
    onCleanup(() => window.removeEventListener('keydown', onKey));
  });
  // Escape ON THE PAGE stands a pick down; escape in the document arrives as a null selection.
  createEffect(() => {
    if (!pick()) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.stopPropagation();
      capture.reset();
      setPick(null);
    };
    window.addEventListener('keydown', onKey);
    onCleanup(() => window.removeEventListener('keydown', onKey));
  });

  const beginScreenshot = async () => {
    if (screenshotUnavailable()) return;
    beginPick('area');
    const preparation = capture.start(); // Only this explicit gesture requests sharing.
    void loadScreenshotEditor().catch(() => {});
    if (await preparation === 'cancelled') beginPick('block');
  };
  // A Select pressed while this code was arriving is started once, on arrival.
  onMount(() => { if (props.pickRequested && props.pickOnOpen !== false) startPick(); });
  const endPick = () => { resumeSelectAfterCompose = false; capture.reset(); setPick(null); };
  const toggleSelect = () => pick() === 'block' ? endPick() : beginPick('block');
  // Without tab capture (Firefox, Safari, plain http) the area tool still runs: the composer takes an uploaded image.
  const screenshotUnavailable = () => imagesUnavailable ?? (!props.editId ? 'Screenshots need a saved document.' : null);

  const topOffset = () => props.topOffset ?? 0;
  // The collapsed identity mark is small enough for phones too; its click opens the same rail as a sheet.
  const floatingRows = createMemo(() => {
    const open = annotations();
    return [...open, ...Object.values(recentResolved()).filter((value) => value.remaining > 0 && !open.some((row) => row.id === value.row.id)).map((value) => value.row)];
  });
  const floating = () => !props.railOpen && Boolean(props.showViewComments) && floatingRows().length > 0;
  const markerRect = () => {
    void viewport();
    return (props.runtimeRef ? documentRect({ runtimeRef: props.runtimeRef }) : undefined) ?? { top: topOffset(), height: innerHeight - topOffset() };
  };
  const placed = createMemo(() => floating() ? positionedComments(floatingRows(), anchorRects(), markerRect(), viewport().height) : []);
  const placedIds = createMemo(() => placed().map((item) => item.annotation.id), undefined, { equals: (a, b) => a.length === b.length && a.every((id, index) => id === b[index]) });
  const placement = (id: string) => placed().find((item) => item.annotation.id === id);

  const visibleResolved = createMemo(() => placed().filter((item) => item.top >= 0 && item.top + VIEW_COMMENT_COLLAPSED_H <= viewport().height).map((item) => item.annotation.id).join(','));
  const counting = createMemo(() => Object.values(recentResolved()).some((value) => value.remaining > 0));
  createEffect(() => {
    if (!floating() || !counting()) return;
    const visible = new Set(visibleResolved().split(','));
    const hover = hoverId();
    const open = openId();
    let last = performance.now();
    const timer = setInterval(() => {
      const now = performance.now(), elapsed = Math.min(250, now - last);
      last = now;
      if (document.visibilityState !== 'visible') return;
      setRecentResolved((current) => {
        let changed = false;
        const next = Object.fromEntries(Object.entries(current).map(([key, value]) => {
          if (value.remaining <= 0 || !visible.has(key) || key === hover || key === open) return [key, value];
          changed = true;
          return [key, { ...value, remaining: Math.max(0, value.remaining - elapsed) }];
        }));
        return changed ? next : current;
      });
    }, 100);
    onCleanup(() => clearInterval(timer));
  });

  // The breadcrumb the edit toolbar taught: nearest ancestors, outermost first.
  const crumbs = () => { const current = selection(); return current ? [...current.ancestors.slice(-2), { path: current.path, tag: current.tag, hint: '' }] : []; };
  // The document is full-width under an open rail, so what the composer and the pill may use is the
  // document LESS the rail — never its own width.
  const railWidth = () => props.panelWidth ?? (props.railOpen && !phoneRail() && !props.railSheet && props.railHost === undefined ? RIGHT_RAIL_W : 0);
  const frameRect = createMemo(() => {
    const { width } = viewport();
    const measured = props.runtimeRef ? documentRect({ runtimeRef: props.runtimeRef }) : undefined;
    return measured
      ? { left: measured.left, top: measured.top, width: Math.max(0, measured.width - railWidth()) }
      : { left: 0, top: topOffset(), width: width - railWidth() };
  });
  const composerPosition = createMemo(() => {
    const current = selection();
    return current ? positionedComposer(current, frameRect(), viewport().width, viewport().height, capture.required()) : null;
  });

  const openIds = createMemo(() => annotations().map((row) => row.id), undefined, { equals: (a, b) => a.length === b.length && a.every((id, index) => id === b[index]) });
  const resolvedIds = createMemo(() => (resolvedList() ?? []).map((row) => row.id), undefined, { equals: (a, b) => a.length === b.length && a.every((id, index) => id === b[index]) });
  const openRow = (id: string) => annotations().find((row) => row.id === id);
  const resolvedRow = (id: string) => (resolvedList() ?? []).find((row) => row.id === id);

  const railHeader = () => <div class="space-y-2 border-b border-edge px-1 pb-3 font-sans">
    <div class="flex items-center justify-between">
      <h2 class="font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-faint">comments</h2>
      <button type="button" aria-label="Close comments" onClick={() => props.onRailOpenChange(false)} class="inline-flex h-6 w-6 cursor-pointer items-center justify-center rounded-[3px] text-muted hover:bg-surface hover:text-fg"><X size={14} strokeWidth={1.8} /></button>
    </div>
    <div role="group" aria-label="Comment tools" class="grid grid-cols-2 gap-2">
      <button type="button" aria-label="Select" aria-pressed={pick() === 'block'} onClick={toggleSelect}
        class={`flex min-h-16 cursor-pointer flex-col items-center justify-center gap-1 rounded-lg border px-3 py-2 ${pick() === 'block' ? 'border-accent bg-accent-soft text-accent' : 'border-edge bg-panel text-fg hover:bg-surface'}`}>
        <span class="flex items-center gap-2 text-sm font-semibold"><SquareDashedMousePointer size={18} />Select</span>
        <span class="text-[11px]">Block or text</span>
      </button>
      <FeatureGate reason={screenshotUnavailable()} class="flex">
        {(gate) => <button type="button" aria-label="Screenshot" aria-pressed={capture.required()} onClick={() => void beginScreenshot()} {...gate}
          class={`flex min-h-16 w-full cursor-pointer flex-col items-center justify-center gap-1 rounded-lg border px-3 py-2 disabled:cursor-default disabled:opacity-50 ${capture.required() ? 'border-accent bg-accent-soft text-accent' : 'border-edge bg-panel text-fg hover:bg-surface'}`}>
          <span class="flex items-center gap-2 text-sm font-semibold"><Camera size={18} />Screenshot</span>
          <span class="text-[11px]">Capture an area</span>
        </button>}
      </FeatureGate>
    </div>
    <p class="text-[11px] leading-relaxed text-muted">{capture.required() ? 'Share this tab, then drag an area.' : 'Select a block or highlight text to comment.'}</p>
  </div>;

  const threadHandlers = (id: string, resolved: boolean) => ({
    onHover: hoverUi,
    onDelete: () => askDelete(id),
    onToggleFold: () => toggle('threads', id),
    onToggleComment: (commentId: string) => toggle('comments', commentId),
    ...(resolved ? {
      // Expanding it makes it the open thread — the document highlights its passage and scrolls there.
      onOpen: () => batch(() => { setJustOpenedId(id); setInspectedResolvedId(id); setOpenId((current) => current === id ? null : id); }),
      onReply: async () => false,
      onResolve: () => {},
      onReopen: () => void act(id, { reopen: true }),
    } : {
      onOpen: () => openThread(id),
      onReply: (body: string) => act(id, { reply: body }),
      onResolve: () => void act(id, { resolve: true }),
      onReopen: () => {},
    }),
  });

  return <PersonMentionProvider artifactId={props.id} backend={backend}>
    <CommentsOffline.Provider value={backend.mode === 'offline'}>
      <style ref={chromeAnchor}>{CAPTURE_CHROME_CSS}</style>
      <Show when={capture.busy() && !selection()}>
        <div data-capture-chrome role="status" class="fixed bottom-4 left-4 z-50 rounded bg-panel p-3 shadow">Preparing screenshot… <button type="button" onClick={() => capture.reset()}>Cancel capture</button></div>
      </Show>

      {/* The ambient surface: tiny open-thread identities over the document's right edge, at their anchors. */}
      <Show when={floating()}>
        <div data-capture-chrome aria-label="Open annotation comments" class="pointer-events-none fixed inset-0 z-20">
          <For each={placedIds()}>{(id) => (
            <Show when={placement(id)}>{(item) => (
              <AnnotationPreview row={item().annotation} top={item().top} remaining={recentResolved()[id]?.remaining}
                hovered={hoverId() === id} rightInset={props.panelWidth} onOpen={() => openThread(id)} onHover={hoverUi} />
            )}</Show>
          )}</For>
        </div>
      </Show>

      {/* The pick's only indicator once the rail is away, and the phone's only way out of it. */}
      <Show when={pick()}>
        <div role="status" data-capture-chrome aria-label={pick() === 'area' ? 'Screenshot tool active' : 'Select tool active'}
          class={`${cardClass} fixed z-30 flex items-center gap-2 border-edge-bright px-3 py-1.5 font-mono text-[11px] text-muted shadow-xl`}
          style={{ left: `${frameRect().left + frameRect().width / 2}px`, top: `${Math.max(topOffset(), frameRect().top, phoneRail() ? APP_BAR_H : 0) + VIEW_COMMENT_INSET}px`, transform: 'translateX(-50%)' }}>
          <SquareDashedMousePointer size={12} strokeWidth={1.8} class="shrink-0 text-accent" />
          <span class="whitespace-nowrap">{pick() === 'area' ? (capture.busy() ? 'Choose this tab in the sharing dialog' : 'drag an area to screenshot') : 'click a block or highlight text to comment'}</span>
          <button type="button" aria-label="Cancel picking" onClick={endPick}
            class="inline-flex h-5 w-5 shrink-0 cursor-pointer items-center justify-center rounded-[3px] text-muted hover:bg-surface hover:text-fg">
            <X size={12} strokeWidth={1.8} />
          </button>
        </div>
      </Show>

      {/* Drafts belong to the thing being discussed; the saved conversation moves to the rail. */}
      <Show when={selection() && composerPosition() && !pick()}>
        <section data-capture-chrome role="dialog" aria-label="Annotation composer" class={`${cardClass} fixed z-30 overflow-y-auto border-edge-bright shadow-xl`}
          style={{ left: `${composerPosition()!.left}px`, top: `${composerPosition()!.top}px`, width: `${composerPosition()!.width}px`, 'max-height': `calc(100vh - ${composerPosition()!.top + VIEW_COMMENT_INSET}px)` }}>
          <div class="flex items-center gap-2 border-b border-edge px-3 py-2.5">
            <span class="inline-flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full border border-accent/25 bg-accent-soft text-accent"><MessageSquare size={12} strokeWidth={1.8} /></span>
            <span class="text-xs font-semibold text-fg">Add comment</span>
            <span class="ml-auto font-sans text-[10px] text-muted">{availableAgents()} {availableAgents() === 1 ? 'agent' : 'agents'} available</span>
            <button type="button" aria-label="Close annotation composer" onClick={cancelCompose}
              class="ml-auto inline-flex h-6 w-6 cursor-pointer items-center justify-center rounded-[3px] text-muted hover:bg-surface hover:text-fg"><X size={14} strokeWidth={1.8} /></button>
          </div>
          <div class="p-3">
            <Show when={capture.busy()}><div role="status" class="mb-3 flex items-center gap-2 rounded-lg border border-edge bg-surface p-4 text-sm text-muted"><LoaderCircle size={16} class="animate-spin" />Preparing screenshot…</div></Show>
            <Show when={capture.draft()} keyed>{(shot) => (
              <Suspense fallback={<div role="status" class="mb-3 flex items-center gap-2 rounded-lg border border-edge bg-surface p-4 text-sm text-muted"><LoaderCircle size={16} class="animate-spin" />Loading screenshot…</div>}>
                <ScreenshotEditor image={shot.image} initialStrokes={shot.strokes} exportRef={screenshotExport} busy={busy()} onRetake={() => void beginScreenshot()} />
              </Suspense>
            )}</Show>
            <Show when={capture.required() && !capture.draft() && !capture.busy()}>
              <div class="mb-3 space-y-3 rounded-lg border border-edge bg-surface p-3 text-xs">
                <p role="alert" class="leading-relaxed text-muted">{capture.error() || 'A screenshot is required for this selection.'}</p>
                <button type="button" class="rounded-lg border border-edge bg-panel px-3 py-2 font-medium hover:border-accent" onClick={() => void beginScreenshot()}>Retry screenshot</button>
                <label class="block space-y-2 font-medium">Upload screenshot<input class="block w-full text-xs text-muted file:mr-2 file:rounded-md file:border-0 file:bg-panel file:px-3 file:py-2 file:text-fg" type="file" accept="image/png,image/jpeg,image/webp" aria-label="Upload screenshot"
                  onChange={(event) => { const file = event.currentTarget.files?.[0]; if (file) void capture.upload(file); event.currentTarget.value = ''; }} /></label>
                <button type="button" class="text-muted underline underline-offset-4 hover:text-fg" onClick={() => capture.skip()}>Continue without screenshot</button>
              </div>
            </Show>
            <Show when={props.editId && imagesUnavailable}>
              <div class="mb-3"><FeatureGate reason={imagesUnavailable}>{(gate) => <button type="button" class="rounded-lg border border-edge bg-panel px-3 py-2 text-xs font-medium disabled:opacity-50" {...gate}>Attach screenshot</button>}</FeatureGate></div>
            </Show>
            <CommentMarkdownField backend={backend} artifactId={props.id}
              label="Annotation comment" quickAgents onAgentCount={setAvailableAgents}
              value={draft()} onChange={setDraft} onSubmit={submitDraft}

              rows={3} autoFocus={!capture.busy()} placeholder="Write a comment…">
              <div class="flex min-w-0 items-center gap-1 overflow-hidden font-mono text-[11px] text-muted">
                <For each={crumbs()}>{(crumb, index) => (
                  <span class="flex min-w-0 items-center gap-1">
                    <Show when={index() > 0}><span>›</span></Show>
                    <Show when={crumb.path !== selection()?.path} fallback={<span class="truncate text-accent">{crumb.tag}</span>}>
                      <Tooltip content={crumb.hint || crumb.tag}>
                        <button type="button" aria-label={`Select ${crumb.tag}`} disabled={!!capture.draft() || capture.busy()}
                          onClick={() => postToFrame({ type: STORY_SELECT_MESSAGE, path: crumb.path })}
                          class="cursor-pointer truncate underline decoration-dotted hover:text-accent">{crumb.tag}</button>
                      </Tooltip>
                    </Show>
                  </span>
                )}</For>
              </div>
            </CommentMarkdownField>
            <Show when={selection()?.viewStateError}><p role="status" class="mb-2 text-xs text-muted">{selection()?.viewStateError}</p></Show>
            <Show when={failure()}><p role="alert" class="mb-2 font-mono text-[11px] text-danger">{failure()}</p></Show>
            <div class="flex items-center justify-end gap-2">
              <CommentSubmitHint action="comment" />
              <button type="button" aria-label="Cancel annotation" onClick={cancelCompose}
                class="cursor-pointer rounded-[4px] bg-transparent px-2 py-1 text-muted hover:bg-surface hover:text-fg">cancel</button>
              <button type="button" aria-label="Save annotation" disabled={busy() || capture.busy() || (capture.required() && !capture.draft()) || !hasReplyText(draft())} onClick={submitDraft}
                class="cursor-pointer rounded-[4px] border border-accent bg-accent px-2 py-1 font-semibold text-bg hover:brightness-110 disabled:cursor-default disabled:opacity-40">comment</button>
            </div>
          </div>
        </section>
      </Show>

      {/* The rail — a panel, open in either mode; a bottom sheet on a phone. */}
      <Show when={props.railOpen && props.railHost !== null}>
        <RailChrome phone={phoneRail() || !!props.railSheet} host={props.railHost ?? undefined} topOffset={topOffset()} rightInset={props.rightInset ?? 0}
          onClose={() => props.onRailOpenChange(false)} header={railHeader()}>
          <div ref={threadsRoot} class="contents">
            <Show when={annotations().length === 0 && !selection()}>
              <p class="p-2 font-mono text-xs text-muted">no open comments — select text in the document, or pick a block, to leave one</p>
            </Show>
            <For each={openIds()}>{(id) => (
              <Show when={openRow(id)}>{(row) => (
                <AnnotationThread artifactId={props.id} backend={backend} a={row()} open={openId() === id} hovered={hoverId() === id} busy={busy()}
                  viewStateError={viewStateError()?.id === id ? viewStateError()?.message : undefined} targetMissing={missingTargets().has(id)} folded={isFolded(folds(), 'threads', id)} justOpened={justOpenedId() === id}
                  isCommentFolded={(commentId) => isFolded(folds(), 'comments', commentId)} {...threadHandlers(id, false)} />
              )}</Show>
            )}</For>
            <div role="separator" aria-labelledby="resolved-annotations-heading" class="mt-1 flex items-center gap-2 px-1">
              <span aria-hidden="true" class="h-px flex-1 bg-edge" />
              <h2 id="resolved-annotations-heading" class="shrink-0 font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-faint">resolved</h2>
              <span aria-hidden="true" class="h-px flex-1 bg-edge" />
            </div>
            <For each={resolvedIds()}>{(id) => (
              <Show when={resolvedRow(id)}>{(row) => (
                <AnnotationThread artifactId={props.id} backend={backend} a={row()} open={openId() === id} resolved hovered={hoverId() === id} busy={busy()}
                  viewStateError={viewStateError()?.id === id ? viewStateError()?.message : undefined} targetMissing={missingTargets().has(id)} folded={isFolded(folds(), 'threads', id)} justOpened={justOpenedId() === id}
                  isCommentFolded={(commentId) => isFolded(folds(), 'comments', commentId)} {...threadHandlers(id, true)} />
              )}</Show>
            )}</For>
            <Show when={(resolvedList()?.length ?? 0) === 0}>
              <p class="p-2 font-mono text-xs text-muted">nothing resolved yet</p>
            </Show>
          </div>
        </RailChrome>
      </Show>

      <Show when={deleting()}>
        <ConfirmDialog {...DELETE_CONFIRMATION} danger busy={confirmBusy()} error={confirmError()}
          onCancel={() => { if (!confirmBusy()) setDeleting(null); }} onConfirm={() => void confirmDelete()} />
      </Show>
    </CommentsOffline.Provider>
  </PersonMentionProvider>;
}
