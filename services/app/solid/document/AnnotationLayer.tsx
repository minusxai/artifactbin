/* @jsxImportSource solid-js */
import { createEffect, createSignal, For, onCleanup, onMount, Show, type JSX } from 'solid-js';
import type { AnnotationWire } from '@/lib/annotations';
import type { ArtifactBackend } from '@/lib/artifact-backend/types';
import { createHttpBackend } from '@/lib/artifact-backend/http';
import { BackendRequestError } from '@/lib/artifact-backend/errors';
import { loginHref } from '@/lib/login-href';
import { documentRect, sendDocument, subscribeDocument, type DocumentRuntimeRef } from '@/lib/story-runtime/document-endpoint';
import { isEditFrameMessage, STORY_ANNOTATIONS_MESSAGE, STORY_ANNOTATION_PIN_MESSAGE, STORY_ANNOTATION_LAYOUT_MESSAGE, STORY_ANNOTATION_HOVER_MESSAGE, STORY_SELECTION_ACTION_MESSAGE, STORY_SELECTION_MESSAGE, type StoryAnnotationsMessage, type StoryEditRect, type StoryEditSelection } from '@/lib/story-runtime/contract';
import { AnnotationRail } from './AnnotationRail';
import { CommentMarkdown, CommentMarkdownField } from './CommentMarkdown';
import { ConfirmDialog } from '../components/ConfirmDialog';

export interface AnnotationLayerProps {
  id: string; backend?: ArtifactBackend; railOpen: boolean; onRailOpenChange: (open: boolean) => void;
  liveAnnotations?: AnnotationWire[] | null; onAnnotationsChange?: (items: AnnotationWire[]) => void;
  initialSelection?: StoryEditSelection | null; onSelectionConsumed?: () => void;
  topOffset?: number; rightInset?: number; railHost?: HTMLElement; railSheet?: boolean;
  runtimeRef?: DocumentRuntimeRef; sessionNonce?: string | null; showViewComments?: boolean;
  pickOnOpen?: boolean; pickRequested?: boolean; editId?: string; panelWidth?: number;
}

