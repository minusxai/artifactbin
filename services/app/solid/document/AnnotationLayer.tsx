/* @jsxImportSource solid-js */
import { createEffect, createMemo, createSignal, untrack, For, onCleanup, onMount, Show, type JSX } from 'solid-js';
import type { AnnotationWire } from '@/lib/annotations';
import type { ArtifactBackend } from '@/lib/artifact-backend/types';
import { createHttpBackend } from '@/lib/artifact-backend/http';
import { BackendRequestError } from '@/lib/artifact-backend/errors';
import { loginHref } from '@/lib/login-href';
import { documentRect, sendDocument, subscribeDocument, type DocumentRuntimeRef } from '@/lib/story-runtime/document-endpoint';
import { isEditFrameMessage, STORY_ANNOTATIONS_MESSAGE, STORY_ANNOTATION_PIN_MESSAGE, STORY_ANNOTATION_LAYOUT_MESSAGE, STORY_ANNOTATION_HOVER_MESSAGE, STORY_SELECTION_ACTION_MESSAGE, STORY_SELECTION_MESSAGE, STORY_SELECT_MESSAGE, type StoryAnnotationsMessage, type StoryEditRect, type StoryEditSelection } from '@/lib/story-runtime/contract';
import { AnnotationRail } from './AnnotationRail';
import { CommentMarkdownField } from './CommentMarkdown';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { isFolded, readFolds, toggleFold, unfold } from '@/lib/comment-folds';
import { parseMarkdownLite, plainText } from '@/lib/markdown-lite';
import { hasReplyText, remoteWorkLabel, replyMentionPrefix } from '@/lib/remote-reply';
import { createCommentCapture } from './CommentCapture';
import { AnnotationPreview, AuthorIdentity, CommentTime, positionedComments, replyParticipants } from './AnnotationPreview';
import { ScreenshotEditor, type ScreenshotDrawing } from './ScreenshotEditor';
import { CommentScreenshot } from './CommentScreenshot';
import { CommentFoldingBody } from './CommentFoldingBody';
import { positionedComposer } from './AnnotationComposerPosition';
import { remoteMention } from '@/lib/remote-reply';
import { APP_BAR_H, RIGHT_RAIL_W } from '@/lib/story/edit-bar';

export interface AnnotationLayerProps {
  id: string; backend?: ArtifactBackend; railOpen: boolean; onRailOpenChange: (open: boolean) => void;
  liveAnnotations?: AnnotationWire[] | null; onAnnotationsChange?: (items: AnnotationWire[]) => void;
  initialSelection?: StoryEditSelection | null; onSelectionConsumed?: () => void;
  topOffset?: number; rightInset?: number; railHost?: HTMLElement; railSheet?: boolean;
  runtimeRef?: DocumentRuntimeRef; sessionNonce?: string | null; showViewComments?: boolean;
  pickOnOpen?: boolean; pickRequested?: boolean; editId?: string; panelWidth?: number;
  linkTarget?: string | null;
}

