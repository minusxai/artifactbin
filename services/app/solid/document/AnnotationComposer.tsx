/* @jsxImportSource solid-js */
/**
 * THE COMPOSER: the floating card a new comment is written in, beside the words it is about.
 *
 * A NON-modal card the reader drags (pointer or arrow keys) beside the words (no backdrop, no focus trap, the page stays
 * live): ui/FloatingPanel. It sits where `positionedComposer` puts it until moved; a move holds until the subject
 * changes. It shows the subject's breadcrumb (pressing one re-selects that ancestor), the screenshot step when one is
 * required, the words and the send. Escape is the draft's window handler, so the panel is given no `onClose`.
 *
 * Interface: `<AnnotationComposer draft show busy frame viewport backend artifactId post />`, and
 * `preloadScreenshotUpload` (the upload fallback's lazy chunk).
 */
import { createEffect, createMemo, createSignal, For, lazy, on, onCleanup, Show, Suspense, untrack, type JSX } from 'solid-js';
import LoaderCircle from 'lucide-solid/icons/loader-circle';
import MessageSquare from 'lucide-solid/icons/message-square';
import X from 'lucide-solid/icons/x';
import type { ArtifactBackend } from '@/lib/artifact-backend';
import { hasReplyText } from '@/lib/annotations/remote-reply';
import { APP_BAR_H } from '@/lib/html-reader/edit-bar';
import type { StoryEditParentMessage } from '@/lib/html-bridge/selection-contract';
import { Button } from '../ui/Button';
import { FloatingPanel } from '../ui/FloatingPanel';
import { Tooltip } from '../ui/Tooltip';
import { beginComposerPointerDrag, clampComposerPosition, positionedComposer, type ComposerPoint } from './AnnotationComposerPosition';
import { VIEW_COMMENT_INSET } from './AnnotationPreview';
import { createImageDropTarget, ImageDropTarget } from './CommentImageAttach';
import { CommentSubmitHint } from './CommentMarkdown';
import { CommentMarkdownField } from './LazyCommentField';
import { RetryingNote } from './RetryingNote';
import type { CommentDraft } from './annotation-draft';

// The upload fallback is a lazy chunk (an intentional exception to top-level imports): it keeps ui/Field off the reader page.
const ScreenshotUpload = lazy(() => import('./AnnotationScreenshotUpload').then((module) => ({ default: module.ScreenshotUpload })));
export const preloadScreenshotUpload = (): Promise<unknown> => ScreenshotUpload.preload();

/** Hidden while capturing a screenshot, in this layer's shadow root and in the portalled panel alike. */
export const CAPTURE_CHROME_CSS = ':host-context(.mx-taking-screenshot) [data-capture-chrome],.mx-taking-screenshot [data-capture-chrome]{visibility:hidden!important}';