/** The page owns the active selection; the layer owns comments and draft state. */
export function AnnotationLayer(props: AnnotationLayerProps): JSX.Element {
  const backend = props.backend ?? createHttpBackend(props.id);
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
  const [pick, setPick] = createSignal<'select' | null>(props.pickRequested ? 'select' : null);
  const [hoverId, setHoverId] = createSignal<string | null>(null);
  const [anchorRects, setAnchorRects] = createSignal<Record<string, StoryEditRect>>({});
  createEffect(() => {
    if (props.railOpen && !selection() && !openId() && props.pickOnOpen !== false && !props.editId && !props.railSheet) setPick('select');
    else if (!props.railOpen && !selection()) setPick(null);
  });
  createEffect(() => { if (props.liveAnnotations) setItems(props.liveAnnotations); });
  createEffect(() => { props.onAnnotationsChange?.(items()); });
  createEffect(() => {
    if (!props.sessionNonce || !props.runtimeRef) return;
    const pins = items().filter(row => !row.orphaned && row.anchor).map(row => {
      const anchor = row.anchor! as typeof row.anchor & { nodeId?: string | null };
      return { id: row.id, path: anchor.path, key: anchor.key, nodeId: anchor.nodeId, range: row.range };
    });
    sendDocument({ runtimeRef: props.runtimeRef }, { type: STORY_ANNOTATIONS_MESSAGE, mode: 'on', pins, openId: openId(), hoverId: hoverId(), selectedPath: selection()?.path ?? null, selected: selection(), canComment: true, pick: pick() } satisfies StoryAnnotationsMessage);
  });
  createEffect(() => {
    if (!props.initialSelection) return;
    setSelection(props.initialSelection);
  });
  onMount(() => {
    const controller = new AbortController();
    void backend.listAnnotations(undefined, { signal: controller.signal }).then(rows => { if (!controller.signal.aborted) setItems(rows); }).catch(cause => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'Could not load comments.'); });
    onCleanup(() => controller.abort());
    if (props.runtimeRef && props.sessionNonce) {
      const unsubscribe = subscribeDocument({ runtimeRef: props.runtimeRef }, event => {
        if (!props.sessionNonce || !isEditFrameMessage(event.data, props.sessionNonce)) return;
        if (event.data.type === STORY_ANNOTATION_PIN_MESSAGE) { setPick(null); setOpenId(event.data.id); props.onRailOpenChange(true); }
        if (event.data.type === STORY_ANNOTATION_HOVER_MESSAGE) setHoverId(event.data.id);
        if (event.data.type === STORY_ANNOTATION_LAYOUT_MESSAGE) setAnchorRects(Object.fromEntries(event.data.positions.map(position => [position.id, position.rect])));
        if (event.data.type === STORY_SELECTION_ACTION_MESSAGE && event.data.action === 'select' && props.pickOnOpen !== false) setPick('select');
        if (event.data.type === STORY_SELECTION_MESSAGE && pick()) {
          setPick(null);
          if (event.data.selection) { setSelection(event.data.selection); setOpenId(null); }
        } else if (event.data.type === STORY_SELECTION_MESSAGE && selection()) {
          const reported = event.data.selection;
          setSelection(previous => reported && previous?.nodeId && reported.nodeId === previous.nodeId
            ? { ...reported, quote: previous.quote, range: previous.range } : reported);
        }
      });
      onCleanup(() => {
        unsubscribe();
        sendDocument({ runtimeRef: props.runtimeRef }, { type: STORY_ANNOTATIONS_MESSAGE, mode: 'off', pins: [], openId: null, hoverId: null } satisfies StoryAnnotationsMessage);
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
      if (body.reply) setReply(previous => ({ ...previous, [id]: '' }));
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
    if (!target || !draft().trim() || busy()) return;
    if (!target.nodeId) { setError('Wait for this change to save before commenting. Your draft is still here.'); return; }
    setBusy(true); setError('');
    try {
      const row = await backend.createAnnotation({ path: target.path, node_id: target.nodeId, body: draft(), ...(target.quote ? { quote: target.quote } : {}), ...(target.range ? { range: target.range } : {}) }, crypto.randomUUID());
      setItems(previous => [...previous.filter(item => item.id !== row.id), row]);
      setDraft(''); setSelection(null); props.onSelectionConsumed?.();
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
  const thread = (row: AnnotationWire) => <article aria-label={`Annotation ${row.id}`} class="rounded border border-edge bg-surface p-3 text-sm">
    <p class="mb-2 text-xs text-muted">{row.quote ?? row.snippet}</p>
    <For each={row.thread}>{comment => <div class="mb-2 min-w-0 break-words"><span class="mr-2 text-xs text-muted">{comment.author.label}</span><CommentMarkdown text={comment.body} /></div>}</For>
    <div class="flex gap-2 text-xs"><Show when={row.status === 'open'} fallback={<button type="button" aria-label="Reopen annotation" disabled={busy()} onClick={() => void act(row.id, { reopen: true })}>reopen</button>}><button type="button" aria-label="Resolve annotation" disabled={busy()} onClick={() => void act(row.id, { resolve: true })}>resolve</button></Show><button type="button" aria-label="Delete annotation" disabled={busy()} onClick={() => setDeleting(row.id)}>delete</button></div>
    <Show when={row.status === 'open'}><form class="mt-2" onSubmit={event => { event.preventDefault(); if (reply()[row.id]?.trim()) void act(row.id, { reply: reply()[row.id] }); }}><CommentMarkdownField label={`Reply to annotation ${row.id}`} value={reply()[row.id] ?? ''} onChange={value => setReply(previous => ({ ...previous, [row.id]: value }))} onSubmit={() => { if (reply()[row.id]?.trim()) void act(row.id, { reply: reply()[row.id] }); }} previewLabel="Reply preview" previewToggleLabel="Preview reply" /><button type="submit" aria-label="Send reply" disabled={busy() || !reply()[row.id]?.trim()}>reply</button></form></Show>
  </article>;
  return <>
    <Show when={pick()}><div role="status" aria-label="Select tool active" class="fixed z-30 rounded border border-edge bg-surface px-3 py-2 text-xs shadow" style={{ top: `${(props.topOffset ?? 0) + 12}px`, left: '50%' }}>tap a block or drag an area to comment<button type="button" aria-label="Cancel picking" onClick={() => setPick(null)} class="ml-2">×</button></div></Show>
    <Show when={selection()}><aside role="dialog" aria-label="Annotation composer" class="fixed bottom-4 left-1/2 z-40 w-80 -translate-x-1/2 rounded border border-edge bg-surface p-3 shadow-lg"><p class="mb-2 text-xs text-muted">{selection()?.quote ?? 'Comment on selection'}</p><CommentMarkdownField label="New comment" value={draft()} onChange={setDraft} onSubmit={() => void post()} /><div class="flex justify-end gap-2"><button type="button" aria-label="Cancel comment" onClick={() => { setSelection(null); props.onSelectionConsumed?.(); }}>Cancel</button><button type="button" aria-label="Post comment" disabled={busy() || !draft().trim()} onClick={() => void post()}>Post</button></div></aside></Show>
    <AnnotationRail open={props.railOpen} onClose={() => props.onRailOpenChange(false)} topOffset={props.topOffset} rightInset={props.rightInset} host={props.railHost} sheet={props.railSheet} picking={pick() !== null} onSelect={() => setPick(current => current ? null : 'select')}>
      <For each={items()}>{thread}</For>
      <Show when={items().length === 0}><p class="px-2 py-3 text-xs text-muted">no comments yet.</p></Show>
      <button type="button" aria-label="Show resolved comments" onClick={() => void loadResolved()}>{showResolved() ? 'hide resolved' : 'show resolved'}</button>
      <Show when={showResolved()}><For each={resolved()}>{thread}</For></Show>
    </AnnotationRail>
    <Show when={!props.railOpen && props.showViewComments && items().length > 0}><div data-capture-chrome aria-label="Open annotation comments" class="pointer-events-none fixed inset-0 z-20"><For each={items()}>{row => {
      const position = () => anchorRects()[row.id];
      const rect = () => props.runtimeRef ? documentRect({ runtimeRef: props.runtimeRef }) : undefined;
      return <button type="button" aria-label={`Open annotation ${row.id}`} onClick={() => { setOpenId(row.id); props.onRailOpenChange(true); }} onMouseEnter={() => setHoverId(row.id)} onMouseLeave={() => setHoverId(null)}
        style={position() ? { top: `${(rect()?.top ?? 0) + position()!.y}px` } : { top: '50%' }}
        class="pointer-events-auto absolute right-3 rounded-full border border-edge bg-surface px-2 py-1 text-xs shadow">{row.thread[0]?.author.label ?? 'comment'}</button>;
    }}</For></div></Show>
    <Show when={error()}><p role="alert" class="fixed bottom-2 left-2 z-50 rounded border border-danger bg-surface px-3 py-2 text-xs text-danger">{error()}</p></Show>
    <Show when={deleting()}>{id => <ConfirmDialog title="Delete annotation?" description="This comment and its replies will be deleted." action="Delete annotation" confirmLabel="Confirm delete annotation" danger busy={busy()} onCancel={() => setDeleting(null)} onConfirm={() => void remove(id())} />}</Show>
  </>;
}
