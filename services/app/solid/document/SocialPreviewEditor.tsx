/* @jsxImportSource solid-js */
import { createMemo, createSignal, onCleanup, Show, type JSX } from 'solid-js';
import RotateCcw from 'lucide-solid/icons/rotate-ccw';
import { Button } from '../ui/Button';
import { Dialog } from '../ui/Dialog';
import { writeBrowserArtifact } from '@/lib/artifact-backend/browser-artifact-write';
import {
  DEFAULT_SOCIAL_PREVIEW_CROP,
  SOCIAL_PREVIEW_HEIGHT,
  SOCIAL_PREVIEW_MIN_CROP_WIDTH,
  SOCIAL_PREVIEW_OVERVIEW_GENERATION,
  SOCIAL_PREVIEW_WIDTH,
  savedSocialPreviewCrop,
  savedSocialPreviewImageCrop,
  writeSocialPreviewImageCrop,
  clampImageCrop,
  defaultImageCrop,
  imageCropMaxWidth,
  socialPreviewImage,
  writeSocialPreviewImage,
  socialPreviewCropHeight,
  writeSocialPreviewCrop,
  type SocialPreviewCrop,
} from '@/lib/document/social-preview';

const rounded = (crop: SocialPreviewCrop): SocialPreviewCrop => ({
  x: Math.round(crop.x), y: Math.round(crop.y), width: Math.round(crop.width),
});

const CAMERA_PADDING = 1.08;
const RESIZE_OUTWARD_SENSITIVITY = 3;
/** Wheel line/page units in CSS pixels, a pinch's (ctrl+wheel) zoom per pixel, and the idle wait before sharpening. */
const WHEEL_LINE = 16;
const WHEEL_PAGE = 800;
const PINCH_ZOOM = 0.004;
const WHEEL_SETTLE_MS = 250;

const clampCrop = (crop: SocialPreviewCrop, sourceHeight: number): SocialPreviewCrop => {
  const width = Math.min(SOCIAL_PREVIEW_WIDTH, Math.max(SOCIAL_PREVIEW_MIN_CROP_WIDTH, crop.width));
  const height = socialPreviewCropHeight(width);
  return {
    width,
    x: Math.min(Math.max(0, crop.x), SOCIAL_PREVIEW_WIDTH - width),
    y: Math.min(Math.max(0, crop.y), Math.max(0, sourceHeight - height)),
  };
};

interface Interaction {
  pointerId: number; kind: 'move' | 'resize'; clientX: number; clientY: number;
  crop: SocialPreviewCrop; camera: SocialPreviewCrop; latest: SocialPreviewCrop;
}
interface SaveResponse { edit_id?: string; source?: string; error?: string; details?: Array<{ message?: string }> }

/** Where a drag leaves the crop: moved by the pointer's travel, or resized along the frame's diagonal (outward faster). */
function draggedCrop(held: Interaction, clientX: number, clientY: number, previewWidth: number): SocialPreviewCrop {
  const scale = held.camera.width * CAMERA_PADDING / previewWidth;
  const dx = (clientX - held.clientX) * scale;
  const dy = (clientY - held.clientY) * scale;
  if (held.kind === 'move') return { ...held.crop, x: held.crop.x - dx, y: held.crop.y - dy };
  const ratio = SOCIAL_PREVIEW_HEIGHT / SOCIAL_PREVIEW_WIDTH;
  const rawResizeDelta = (dx + ratio * dy) / (1 + ratio * ratio);
  return { ...held.crop, width: held.crop.width + (rawResizeDelta > 0 ? rawResizeDelta * RESIZE_OUTWARD_SENSITIVITY : rawResizeDelta) };
}

