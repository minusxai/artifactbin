/* @jsxImportSource solid-js */
/**
 * ONE IMAGE ON A COMMENT, HOWEVER IT ARRIVES — pasted from the clipboard (a screenshot taken to it),
 * dropped onto the box, or picked with "Attach image". Every comment box uses this one module: the
 * new-comment composer, a thread's reply box and anything that reuses that reply box.
 *
 *   · `CommentImagesProvider` — the annotation layer says where images go (its backend) and which
 *                               document revision they are staged against (`editId`).
 *   · `createCommentImageDraft` — one box's draft image: the existing CommentCapture upload path
 *                               (`method: 'upload'`), its brush export and its staging for a write.
 *   · `bindImageAttach`       — paste / drag / drop on an element, in the CAPTURE phase so the text
 *                               editor never sees an image paste (ProseMirror would replace the
 *                               selection with the clipboard's empty text). Text paste passes through.
 *   · `CommentImageDraftView`, `AttachImageButton`, `ImageDropTarget` — what the box draws.
 *
 * One image per comment stays the model: a new one replaces the draft's. A backend without comment
 * images (offline file, local preview) attaches nothing and says why.
 */
import { createContext, createSignal, lazy, onCleanup, Show, Suspense, useContext, type JSX } from 'solid-js';
import ImagePlus from 'lucide-solid/icons/image-plus';
import LoaderCircle from 'lucide-solid/icons/loader-circle';
import type { ArtifactBackend } from '@/lib/artifact-backend/types';
import { FeatureGate } from '../components/FeatureGate';
import { Tooltip } from '../ui/Tooltip';
import { COMMENT_IMAGE_TYPES, createCommentCapture } from './CommentCapture';
import type { ScreenshotDrawing } from './ScreenshotEditor';

// The brush is its own chunk. It renders under its OWN Suspense boundary: the nearest one otherwise
// is the app's, and a first render would put the whole page on hold.
const ScreenshotEditor = lazy(() => import('./ScreenshotEditor').then((module) => ({ default: module.ScreenshotEditor })));
export const preloadScreenshotEditor = () => ScreenshotEditor.preload();

export type CommentCapture = ReturnType<typeof createCommentCapture>;
/** What a write carries for its image: the stage, and the revision it was staged against. */
export interface CommentImageAttachment { attachment_id: string; edit_id: string }

export interface CommentImageDraft {
  capture: CommentCapture;
  exportRef: { current: (() => Promise<ScreenshotDrawing>) | null };
  /** Why nothing can be attached here; null when images work. */
  unavailable: () => string | null;
  /** Capture this draft's image again — the composer's area tool. Absent for an attached image. */
  retake: () => (() => void) | undefined;
  /** A gated attempt's reason, shown where the draft's errors are. */
  refusal: () => string;
  attach: (file: File) => void;
  remove: () => void;
  /** Upload the image as drawn; undefined when the draft has none. */
  stage: () => Promise<CommentImageAttachment | undefined>;
}

interface CommentImagesSource { backend: ArtifactBackend; editId: () => string | undefined }
const CommentImagesContext = createContext<CommentImagesSource>();

export function CommentImagesProvider(props: CommentImagesSource & { children: JSX.Element }): JSX.Element {
  return <CommentImagesContext.Provider value={{ backend: props.backend, editId: props.editId }}>{props.children}</CommentImagesContext.Provider>;
}

/**
 * One box's draft image. The backend and revision come from the nearest CommentImagesProvider unless
 * given; without either there is nowhere to put an image, and the box simply offers none (null).
 */
