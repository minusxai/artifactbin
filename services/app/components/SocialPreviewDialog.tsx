'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { RotateCcw, X } from 'lucide-react';
import {
  DEFAULT_SOCIAL_PREVIEW_CROP,
  SOCIAL_PREVIEW_HEIGHT,
  SOCIAL_PREVIEW_MIN_CROP_WIDTH,
  SOCIAL_PREVIEW_OVERVIEW_GENERATION,
  SOCIAL_PREVIEW_WIDTH,
  savedSocialPreviewCrop,
  socialPreviewCropHeight,
  writeSocialPreviewCrop,
  type SocialPreviewCrop,
} from '@/lib/story/social-preview';

const rounded = (crop: SocialPreviewCrop): SocialPreviewCrop => ({
  x: Math.round(crop.x),
  y: Math.round(crop.y),
  width: Math.round(crop.width),
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

type Interaction = {
  pointerId: number;
  kind: 'move' | 'resize';
  clientX: number;
  clientY: number;
  crop: SocialPreviewCrop;
  camera: SocialPreviewCrop;
  latest: SocialPreviewCrop;
};

interface SaveResponse {
  edit_id?: string;
  source?: string;
  error?: string;
  details?: Array<{ message?: string }>;
}

export default function SocialPreviewDialog({ id, source, editId, version, onClose }: {
  id: string;
  source: string;
  editId: string;
  version: number;
  onClose: () => void;
}) {
  const initialSaved = useMemo(() => savedSocialPreviewCrop(source), [source]);
  const [crop, setCrop] = useState<SocialPreviewCrop>(initialSaved ?? DEFAULT_SOCIAL_PREVIEW_CROP);
  const [camera, setCamera] = useState<SocialPreviewCrop>(initialSaved ?? DEFAULT_SOCIAL_PREVIEW_CROP);
  const [interacting, setInteracting] = useState(false);
  const [loadedFocusedUrl, setLoadedFocusedUrl] = useState('');
  const [reset, setReset] = useState(false);
  const [sourceHeight, setSourceHeight] = useState(SOCIAL_PREVIEW_HEIGHT);
  const [imageReady, setImageReady] = useState(false);
  const [imageFailed, setImageFailed] = useState(false);
  const [previewAttempt, setPreviewAttempt] = useState(0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [base, setBase] = useState({ source, editId });
  const panelRef = useRef<HTMLDivElement | null>(null);
  const closeRef = useRef<HTMLButtonElement | null>(null);
  const frameRef = useRef<HTMLDivElement | null>(null);
  const interaction = useRef<Interaction | null>(null);

  const previewUrl = `/a/${id}/export?mode=preview&format=jpg&v=${version}&pv=${SOCIAL_PREVIEW_OVERVIEW_GENERATION}${previewAttempt ? `&attempt=${previewAttempt}` : ''}`;
  const height = socialPreviewCropHeight(crop.width);
  const magnification = Math.round(SOCIAL_PREVIEW_WIDTH / crop.width * 100);
  const focusedCrop = rounded(crop);
  const focusedUrl = `/a/${id}/export?mode=preview&format=png&v=${version}&pv=${SOCIAL_PREVIEW_OVERVIEW_GENERATION}&focus=1&crop=${encodeURIComponent(`x=${focusedCrop.x};y=${focusedCrop.y};width=${focusedCrop.width}`)}`;
  const focusedReady = loadedFocusedUrl === focusedUrl;
  const cameraHeight = socialPreviewCropHeight(camera.width) * CAMERA_PADDING;
  const cameraWidth = camera.width * CAMERA_PADDING;
  const cameraX = camera.x - (cameraWidth - camera.width) / 2;
  const cameraY = camera.y - (cameraHeight - socialPreviewCropHeight(camera.width)) / 2;

  useEffect(() => { closeRef.current?.focus(); }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { onClose(); return; }
      if (event.key !== 'Tab' || !panelRef.current) return;
      const stops = [...panelRef.current.querySelectorAll<HTMLElement>('button:not([disabled]), [tabindex="0"]')];
      if (stops.length === 0) return;
      const edge = event.shiftKey ? stops[0] : stops[stops.length - 1];
      if (document.activeElement === edge) {
        event.preventDefault();
        (event.shiftKey ? stops[stops.length - 1] : stops[0]).focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const update = useCallback((next: SocialPreviewCrop) => {
    setReset(false);
    const clamped = clampCrop(next, sourceHeight);
    setCrop(clamped);
    setCamera(clamped);
  }, [sourceHeight]);

  const onImageLoad = (event: React.SyntheticEvent<HTMLImageElement>) => {
    const image = event.currentTarget;
    const density = image.naturalWidth / SOCIAL_PREVIEW_WIDTH;
    const measuredHeight = density > 0 ? image.naturalHeight / density : SOCIAL_PREVIEW_HEIGHT;
    setSourceHeight(Math.max(SOCIAL_PREVIEW_HEIGHT, measuredHeight));
    setCrop((current) => {
      const clamped = clampCrop(current, Math.max(SOCIAL_PREVIEW_HEIGHT, measuredHeight));
      setCamera(clamped);
      return clamped;
    });
    setImageReady(true);
    setImageFailed(false);
  };

  const begin = (kind: Interaction['kind']) => (event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    setInteracting(true);
    interaction.current = {
      pointerId: event.pointerId,
      kind,
      clientX: event.clientX,
      clientY: event.clientY,
      crop,
      camera,
      latest: crop,
    };
  };

  const move = (event: React.PointerEvent<HTMLDivElement>) => {
    const held = interaction.current;
    if (!held || held.pointerId !== event.pointerId || !frameRef.current) return;
    const previewWidth = frameRef.current.parentElement?.getBoundingClientRect().width ?? 0;
    if (previewWidth <= 0) return;
    const scale = held.camera.width * CAMERA_PADDING / previewWidth;
    const dx = (event.clientX - held.clientX) * scale;
    const dy = (event.clientY - held.clientY) * scale;
    const ratio = SOCIAL_PREVIEW_HEIGHT / SOCIAL_PREVIEW_WIDTH;
    const rawResizeDelta = (dx + ratio * dy) / (1 + ratio * ratio);
    const resizeDelta = rawResizeDelta > 0
      ? rawResizeDelta * RESIZE_OUTWARD_SENSITIVITY
      : rawResizeDelta;
    const next = clampCrop(held.kind === 'move'
      // Once focused, dragging pans the document beneath the output frame.
      ? { ...held.crop, x: held.crop.x - dx, y: held.crop.y - dy }
      : { ...held.crop, width: held.crop.width + resizeDelta }, sourceHeight);
    held.latest = next;
    setReset(false);
    setCrop(next);
    // Keep inward resizing spatially stable, then focus it on release. When
    // resizing outward, reveal more of the page as the handle approaches it.
    if (held.kind === 'move' || next.width >= held.crop.width) setCamera(next);
  };

  const end = (event: React.PointerEvent<HTMLDivElement>) => {
    const held = interaction.current;
    if (held?.pointerId !== event.pointerId) return;
    interaction.current = null;
    setInteracting(false);
    setCamera(held.latest);
  };

  const moveByKey = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const step = event.shiftKey ? 1 : 10;
    const delta = {
      ArrowLeft: { x: -step, y: 0 }, ArrowRight: { x: step, y: 0 },
      ArrowUp: { x: 0, y: -step }, ArrowDown: { x: 0, y: step },
    }[event.key];
    if (!delta) return;
    event.preventDefault();
    update({ ...crop, x: crop.x + delta.x, y: crop.y + delta.y });
  };

  const resizeByKey = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    event.stopPropagation();
    const step = event.shiftKey ? 1 : 20;
    update({ ...crop, width: crop.width + (event.key === 'ArrowRight' ? step : -step) });
  };

  const save = async () => {
    if (saving) return;
    setSaving(true);
    setError('');
    const persisted = reset ? null : rounded(clampCrop(crop, sourceHeight));
    try {
      const res = await fetch(`/api/my/artifacts/${id}/edits`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ edit_id: base.editId, source: writeSocialPreviewCrop(base.source, persisted) }),
      });
      const body = (await res.json().catch(() => ({}))) as SaveResponse;
      if (res.ok) { onClose(); return; }
      if (res.status === 409 && body.edit_id && typeof body.source === 'string') {
        setBase({ editId: body.edit_id, source: body.source });
        setError('The document changed elsewhere. Your framing is preserved; review it and save again.');
        return;
      }
      const detail = body.details?.find((item) => item.message)?.message;
      setError(detail ?? `Could not save the preview (${body.error ?? res.status}).`);
    } catch {
      setError('Could not save the preview. Check your connection and try again.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-3 sm:p-8">
      <button type="button" aria-label="Close social preview" onClick={onClose} className="absolute inset-0 cursor-default border-0 bg-black/50 p-0 backdrop-blur-[2px]" />
      <div ref={panelRef} role="dialog" aria-modal="true" aria-label="Social preview" className="relative z-10 flex max-h-[92vh] w-full max-w-4xl flex-col overflow-hidden rounded-[9px] border border-edge-bright bg-surface shadow-2xl">
        <header className="flex shrink-0 items-start justify-between border-b border-edge px-4 py-3">
          <div>
            <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-accent">Share card</p>
            <h2 className="mt-1 font-sans text-base font-semibold text-fg">Social preview</h2>
            <p className="mt-1 font-sans text-xs text-muted">Drag to pan. Resize the locked 40:21 frame; release to focus.</p>
          </div>
          <button ref={closeRef} type="button" aria-label="Cancel social preview" onClick={onClose} className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-full border border-edge bg-transparent text-muted hover:bg-raised hover:text-fg"><X size={15} /></button>
        </header>

        <div className="min-h-0 flex-1 bg-ground p-3 sm:p-5">
          <div className="relative mx-auto aspect-[40/21] max-h-full overflow-hidden border border-edge bg-surface" aria-label="Social preview canvas">
            {/* eslint-disable-next-line @next/next/no-img-element -- this is an authenticated generated export. */}
            <img
              key={previewAttempt}
              src={previewUrl}
              alt="Artifact preview"
              draggable={false}
              onLoad={onImageLoad}
              onError={() => { setImageFailed(true); setImageReady(false); }}
              className={`pointer-events-none absolute h-auto max-w-none select-none ease-out motion-reduce:transition-none ${interacting ? '' : 'transition-[left,top,width] duration-200'}`}
              style={{
                width: `${SOCIAL_PREVIEW_WIDTH / cameraWidth * 100}%`,
                left: `${-cameraX / cameraWidth * 100}%`,
                top: `${-cameraY / cameraHeight * 100}%`,
              }}
            />
            {!imageReady && !imageFailed && (
              <div role="status" aria-live="polite" className="absolute inset-0 flex min-h-48 flex-col items-center justify-center gap-3 bg-surface px-4 text-center font-mono text-xs text-muted">
                <span aria-hidden="true" className="h-5 w-5 animate-spin rounded-full border-2 border-edge-bright border-t-accent motion-reduce:animate-none" />
                <span>rendering full-page overview…</span>
                <span className="text-[10px] text-faint">Complex artifacts can take a few seconds.</span>
              </div>
            )}
            {imageFailed && (
              <div role="status" className="absolute inset-0 flex min-h-48 flex-col items-center justify-center gap-3 bg-surface px-4 text-center font-mono text-xs text-muted">
                <span>The overview could not be rendered.</span>
                <button type="button" onClick={() => { setImageFailed(false); setPreviewAttempt((attempt) => attempt + 1); }} className="cursor-pointer rounded-[5px] border border-edge-bright bg-raised px-3 py-2 text-fg hover:border-accent">retry</button>
              </div>
            )}
            {imageReady && (
              <div
                ref={frameRef}
                role="group"
                tabIndex={0}
                aria-label="Move social preview crop"
                aria-valuetext={`x ${Math.round(crop.x)}, y ${Math.round(crop.y)}, width ${Math.round(crop.width)}`}
                onKeyDown={moveByKey}
                onPointerDown={begin('move')}
                onPointerMove={move}
                onPointerUp={end}
                onPointerCancel={end}
                className={`absolute cursor-move border-2 border-accent shadow-[0_0_0_9999px_rgba(0,0,0,0.55)] outline-none ease-out focus:ring-2 focus:ring-accent focus:ring-offset-2 motion-reduce:transition-none ${interacting ? '' : 'transition-[left,top,width,height] duration-200'}`}
                style={{
                  left: `${(crop.x - cameraX) / cameraWidth * 100}%`,
                  top: `${(crop.y - cameraY) / cameraHeight * 100}%`,
                  width: `${crop.width / cameraWidth * 100}%`,
                  height: `${height / cameraHeight * 100}%`,
                  touchAction: 'none',
                }}
              >
                {!interacting && (
                  <>
                    {/* A crop-sized render replaces the overview after each gesture, so magnification never enlarges overview pixels. */}
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      key={focusedUrl}
                      src={focusedUrl}
                      alt=""
                      aria-hidden="true"
                      draggable={false}
                      onLoad={() => setLoadedFocusedUrl(focusedUrl)}
                      className={`pointer-events-none absolute inset-0 h-full w-full select-none transition-opacity duration-150 motion-reduce:transition-none ${focusedReady ? 'opacity-100' : 'opacity-0'}`}
                    />
                    {!focusedReady && (
                      <span aria-live="polite" className="absolute right-1.5 top-1.5 flex items-center gap-1.5 bg-black/65 px-2 py-1 font-mono text-[9px] text-white">
                        <span aria-hidden="true" className="h-2.5 w-2.5 animate-spin rounded-full border border-white/40 border-t-white motion-reduce:animate-none" />
                        sharpening…
                      </span>
                    )}
                  </>
                )}
                <span className="absolute left-1 top-1 bg-accent px-1.5 py-1 font-mono text-[9px] text-white">1600 × 840 · {magnification}%</span>
                <div
                  role="slider"
                  tabIndex={0}
                  aria-label="Resize social preview crop"
                  aria-valuemin={SOCIAL_PREVIEW_MIN_CROP_WIDTH}
                  aria-valuemax={SOCIAL_PREVIEW_WIDTH}
                  aria-valuenow={Math.round(crop.width)}
                  onKeyDown={resizeByKey}
                  onPointerDown={begin('resize')}
                  onPointerMove={move}
                  onPointerUp={end}
                  onPointerCancel={end}
                  className="absolute -bottom-2 -right-2 h-5 w-5 cursor-se-resize rounded-full border-2 border-white bg-accent shadow outline-none focus:ring-2 focus:ring-accent"
                  style={{ touchAction: 'none' }}
                />
              </div>
            )}
          </div>
        </div>

        <footer className="shrink-0 border-t border-edge bg-surface px-4 py-3">
          {error && <p role="status" className="mb-2 font-mono text-[11px] text-danger">{error}</p>}
          <div className="flex items-center justify-between gap-3">
            <button
              type="button"
              aria-label="Reset social preview"
              onClick={() => { setCrop(DEFAULT_SOCIAL_PREVIEW_CROP); setCamera(DEFAULT_SOCIAL_PREVIEW_CROP); setReset(true); setError(''); }}
              className="inline-flex cursor-pointer items-center gap-1.5 rounded-[5px] border-0 bg-transparent px-2 py-2 font-mono text-xs text-muted hover:bg-raised hover:text-fg"
            >
              <RotateCcw size={13} /> reset
            </button>
            <div className="flex gap-2">
              <button type="button" onClick={onClose} className="cursor-pointer rounded-[5px] border border-edge bg-transparent px-3 py-2 font-mono text-xs text-muted hover:border-edge-bright hover:text-fg">cancel</button>
              <button type="button" disabled={saving || !imageReady} onClick={() => void save()} className="cursor-pointer rounded-[5px] border border-accent bg-accent px-3 py-2 font-mono text-xs font-semibold text-white disabled:cursor-default disabled:opacity-60">{saving ? 'saving…' : 'save preview'}</button>
            </div>
          </div>
        </footer>
      </div>
    </div>
  );
}