/** Where a wheel leaves the crop: a pinch (ctrl/⌘ + wheel) resizes about the centre; otherwise it pans (shift: sideways). */
function wheeledCrop(current: SocialPreviewCrop, camera: SocialPreviewCrop, event: WheelEvent, previewWidth: number): SocialPreviewCrop {
  const unit = event.deltaMode === 1 ? WHEEL_LINE : event.deltaMode === 2 ? WHEEL_PAGE : 1;
  if (event.ctrlKey || event.metaKey) {
    const width = current.width * Math.exp(event.deltaY * unit * PINCH_ZOOM);
    return { width, x: current.x + (current.width - width) / 2, y: current.y + (socialPreviewCropHeight(current.width) - socialPreviewCropHeight(width)) / 2 };
  }
  const scale = camera.width * CAMERA_PADDING / previewWidth;
  const dx = (event.shiftKey && !event.deltaX ? event.deltaY : event.deltaX) * unit * scale;
  const dy = (event.shiftKey && !event.deltaX ? 0 : event.deltaY) * unit * scale;
  return { ...current, x: current.x + dx, y: current.y + dy };
}

/** The camera's box over the source: the frame it follows, padded so the frame never touches the canvas edge. */
const cameraBox = (camera: SocialPreviewCrop) => {
  const width = camera.width * CAMERA_PADDING, height = socialPreviewCropHeight(camera.width) * CAMERA_PADDING;
  return { width, height, x: camera.x - (width - camera.width) / 2, y: camera.y - (height - socialPreviewCropHeight(camera.width)) / 2 };
};

const ARROWS: Record<string, { x: number; y: number }> = { ArrowLeft: { x: -1, y: 0 }, ArrowRight: { x: 1, y: 0 }, ArrowUp: { x: 0, y: -1 }, ArrowDown: { x: 0, y: 1 } };

/** Where an arrow key leaves the crop: moved 10 px (Shift: 1), or when `resize`, left/right resize it 20 px (Shift: 1). Null for any other key. */
function keyedCrop(crop: SocialPreviewCrop, event: KeyboardEvent, resize: boolean): SocialPreviewCrop | null {
  if (resize) {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return null;
    const step = event.shiftKey ? 1 : 20;
    return { ...crop, width: crop.width + (event.key === 'ArrowRight' ? step : -step) };
  }
  const delta = Object.hasOwn(ARROWS, event.key) ? ARROWS[event.key]! : null;
  if (!delta) return null;
  const step = event.shiftKey ? 1 : 10;
  return { ...crop, x: crop.x + delta.x * step, y: crop.y + delta.y * step };
}

/** The loaded image's height in source pixels (its width is the frame's 1600); the overview is never shorter than a card. */
function sourceHeightOf(image: HTMLImageElement, uploaded: boolean): number {
  const density = image.naturalWidth / SOCIAL_PREVIEW_WIDTH;
  const measured = density > 0 ? image.naturalHeight / density : SOCIAL_PREVIEW_HEIGHT;
  return uploaded ? measured : Math.max(SOCIAL_PREVIEW_HEIGHT, measured);
}

/**
 * The frame's own sharp render, laid over the overview once it has loaded; until then the frame says it is sharpening.
 * `loaded` is the last render that finished, kept by the editor: the overlay goes while a gesture runs, and an unchanged
 * frame must not sharpen again when it returns.
 */
function SharpFrame(props: { url: string; loaded: string; onLoad: (url: string) => void }): JSX.Element {
  const ready = () => props.loaded === props.url;
  return <>
    <img src={props.url} alt="" aria-hidden="true" draggable={false} onLoad={() => props.onLoad(props.url)}
      class={`pointer-events-none absolute inset-0 h-full w-full select-none transition-opacity duration-150 motion-reduce:transition-none ${ready() ? 'opacity-100' : 'opacity-0'}`} />
    <Show when={!ready()}>
      <span aria-live="polite" class="absolute right-1.5 top-1.5 flex items-center gap-1.5 rounded-chip bg-surface/80 px-2 py-1 font-mono text-micro text-fg">
        <span aria-hidden="true" class="h-2.5 w-2.5 animate-spin rounded-full border border-edge-bright border-t-accent motion-reduce:animate-none" />
        sharpening…
      </span>
    </Show>
  </>;
}

