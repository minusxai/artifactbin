/** @jsxImportSource solid-js */
/**
 * lib/story-runtime/edit/grid-edit in SOLID, WITHOUT react-grid-layout's component: tiles are
 * positioned by the same arithmetic RGL uses at margin [0,0] (x·colWidth, y·rowHeight), moved by
 * pointer or keyboard, and every staged layout goes through RGL's own kernel (moveElement + vertical
 * compact) so the rects handed to `onLayout` (via lib/story-ui/grid-layout diffLayouts) are the ones
 * the React editor would produce. Escape cancels a drag or a staged keyboard move; Enter commits one.
 *
 * Tiles are keyed by identity (`key`), so a tile's DOM survives its AST path changing.
 */
import { createMemo, createSignal, For, onCleanup, onMount, Show, untrack, type JSX } from 'solid-js';
import { diffLayouts, type GridItemRect } from '@/lib/story-ui/grid-layout';
import type { StoryLayoutRect } from '@/lib/story-runtime/contract';
import { compact, moveElement, type LayoutItem } from './rgl-kernel';

export interface GridTile { key: string; path: string; rect: GridItemRect; children: () => JSX.Element }

export function GridEdit(props: { cols: number; rowHeight: number; flow?: boolean; tiles: GridTile[]; onLayout(rects: StoryLayoutRect[]): void; renderFlow: () => JSX.Element }) {
  let wrap!: HTMLDivElement;
  const [width, setWidth] = createSignal<number | null>(null);
  onMount(() => {
    const measure = () => { const w = wrap.clientWidth; if (w) setWidth(w); };
    measure();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    observer?.observe(wrap);
    window.addEventListener('resize', measure);
    onCleanup(() => { observer?.disconnect(); window.removeEventListener('resize', measure); });
  });
  // The reader's @max-2xl container rule is 42rem: below it, the reader's stacked rendering.
  const stackBelow = () => 42 * (parseFloat(getComputedStyle(document.documentElement).fontSize) || 16);
  const positioned = () => !props.flow && props.tiles.length > 0 && width() !== null && width()! >= stackBelow();
  return <div ref={wrap} class="w-full">
    <Show when={positioned()} fallback={props.renderFlow()}>
      <Positioned width={width()!} cols={props.cols} rowHeight={props.rowHeight} tiles={props.tiles} onLayout={props.onLayout} />
    </Show>
  </div>;
}

