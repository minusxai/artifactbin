/* @jsxImportSource solid-js */
import { createEffect, createMemo, createSignal, Index, onCleanup, onMount } from 'solid-js';
import { isometricScene, type IsoDrawPath } from '@/lib/story-ui/isometric';
import type { IsometricSpec } from '@/lib/jsx';
import { useIsland } from '../context';
const ink = 'var(--ds-hand-ink, var(--foreground))';
const ground = 'var(--ds-hand-ground, var(--card))';
const tones = { neutral: ground, accent: 'var(--ds-hand-fill, var(--primary))', secondary: 'var(--ds-hand-fill2, var(--chart-2))', muted: 'var(--ds-hand-muted, var(--muted))' };
export function IsometricDrawing(p: IsometricSpec) {
  const island = [p.spread, p.angle, p.flow].some(v => typeof v === 'string') ? useIsland() : null;
  const value = (v: unknown) => typeof v === 'string' ? island?.value(v.slice(1)) : v;
  const numeric = (v: unknown) => { const n = Number(value(v) ?? 0); return Number.isFinite(n) ? n : 0; };
  const target = createMemo(() => ({ spread: Math.max(0, Math.min(1, numeric(p.spread))), angle: Math.max(-180, Math.min(180, numeric(p.angle))) }));
  const flowing = () => value(p.flow) === true;
  const [pose, setPose] = createSignal(target());
  const [dash, setDash] = createSignal(0);
  // Geometry is static except actuated rotations. Separation translates the same cached paths.
  const scene = createMemo(() => isometricScene(p));
  const drawing = createMemo(() => scene().draw(pose().spread, pose().angle));
  let host!: SVGSVGElement;
  onMount(() => {
    const doc = host.ownerDocument, win = doc.defaultView!;
    const reduced = win.matchMedia?.('(prefers-reduced-motion: reduce)');
    let visible = true, frame = 0, previous = 0;
    const cancel = () => { if (frame) win.cancelAnimationFrame(frame); frame = 0; previous = 0; };
    const active = () => visible && !doc.hidden && !reduced?.matches;
    const tick = (now: number) => {
      frame = 0;
      if (!active()) { setPose(target()); return; }
      const dt = previous ? Math.min((now - previous) / 1000, .05) : 1 / 60;
      previous = now;
      const to = target(), from = pose(), smooth = p.motion === 'smooth';
      const amount = smooth ? 1 - Math.exp(-12 * dt) : 1;
      const next = { spread: from.spread + (to.spread - from.spread) * amount, angle: from.angle + (to.angle - from.angle) * amount };
      const moving = Math.abs(next.spread - to.spread) > .0001 || Math.abs(next.angle - to.angle) > .001;
      setPose(moving ? next : to);
      if (flowing()) setDash(n => (n - dt * 20) % 20);
      if (moving || flowing()) frame = win.requestAnimationFrame(tick); else previous = 0;
    };
    const update = () => {
      if (!active() || p.motion !== 'smooth') setPose(target());
      if (!active()) { cancel(); setDash(0); return; }
      if (!frame && (flowing() || p.motion === 'smooth')) frame = win.requestAnimationFrame(tick);
    };
    createEffect(() => { target(); flowing(); update(); });
    const observer = typeof win.IntersectionObserver === 'function' ? new win.IntersectionObserver(entries => { visible = entries.some(e => e.isIntersecting); update(); }) : null;
    observer?.observe(host);
    doc.addEventListener('visibilitychange', update);
    reduced?.addEventListener('change', update);
    onCleanup(() => { cancel(); observer?.disconnect(); doc.removeEventListener('visibilitychange', update); reduced?.removeEventListener('change', update); });
  });
  const fill = (path: IsoDrawPath) => {
    if (path.kind !== 'face') return 'none';
    const tone = tones[path.tone];
    const base = p.appearance === 'solid' || path.section || path.tone === 'neutral' ? tone : `color-mix(in srgb, ${tone} 18%, ${ground})`;
    return `color-mix(in srgb, ${ink} ${path.shade * (p.appearance === 'solid' ? 5 : 2)}%, ${base})`;
  };
  const stroke = (path: IsoDrawPath) => path.kind === 'face' ? fill(path) : path.tone === 'muted' ? `color-mix(in srgb, ${ink} 48%, ${ground})` : path.tone !== 'neutral' ? `color-mix(in srgb, ${tones[path.tone]} 80%, ${ink})` : ink;
  return <svg ref={host} viewBox={`0 0 ${scene().width} ${scene().height}`} role="img" aria-label={p.title} class="block h-auto w-full" fill="none" stroke-linejoin="round" stroke-linecap="round">
      <title>{p.title}</title>
      <Index each={drawing()}>{part => <g data-part={part().key} transform={`translate(${part().offset[0]} ${part().offset[1]})`}>
        <Index each={part().paths}>{path => <path d={path().d} fill={fill(path())} stroke={stroke(path())}
          stroke-width={path().width ?? (path().kind === 'face' ? .35 : path().kind === 'crease' ? .8 : 1.6)}
          stroke-opacity={path().opacity ?? (path().kind === 'crease' ? .7 : 1)} vector-effect="non-scaling-stroke"
          stroke-dasharray={path().dashed ? '10 10' : undefined} stroke-dashoffset={path().dashed ? dash() : undefined} />}</Index>
      </g>}</Index>
  </svg>;
}