/** The canvas before its image shows: rendering or loading it, or why it could not, with a retry. */
function CanvasStatus(props: { failed: boolean; uploaded: boolean; onRetry: () => void }): JSX.Element {
  return <div role="status" aria-live={props.failed ? undefined : 'polite'} class="absolute inset-0 flex min-h-48 flex-col items-center justify-center gap-3 bg-surface px-4 text-center font-mono text-xs text-muted">
    <Show when={props.failed} fallback={<>
      <span aria-hidden="true" class="h-5 w-5 animate-spin rounded-full border-2 border-edge-bright border-t-accent motion-reduce:animate-none" />
      <span>{props.uploaded ? 'loading image…' : 'rendering full-page overview…'}</span>
      <Show when={!props.uploaded}><span class="text-micro text-faint">Complex artifacts can take a few seconds.</span></Show>
    </>}>
      <span>The preview could not be loaded.</span>
      <Button variant="secondary" size="sm" onClick={() => props.onRetry()}>retry</Button>
    </Show>
  </div>;
}

/** Uploads an image as an artifact of its own; its id, or the server's refusal as the error's message. */
async function uploadImage(file: File): Promise<string> {
  const response = await fetch('/api/my/artifacts', { method: 'POST', headers: { 'Content-Type': file.type || 'application/octet-stream' }, body: file });
  const body = await response.json();
  if (!response.ok || typeof body.id !== 'string') throw new Error(body.details?.find((item: { message?: string }) => item.message)?.message ?? body.error ?? 'Could not upload image.');
  return body.id;
}

/**
 * The document's source with this framing: the image it names (or none) and, for an image, its crop; for the
 * document overview, its crop when `writeDocumentCrop` (it was moved, or the page had no image before). Null resets.
 */
function framedSource(source: string, imageId: string | null, crop: SocialPreviewCrop | null, writeDocumentCrop: boolean): string {
  const next = writeSocialPreviewImage(source, imageId);
  if (imageId) return writeSocialPreviewImageCrop(next, crop);
  return writeDocumentCrop ? writeSocialPreviewCrop(next, crop) : next;
}

/**
 * What the canvas draws: the document's full-page overview, the image the page already names (through the export,
 * at this version), or a newly uploaded image (raw). `attempt` busts a failed load.
 */
function canvasAddress(id: string, version: number, imageId: string | null, initialImage: string | null, attempt: number): string {
  if (!imageId) return `/a/${id}/export?mode=preview&format=jpg&v=${version}&pv=${SOCIAL_PREVIEW_OVERVIEW_GENERATION}${attempt ? `&attempt=${attempt}` : ''}`;
  return imageId === initialImage ? `/a/${id}/export?mode=preview&image=1&v=${version}&attempt=${attempt}` : `/a/${imageId}/raw?attempt=${attempt}`;
}

/** The overview rendered sharp inside `crop` alone. */
const focusedAddress = (id: string, version: number, crop: SocialPreviewCrop) =>
  `/a/${id}/export?mode=preview&format=png&v=${version}&pv=${SOCIAL_PREVIEW_OVERVIEW_GENERATION}&focus=1&crop=${encodeURIComponent(`x=${crop.x};y=${crop.y};width=${crop.width}`)}`;

interface SocialPreviewEditorProps { id: string; source: string; editId: string; version: number; onClose: () => void }

/** The share-card crop editor: a locked 40:21 frame the owner pans and resizes over the document
 * overview or an uploaded image. Framing persists as native HTML head metadata (lib/document/social-preview);
 * saving goes through the same authoring transport as any other document edit. */