export function AnnotationComposer(props: {
  draft: CommentDraft;
  /** Whether the card is up (a subject, no pick in progress, may comment); its position outlives a hidden spell. */
  show: boolean;
  busy: boolean;
  /** The document's box less the rail, and the window. */
  frame: { left: number; top: number; width: number };
  viewport: { width: number; height: number };
  backend: ArtifactBackend;
  artifactId: string;
  post: (message: StoryEditParentMessage) => void;
}): JSX.Element {
  const draft = untrack(() => props.draft);
  const { capture } = draft;
  const drop = createImageDropTarget(() => draft.image);
  const [manualPoint, setManualPoint] = createSignal<ComposerPoint | null>(null);
  const [moveAnnouncement, setMoveAnnouncement] = createSignal('');
  let stopDrag: (() => void) | undefined;
  let element: HTMLDivElement | undefined;
  let target: string | null = null;
  createEffect(on(draft.selection, (current) => {
    const next = current ? JSON.stringify([current.anchor ?? null, current.nodeId ?? null, current.path, current.kind, current.quote ?? null, current.range ?? null]) : null;
    if (next !== target) {
      stopDrag?.();
      stopDrag = undefined;
      setManualPoint(null);
      setMoveAnnouncement('');
      target = next;
    }
  }));
  createEffect(() => {
    if (!draft.selection() || draft.pick()) {
      stopDrag?.();
      stopDrag = undefined;
    }
  });
  /** The highest the card may sit and the height it can show there. */
  const reach = (screenshot: boolean) => {
    const frame = props.frame, view = props.viewport;
    const minTop = Math.min(Math.max(frame.top, screenshot ? APP_BAR_H : 0) + VIEW_COMMENT_INSET, Math.max(VIEW_COMMENT_INSET, view.height - VIEW_COMMENT_INSET));
    const naturalHeight = element?.scrollHeight || element?.getBoundingClientRect().height || (screenshot ? 720 : 236);
    return { minTop, height: Math.min(naturalHeight, Math.max(0, view.height - minTop - VIEW_COMMENT_INSET)) };
  };
  const position = createMemo(() => {
    const current = draft.selection();
    if (!current) return null;
    const view = props.viewport;
    const screenshot = capture.required();
    const base = positionedComposer(current, props.frame, view.width, view.height, screenshot);
    const moved = manualPoint();
    if (!moved) return base;
    const { minTop, height } = reach(screenshot);
    return { ...base, ...clampComposerPosition({ ...base, ...moved }, view.width, view.height, height, minTop, VIEW_COMMENT_INSET) };
  });
  const place = (point: ComposerPoint) => {
    const current = position();
    if (!current) return;
    const view = props.viewport;
    const { minTop, height } = reach(capture.required());
    setManualPoint(clampComposerPosition({ ...current, ...point }, view.width, view.height, height, minTop, VIEW_COMMENT_INSET));
  };
  const startDrag = (event: PointerEvent) => {
    const current = position();
    if (!current) return;
    stopDrag?.();
    stopDrag = beginComposerPointerDrag(event, current, place, event.currentTarget as HTMLElement);
  };
  onCleanup(() => stopDrag?.());
  const moveByKey = (event: KeyboardEvent) => {
    const step = event.shiftKey ? 32 : 12;
    const delta = event.key === 'ArrowLeft' ? { left: -step, top: 0 }
      : event.key === 'ArrowRight' ? { left: step, top: 0 }
      : event.key === 'ArrowUp' ? { left: 0, top: -step }
      : event.key === 'ArrowDown' ? { left: 0, top: step }
      : null;
    if (!delta) return;
    const current = position();
    if (!current) return;
    event.preventDefault();
    place({ left: current.left + delta.left, top: current.top + delta.top });
    const next = position();
    if (next) setMoveAnnouncement(`Comment box moved to ${Math.round(next.left)}, ${Math.round(next.top)} pixels.`);
  };
  // The breadcrumb the edit toolbar taught: nearest ancestors, outermost first.
  const crumbs = () => { const current = draft.selection(); return current ? [...current.ancestors.slice(-2), { path: current.path, tag: current.tag, hint: '' }] : []; };

  return <Show when={props.show && position()}>
    <FloatingPanel label="Annotation composer" data-capture-chrome ref={drop.ref} class="text-sm"
      position={{ left: position()!.left, top: position()!.top }} width={position()!.width}>
      {/* The panel is portalled out of this layer's shadow root, so it carries its own copy of the capture rule. */}
      <style>{CAPTURE_CHROME_CSS}</style>
      {/* A file dragged anywhere over the composer is its image (CommentImageAttach). */}
      <ImageDropTarget over={drop.over()} />
      <div ref={element} class="overflow-y-auto" style={{ 'max-height': `calc(100vh - ${position()!.top + VIEW_COMMENT_INSET}px)` }}>
      <div class="flex items-center gap-2 border-b border-edge px-3 py-2.5">
        <span class="inline-flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full border border-accent/25 bg-accent-soft text-accent"><MessageSquare size={12} strokeWidth={1.8} /></span>
        <span class="text-xs font-semibold text-fg">Add comment</span>
        <Button type="button" variant="ghost" size="sm" icon aria-label="Move comment box" aria-describedby="annotation-composer-move-hint" aria-keyshortcuts="ArrowLeft ArrowRight ArrowUp ArrowDown" onPointerDown={startDrag} onKeyDown={moveByKey}
          class="touch-none select-none" style={{ cursor: 'move' }}>⠿</Button>
        <span id="annotation-composer-move-hint" class="sr-only" aria-live="polite">Use the arrow keys to move the comment box. Hold Shift to move farther.</span>
        <span class="sr-only" aria-live="polite">{moveAnnouncement()}</span>
        <Button type="button" variant="ghost" size="sm" icon aria-label="Close annotation composer" onClick={draft.cancel}
          class="ml-auto"><X size={14} strokeWidth={1.8} /></Button>
      </div>
      <div class="p-3">
        <Show when={capture.busy()}><div role="status" class="mb-3 flex items-center gap-2 rounded-lg border border-edge bg-surface p-4 text-sm text-muted"><LoaderCircle size={16} class="animate-spin" />Preparing screenshot…</div></Show>
        <Show when={capture.required() && !capture.draft() && !capture.busy()}>
          <div class="mb-3 space-y-3 rounded-lg border border-edge bg-surface p-3 text-xs">
            <p role="alert" class="leading-relaxed text-muted">{capture.error() || 'A screenshot is required for this selection.'}</p>
            <Button type="button" variant="secondary" size="sm" onClick={() => void draft.screenshot()}>Retry screenshot</Button>
            <Suspense fallback={null}><ScreenshotUpload onFile={(file) => void capture.upload(file)} /></Suspense>
            <Button type="button" variant="link" onClick={() => capture.skip()}>Continue without screenshot</Button>
          </div>
        </Show>
        <CommentMarkdownField backend={props.backend} artifactId={props.artifactId}
          label="Annotation comment" image={draft.image} busy={props.busy}
          value={draft.words()} onChange={draft.setWords} onSubmit={draft.submit}

          rows={2} autoFocus={!capture.busy()}>
          <div class="flex min-w-0 items-center gap-1 overflow-hidden font-mono text-2xs text-muted">
            <For each={crumbs()}>{(crumb, index) => (
              <span class="flex min-w-0 items-center gap-1">
                <Show when={index() > 0}><span>›</span></Show>
                <Show when={crumb.path !== draft.selection()?.path} fallback={<span class="truncate text-accent">{crumb.tag}</span>}>
                  <Tooltip content={crumb.hint || crumb.tag}>
                    <Button type="button" variant="link" aria-label={`Select ${crumb.tag}`} disabled={!!capture.draft() || capture.busy()}
                      onClick={() => props.post({ type: 'mx:select', path: crumb.path })}
                      class="min-w-0 truncate">{crumb.tag}</Button>
                  </Tooltip>
                </Show>
              </span>
            )}</For>
          </div>
        </CommentMarkdownField>
        <Show when={draft.selection()?.viewStateError}><p role="status" class="mb-2 text-xs text-muted">{draft.selection()?.viewStateError}</p></Show>
        <RetryingNote backend={props.backend} active={props.busy} />
        <Show when={draft.failure()}><p role="alert" class="mb-2 font-mono text-2xs text-danger">{draft.failure()}</p></Show>
        <div class="flex items-center justify-end gap-2">
          <CommentSubmitHint action="comment" />
          <Button type="button" variant="ghost" size="sm" aria-label="Cancel annotation" onClick={draft.cancel}>cancel</Button>
          <Button type="button" size="sm" aria-label="Save annotation" disabled={props.busy || capture.busy() || (capture.required() && !capture.draft()) || !hasReplyText(draft.words())} onClick={draft.submit}>comment</Button>
        </div>
      </div>
      </div>
    </FloatingPanel>
  </Show>;
}
