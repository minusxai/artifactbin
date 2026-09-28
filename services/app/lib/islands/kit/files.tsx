/* @jsxImportSource solid-js */
import { For, Show, createEffect, createMemo, createSignal, onCleanup } from 'solid-js';
import { refName, resolveRefTemplate, type Row } from '@/lib/story/dataflow';
import { ISLAND_DATA_ID } from '@/lib/compiled-page/contract';
import { sparklineSvg } from '@/lib/viz/spark-markup';
import { useIsland } from '../context';
import { fileGlyphName } from '@/lib/story-ui/file-glyphs';
import { iconGlyphKey, FALLBACK_ICON_KEY, type GlyphMap } from '@/lib/story-ui/icon-contract';

type Props = { data?: string; rows?: Row[]; variant?: string; capture?: boolean; className?: string; glyphs?: GlyphMap; [key: string]: unknown };

/** A reader-chosen image source goes through this document's scoped import door. */
export function BoundImage(p: { template: string; props: Record<string, string> }) {
  const island = useIsland();
  const source = createMemo(() => {
    const value = resolveRefTemplate(p.template, name => island.value(name));
    return typeof value === 'string' && value ? value : null;
  });
  const [mapped, setMapped] = createSignal<{ source: string; url: string } | null>(null);
  const [refused, setRefused] = createSignal<string | null>(null);
  const imported = new Map<string, string>();
  createEffect(() => {
    const value = source();
    if (!value) return;
    const cached = imported.get(value);
    if (cached) { setMapped({ source: value, url: cached }); setRefused(null); return; }
    if (!/^https?:\/\//i.test(value) && !/^ref:[A-Za-z0-9]{6,12}$/.test(value)) { setRefused(value); return; }
    if (typeof document === 'undefined') return;
    let door: string | undefined;
    try { door = (JSON.parse(document.getElementById(ISLAND_DATA_ID)?.textContent ?? '{}') as { assetsUrl?: string }).assetsUrl; } catch { door = undefined; }
    if (!door) { setRefused(value); return; }
    const controller = new AbortController();
    const separator = door.includes('?') ? '&' : '?';
    void fetch(`${door}${separator}u=${encodeURIComponent(value)}`, { headers: { Accept: 'application/json' }, signal: controller.signal })
      .then(async response => response.ok ? response.json() as Promise<{ url: string }> : null)
      .then(answer => { if (!controller.signal.aborted) { if (answer?.url) { imported.set(value, answer.url); setMapped({ source: value, url: answer.url }); setRefused(null); } else setRefused(value); } })
      .catch(() => { if (!controller.signal.aborted) setRefused(value); });
    onCleanup(() => controller.abort());
  });
  return <img {...p.props} src={mapped()?.source === source() ? mapped()?.url : undefined}
    data-mx-bound={mapped()?.source === source() ? undefined : `src:${p.template}`}
    data-mx-asset={refused() === source() ? 'refused' : undefined} />;
}

/** Row image URLs are resolved in the image chunk, outside every page's rt+boot closure. */
export function rowImageAttrs(result: Record<string, string>): Record<string, string> {
  const id = /^ref:([A-Za-z0-9]{6,12})$/.exec(result.src)?.[1];
  if (id) result.src = `/a/${id}/raw`;
  return result;
}
/**
 * A format's glyph as today's `<Icon>` draws it (components/kit/icon): lucide's svg attributes, the glyph's
 * own class, `ICON_BASE_CLASS` with the listing's size merged in (tailwind-merge's result, precomputed —
 * readers never download it), decorative, and the server-resolved glyph markup (never author text).
 */
const ICON_SIZED: Record<'icons' | 'tiles', string> = { icons: 'inline-block shrink-0 align-[-0.125em] size-6', tiles: 'inline-block shrink-0 align-[-0.125em] size-8' };
function Glyph(p: { glyphs?: GlyphMap; format: string; density: 'icons' | 'tiles' }) {
  const glyph = () => p.glyphs?.[iconGlyphKey(fileGlyphName(p.format))] ?? p.glyphs?.[FALLBACK_ICON_KEY];
  return <Show when={glyph()}>{g => <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"
    class={['lucide', g().cls, ICON_SIZED[p.density]].filter((c, i, all) => c && c.trim() !== '' && all.indexOf(c) === i).join(' ').trim()} aria-hidden="true" data-slot="icon" innerHTML={g().inner} />}</Show>;
}
const text = (v: unknown) => typeof v === 'string' && v ? v : '';
const count = (v: unknown) => typeof v === 'number' && Number.isFinite(v) ? v : null;
const join = (...v: (string | false | undefined)[]) => v.filter(Boolean).join(' ');
const GRID = { icons: 'grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4', tiles: 'grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3' };
export function Files(p: Props) {
  // Today's live listing (StoryRuntimeApp FilesAdapter) hands `<Files>` its rows, variant and capture only: the
  // section carries no authored id, stamp or class — so neither does this one.
  const island = useIsland(); const { data,rows,variant,capture } = p;
  const density = () => variant === 'tiles' ? 'tiles' : 'icons';
  const items = () => rows ?? (data && refName(data) ? island.table(refName(data)!)?.rows : undefined) ?? [];
  return <section data-slot="files" class="my-6">
    <ul aria-label="Files" data-slot="files-list" data-variant={density()} class={join('m-0 list-none p-0',items().length > 0 && GRID[density()])}>
      <For each={items()}>{row => {
        const id = text(row.id); const name = text(row.title) || text(row.name) || id || 'Untitled'; const url = text(row.url) || (id ? `/a/${id}` : '');
        const format = text(row.format) || 'markup'; const thumb = capture ? '' : text(row.thumbnail); const views = count(row.views); const spark = text(row.sparkline); const inside = format === 'folder' ? count(row.count) : null;
        return <li data-slot="files-item" class="m-0 p-0"><a href={url || undefined} aria-label={`Open ${name}`} data-format={format}
          class={density() === 'tiles' ? 'group flex flex-col rounded-md border border-border bg-card text-card-foreground no-underline transition-colors hover:border-muted-foreground/40 gap-3 p-3' : 'group flex flex-col gap-2 rounded-md border border-border bg-card p-2 text-card-foreground no-underline transition-colors hover:border-muted-foreground/40'}>
          <span class="flex aspect-[40/21] w-full items-center justify-center overflow-hidden rounded-sm bg-muted">
            <Show when={thumb} fallback={<span data-glyph={format} class="flex items-center justify-center opacity-70"><Glyph glyphs={p.glyphs} format={format} density={density()} /></span>}>
              <img src={thumb} alt="" loading="lazy" decoding="async" class="h-full w-full object-cover" />
            </Show></span>
          <span data-slot="files-title" class={join('truncate font-medium',density() === 'icons' && 'text-sm')}>{name}</span>
          <Show when={inside !== null}><span data-slot="files-count" class="text-xs text-muted-foreground">{inside} item{inside === 1 ? '' : 's'}</span></Show>
          <Show when={views !== null}><span aria-label={`${views} views`} data-slot="files-views" class="flex min-w-0 items-center gap-2 text-xs text-muted-foreground"><span class="shrink-0 tabular-nums">{views} view{views === 1 ? '' : 's'}</span>
            <Show when={spark}><span aria-hidden="true" class="flex h-4 min-w-0 flex-1 items-center [&>svg]:h-full [&>svg]:w-full" innerHTML={sparklineSvg(spark)} /></Show>
          </span></Show></a></li>;
      }}</For>
    </ul>
  </section>;
}