export function SocialPreviewEditor(props: SocialPreviewEditorProps): JSX.Element {
  const initialImage = socialPreviewImage(props.source);
  const initialSaved = savedSocialPreviewCrop(props.source);
  const initialImageCrop = savedSocialPreviewImageCrop(props.source);
  const documentDraft = { crop: initialSaved ?? DEFAULT_SOCIAL_PREVIEW_CROP, reset: false, dirty: false };
  let imageDraft: SocialPreviewCrop | null = initialImageCrop;

  const [imageId, setImageId] = createSignal<string | null>(initialImage);
  const [uploading, setUploading] = createSignal(false);
  const [cropDirty, setCropDirty] = createSignal(false);
  const [crop, setCrop] = createSignal<SocialPreviewCrop>((initialImage ? initialImageCrop : initialSaved) ?? DEFAULT_SOCIAL_PREVIEW_CROP);
  const [camera, setCamera] = createSignal<SocialPreviewCrop>(initialSaved ?? DEFAULT_SOCIAL_PREVIEW_CROP);
  const [interacting, setInteracting] = createSignal(false);
  const [loadedFocusedUrl, setLoadedFocusedUrl] = createSignal('');
  const [reset, setReset] = createSignal(false);
  const [sourceHeight, setSourceHeight] = createSignal(SOCIAL_PREVIEW_HEIGHT);
  const [imageReady, setImageReady] = createSignal(false);
  const [imageFailed, setImageFailed] = createSignal(false);
  const [previewAttempt, setPreviewAttempt] = createSignal(0);
  const [saving, setSaving] = createSignal(false);
  const [error, setError] = createSignal('');
  const [base, setBase] = createSignal({ source: props.source, editId: props.editId });

  let frame!: HTMLDivElement;
  let uploadInput!: HTMLInputElement;
  let interaction: Interaction | null = null;
  let wheelSettle: ReturnType<typeof setTimeout> | undefined;
  onCleanup(() => clearTimeout(wheelSettle));

  const previewUrl = () => canvasAddress(props.id, props.version, imageId(), initialImage, previewAttempt());
  const boundCrop = (next: SocialPreviewCrop, height: number) => imageId() ? clampImageCrop(next, height) : clampCrop(next, height);
  const height = () => socialPreviewCropHeight(crop().width);
  const magnification = () => Math.round(SOCIAL_PREVIEW_WIDTH / crop().width * 100);
  const focusedUrl = () => focusedAddress(props.id, props.version, rounded(crop()));
  const view = createMemo(() => cameraBox(camera()));

  /** The frame moves to `next` (already bounded): the framing is now this person's, not the saved or reset one. */
  const place = (next: SocialPreviewCrop) => { if (imageId()) imageDraft = next; setCropDirty(true); setReset(false); setCrop(next); };
  const update = (next: SocialPreviewCrop) => { const clamped = boundCrop(next, sourceHeight()); place(clamped); setCamera(clamped); };

  const onImageLoad = (event: Event) => {
    const nextHeight = sourceHeightOf(event.currentTarget as HTMLImageElement, !!imageId());
    setSourceHeight(nextHeight);
    const clamped = imageId() ? clampImageCrop(imageDraft ?? defaultImageCrop(nextHeight), nextHeight) : clampCrop(crop(), nextHeight);
    setCamera(clamped); setCrop(clamped);
    setImageReady(true); setImageFailed(false);
  };

  const begin = (kind: Interaction['kind']) => (event: PointerEvent) => {
    event.preventDefault(); event.stopPropagation();
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    setInteracting(true);
    interaction = { pointerId: event.pointerId, kind, clientX: event.clientX, clientY: event.clientY, crop: crop(), camera: camera(), latest: crop() };
  };

  const move = (event: PointerEvent) => {
    const held = interaction;
    if (!held || held.pointerId !== event.pointerId || !frame) return;
    const previewWidth = frame.parentElement?.getBoundingClientRect().width ?? 0;
    if (previewWidth <= 0) return;
    const next = boundCrop(draggedCrop(held, event.clientX, event.clientY, previewWidth), sourceHeight());
    held.latest = next;
    place(next);
    if (held.kind === 'move' || next.width >= held.crop.width) setCamera(next);
  };

  const end = (event: PointerEvent) => {
    const held = interaction;
    if (held?.pointerId !== event.pointerId) return;
    interaction = null; setInteracting(false); setCamera(held.latest);
  };

  /** Scrolling pans the frame through the page (wheel down → further down); a trackpad pinch, or ctrl/⌘ + wheel,
   * resizes it about its centre. The frame stays unsharpened until the gesture settles. */
  const wheel = (event: WheelEvent & { currentTarget: HTMLDivElement }) => {
    if (!imageReady() || interaction) return;
    const previewWidth = event.currentTarget.getBoundingClientRect().width;
    if (previewWidth <= 0) return;
    event.preventDefault();
    setInteracting(true);
    update(wheeledCrop(crop(), camera(), event, previewWidth));
    clearTimeout(wheelSettle);
    wheelSettle = setTimeout(() => setInteracting(false), WHEEL_SETTLE_MS);
  };

  /** The arrow keys on the frame move it; on its corner handle (`resize`) they resize it, and stay the handle's. */
  const byKey = (resize: boolean) => (event: KeyboardEvent) => {
    const next = keyedCrop(crop(), event, resize);
    if (!next) return;
    event.preventDefault(); if (resize) event.stopPropagation();
    update(next);
  };

  const showImage = (id: string | null) => { setImageReady(false); setImageFailed(false); setImageId(id); };

  const upload = async (file: File) => {
    setUploading(true); setError('');
    try {
      const id = await uploadImage(file);
      if (!imageId()) Object.assign(documentDraft, { crop: crop(), reset: reset(), dirty: cropDirty() });
      imageDraft = null;
      setCropDirty(false); setReset(false); showImage(id);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not upload image. Try again.'); }
    finally { setUploading(false); if (uploadInput) uploadInput.value = ''; }
  };

  const save = async () => {
    if (saving() || uploading()) return;
    setSaving(true); setError('');
    const nextSource = framedSource(base().source, imageId(), reset() ? null : rounded(boundCrop(crop(), sourceHeight())), cropDirty() || !initialImage);
    try {
      const response = await writeBrowserArtifact(props.id, { source: nextSource }, base().editId);
      const body = await response.json().catch(() => ({})) as SaveResponse;
      if (response.ok) { props.onClose(); return; }
      if (response.status === 409 && body.edit_id && typeof body.source === 'string') {
        setBase({ editId: body.edit_id, source: body.source });
        setError('The document changed elsewhere. Your framing is preserved; review it and save again.');
        return;
      }
      const detail = body.details?.find(item => item.message)?.message;
      setError(detail ?? `Could not save the preview (${body.error ?? response.status}).`);
    } catch { setError('Could not save the preview. Check your connection and try again.'); }
    finally { setSaving(false); }
  };

  const resetCrop = () => { setCropDirty(true); imageDraft = null; const next = imageId() ? defaultImageCrop(sourceHeight()) : DEFAULT_SOCIAL_PREVIEW_CROP; setCrop(next); setCamera(next); setReset(true); setError(''); };

  const useDocumentFraming = () => {
    showImage(null);
    setCrop(documentDraft.crop); setCamera(documentDraft.crop); setReset(documentDraft.reset); setCropDirty(documentDraft.dirty);
  };

  return <Dialog title="Social preview" size="xl" closeLabel="Close social preview" description="Drag or scroll to pan. Pinch or drag the corner to resize the locked 40:21 frame." onClose={props.onClose} initialFocus="[data-cancel-preview]"
    footer={<div class="flex w-full items-center justify-between gap-3">
      <Button variant="ghost" aria-label="Reset social preview" disabled={!imageReady() || uploading() || saving()}
        onClick={resetCrop}>
        <RotateCcw size={13} /> reset
      </Button>
      <div class="flex gap-2">
        <Button variant="secondary" aria-label="Cancel social preview" data-cancel-preview onClick={props.onClose}>cancel</Button>
        <Button disabled={saving() || uploading() || !imageReady()} onClick={() => void save()}>{saving() ? 'saving…' : 'save preview'}</Button>
      </div>
    </div>}>
    <div class="mb-3 flex items-center gap-3">
      <input ref={uploadInput} hidden type="file" accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml" aria-label="Upload social preview image" onChange={event => { const file = event.currentTarget.files?.[0]; if (file) void upload(file); }} />
      <Button variant="secondary" size="sm" disabled={uploading() || saving()} onClick={() => uploadInput?.click()}>{uploading() ? 'uploading…' : imageId() ? 'replace image' : 'upload image'}</Button>
      <Show when={imageId()}><Button variant="ghost" size="sm" disabled={uploading() || saving()} onClick={useDocumentFraming}>use document framing</Button></Show>
    </div>
    <div class="min-h-0 flex-1 rounded-panel bg-raised p-3">
      <div class="relative mx-auto aspect-[40/21] max-h-full overflow-hidden border border-edge bg-surface" aria-label="Social preview canvas" onWheel={wheel}>
        <img src={previewUrl()} alt={imageId() ? 'Uploaded social preview' : 'Artifact preview'} draggable={false}
          onLoad={onImageLoad} onError={() => { setImageFailed(true); setImageReady(false); }}
          class={`pointer-events-none absolute h-auto max-w-none select-none ease-out motion-reduce:transition-none ${interacting() ? '' : 'transition-[left,top,width] duration-200'}`}
          style={{ width: `${SOCIAL_PREVIEW_WIDTH / view().width * 100}%`, left: `${-view().x / view().width * 100}%`, top: `${-view().y / view().height * 100}%` }} />
        <Show when={!imageReady()}><CanvasStatus failed={imageFailed()} uploaded={!!imageId()} onRetry={() => { setImageFailed(false); setPreviewAttempt(value => value + 1); }} /></Show>
        <Show when={imageReady()}>
          <div ref={frame} role="group" tabIndex={0} aria-label="Move social preview crop" aria-valuetext={`x ${Math.round(crop().x)}, y ${Math.round(crop().y)}, width ${Math.round(crop().width)}`}
            onKeyDown={byKey(false)} onPointerDown={begin('move')} onPointerMove={move} onPointerUp={end} onPointerCancel={end}
            class={`absolute cursor-move border-2 border-accent shadow-[0_0_0_9999px_rgba(0,0,0,0.55)] outline-none ease-out focus:ring-2 focus:ring-accent focus:ring-offset-2 motion-reduce:transition-none ${interacting() ? '' : 'transition-[left,top,width,height] duration-200'}`}
            style={{ left: `${(crop().x - view().x) / view().width * 100}%`, top: `${(crop().y - view().y) / view().height * 100}%`, width: `${crop().width / view().width * 100}%`, height: `${height() / view().height * 100}%`, 'touch-action': 'none' }}>
            <Show when={!imageId() && !interacting()}><SharpFrame url={focusedUrl()} loaded={loadedFocusedUrl()} onLoad={setLoadedFocusedUrl} /></Show>
            <span class="absolute left-1 top-1 bg-accent px-1.5 py-1 font-mono text-micro text-action-ink">1600 × 840 · {magnification()}%</span>
            <div role="slider" tabIndex={0} aria-label="Resize social preview crop"
              aria-valuemin={imageId() ? Math.min(SOCIAL_PREVIEW_MIN_CROP_WIDTH, imageCropMaxWidth(sourceHeight())) : SOCIAL_PREVIEW_MIN_CROP_WIDTH}
              aria-valuemax={imageId() ? imageCropMaxWidth(sourceHeight()) : SOCIAL_PREVIEW_WIDTH}
              aria-valuenow={Math.round(crop().width)}
              onKeyDown={byKey(true)} onPointerDown={begin('resize')} onPointerMove={move} onPointerUp={end} onPointerCancel={end}
              class="absolute -bottom-2 -right-2 h-5 w-5 cursor-se-resize rounded-full border-2 border-surface bg-accent shadow outline-none focus:ring-2 focus:ring-accent" style={{ 'touch-action': 'none' }} />
          </div>
        </Show>
      </div>
    </div>
    <Show when={error()}><p role="status" class="mt-3 font-mono text-2xs text-danger">{error()}</p></Show>
  </Dialog>;
}