export function createCommentImageDraft(options: { backend?: ArtifactBackend; editId?: () => string | undefined; capture?: CommentCapture; retake?: () => (() => void) | undefined } = {}): CommentImageDraft | null {
  const source = useContext(CommentImagesContext);
  const backend = options.backend ?? source?.backend;
  const editId = options.editId ?? source?.editId;
  if (!backend || !editId) return null;
  const capture = options.capture ?? createCommentCapture(backend, editId);
  const exportRef: CommentImageDraft['exportRef'] = { current: null };
  const [refusal, setRefusal] = createSignal('');
  const unavailable = () => backend.unavailable('commentImages') ?? (editId() ? null : 'Images need a saved document.');
  return {
    capture, exportRef, unavailable, refusal,
    retake: options.retake ?? (() => undefined),
    attach: (file) => {
      const reason = unavailable();
      setRefusal(reason ?? '');
      if (reason) return;
      void preloadScreenshotEditor().catch(() => {});
      void capture.upload(file);
    },
    remove: () => { setRefusal(''); capture.skip(); },
    stage: async () => {
      const shot = capture.draft();
      if (!shot) return undefined;
      if (!exportRef.current) throw new Error('The screenshot is still loading. Please try again.');
      const staged = await capture.stage(await exportRef.current());
      return staged ? { attachment_id: staged.id, edit_id: staged.editId } : undefined;
    },
  };
}

const hasFiles = (data: DataTransfer | null | undefined) => !!data && Array.from(data.types ?? []).includes('Files');
const filesOf = (data: DataTransfer): File[] => {
  const files = Array.from(data.files ?? []);
  if (files.length) return files;
  return Array.from(data.items ?? []).flatMap((item) => (item.kind === 'file' ? [item.getAsFile()].filter((file): file is File => !!file) : []));
};
const preferred = (files: File[]) => files.find((file) => (COMMENT_IMAGE_TYPES as readonly string[]).includes(file.type)) ?? files[0] ?? null;

/**
 * The image a paste carries, or null when it is a text paste. A clipboard holding words AND a picture
 * (a spreadsheet's cells, a selection of a web page) is text; a copied file whose only text is its
 * own name is the file.
 */
export function clipboardImage(data: DataTransfer | null | undefined): File | null {
  if (!data) return null;
  const file = preferred(filesOf(data).filter((candidate) => candidate.type.startsWith('image/')));
  if (!file) return null;
  const text = (data.getData('text/plain') ?? '').trim();
  return !text || text === file.name || text.endsWith(`/${file.name}`) ? file : null;
}

/**
 * Paste, drag and drop on `element`. A file dragged anywhere else on the page while the box is up is
 * refused rather than opened: the browser would otherwise navigate away from the draft.
 */
export function bindImageAttach(element: HTMLElement, draft: CommentImageDraft, setOver: (over: boolean) => void): () => void {
  let depth = 0;
  const settle = () => { depth = 0; setOver(false); };
  const take = (event: Event) => { event.preventDefault(); event.stopPropagation(); };
  const onPaste = (event: ClipboardEvent) => {
    const file = clipboardImage(event.clipboardData);
    if (!file) return;
    take(event);
    draft.attach(file);
  };
  const onEnter = (event: DragEvent) => {
    if (!hasFiles(event.dataTransfer)) return;
    take(event);
    depth += 1;
    setOver(!draft.unavailable());
  };
  const onOver = (event: DragEvent) => {
    if (!hasFiles(event.dataTransfer)) return;
    take(event);
    if (event.dataTransfer) event.dataTransfer.dropEffect = draft.unavailable() ? 'none' : 'copy';
  };
  const onLeave = (event: DragEvent) => {
    if (!hasFiles(event.dataTransfer)) return;
    depth = Math.max(0, depth - 1);
    if (!depth) setOver(false);
  };
  const onDrop = (event: DragEvent) => {
    if (!hasFiles(event.dataTransfer)) return;
    take(event);
    settle();
    const file = preferred(filesOf(event.dataTransfer!));
    if (file) draft.attach(file);
  };
  // Elsewhere on the page: no navigation to the file, and nothing else changes (the selection stays).
  const guard = (event: DragEvent) => {
    if (!hasFiles(event.dataTransfer) || event.defaultPrevented) return;
    event.preventDefault();
    if (event.type === 'dragover' && event.dataTransfer) event.dataTransfer.dropEffect = 'none';
  };
  const listeners: Array<[EventTarget, string, EventListener, boolean]> = [
    [element, 'paste', onPaste as EventListener, true],
    [element, 'dragenter', onEnter as EventListener, true],
    [element, 'dragover', onOver as EventListener, true],
    [element, 'dragleave', onLeave as EventListener, true],
    [element, 'drop', onDrop as EventListener, true],
    [window, 'dragover', guard as EventListener, false],
    [window, 'drop', guard as EventListener, false],
    [window, 'dragend', settle, false],
  ];
  for (const [target, type, listener, capture] of listeners) target.addEventListener(type, listener, capture);
  return () => { for (const [target, type, listener, capture] of listeners) target.removeEventListener(type, listener, capture); };
}