/** The page owns the active selection; the layer owns comments and draft state. */
export function AnnotationLayer(props: AnnotationLayerProps): JSX.Element {
  const backend = props.backend ?? createHttpBackend(props.id);
  const capture = createCommentCapture(backend, props.editId);
  const screenshotExport: { current: (() => Promise<ScreenshotDrawing>) | null } = { current: null };
  const [items, setItems] = createSignal<AnnotationWire[]>([]);
  const [resolved, setResolved] = createSignal<AnnotationWire[]>([]);
  const [recentResolved, setRecentResolved] = createSignal<Record<string, { row: AnnotationWire; remaining: number }>>({});
  const [selection, setSelection] = createSignal<StoryEditSelection | null>(props.initialSelection ?? null);
  const [draft, setDraft] = createSignal('');
  let draftTouched = false;
  const editDraft = (value: string) => { draftTouched = true; setDraft(value); };
  const [reply, setReply] = createSignal<Record<string, string>>({});
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal('');
  const [showResolved, setShowResolved] = createSignal(false);
  const [deleting, setDeleting] = createSignal<string | null>(null);
  const [openId, setOpenId] = createSignal<string | null>(null);
  const [inspectedResolvedId, setInspectedResolvedId] = createSignal<string | null>(null);
  const [justOpenedId, setJustOpenedId] = createSignal<string | null>(null);
  const [menuOpen, setMenuOpen] = createSignal<string | null>(null);
  let menuRoot: HTMLDivElement | undefined;
  let mutation = { signature: '', key: '' };
  const [folds, setFolds] = createSignal(readFolds(props.id));
  const [pick, setPick] = createSignal<'block' | 'area' | null>(props.pickRequested ? 'block' : null);
  let resumeSelectAfterCompose = false;
  let lastRailOpen = false;
  let openedForThread = false;
  let sheetAwayForPick = false;
  const endPick = () => { resumeSelectAfterCompose = false; setPick(null); capture.reset(); sheetAwayForPick = false; };
  const beginPick = (mode: 'block' | 'area') => {
    if (mode === 'block') capture.reset();
    setPick(mode); setOpenId(null);
    if (props.railSheet && props.railOpen) { sheetAwayForPick = true; props.onRailOpenChange(false); }
  };
  const beginScreenshot = async () => {
    if (!props.editId || backend.unavailable('commentImages')) return;
    beginPick('area');
    if (await capture.start() === 'cancelled') beginPick('block');
  };
  const screenshotUnavailable = () => backend.unavailable('commentImages') ?? (!props.editId ? 'Screenshots need a saved document.' : null);
  const [hoverId, setHoverId] = createSignal<string | null>(null);
  const [anchorRects, setAnchorRects] = createSignal<Record<string, StoryEditRect>>({});
  const [linkTarget, setLinkTarget] = createSignal<string | null>(props.linkTarget ?? (typeof location === 'undefined' ? null : new URLSearchParams(location.search).get('comment') ?? new URLSearchParams(location.search).get('thread')));
  let followedLink: string | null = null;
  let soughtResolved: string | null = null;
  let threadsRoot: HTMLDivElement | undefined;
  createEffect(() => { if (props.linkTarget !== undefined) setLinkTarget(props.linkTarget); });
  onMount(() => {
    const navigate = () => { if (props.linkTarget === undefined) setLinkTarget(new URLSearchParams(location.search).get('comment') ?? new URLSearchParams(location.search).get('thread')); };
    window.addEventListener('popstate', navigate);
    onCleanup(() => window.removeEventListener('popstate', navigate));
  });
  createEffect(() => {
    const railOpen = props.railOpen;
    const canPick = props.pickOnOpen !== false;
    if (!canPick) { resumeSelectAfterCompose = false; setPick(null); capture.reset(); sheetAwayForPick = false; }
    else if (railOpen && !lastRailOpen && !selection() && !openId() && !openedForThread && !props.railSheet) {
      setPick('block');
    }
    else if (!railOpen && lastRailOpen && !sheetAwayForPick) { if (pick() || !selection()) capture.reset(); setPick(null); }
    if (railOpen && !lastRailOpen) openedForThread = false;
    lastRailOpen = railOpen;
  });
  createEffect(() => {
    const live = props.liveAnnotations;
    if (!live) return;
    const expanded = openId();
    const removed = new Set(items().filter(row => !live.some(next => next.id === row.id)).map(row => row.id));
    setItems(live);
    if (removed.size) void backend.listAnnotations('resolved').then(rows => {
      setResolved(rows);
      if (expanded && rows.some(row => row.id === expanded)) setShowResolved(true);
      setRecentResolved(previous => {
        const next = { ...previous };
        for (const row of rows) {
          if (!removed.has(row.id) && !previous[row.id]) continue;
          const old = previous[row.id];
          next[row.id] = { row, remaining: old?.row.revision === row.revision ? old.remaining : 10000 };
        }
        return next;
      });
    }).catch(() => {});
  });
  createEffect(() => {
    const open = new Set(items().map(row => row.id));
    if (open.has(inspectedResolvedId() ?? '')) setInspectedResolvedId(null);
    setRecentResolved(previous => {
      const next = Object.fromEntries(Object.entries(previous).filter(([id]) => !open.has(id)));
      return Object.keys(next).length === Object.keys(previous).length ? previous : next;
    });
  });
  createEffect(() => { props.onAnnotationsChange?.(items()); });
  createEffect(() => {
    if (!menuOpen()) return;
    const dismiss = (event: PointerEvent) => { if (!menuRoot || !event.composedPath().includes(menuRoot)) setMenuOpen(null); };
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') setMenuOpen(null); };
    document.addEventListener('pointerdown', dismiss);
    document.addEventListener('keydown', escape);
    onCleanup(() => { document.removeEventListener('pointerdown', dismiss); document.removeEventListener('keydown', escape); });
  });
  createEffect(() => {
    if (!props.sessionNonce || !props.runtimeRef) return;
    const expandedResolved = resolved().find(row => row.id === openId());
    const recent = Object.values(recentResolved()).filter(value => value.remaining > 0 && value.row.id !== expandedResolved?.id).map(value => value.row);
    const pins = [...items(), ...(expandedResolved ? [expandedResolved] : []), ...recent].filter(row => !row.orphaned && row.anchor).map(row => {
      const anchor = row.anchor! as typeof row.anchor & { nodeId?: string | null };
      return { id: row.id, path: anchor.path, key: anchor.key, nodeId: anchor.nodeId, range: row.range,
        ...(row.status === 'resolved' && (row.id !== inspectedResolvedId() || row.id !== openId()) ? { layoutOnly: true } : {}) };
    });
    sendDocument({ runtimeRef: props.runtimeRef }, { type: STORY_ANNOTATIONS_MESSAGE, mode: capture.busy() ? 'off' : 'on', pins, openId: openId(), hoverId: hoverId(), selectedPath: selection()?.path ?? null, selected: selection(), canComment: true, pick: pick() } satisfies StoryAnnotationsMessage);
  });
  createEffect(() => {
    if (!props.initialSelection) return;
    resumeSelectAfterCompose = untrack(pick) === 'block';
    capture.reset();
    setPick(null);
    setSelection(props.initialSelection);
  });
  createEffect(() => {
    if (!selection()) { draftTouched = false; return; }
    if (backend.unavailable('remoteSessions')) return;
    const controller = new AbortController();
    void backend.remoteSessions({ signal: controller.signal }).then(answer => {
      if (controller.signal.aborted || draftTouched) return;
      const online = (answer.sessions ?? []).filter(session => session.online && session.activity !== 'stopped' && session.exitCode === null);
      if (online.length === 1) setDraft(remoteMention(online[0]!));
    }).catch(() => {});
    onCleanup(() => controller.abort());
  });
  createEffect(() => {
    if (!pick() && !selection()) return;
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.stopPropagation();
      if (pick()) { setPick(null); capture.reset(); }
      else cancelComposer();
    };
    window.addEventListener('keydown', escape);
    onCleanup(() => window.removeEventListener('keydown', escape));
  });
  onMount(() => {
    const controller = new AbortController();
    void backend.listAnnotations(undefined, { signal: controller.signal }).then(rows => { if (!controller.signal.aborted) setItems(rows); }).catch(cause => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'Could not load comments.'); });
    onCleanup(() => controller.abort());
  });
  createEffect(() => {
    const nonce = props.sessionNonce;
    const runtimeRef = props.runtimeRef;
    if (runtimeRef && nonce) {
      const unsubscribe = subscribeDocument({ runtimeRef }, event => {
        if (!isEditFrameMessage(event.data, nonce)) return;
        if (event.data.type === STORY_ANNOTATION_PIN_MESSAGE) { openThread(event.data.id); }
        if (event.data.type === STORY_ANNOTATION_HOVER_MESSAGE) setHoverId(event.data.id);
        if (event.data.type === STORY_ANNOTATION_LAYOUT_MESSAGE) setAnchorRects(Object.fromEntries(event.data.positions.map(position => [position.id, position.rect])));
        if (event.data.type === STORY_SELECTION_ACTION_MESSAGE && event.data.action === 'select' && props.pickOnOpen !== false) beginPick('block');
        if (event.data.type === STORY_SELECTION_MESSAGE && pick()) {
          const screenshot = pick() === 'area';
          resumeSelectAfterCompose = Boolean(event.data.selection) && pick() === 'block';
          setPick(null);
          if (event.data.selection) {
            setSelection(event.data.selection); setOpenId(null);
            const rect = event.data.selection.captureRect ?? event.data.selection.rect;
            const viewport = documentRect({ runtimeRef });
            if (screenshot) void capture.capture({ ...rect, x: rect.x + (viewport?.left ?? 0), y: rect.y + (viewport?.top ?? 0) });
          } else capture.reset();
        } else if (event.data.type === STORY_SELECTION_MESSAGE && selection()) {
          if (capture.busy() || capture.draft()) return;
          const reported = event.data.selection;
          setSelection(previous => {
            const next = reported && previous?.nodeId && reported.nodeId === previous.nodeId
              ? { ...reported, ...(previous.quote ? { quote: previous.quote } : {}), ...(previous.range ? { range: previous.range } : {}) } : reported;
            return JSON.stringify(previous) === JSON.stringify(next) ? previous : next;
          });
        }
      });
      onCleanup(() => {
        unsubscribe();
        sendDocument({ runtimeRef }, { type: STORY_ANNOTATIONS_MESSAGE, mode: 'off', pins: [], openId: null, hoverId: null } satisfies StoryAnnotationsMessage);
      });
    }
  });
  const act = async (id: string, body: { reply?: string; resolve?: boolean; reopen?: boolean }) => {
    if (busy()) return;
    setBusy(true); setError('');
    try {
      const answer = await backend.actOnAnnotation(id, body);
      setItems(previous => answer.status === 'resolved' ? previous.filter(row => row.id !== id) : previous.some(row => row.id === id) ? previous.map(row => row.id === id ? answer : row) : [...previous, answer]);
      setResolved(previous => answer.status === 'open' ? previous.filter(row => row.id !== id) : previous.some(row => row.id === id) ? previous.map(row => row.id === id ? answer : row) : [...previous, answer]);
      if (answer.status === 'resolved') setRecentResolved(previous => ({ ...previous, [id]: { row: answer, remaining: 10000 } }));
      else setRecentResolved(previous => { const next = { ...previous }; delete next[id]; return next; });
      if (body.reply) setReply(previous => ({ ...previous, [id]: replyMentionPrefix(answer.thread) }));
      if (answer.status === 'resolved') setOpenId(null);
      else if (body.reopen) { setOpenId(id); setJustOpenedId(id); }
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not update this comment.'); }
    finally { setBusy(false); }
  };
  const remove = async (id: string) => {
    if (busy()) return;
    setBusy(true); setError('');
    try { await backend.deleteAnnotation(id); setItems(previous => previous.filter(row => row.id !== id)); setResolved(previous => previous.filter(row => row.id !== id)); setDeleting(null); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not delete this comment.'); }
    finally { setBusy(false); }
  };
  const post = async () => {
    const target = selection();
    if (!target || !hasReplyText(draft()) || busy() || capture.busy() || (capture.required() && !capture.draft())) return;
    if (!target.nodeId) { setError('Wait for this change to save before commenting. Your draft is still here.'); return; }
    setBusy(true); setError('');
    try {
      if (capture.draft() && !screenshotExport.current) throw new Error('The screenshot is still loading. Please try again.');
      const attachmentId = await capture.stage(capture.draft() ? await screenshotExport.current!() : undefined);
      const signature = JSON.stringify([target, draft(), attachmentId]);
      if (mutation.signature !== signature) mutation = { signature, key: crypto.randomUUID() };
      const row = await backend.createAnnotation({ path: target.path, node_id: target.nodeId, body: draft(), ...(target.quote ? { quote: target.quote } : {}), ...(target.range ? { range: target.range } : {}), ...(attachmentId ? { attachment_id: attachmentId, edit_id: capture.draft()!.editId } : {}) }, mutation.key);
      setItems(previous => [...previous.filter(item => item.id !== row.id), row]);
      setDraft(''); setSelection(null); capture.reset(); props.onSelectionConsumed?.(); setOpenId(row.id); setJustOpenedId(row.id);
      if (resumeSelectAfterCompose) { resumeSelectAfterCompose = false; setPick('block'); }
      else sendDocument({ runtimeRef: props.runtimeRef }, { type: STORY_SELECT_MESSAGE, path: null });
    } catch (cause) {
      if (cause instanceof BackendRequestError && cause.signInRequired) location.assign(loginHref(location, 'comment'));
      else setError(cause instanceof Error ? cause.message : 'Could not save the comment. Your draft is still here.');
    } finally { setBusy(false); }
  };
  const loadResolved = async () => {
    if (showResolved()) { setShowResolved(false); return; }
    try { setResolved(await backend.listAnnotations('resolved')); setShowResolved(true); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not load resolved comments.'); }
  };
  const openThread = (id: string) => {
    openedForThread = true;
    capture.reset();
    setPick(null);
    setOpenId(id);
    setJustOpenedId(id);
    const row = [...items(), ...resolved()].find(item => item.id === id);
    setInspectedResolvedId(row?.status === 'resolved' ? id : null);
    if (row?.status === 'resolved') setShowResolved(true);
    if (row) setReply(previous => previous[id] !== undefined ? previous : { ...previous, [id]: replyMentionPrefix(row.thread) });
    setFolds(unfold(props.id, { threads: [id], comments: row?.thread.at(-1) ? [row.thread.at(-1)!.id] : [] }));
    props.onRailOpenChange(true);
  };
  createEffect(() => {
    const target = linkTarget();
    if (!target || target === followedLink) return;
    const row = [...items(), ...resolved()].find(item => item.id === target || item.thread.some(comment => comment.id === target));
    if (row) {
      followedLink = target;
      if (row.status === 'resolved') setShowResolved(true);
      openThread(row.id);
      setFolds(unfold(props.id, { threads: [row.id], comments: [target] }));
    } else if (target !== soughtResolved) {
      soughtResolved = target;
      void backend.listAnnotations('resolved').then(rows => setResolved(rows)).catch(() => {});
    }
  });
  createEffect(() => {
    const id = openId();
    const targetComment = linkTarget();
    if (!id || !props.railOpen) return;
    const frame = requestAnimationFrame(() => {
      const target = Array.from(threadsRoot?.querySelectorAll<HTMLElement>('[data-thread-id]') ?? []).find(node => node.dataset.threadId === id);
      target?.scrollIntoView?.({ block: 'start', inline: 'nearest' });
      const comments = Array.from(target?.querySelectorAll<HTMLElement>('[data-comment-id]') ?? []);
      (comments.find(comment => comment.dataset.commentId === targetComment) ?? comments.at(-1))?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
    });
    onCleanup(() => cancelAnimationFrame(frame));
  });
  const foldThread = (id: string) => setFolds(toggleFold(props.id, 'threads', id));
  const foldComment = (id: string) => setFolds(toggleFold(props.id, 'comments', id));
  const preview = (body: string) => plainText(parseMarkdownLite(body));
  const frameArea = createMemo(() => {
    const railWidth = props.panelWidth ?? (props.railOpen && !props.railSheet && !props.railHost ? RIGHT_RAIL_W : 0);
    const measured = props.runtimeRef?.current?.getViewportRect ? documentRect({ runtimeRef: props.runtimeRef }) : undefined;
    return measured ? { left: measured.left, top: measured.top, width: Math.max(0, measured.width - railWidth) }
      : { left: 0, top: props.topOffset ?? 0, width: innerWidth - railWidth };
  });
  const composerPosition = createMemo(() => selection() ? positionedComposer(selection()!, frameArea(), innerWidth, innerHeight, capture.required()) : null);
  const cancelComposer = () => {
    setSelection(null); setDraft(''); capture.reset(); setError(''); props.onSelectionConsumed?.();
    if (resumeSelectAfterCompose) { resumeSelectAfterCompose = false; beginPick('block'); }
    else sendDocument({ runtimeRef: props.runtimeRef }, { type: STORY_SELECT_MESSAGE, path: null });
  };
  const floatingRows = createMemo(() => [...items(), ...Object.values(recentResolved()).filter(value => value.remaining > 0 && !items().some(row => row.id === value.row.id)).map(value => value.row)]);
  const floating = () => !props.railOpen && Boolean(props.showViewComments) && floatingRows().length > 0;
  const placed = createMemo(() => floating() ? positionedComments(floatingRows(), anchorRects(), props.runtimeRef ? documentRect({ runtimeRef: props.runtimeRef }) ?? { top: 0, height: innerHeight } : { top: 0, height: innerHeight }, innerHeight) : []);
  const visibleRecent = createMemo(() => placed().filter(item => recentResolved()[item.annotation.id] && item.top >= 0 && item.top + 36 <= innerHeight).map(item => item.annotation.id).join(','));
  const hasRecent = createMemo(() => Object.values(recentResolved()).some(value => value.remaining > 0));
  createEffect(() => {
    if (!floating() || !hasRecent()) return;
    const visible = visibleRecent();
    const hover = hoverId();
    const open = openId();
    let last = performance.now();
    const timer = setInterval(() => {
      const now = performance.now();
      const elapsed = Math.min(250, now - last);
      last = now;
      if (document.visibilityState !== 'visible') return;
      const visibleIds = new Set(visible.split(','));
      setRecentResolved(previous => {
        let changed = false;
        const next = Object.fromEntries(Object.entries(previous).map(([id, value]) => {
          if (value.remaining <= 0 || !visibleIds.has(id) || id === hover || id === open) return [id, value];
          changed = true;
          return [id, { ...value, remaining: Math.max(0, value.remaining - elapsed) }];
        }));
        return changed ? next : previous;
      });
    }, 100);
    onCleanup(() => clearInterval(timer));
  });
  const thread = (row: AnnotationWire) => <article aria-label={row.status === 'resolved' ? 'Resolved annotation thread' : 'Annotation thread'} data-thread-id={row.id} data-hovered={hoverId() === row.id ? 'true' : undefined}
    onMouseEnter={() => setHoverId(row.id)} onMouseLeave={() => setHoverId(null)}
    onClick={event => { if (openId() !== row.id && !isFolded(folds(), 'threads', row.id) && !(event.target as Element).closest('a, button, textarea, input, [role="button"]')) openThread(row.id); }}
    class={`shrink-0 overflow-hidden rounded border border-edge bg-comment text-sm ${row.status === 'resolved' ? 'opacity-55 hover:opacity-100 focus-within:opacity-100' : ''} ${openId() === row.id || hoverId() === row.id ? 'border-edge-bright bg-comment-hover' : ''}`}>
    <For each={(row.remote_work ?? []).filter((work, index, all) => !all.slice(index + 1).some(next => next.sessionId === work.sessionId))}>{work => <p role="status" class="border-b border-edge px-3 py-1.5"><a href={`/chat?session=${work.sessionId}`} target="_blank" rel="noopener noreferrer">@{work.name}</a> {remoteWorkLabel(work)}</p>}</For>
    <Show when={isFolded(folds(), 'threads', row.id)} fallback={<>
      <div class="mb-2 flex items-center gap-2 px-3 pt-2"><button type="button" aria-label="Collapse thread" aria-expanded="true" onClick={() => foldThread(row.id)}>⌄</button><p class="text-xs text-muted">{row.snippet}</p></div>
      <Show when={row.orphaned}><div><Show when={openId() === row.id && (row.quote ?? row.snippet)}><p>{row.quote ?? row.snippet}</p></Show><p>This passage was removed from the document.</p></div></Show>
      <Show when={!row.orphaned && openId() === row.id && row.quote_found === false && row.quote}><div><p>{row.quote}</p><p>These words have since been edited.</p></div></Show>
      <For each={openId() === row.id ? row.thread : row.thread.slice(0, 1)}>{(comment, index) => <div data-comment-id={comment.id} class="mb-2 min-w-0 break-words px-3 scroll-mb-14 sm:scroll-mb-0">
        <div class="mb-1.5 flex min-w-0 items-center gap-2"><span role={openId() === row.id ? 'button' : undefined} tabindex={openId() === row.id ? 0 : undefined} aria-label={openId() === row.id ? isFolded(folds(), 'comments', comment.id) ? 'Expand comment' : 'Collapse comment' : undefined}
          aria-expanded={openId() === row.id ? !isFolded(folds(), 'comments', comment.id) : undefined}
          onClick={event => { if (openId() === row.id && !(event.target as Element).closest('a, button')) foldComment(comment.id); }} onKeyDown={event => { if (openId() === row.id && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); foldComment(comment.id); } }}
          class="mr-2 inline-flex min-w-0 flex-1 cursor-pointer items-center gap-2 text-xs text-muted"><AuthorIdentity author={comment.author} /><CommentTime iso={comment.created_at} /></span>
          <Show when={index() === 0 && row.status === 'open'}><button type="button" aria-label="Resolve annotation" disabled={busy()} onClick={() => void act(row.id, { resolve: true })}>✓</button></Show>
          <Show when={index() === 0 && row.status === 'resolved' && openId() === row.id}><button type="button" aria-label="Hide resolved conversation" onClick={() => setOpenId(null)}>↑</button></Show>
          <Show when={index() === 0 && (row.status === 'open' || openId() === row.id)}><div ref={menuRoot} class="relative"><button type="button" aria-label="Annotation actions" aria-expanded={menuOpen() === row.id} onClick={() => setMenuOpen(value => value === row.id ? null : row.id)}>⋮</button>
            <Show when={menuOpen() === row.id}><div role="menu" aria-label="Annotation action menu" class="absolute right-0 top-6 z-20 min-w-24 border border-edge bg-surface p-1 shadow-lg"><button type="button" role="menuitem" aria-label="Delete annotation" onClick={() => { setMenuOpen(null); setDeleting(row.id); }}>delete</button></div></Show>
          </div></Show></div>
        <Show when={isFolded(folds(), 'comments', comment.id)} fallback={openId() === row.id ? <CommentFoldingBody text={comment.body} foldable={!(justOpenedId() === row.id && index() === row.thread.length - 1)} /> : <p class="line-clamp-2 font-sans">{preview(comment.body)}</p>}>
          <p class="truncate font-sans">{preview(comment.body).split('\n', 1)[0]}</p>
        </Show>
        <Show when={index() === 0 && row.image}><CommentScreenshot image={row.image!} /></Show>
      </div>}</For>
      <Show when={openId() !== row.id}><button type="button" aria-label={row.status === 'resolved' ? 'Show resolved conversation' : 'Open annotation thread'} onClick={() => openThread(row.id)} class="flex w-full justify-between border-t border-edge px-3 py-1.5"><span><Show when={replyParticipants(row.thread).length}><span aria-label={`Reply participants: ${replyParticipants(row.thread).map(author => author.label ?? 'Agent').join(', ')}`}><For each={replyParticipants(row.thread)}>{author => <span>{author.label}</span>}</For></span></Show>+{Math.max(0, row.thread.length - 1)} more</span><span>open →</span></button></Show>
    </>}>
      <button type="button" aria-label="Expand thread" aria-expanded="false" onClick={() => foldThread(row.id)}>› {row.snippet}</button>
      <p class="truncate font-sans">{row.thread[0] ? preview(row.thread[0].body).split('\n', 1)[0] : ''}</p>
      <p>{Math.max(0, row.thread.length - 1)} {row.thread.length === 2 ? 'reply' : 'replies'}</p>
    </Show>
    <Show when={row.status === 'resolved' && openId() === row.id}><button type="button" aria-label="Reopen annotation" disabled={busy()} onClick={() => void act(row.id, { reopen: true })}>↺ reopen</button></Show>
    <Show when={row.status === 'open' && openId() === row.id}><form class="mt-2 border-t border-edge px-3 py-2" onSubmit={event => { event.preventDefault(); if (hasReplyText(reply()[row.id] ?? '')) void act(row.id, { reply: reply()[row.id] }); }}><CommentMarkdownField label={`Reply to annotation ${row.id}`} value={reply()[row.id] ?? ''} onChange={value => setReply(previous => ({ ...previous, [row.id]: value }))} onSubmit={() => { if (hasReplyText(reply()[row.id] ?? '')) void act(row.id, { reply: reply()[row.id] }); }} previewLabel="Reply preview" previewToggleLabel="Preview reply" backend={backend} artifactId={props.id} placeholder="reply…" rows={2} /><div class="flex justify-end gap-2"><button type="button" aria-label="Cancel reply" onClick={() => { setReply(previous => ({ ...previous, [row.id]: '' })); setOpenId(null); }} class="bg-transparent px-2 py-1">cancel</button><button type="submit" aria-label="Send reply" disabled={busy() || !hasReplyText(reply()[row.id] ?? '')} class="border border-accent bg-accent px-2 py-1 text-bg">reply</button></div></form></Show>
  </article>;
  return <>
    <Show when={pick()}><div role="status" aria-label={pick() === 'area' ? 'Screenshot tool active' : 'Select tool active'} class="fixed z-30 rounded border border-edge bg-surface px-3 py-2 text-xs shadow" style={{ top: `${Math.max(props.topOffset ?? 0, frameArea().top, props.railSheet ? APP_BAR_H : 0) + 12}px`, left: `${frameArea().left + frameArea().width / 2}px`, transform: 'translateX(-50%)' }}>{pick() === 'area' ? (capture.busy() ? 'Choose this tab in the sharing dialog' : 'drag an area to screenshot') : 'click a block or highlight text to comment'}<button type="button" aria-label="Cancel picking" onClick={endPick} class="ml-2">×</button></div></Show>
    <Show when={selection() && !pick()}><aside role="dialog" aria-label="Annotation composer" class="fixed z-40 overflow-y-auto rounded border border-edge bg-surface p-3 shadow-lg" style={{ left: `${composerPosition()?.left ?? 12}px`, top: `${composerPosition()?.top ?? 12}px`, width: `${composerPosition()?.width ?? 384}px`, 'max-height': `calc(100vh - ${(composerPosition()?.top ?? 12) + 12}px)` }}><p class="mb-2 text-xs text-muted">{selection()?.quote ?? 'Comment on selection'}</p>
      <Show when={capture.busy()}><p role="status">Preparing screenshot…</p></Show>
      <Show when={capture.draft()}>{current => <ScreenshotEditor image={current().image} initialStrokes={current().strokes} exportRef={screenshotExport} busy={busy()} onRetake={() => void beginScreenshot()} />}</Show>
      <Show when={capture.required() && !capture.draft() && !capture.busy()}><div class="mb-2 rounded border border-edge bg-raised p-2 text-xs"><p role="alert">{capture.error() || 'A screenshot is required for this selection.'}</p><button type="button" onClick={() => void beginScreenshot()}>Retry screenshot</button><label>Upload screenshot<input aria-label="Upload screenshot" type="file" accept="image/png,image/jpeg,image/webp" onChange={event => { const file = event.currentTarget.files?.[0]; if (file) void capture.upload(file); }} /></label><button type="button" onClick={capture.skip}>Continue without screenshot</button></div></Show>
      <div class="mb-2 flex gap-1 text-xs"><For each={[...(selection()?.ancestors.slice(-2) ?? []), ...(selection() ? [{ path: selection()!.path, tag: selection()!.tag, hint: '' }] : [])]}>{crumb => <Show when={crumb.path !== selection()?.path} fallback={<span>{crumb.tag}</span>}><button type="button" aria-label={`Select ${crumb.tag}`} disabled={capture.busy() || Boolean(capture.draft())} onClick={() => sendDocument({ runtimeRef: props.runtimeRef }, { type: STORY_SELECT_MESSAGE, path: crumb.path })}>{crumb.tag}</button></Show>}</For></div>
      <CommentMarkdownField label="New comment" value={draft()} onChange={editDraft} onSubmit={() => void post()} backend={backend} artifactId={props.id} placeholder="Add a comment for your agent…" rows={4} /><div class="flex justify-end gap-2"><button type="button" aria-label="Cancel comment" onClick={cancelComposer} class="bg-transparent px-2 py-1">Cancel</button><button type="button" aria-label="Post comment" disabled={busy() || capture.busy() || (capture.required() && !capture.draft()) || !hasReplyText(draft())} onClick={() => void post()} class="border border-accent bg-accent px-2 py-1 text-bg">Post</button></div></aside></Show>
    <AnnotationRail open={props.railOpen} onClose={() => props.onRailOpenChange(false)} topOffset={props.topOffset} rightInset={props.rightInset} host={props.railHost} sheet={props.railSheet} picking={pick() === 'block'} screenshot={capture.required()} screenshotUnavailable={screenshotUnavailable()} onScreenshot={() => void beginScreenshot()} onSelect={() => pick() === 'block' ? endPick() : beginPick('block')}>
      <div ref={threadsRoot}>
        <For each={items()}>{thread}</For>
        <Show when={items().length === 0}><p class="px-2 py-3 text-xs text-muted">no comments yet.</p></Show>
        <button type="button" aria-label="Show resolved comments" onClick={() => void loadResolved()}>{showResolved() ? 'hide resolved' : 'show resolved'}</button>
        <Show when={showResolved()}><div role="separator" aria-label="resolved" /><For each={resolved()}>{thread}</For></Show>
      </div>
    </AnnotationRail>
    <Show when={floating()}><div data-capture-chrome aria-label="Open annotation comments" class="pointer-events-none fixed inset-0 z-20"><For each={placed()}>{position =>
      <AnnotationPreview row={position.annotation} top={position.top} remaining={recentResolved()[position.annotation.id]?.remaining} hovered={hoverId() === position.annotation.id} onHover={setHoverId} onOpen={() => openThread(position.annotation.id)} />
    }</For></div></Show>
    <Show when={error()}><p role="alert" class="fixed bottom-2 left-2 z-50 rounded border border-danger bg-surface px-3 py-2 text-xs text-danger">{error()}</p></Show>
    <Show when={deleting()}>{id => <ConfirmDialog title="Delete annotation?" description="This comment and its replies will be deleted." action="Delete annotation" confirmLabel="Confirm delete annotation" danger busy={busy()} onCancel={() => setDeleting(null)} onConfirm={() => void remove(id())} />}</Show>
  </>;
}
