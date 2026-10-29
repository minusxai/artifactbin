/* @jsxImportSource solid-js */
import { createSignal, onCleanup, onMount, Show, type JSX } from 'solid-js';
import type { CapturedImage } from '@/lib/capture';
import { encodePng } from '@/lib/capture/png';
import { COMMENT_IMAGE_LIMITS, type BrushStroke } from '../../../contracts/src/comment-image';
import Undo2 from 'lucide-solid/icons/undo-2';
import { Button } from '../ui/Button';
import { SwatchPicker, SWATCHES } from '../ui/ColorField';
import { Panel } from '../ui/Panel';
import { Slider } from '../ui/Slider';
import { StatusMessage } from '../ui/StatusMessage';
import { Tooltip } from '../ui/Tooltip';

export interface ScreenshotDrawing { preview: Blob; strokes: BrushStroke[] }
interface ScreenshotEditorProps {
  image: CapturedImage; initialStrokes: BrushStroke[];
  exportRef: { current: (() => Promise<ScreenshotDrawing>) | null };
  busy: boolean;
  /** Capture again (the area tool); absent for an attached image, which has nothing to retake. */
  onRetake?: () => void;
  /** Drop the image from the draft. */
  onRemove?: () => void;
}

/** A static image plus bounded vector strokes — undo never retains pixel snapshots, and export waits for submission. */
export function ScreenshotEditor(props: ScreenshotEditorProps): JSX.Element {
  let canvas!: HTMLCanvasElement;
  let bitmap: HTMLImageElement | null = null;
  let strokes = structuredClone(props.initialStrokes);
  let active: BrushStroke | null = null;
  let raf = 0;
  let exported: ScreenshotDrawing | null = null;
  const [count, setCount] = createSignal(strokes.length);
  const [color, setColor] = createSignal<string>(SWATCHES[0]!.value);
  const [width, setWidth] = createSignal(3);
  const [ready, setReady] = createSignal(false);
  const [error, setError] = createSignal('');
  const paint = () => {
    const context = canvas?.getContext('2d');
    if (!context || !bitmap) return;
    context.clearRect(0, 0, props.image.width, props.image.height);
    context.drawImage(bitmap, 0, 0, props.image.width, props.image.height);
    for (const stroke of strokes) {
      context.strokeStyle = stroke.color; context.fillStyle = stroke.color; context.lineWidth = stroke.width;
      context.lineCap = 'round'; context.lineJoin = 'round'; context.beginPath();
      const [first, ...rest] = stroke.points;
      if (!first) continue;
      if (!rest.length) { context.arc(first[0], first[1], stroke.width / 2, 0, Math.PI * 2); context.fill(); continue; }
      context.moveTo(...first);
      for (const point of rest) context.lineTo(...point);
      context.stroke();
    }
  };
  const schedule = () => { if (!raf) raf = requestAnimationFrame(() => { raf = 0; paint(); }); };
  onMount(() => {
    const url = URL.createObjectURL(props.image.blob);
    const image = new Image();
    let live = true;
    image.onload = () => { if (live) { bitmap = image; paint(); setReady(true); } };
    image.onerror = () => { if (live) setError('Could not load the screenshot.'); };
    image.src = url;
    onCleanup(() => { live = false; URL.revokeObjectURL(url); cancelAnimationFrame(raf); bitmap = null; });
  });
  const point = (event: PointerEvent & { currentTarget: HTMLCanvasElement }): [number, number] => {
    const rect = event.currentTarget.getBoundingClientRect();
    return [Math.max(0, Math.min(props.image.width, (event.clientX - rect.left) * props.image.width / rect.width)),
      Math.max(0, Math.min(props.image.height, (event.clientY - rect.top) * props.image.height / rect.height))];
  };
  const finish = () => { active = null; };
  const undo = () => { exported = null; active = null; strokes.pop(); setCount(strokes.length); schedule(); };
  props.exportRef.current = async () => {
    if (!ready() || !canvas) throw new Error('The screenshot is still loading. Please try again.');
    if (exported) return exported;
    finish(); paint();
    const saved = structuredClone(strokes);
    // Encoded at once: Chromium's toBlob waits for main-thread idle time (lib/capture/png).
    let blob: Blob;
    try { blob = encodePng(canvas); } catch { throw new Error('Could not save the drawing. Please try again.'); }
    return exported = { preview: blob, strokes: saved };
  };
  onCleanup(() => { props.exportRef.current = null; });
  return <Panel label="Screenshot editor" padding="none" class="mb-4 overflow-hidden">
    <div class="flex flex-wrap items-center gap-x-3 gap-y-3 border-b border-edge px-3 py-3">
      <SwatchPicker label="Brush color" size="sm" custom options={SWATCHES} value={color()} onChange={setColor} />
      <Slider label="Brush thickness" size="sm" min={1} max={16} value={width()} onChange={setWidth} valueText={(value) => `${value} px`} class="min-w-60 flex-1" />
      <Tooltip content="Undo last stroke (⌘/Ctrl Z)"><Button variant="ghost" size="sm" disabled={!count() || props.busy} onClick={undo} aria-label="Undo stroke" class="ml-auto"><Undo2 size={16} />Undo</Button></Tooltip>
    </div>
    <div class="flex min-h-24 items-center justify-center overflow-auto bg-surface p-3" style={{ 'background-image': 'radial-gradient(var(--color-edge) 1px, transparent 1px)', 'background-size': '16px 16px' }}>
      <canvas ref={canvas} width={props.image.width} height={props.image.height} aria-label="Screenshot drawing canvas" aria-busy={!ready()} tabIndex={0}
        style={{ cursor: 'crosshair', width: `min(100%, ${props.image.width / props.image.height * 32}vh, ${props.image.width}px)` }}
        onKeyDown={event => { if (!props.busy && (event.metaKey || event.ctrlKey) && event.key === 'z') { event.preventDefault(); undo(); } }}
        onPointerDown={event => {
          if (!ready() || props.busy || event.button !== 0 || active) return;
          event.preventDefault(); event.currentTarget.focus(); exported = null;
          if (strokes.length >= COMMENT_IMAGE_LIMITS.strokes) { setError('Drawing limit reached. Undo a stroke to continue.'); return; }
          event.currentTarget.setPointerCapture(event.pointerId);
          const scale = props.image.width / event.currentTarget.getBoundingClientRect().width;
          active = { color: color(), width: Math.min(128, width() * scale), points: [point(event)] };
          strokes.push(active); setCount(strokes.length); schedule();
        }}
        onPointerMove={event => {
          if (!active) return;
          if (strokes.reduce((total, stroke) => total + stroke.points.length, 0) >= COMMENT_IMAGE_LIMITS.points) { finish(); setError('Drawing limit reached. Undo a stroke to continue.'); return; }
          active.points.push(point(event)); schedule();
        }}
        onPointerUp={finish} onPointerCancel={finish} onLostPointerCapture={finish}
        class="block h-auto max-w-full touch-none rounded-sm bg-surface shadow-lg" />
    </div>
    <Show when={error()}><StatusMessage kind="error" class="m-3">{error()}</StatusMessage></Show>
    <div class="flex items-center justify-between gap-3 border-t border-edge px-3 py-2 text-xs text-muted">
      <span>{ready() ? 'Draw on the image or write below.' : 'Loading screenshot…'}</span>
      <span class="flex shrink-0 items-center gap-3">
        <Show when={props.onRemove}><Button variant="ghost" size="sm" disabled={props.busy} onClick={() => props.onRemove?.()}>Remove image</Button></Show>
        <Show when={props.onRetake}><Button variant="ghost" size="sm" disabled={props.busy} onClick={() => props.onRetake?.()}>Retake screenshot</Button></Show>
      </span>
    </div>
  </Panel>;
}
