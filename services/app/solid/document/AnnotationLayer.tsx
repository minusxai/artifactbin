/* @jsxImportSource solid-js */
import { createEffect, createSignal, For, onCleanup, onMount, Show, type JSX } from 'solid-js';
import type { AnnotationWire } from '@/lib/annotations';
import type { ArtifactBackend } from '@/lib/artifact-backend/types';
import { createHttpBackend } from '@/lib/artifact-backend/http';
import { BackendRequestError } from '@/lib/artifact-backend/errors';
import { loginHref } from '@/lib/login-href';
import { documentRect, sendDocument, subscribeDocument, type DocumentRuntimeRef } from '@/lib/story-runtime/document-endpoint';
import { isEditFrameMessage, STORY_ANNOTATIONS_MESSAGE, STORY_ANNOTATION_PIN_MESSAGE, STORY_ANNOTATION_LAYOUT_MESSAGE, STORY_ANNOTATION_HOVER_MESSAGE, STORY_SELECTION_ACTION_MESSAGE, STORY_SELECTION_MESSAGE, STORY_SELECT_MESSAGE, type StoryAnnotationsMessage, type StoryEditRect, type StoryEditSelection } from '@/lib/story-runtime/contract';
import { AnnotationRail } from './AnnotationRail';
import { CommentMarkdown, CommentMarkdownField } from './CommentMarkdown';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { isFolded, readFolds, toggleFold, unfold } from '@/lib/comment-folds';
import { parseMarkdownLite, plainText } from '@/lib/markdown-lite';
import { hasReplyText, remoteWorkLabel, replyMentionPrefix } from '@/lib/remote-reply';
import { createCommentCapture } from './CommentCapture';
import { AnnotationPreview, AuthorMark, CommentTime, positionedComments } from './AnnotationPreview';
import { ScreenshotEditor, type ScreenshotDrawing } from './ScreenshotEditor';
import { CommentScreenshot } from './CommentScreenshot';

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
  const [selection, setSelection] = createSignal<StoryEditSelection | null>(props.initialSelection ?? null);
  const [draft, setDraft] = createSignal('');
  const [reply, setReply] = createSignal<Record<string, string>>({});
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal('');
  const [showResolved, setShowResolved] = createSignal(false);
  const [deleting, setDeleting] = createSignal<string | null>(null);
  const [openId, setOpenId] = createSignal<string | null>(null);
  let mutation = { signature: '', key: '' };
  const [folds, setFolds] = createSignal(readFolds(props.id));
  const [pick, setPick] = createSignal<'select' | null>(props.pickRequested ? 'select' : null);
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
    if (props.railOpen && !selection() && !openId() && props.pickOnOpen !== false && !props.editId && !props.railSheet) setPick('select');
    else if (!props.railOpen && !selection()) setPick(null);
  });
  createEffect(() => {
    const live = props.liveAnnotations;
    if (!live) return;
    const expanded = openId();
    const disappeared = expanded && items().some(row => row.id === expanded) && !live.some(row => row.id === expanded);
    setItems(live);
    if (disappeared) void backend.listAnnotations('resolved').then(rows => { setResolved(rows); if (rows.some(row => row.id === expanded)) setShowResolved(true); }).catch(() => {});
  });
  createEffect(() => { props.onAnnotationsChange?.(items()); });
  createEffect(() => {
    if (!props.sessionNonce || !props.runtimeRef) return;
    const expandedResolved = resolved().find(row => row.id === openId());
    const pins = [...items(), ...(expandedResolved ? [expandedResolved] : [])].filter(row => !row.orphaned && row.anchor).map(row => {
      const anchor = row.anchor! as typeof row.anchor & { nodeId?: string | null };
      return { id: row.id, path: anchor.path, key: anchor.key, nodeId: anchor.nodeId, range: row.range };
    });
    sendDocument({ runtimeRef: props.runtimeRef }, { type: STORY_ANNOTATIONS_MESSAGE, mode: 'on', pins, openId: openId(), hoverId: hoverId(), selectedPath: selection()?.path ?? null, selected: selection(), canComment: true, pick: pick() } satisfies StoryAnnotationsMessage);
  });
  createEffect(() => {
    if (!props.initialSelection) return;
    setSelection(props.initialSelection);
  });
  createEffect(() => {
    if (!pick() && !selection()) return;
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.stopPropagation();
      if (pick()) { setPick(null); capture.reset(); }
      else { setSelection(null); capture.reset(); props.onSelectionConsumed?.(); sendDocument({ runtimeRef: props.runtimeRef }, { type: STORY_SELECT_MESSAGE, path: null }); }
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
        if (event.data.type === STORY_SELECTION_ACTION_MESSAGE && event.data.action === 'select' && props.pickOnOpen !== false) setPick('select');
        if (event.data.type === STORY_SELECTION_MESSAGE && pick()) {
          setPick(null);
          if (event.data.selection) {
            setSelection(event.data.selection); setOpenId(null);
            const rect = event.data.selection.captureRect ?? event.data.selection.rect;
            const viewport = documentRect({ runtimeRef });
            void capture.capture({ ...rect, x: rect.x + (viewport?.left ?? 0), y: rect.y + (viewport?.top ?? 0) });
          } else capture.reset();
        } else if (event.data.type === STORY_SELECTION_MESSAGE && selection()) {
          const reported = event.data.selection;
          setSelection(previous => reported && previous?.nodeId && reported.nodeId === previous.nodeId
            ? { ...reported, quote: previous.quote, range: previous.range } : reported);
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
      if (body.reply) setReply(previous => ({ ...previous, [id]: replyMentionPrefix(answer.thread) }));
      if (answer.status === 'resolved') setOpenId(null);
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
    if (!target || !draft().trim() || busy() || capture.busy() || (capture.required() && !capture.draft())) return;
    if (!target.nodeId) { setError('Wait for this change to save before commenting. Your draft is still here.'); return; }
    setBusy(true); setError('');
    try {
      if (capture.draft() && !screenshotExport.current) throw new Error('The screenshot is still loading. Please try again.');
      const attachmentId = await capture.stage(capture.draft() ? await screenshotExport.current!() : undefined);
      const signature = JSON.stringify([target, draft(), attachmentId]);
      if (mutation.signature !== signature) mutation = { signature, key: crypto.randomUUID() };
      const row = await backend.createAnnotation({ path: target.path, node_id: target.nodeId, body: draft(), ...(target.quote ? { quote: target.quote } : {}), ...(target.range ? { range: target.range } : {}), ...(attachmentId ? { attachment_id: attachmentId, edit_id: capture.draft()!.editId } : {}) }, mutation.key);
      setItems(previous => [...previous.filter(item => item.id !== row.id), row]);
      setDraft(''); setSelection(null); capture.reset(); props.onSelectionConsumed?.();
      sendDocument({ runtimeRef: props.runtimeRef }, { type: STORY_SELECT_MESSAGE, path: null });
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
    setPick(null);
    setOpenId(id);
    const row = [...items(), ...resolved()].find(item => item.id === id);
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
  const thread = (row: AnnotationWire) => <article aria-label={`Annotation ${row.id}`} data-thread-id={row.id} class="rounded border border-edge bg-surface p-3 text-sm">
    <For each={row.remote_work ?? []}>{work => <p role="status"><a href={`/chat?session=${work.sessionId}`} target="_blank" rel="noopener noreferrer">@{work.name}</a> {remoteWorkLabel(work)}</p>}</For>
    <Show when={isFolded(folds(), 'threads', row.id)} fallback={<>
      <div class="mb-2 flex items-center gap-2"><button type="button" aria-label="Fold thread" onClick={() => foldThread(row.id)}>⌄</button><p class="text-xs text-muted">{row.snippet}</p></div>
      <Show when={row.orphaned}><div><Show when={openId() === row.id && (row.quote ?? row.snippet)}><p>{row.quote ?? row.snippet}</p></Show><p>This passage was removed from the document.</p></div></Show>
      <Show when={!row.orphaned && openId() === row.id && row.quote_found === false && row.quote}><div><p>{row.quote}</p><p>These words have since been edited.</p></div></Show>
      <For each={openId() === row.id ? row.thread : row.thread.slice(0, 1)}>{(comment, index) => <div data-comment-id={comment.id} class="mb-2 min-w-0 break-words">
        <span role="button" tabindex="0" aria-label={isFolded(folds(), 'comments', comment.id) ? 'Expand comment' : 'Collapse comment'}
          aria-expanded={!isFolded(folds(), 'comments', comment.id)}
          onClick={() => foldComment(comment.id)} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); foldComment(comment.id); } }}
          class="mr-2 inline-flex cursor-pointer items-center gap-2 text-xs text-muted"><span aria-label={`${comment.author.label ?? 'You'} avatar`} class="size-[22px]"><AuthorMark author={comment.author} /></span>{comment.author.label}<CommentTime iso={comment.created_at} /></span>
        <Show when={isFolded(folds(), 'comments', comment.id)} fallback={<CommentMarkdown text={comment.body} />}>
          <p class="truncate font-sans">{preview(comment.body).split('\n', 1)[0]}</p>
        </Show>
        <Show when={index() === 0 && row.image}><CommentScreenshot image={row.image!} /></Show>
      </div>}</For>
      <Show when={openId() !== row.id}><button type="button" aria-label={row.status === 'resolved' ? 'Show resolved conversation' : 'Open annotation thread'} onClick={() => openThread(row.id)}>open →</button></Show>
      <Show when={row.status === 'resolved' && openId() === row.id}><button type="button" aria-label="Hide resolved conversation" onClick={() => setOpenId(null)}>↑</button></Show>
    </>}>
      <button type="button" aria-label="Unfold thread" onClick={() => foldThread(row.id)}>› {row.snippet}</button>
      <p class="truncate font-sans">{row.thread[0] ? preview(row.thread[0].body).split('\n', 1)[0] : ''}</p>
      <p>{Math.max(0, row.thread.length - 1)} {row.thread.length === 2 ? 'reply' : 'replies'}</p>
    </Show>
    <div class="flex gap-2 text-xs"><Show when={row.status === 'open'} fallback={<button type="button" aria-label="Reopen annotation" disabled={busy()} onClick={() => void act(row.id, { reopen: true })}>reopen</button>}><button type="button" aria-label="Resolve annotation" disabled={busy()} onClick={() => void act(row.id, { resolve: true })}>resolve</button></Show><button type="button" aria-label="Delete annotation" disabled={busy()} onClick={() => setDeleting(row.id)}>delete</button></div>
    <Show when={row.status === 'open' && openId() === row.id}><form class="mt-2" onSubmit={event => { event.preventDefault(); if (hasReplyText(reply()[row.id] ?? '')) void act(row.id, { reply: reply()[row.id] }); }}><CommentMarkdownField label={`Reply to annotation ${row.id}`} value={reply()[row.id] ?? ''} onChange={value => setReply(previous => ({ ...previous, [row.id]: value }))} onSubmit={() => { if (hasReplyText(reply()[row.id] ?? '')) void act(row.id, { reply: reply()[row.id] }); }} previewLabel="Reply preview" previewToggleLabel="Preview reply" backend={backend} artifactId={props.id} /><button type="submit" aria-label="Send reply" disabled={busy() || !hasReplyText(reply()[row.id] ?? '')}>reply</button></form></Show>
  </article>;
  return <>
    <Show when={pick()}><div role="status" aria-label="Select tool active" class="fixed z-30 rounded border border-edge bg-surface px-3 py-2 text-xs shadow" style={{ top: `${(props.topOffset ?? 0) + 12}px`, left: '50%' }}>tap a block or drag an area to comment<button type="button" aria-label="Cancel picking" onClick={() => setPick(null)} class="ml-2">×</button></div></Show>
    <Show when={selection()}><aside role="dialog" aria-label="Annotation composer" class="fixed bottom-4 left-1/2 z-40 w-80 -translate-x-1/2 rounded border border-edge bg-surface p-3 shadow-lg"><p class="mb-2 text-xs text-muted">{selection()?.quote ?? 'Comment on selection'}</p>
      <Show when={capture.busy()}><p role="status">Preparing screenshot…</p></Show>
      <Show when={capture.draft()}>{current => <ScreenshotEditor image={current().image} initialStrokes={current().strokes} exportRef={screenshotExport} busy={busy()} onRetake={() => void capture.start()} />}</Show>
      <Show when={capture.required() && !capture.draft() && !capture.busy()}><div class="mb-2 rounded border border-edge bg-raised p-2 text-xs"><p role="alert">{capture.error() || 'A screenshot is required for this selection.'}</p><button type="button" onClick={() => void capture.start()}>Retry screenshot</button><label>Upload screenshot<input aria-label="Upload screenshot" type="file" accept="image/png,image/jpeg,image/webp" onChange={event => { const file = event.currentTarget.files?.[0]; if (file) void capture.upload(file); }} /></label><button type="button" onClick={capture.skip}>Continue without screenshot</button></div></Show>
      <CommentMarkdownField label="New comment" value={draft()} onChange={setDraft} onSubmit={() => void post()} backend={backend} artifactId={props.id} /><div class="flex justify-end gap-2"><button type="button" aria-label="Cancel comment" onClick={() => { setSelection(null); capture.reset(); props.onSelectionConsumed?.(); }}>Cancel</button><button type="button" aria-label="Post comment" disabled={busy() || capture.busy() || (capture.required() && !capture.draft()) || !draft().trim()} onClick={() => void post()}>Post</button></div></aside></Show>
    <AnnotationRail open={props.railOpen} onClose={() => props.onRailOpenChange(false)} topOffset={props.topOffset} rightInset={props.rightInset} host={props.railHost} sheet={props.railSheet} picking={pick() !== null} onSelect={() => {
      if (pick()) { setPick(null); capture.reset(); } else { setPick('select'); void capture.start(); }
    }}>
      <div ref={threadsRoot}>
        <For each={items()}>{thread}</For>
        <Show when={items().length === 0}><p class="px-2 py-3 text-xs text-muted">no comments yet.</p></Show>
        <button type="button" aria-label="Show resolved comments" onClick={() => void loadResolved()}>{showResolved() ? 'hide resolved' : 'show resolved'}</button>
        <Show when={showResolved()}><div role="separator" aria-label="resolved" /><For each={resolved()}>{thread}</For></Show>
      </div>
    </AnnotationRail>
    <Show when={!props.railOpen && props.showViewComments && items().length > 0}><div data-capture-chrome aria-label="Open annotation comments" class="pointer-events-none fixed inset-0 z-20"><For each={positionedComments(items(), anchorRects(), props.runtimeRef ? documentRect({ runtimeRef: props.runtimeRef }) ?? { top: 0, height: innerHeight } : { top: 0, height: innerHeight }, innerHeight)}>{placed =>
      <AnnotationPreview row={placed.annotation} top={placed.top} hovered={hoverId() === placed.annotation.id} onHover={setHoverId} onOpen={() => openThread(placed.annotation.id)} />
    }</For></div></Show>
    <Show when={error()}><p role="alert" class="fixed bottom-2 left-2 z-50 rounded border border-danger bg-surface px-3 py-2 text-xs text-danger">{error()}</p></Show>
    <Show when={deleting()}>{id => <ConfirmDialog title="Delete annotation?" description="This comment and its replies will be deleted." action="Delete annotation" confirmLabel="Confirm delete annotation" danger busy={busy()} onCancel={() => setDeleting(null)} onConfirm={() => void remove(id())} />}</Show>
  </>;
}
