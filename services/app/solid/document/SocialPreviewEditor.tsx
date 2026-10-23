/* @jsxImportSource solid-js */
import { createSignal, Show, type JSX } from 'solid-js';
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

  const documentPreviewUrl = () => `/a/${props.id}/export?mode=preview&format=jpg&v=${props.version}&pv=${SOCIAL_PREVIEW_OVERVIEW_GENERATION}${previewAttempt() ? `&attempt=${previewAttempt()}` : ''}`;
  const previewUrl = () => {
    const id = imageId();
    if (!id) return documentPreviewUrl();
    return id === initialImage ? `/a/${props.id}/export?mode=preview&image=1&v=${props.version}&attempt=${previewAttempt()}` : `/a/${id}/raw?attempt=${previewAttempt()}`;
  };
  const boundCrop = (next: SocialPreviewCrop, height: number) => imageId() ? clampImageCrop(next, height) : clampCrop(next, height);
  const height = () => socialPreviewCropHeight(crop().width);
  const magnification = () => Math.round(SOCIAL_PREVIEW_WIDTH / crop().width * 100);
  const focusedCrop = () => rounded(crop());
  const focusedUrl = () => `/a/${props.id}/export?mode=preview&format=png&v=${props.version}&pv=${SOCIAL_PREVIEW_OVERVIEW_GENERATION}&focus=1&crop=${encodeURIComponent(`x=${focusedCrop().x};y=${focusedCrop().y};width=${focusedCrop().width}`)}`;
  const focusedReady = () => loadedFocusedUrl() === focusedUrl();
  const cameraHeight = () => socialPreviewCropHeight(camera().width) * CAMERA_PADDING;
  const cameraWidth = () => camera().width * CAMERA_PADDING;
  const cameraX = () => camera().x - (cameraWidth() - camera().width) / 2;
  const cameraY = () => camera().y - (cameraHeight() - socialPreviewCropHeight(camera().width)) / 2;

  const update = (next: SocialPreviewCrop) => {
    setCropDirty(true); setReset(false);
    const clamped = boundCrop(next, sourceHeight());
    if (imageId()) imageDraft = clamped;
    setCrop(clamped); setCamera(clamped);
  };

  const onImageLoad = (event: Event) => {
    const image = event.currentTarget as HTMLImageElement;
    const density = image.naturalWidth / SOCIAL_PREVIEW_WIDTH;
    const measuredHeight = density > 0 ? image.naturalHeight / density : SOCIAL_PREVIEW_HEIGHT;
    const nextHeight = imageId() ? measuredHeight : Math.max(SOCIAL_PREVIEW_HEIGHT, measuredHeight);
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
    const scale = held.camera.width * CAMERA_PADDING / previewWidth;
    const dx = (event.clientX - held.clientX) * scale;
    const dy = (event.clientY - held.clientY) * scale;
    const ratio = SOCIAL_PREVIEW_HEIGHT / SOCIAL_PREVIEW_WIDTH;
    const rawResizeDelta = (dx + ratio * dy) / (1 + ratio * ratio);
    const resizeDelta = rawResizeDelta > 0 ? rawResizeDelta * RESIZE_OUTWARD_SENSITIVITY : rawResizeDelta;
    const next = boundCrop(held.kind === 'move' ? { ...held.crop, x: held.crop.x - dx, y: held.crop.y - dy } : { ...held.crop, width: held.crop.width + resizeDelta }, sourceHeight());
    held.latest = next;
    if (imageId()) imageDraft = next;
    setCropDirty(true); setReset(false); setCrop(next);
    if (held.kind === 'move' || next.width >= held.crop.width) setCamera(next);
  };

  const end = (event: PointerEvent) => {
    const held = interaction;
    if (held?.pointerId !== event.pointerId) return;
    interaction = null; setInteracting(false); setCamera(held.latest);
  };

  const moveByKey = (event: KeyboardEvent) => {
    const step = event.shiftKey ? 1 : 10;
    const delta = ({ ArrowLeft: { x: -step, y: 0 }, ArrowRight: { x: step, y: 0 }, ArrowUp: { x: 0, y: -step }, ArrowDown: { x: 0, y: step } } as Record<string, { x: number; y: number }>)[event.key];
    if (!delta) return;
    event.preventDefault();
    update({ ...crop(), x: crop().x + delta.x, y: crop().y + delta.y });
  };

  const resizeByKey = (event: KeyboardEvent) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault(); event.stopPropagation();
    const step = event.shiftKey ? 1 : 20;
    update({ ...crop(), width: crop().width + (event.key === 'ArrowRight' ? step : -step) });
  };

  const upload = async (file: File) => {
    setUploading(true); setError('');
    try {
      const response = await fetch('/api/my/artifacts', { method: 'POST', headers: { 'Content-Type': file.type || 'application/octet-stream' }, body: file });
      const body = await response.json();
      if (!response.ok || typeof body.id !== 'string') throw new Error(body.details?.find((item: { message?: string }) => item.message)?.message ?? body.error ?? 'Could not upload image.');
      if (!imageId()) Object.assign(documentDraft, { crop: crop(), reset: reset(), dirty: cropDirty() });
      imageDraft = null;
      setCropDirty(false); setReset(false); setImageReady(false); setImageFailed(false);
      setImageId(body.id);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not upload image. Try again.'); }
    finally { setUploading(false); if (uploadInput) uploadInput.value = ''; }
  };

  const save = async () => {
    if (saving() || uploading()) return;
    setSaving(true); setError('');
    const persisted = reset() ? null : rounded(boundCrop(crop(), sourceHeight()));
    let nextSource = writeSocialPreviewImage(base().source, imageId());
    if (imageId()) nextSource = writeSocialPreviewImageCrop(nextSource, persisted);
    else if (cropDirty() || !initialImage) nextSource = writeSocialPreviewCrop(nextSource, persisted);
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

  const useDocumentFraming = () => {
    setImageId(null); setImageReady(false); setImageFailed(false);
    setCrop(documentDraft.crop); setCamera(documentDraft.crop); setReset(documentDraft.reset); setCropDirty(documentDraft.dirty);
  };

  return <Dialog title="Social preview" size="xl" closeLabel="Close social preview" description="Drag to pan. Resize the locked 40:21 frame; release to focus." onClose={props.onClose} initialFocus="[data-cancel-preview]"
    footer={<div class="flex w-full items-center justify-between gap-3">
      <Button variant="ghost" aria-label="Reset social preview" disabled={!imageReady() || uploading() || saving()}
        onClick={() => { setCropDirty(true); imageDraft = null; const next = imageId() ? defaultImageCrop(sourceHeight()) : DEFAULT_SOCIAL_PREVIEW_CROP; setCrop(next); setCamera(next); setReset(true); setError(''); }}>
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
      <div class="relative mx-auto aspect-[40/21] max-h-full overflow-hidden border border-edge bg-surface" aria-label="Social preview canvas">
        <img src={previewUrl()} alt={imageId() ? 'Uploaded social preview' : 'Artifact preview'} draggable={false}
          onLoad={onImageLoad} onError={() => { setImageFailed(true); setImageReady(false); }}
          class={`pointer-events-none absolute h-auto max-w-none select-none ease-out motion-reduce:transition-none ${interacting() ? '' : 'transition-[left,top,width] duration-200'}`}
          style={{ width: `${SOCIAL_PREVIEW_WIDTH / cameraWidth() * 100}%`, left: `${-cameraX() / cameraWidth() * 100}%`, top: `${-cameraY() / cameraHeight() * 100}%` }} />
        <Show when={!imageReady() && !imageFailed()}>
          <div role="status" aria-live="polite" class="absolute inset-0 flex min-h-48 flex-col items-center justify-center gap-3 bg-surface px-4 text-center font-mono text-xs text-muted">
            <span aria-hidden="true" class="h-5 w-5 animate-spin rounded-full border-2 border-edge-bright border-t-accent motion-reduce:animate-none" />
            <span>{imageId() ? 'loading image…' : 'rendering full-page overview…'}</span>
            <Show when={!imageId()}><span class="text-micro text-faint">Complex artifacts can take a few seconds.</span></Show>
          </div>
        </Show>
        <Show when={imageFailed()}>
          <div role="status" class="absolute inset-0 flex min-h-48 flex-col items-center justify-center gap-3 bg-surface px-4 text-center font-mono text-xs text-muted">
            <span>The preview could not be loaded.</span>
            <Button variant="secondary" size="sm" onClick={() => { setImageFailed(false); setPreviewAttempt(value => value + 1); }}>retry</Button>
          </div>
        </Show>
        <Show when={imageReady()}>
          <div ref={frame} role="group" tabIndex={0} aria-label="Move social preview crop" aria-valuetext={`x ${Math.round(crop().x)}, y ${Math.round(crop().y)}, width ${Math.round(crop().width)}`}
            onKeyDown={moveByKey} onPointerDown={begin('move')} onPointerMove={move} onPointerUp={end} onPointerCancel={end}
            class={`absolute cursor-move border-2 border-accent shadow-[0_0_0_9999px_rgba(0,0,0,0.55)] outline-none ease-out focus:ring-2 focus:ring-accent focus:ring-offset-2 motion-reduce:transition-none ${interacting() ? '' : 'transition-[left,top,width,height] duration-200'}`}
            style={{ left: `${(crop().x - cameraX()) / cameraWidth() * 100}%`, top: `${(crop().y - cameraY()) / cameraHeight() * 100}%`, width: `${crop().width / cameraWidth() * 100}%`, height: `${height() / cameraHeight() * 100}%`, 'touch-action': 'none' }}>
            <Show when={!imageId() && !interacting()}>
              <img src={focusedUrl()} alt="" aria-hidden="true" draggable={false} onLoad={() => setLoadedFocusedUrl(focusedUrl())}
                class={`pointer-events-none absolute inset-0 h-full w-full select-none transition-opacity duration-150 motion-reduce:transition-none ${focusedReady() ? 'opacity-100' : 'opacity-0'}`} />
              <Show when={!focusedReady()}>
                <span aria-live="polite" class="absolute right-1.5 top-1.5 flex items-center gap-1.5 rounded-chip bg-surface/80 px-2 py-1 font-mono text-micro text-fg">
                  <span aria-hidden="true" class="h-2.5 w-2.5 animate-spin rounded-full border border-edge-bright border-t-accent motion-reduce:animate-none" />
                  sharpening…
                </span>
              </Show>
            </Show>
            <span class="absolute left-1 top-1 bg-accent px-1.5 py-1 font-mono text-micro text-action-ink">1600 × 840 · {magnification()}%</span>
            <div role="slider" tabIndex={0} aria-label="Resize social preview crop"
              aria-valuemin={imageId() ? Math.min(SOCIAL_PREVIEW_MIN_CROP_WIDTH, imageCropMaxWidth(sourceHeight())) : SOCIAL_PREVIEW_MIN_CROP_WIDTH}
              aria-valuemax={imageId() ? imageCropMaxWidth(sourceHeight()) : SOCIAL_PREVIEW_WIDTH}
              aria-valuenow={Math.round(crop().width)}
              onKeyDown={resizeByKey} onPointerDown={begin('resize')} onPointerMove={move} onPointerUp={end} onPointerCancel={end}
              class="absolute -bottom-2 -right-2 h-5 w-5 cursor-se-resize rounded-full border-2 border-surface bg-accent shadow outline-none focus:ring-2 focus:ring-accent" style={{ 'touch-action': 'none' }} />
          </div>
        </Show>
      </div>
    </div>
    <Show when={error()}><p role="status" class="mt-3 font-mono text-2xs text-danger">{error()}</p></Show>
  </Dialog>;
}
