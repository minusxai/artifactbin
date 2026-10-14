/* @jsxImportSource solid-js */
import { createMemo, For, Show, splitProps, type JSX } from 'solid-js';
import { isometricScene } from '@/lib/story-ui/isometric';
import type { IsometricSpec } from '@/lib/jsx/isometric-spec';
import { useIsland } from '../context';

const ink = 'var(--ds-hand-ink, var(--foreground))';
const tones = {
  neutral: 'var(--ds-hand-ground, var(--card))',
  accent: 'var(--ds-hand-fill, var(--primary))',
  secondary: 'var(--ds-hand-fill2, var(--chart-2))',
  muted: 'var(--ds-hand-muted, var(--muted))',
};
export function Isometric(props: IsometricSpec & JSX.HTMLAttributes<HTMLDivElement>) {
  const [p, rest] = splitProps(props, ['parts', 'title', 'width', 'height', 'azimuth', 'elevation', 'spread', 'children']);
  const island = typeof p.spread === 'string' ? useIsland() : null;
  // Fitting includes assembled AND separated positions. A slider never zooms the camera.
  const scene = createMemo(() => isometricScene(p));
  const drawing = createMemo(() => scene().draw(Number(typeof p.spread === 'string' ? island?.value(p.spread.slice(1)) : p.spread ?? 0)));
  return <div {...rest} data-slot="isometric">
    <svg viewBox={`0 0 ${scene().width} ${scene().height}`} role="img" aria-label={p.title} class="block h-auto w-full" fill="none" stroke-linejoin="round">
      <title>{p.title}</title>
      <For each={drawing()}>{part => <g data-part={part.key}>
        <Show when={part.solid}>{solid => <>
          <path d={solid().fill} fill={tones[part.tone]} />
          <For each={solid().shades}>{(d, index) => <path d={d} fill={`color-mix(in srgb, ${ink} ${18 - index() * 4}%, ${tones[part.tone]})`} />}</For>
          <path d={solid().outline} stroke={ink} stroke-width="1" />
          <path d={solid().crease} stroke={ink} stroke-width="0.6" />
        </>}</Show>
        <Show when={part.line}>{d => <path d={d()} stroke={part.tone === 'neutral' ? ink : tones[part.tone]} stroke-width="1" stroke-dasharray={part.dashed ? '5 5' : undefined} />}</Show>
      </g>}</For>
    </svg>
  </div>;
}
