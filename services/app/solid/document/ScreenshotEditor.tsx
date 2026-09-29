/* @jsxImportSource solid-js */
import { createSignal, For, onCleanup, onMount, Show, type JSX } from 'solid-js';
import type { CapturedImage } from '@/lib/capture/contract';
import { COMMENT_IMAGE_LIMITS, type BrushStroke } from '../../../contracts/src/comment-image';
import { Tooltip } from '../components/Tooltip';

const COLORS = [['Red', '#ef4444'], ['Orange', '#f59e0b'], ['Blue', '#3b82f6'], ['Green', '#22c55e'], ['Black', '#171717'], ['White', '#ffffff']] as const;
export interface ScreenshotDrawing { preview: Blob; strokes: BrushStroke[] }
export interface ScreenshotEditorProps {
  image: CapturedImage; initialStrokes: BrushStroke[];
  exportRef: { current: (() => Promise<ScreenshotDrawing>) | null };
  busy: boolean; onRetake: () => void;
}

/** Bounded vector strokes over a captured still; export is deferred until submission. */
export function ScreenshotEditor(props: ScreenshotEditorProps): JSX.Element {
  let canvas!: HTMLCanvasElement;
  let bitmap: HTMLImageElement | null = null;
  let strokes = structuredClone(props.initialStrokes);
  let active: BrushStroke | null = null;
  let raf = 0;
  let exported: ScreenshotDrawing | null = null;
  const [count, setCount] = createSignal(strokes.length);
  const [color, setColor] = createSignal('#ef4444');
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
    const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/png'));
    if (!blob) throw new Error('Could not save the drawing. Please try again.');
    return exported = { preview: blob, strokes: saved };
  };
  onCleanup(() => { props.exportRef.current = null; });
  return <div aria-label="Screenshot editor" class="mb-4 overflow-hidden rounded border border-edge bg-surface">
    <div class="flex flex-wrap items-center gap-3 border-b border-edge px-3 py-3">
      <div role="group" aria-label="Brush colors" class="flex gap-2"><For each={COLORS}>{([name, value]) =>
        <Tooltip content={name}><button type="button" aria-label={`${name} brush`} aria-pressed={color() === value} onClick={() => setColor(value)} style={{ 'background-color': value }} class="size-7 rounded-full border border-edge">{color() === value ? '✓' : ''}</button></Tooltip>
      }</For><label aria-label="Custom brush color"><input aria-label="Brush color" type="color" value={color()} onChange={event => setColor(event.currentTarget.value)} /></label></div>
      <label class="flex items-center gap-2">Size <input aria-label="Brush thickness" type="range" min="1" max="16" value={width()} onChange={event => setWidth(Number(event.currentTarget.value))} />{width()} px</label>
      <Tooltip content="Undo last stroke (⌘/Ctrl Z)"><button type="button" aria-label="Undo stroke" disabled={!count() || props.busy} onClick={undo}>Undo</button></Tooltip>
    </div>
    <div class="flex min-h-24 items-center justify-center overflow-auto p-3">
      <canvas ref={canvas} width={props.image.width} height={props.image.height} aria-label="Screenshot drawing canvas" aria-busy={!ready()} tabIndex={0}
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
        class="block h-auto max-w-full touch-none rounded bg-white shadow" />
    </div>
    <Show when={error()}><p role="alert" class="border-t border-edge p-3 text-danger">{error()}</p></Show>
    <div class="flex items-center justify-between border-t border-edge px-3 py-2 text-xs"><span>{ready() ? 'Draw on the image or write below.' : 'Loading screenshot…'}</span><button type="button" disabled={props.busy} onClick={props.onRetake}>Retake screenshot</button></div>
  </div>;
}