/** `bindImageAttach` for a ref: bound while the element lives, with the drop-target state it reports. */
export function createImageDropTarget(draft: () => CommentImageDraft | null | undefined) {
  const [over, setOver] = createSignal(false);
  const ref = (element: HTMLElement) => {
    const current = draft();
    if (!current) return;
    const unbind = bindImageAttach(element, current, setOver);
    onCleanup(unbind);
  };
  return { over, ref };
}

/** The visible drop target while a file is over the box. It takes no pointer events, so the drag still lands. */
export function ImageDropTarget(props: { over: boolean }): JSX.Element {
  return <Show when={props.over}>
    <div role="status" class="pointer-events-none absolute inset-0 z-20 flex items-center justify-center rounded-[6px] border-2 border-dashed border-accent bg-accent-soft/90 text-sm font-semibold text-accent">Drop image to attach</div>
  </Show>;
}

/** A file picker that looks like a toolbar button; always offered, disabled with its reason where images are unavailable. */
export function AttachImageButton(props: { image: CommentImageDraft }): JSX.Element {
  const control = (gate: { disabled?: true; 'aria-describedby'?: string }) => (
    <label class="inline-flex h-6 w-6 cursor-pointer items-center justify-center rounded-[3px] text-muted hover:bg-surface hover:text-fg focus-within:outline-2 focus-within:outline-accent has-[:disabled]:cursor-default has-[:disabled]:opacity-50">
      <ImagePlus size={13} strokeWidth={1.8} aria-hidden="true" />
      <input type="file" class="sr-only" accept={COMMENT_IMAGE_TYPES.join(',')} aria-label="Attach image" {...gate}
        onChange={(event) => { const file = event.currentTarget.files?.[0]; if (file) props.image.attach(file); event.currentTarget.value = ''; }} />
    </label>
  );
  return <FeatureGate reason={props.image.unavailable()}>
    {(gate) => (gate.disabled ? control(gate) : <Tooltip content="attach image (or paste / drop one)">{control(gate)}</Tooltip>)}
  </FeatureGate>;
}

/** The draft's image in the brush editor, and anything that went wrong attaching one. */
export function CommentImageDraftView(props: { image: CommentImageDraft; busy?: boolean }): JSX.Element {
  const capture = props.image.capture;
  // The composer's own "screenshot required" panel shows a capture failure; everything else shows here.
  const error = () => props.image.refusal() || (capture.required() && !capture.draft() ? '' : capture.error());
  return <>
    <Show when={capture.draft()} keyed>{(shot) => (
      <Suspense fallback={<div role="status" class="mb-3 flex items-center gap-2 rounded-lg border border-edge bg-surface p-4 text-sm text-muted"><LoaderCircle size={16} class="animate-spin" />Loading screenshot…</div>}>
        <ScreenshotEditor image={shot.image} initialStrokes={shot.strokes} exportRef={props.image.exportRef} busy={!!props.busy}
          onRetake={props.image.retake()} onRemove={props.image.remove} />
      </Suspense>
    )}</Show>
    <Show when={error()}><p role="alert" class="mb-2 text-xs text-danger">{error()}</p></Show>
  </>;
}