function Positioned(props: { width: number; cols: number; rowHeight: number; tiles: GridTile[]; onLayout(rects: StoryLayoutRect[]): void }) {
  const [draft, setDraft] = createSignal<LayoutItem[] | null>(null);
  const layout = createMemo(() => props.tiles.map((t) => ({ i: t.key, ...t.rect })));
  const current = () => draft() ?? layout();
  const rects = () => new Map(props.tiles.map((t) => [t.key, t.rect] as const));
  const paths = () => new Map(props.tiles.map((t) => [t.key, t.path] as const));
  const colW = () => props.width / props.cols;
  let gesture: { key: string; mode: 'move' | 'resize'; startX: number; startY: number; origin: LayoutItem; pointer: number } | null = null;

  const stage = (key: string, fn: (item: LayoutItem, all: LayoutItem[]) => LayoutItem[]) => {
    const next = current().map((r) => ({ ...r }));
    const item = next.find((r) => r.i === key);
    if (item) setDraft(compact(fn(item, next), 'vertical', props.cols));
  };
  const commit = () => {
    const next = draft(); setDraft(null);
    if (!next) return;
    const changed = diffLayouts(next, rects());
    if (changed.length) props.onLayout(changed.map((c) => ({ path: paths().get(c.astPath)!, x: c.x, y: c.y, w: c.w, h: c.h })));
  };
  const cancel = () => { gesture = null; setDraft(null); };
  // A layout change from the SOURCE (another writer, an undo) abandons whatever was staged.
  createMemo((previous: string | undefined) => { const now = JSON.stringify(layout()); if (previous !== undefined && previous !== now) cancel(); return now; });
  const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape' && (gesture || draft())) { event.preventDefault(); cancel(); } };
  document.addEventListener('keydown', onKey, true);
  onCleanup(() => document.removeEventListener('keydown', onKey, true));

  const keyAction = (event: KeyboardEvent, key: string, resize = false) => {
    if (event.key === 'Escape') { event.preventDefault(); cancel(); return; }
    if (event.key === 'Enter' && draft()) { event.preventDefault(); commit(); return; }
    const delta = event.key === 'ArrowLeft' ? [-1, 0] : event.key === 'ArrowRight' ? [1, 0] : event.key === 'ArrowUp' ? [0, -1] : event.key === 'ArrowDown' ? [0, 1] : null;
    if (!delta) return;
    event.preventDefault(); event.stopPropagation();
    stage(key, (item, all) => {
      if (resize) { item.w = Math.max(1, Math.min(props.cols - item.x, item.w + delta[0]!)); item.h = Math.max(1, item.h + delta[1]!); return all; }
      return moveElement(all, item, Math.min(props.cols - item.w, Math.max(0, item.x + delta[0]!)), Math.max(0, item.y + delta[1]!), true, false, 'vertical', props.cols);
    });
  };
  const start = (event: PointerEvent, key: string, mode: 'move' | 'resize') => {
    if (event.button !== 0) return;
    const origin = current().find((r) => r.i === key); if (!origin) return;
    event.preventDefault();
    (event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId);
    gesture = { key, mode, startX: event.clientX, startY: event.clientY, origin: { ...origin }, pointer: event.pointerId };
  };
  const move = (event: PointerEvent) => {
    const g = gesture; if (!g || event.pointerId !== g.pointer) return;
    const dx = Math.round((event.clientX - g.startX) / colW()), dy = Math.round((event.clientY - g.startY) / props.rowHeight);
    const base = layout().map((r) => (r.i === g.key ? { ...g.origin } : { ...r }));
    const item = base.find((r) => r.i === g.key)!;
    if (g.mode === 'resize') {
      item.w = Math.max(1, Math.min(props.cols - item.x, g.origin.w + dx)); item.h = Math.max(1, g.origin.h + dy);
      setDraft(compact(base, 'vertical', props.cols));
    } else {
      setDraft(compact(moveElement(base, item, Math.min(props.cols - item.w, Math.max(0, g.origin.x + dx)), Math.max(0, g.origin.y + dy), true, false, 'vertical', props.cols), 'vertical', props.cols));
    }
  };
  const end = (event: PointerEvent) => { if (!gesture || event.pointerId !== gesture.pointer) return; gesture = null; commit(); };
  const rows = () => current().reduce((m, r) => Math.max(m, r.y + r.h), 1);
  const rectOf = (key: string) => current().find((r) => r.i === key);

  const keys = createMemo(() => props.tiles.map((t) => t.key), undefined, { equals: (a, b) => a.length === b.length && a.every((k, i) => k === b[i]) });
  return <div class="mx-grid-positioned" style={{ position: 'relative', height: `${rows() * props.rowHeight}px` }} onDragStart={(e) => e.preventDefault()} onPointerMove={move} onPointerUp={end} onPointerCancel={() => cancel()}>
    {/* Keyed by IDENTITY (the string key), not by the tile object: a tile whose AST path moved keeps
        its DOM. Its content is rendered once per identity and updates through its own reactivity —
        the Solid shape of React's "same key, re-render the element". */}
    <For each={keys()}>{(key) => {
      const tile = () => props.tiles.find((t) => t.key === key)!;
      const r = () => rectOf(key)!;
      const content = untrack(() => tile().children());
      return <div data-mx-grid-tile={key} style={{ position: 'absolute', left: `${r().x * colW()}px`, top: `${r().y * props.rowHeight}px`, width: `${r().w * colW()}px`, height: `${r().h * props.rowHeight}px`, transition: gesture ? 'none' : 'left .15s, top .15s' }}>
        {content}
        <button type="button" class="mx-grid-grip" aria-label={`Move GridItem ${tile().path}`} onPointerDown={(e) => start(e, key, 'move')} onKeyDown={(e) => keyAction(e, key)}>⠿</button>
        <span role="button" tabIndex={0} aria-label="Resize positioned tile" class="mx-grid-resize" onPointerDown={(e) => start(e, key, 'resize')} onKeyDown={(e) => keyAction(e, key, true)} />
      </div>;
    }}</For>
  </div>;
}
