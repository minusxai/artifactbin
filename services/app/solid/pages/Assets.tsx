import WorkspaceHeading from '../components/WorkspaceHeading';
/* @jsxImportSource solid-js */
import { createEffect, createMemo, createSignal, For, Show, type JSX } from 'solid-js';
import { Navigate } from '@solidjs/router';
import DatabasePlus from 'lucide-solid/icons/database-plus';
import FileUp from 'lucide-solid/icons/file-up';
import ChevronLeft from 'lucide-solid/icons/chevron-left';
import ChevronRight from 'lucide-solid/icons/chevron-right';
import Globe from 'lucide-solid/icons/globe';
import Search from 'lucide-solid/icons/search';
import type { AssetSelection, WorkspaceAssets } from '@/lib/workspace/inventory';
import { displayTitle } from '@/lib/document/display-title';
import type { ShelfRow } from '@/lib/workspace/shelf';
import { MicroLabel, PANEL, FormatBadge, timeAgo } from '../components/ui';
import { RowActions } from '../components/Shelf';
import { usePageData } from '../lib/use-page-data';
import { useSession } from '../lib/session';

/** The server owns search, filters and pagination; the page only serializes a selection. */
export function AssetsPage(): JSX.Element {
  const { session } = useSession();
  const [selection, setSelection] = createSignal<AssetSelection>({ page: 0, query: '', formats: [], visibilities: [] });
  const key = createMemo(() => {
    const selected = selection();
    const params = new URLSearchParams();
    if (selected.page) params.set('page', String(selected.page));
    if (selected.query) params.set('q', selected.query);
    selected.formats.forEach((format) => params.append('formats', format));
    selected.visibilities.forEach((visibility) => params.append('visibilities', visibility));
    return `/api/page/assets${params.size ? `?${params}` : ''}`;
  });
  const page = usePageData<WorkspaceAssets>(key, { enabled: () => Boolean(session()?.user) });
  const [previous, setPrevious] = createSignal<{ owner: string; data: WorkspaceAssets } | null>(null);
  const [removed, setRemoved] = createSignal<string[]>([]);
  createEffect(() => { const data = page.data(); const owner = session()?.user?.id; if (data && owner) setPrevious({ owner, data }); });
  const data = () => page.data() ?? (previous()?.owner === session()?.user?.id ? previous()?.data ?? null : null);
  const assets = createMemo(() => (data()?.assets ?? []).filter(asset => !removed().includes(asset.id)).map(asset => ({ ...asset, title: displayTitle(asset) })));
  const selected = () => selection();
  const toggle = (kind: 'formats' | 'visibilities', value: string) => setSelection((current) => ({ ...current, page: 0,
    [kind]: current[kind].includes(value) ? current[kind].filter((item) => item !== value) : [...current[kind], value],
  }));
  const pageCount = () => Math.max(1, Math.ceil((data()?.total ?? 0) / (data()?.perPage ?? 50)));
  const pageIndex = () => data()?.page ?? selected().page;
  return <Show when={!session() || session()?.user} fallback={<Navigate href="/login?callbackUrl=/assets" />}>
    <main class="workspace-page">
      <WorkspaceHeading title="Assets" description="The material documents are built from.">
        <div class="ml-auto flex items-center gap-2">
          <a href="/files/new" aria-label="Upload file" class="inline-flex items-center gap-1.5 rounded border border-edge-bright px-3 py-1.5 font-mono text-xs text-accent hover:border-accent"><FileUp aria-hidden="true" size={13} />Upload file</a>
          <a href="/datasets/new" aria-label="Create dataset" class="inline-flex items-center gap-1.5 rounded border border-edge-bright px-3 py-1.5 font-mono text-xs text-accent hover:border-accent"><DatabasePlus aria-hidden="true" size={13} />Create dataset</a>
        </div>
      </WorkspaceHeading>
      <Show when={!data()} fallback={<section aria-label="Assets" aria-busy={page.pending()} class={PANEL}>
        <Show when={page.error()}><button type="button" aria-label="Retry assets" onClick={() => void page.refresh(true)}>Could not refresh assets. Retry</button></Show>
        <div class="flex flex-wrap items-center gap-2 border-b border-edge px-4 py-2">
          <Search size={13} class="text-faint" /><input aria-label="Search assets" placeholder="search assets" value={selected().query} onInput={(event) => setSelection((current) => ({ ...current, query: event.currentTarget.value, page: 0 }))} class="min-w-32 flex-1 border-0 bg-transparent font-mono text-xs text-fg placeholder:text-faint focus:outline-none" />
          <Show when={(data()?.formats.length ?? 0) >= 2}><For each={data()?.formats ?? []}>{(format) => <button type="button" aria-label={`Filter ${format}`} aria-pressed={selected().formats.includes(format)} onClick={() => toggle('formats', format)} class="rounded-full border border-edge px-2 py-0.5 font-mono text-[10px] text-muted">{format}</button>}</For></Show>
          <Show when={(data()?.visibilities.length ?? 0) >= 2}><For each={data()?.visibilities ?? []}>{(visibility) => <button type="button" aria-label={`Filter ${visibility}`} aria-pressed={selected().visibilities.includes(visibility)} onClick={() => toggle('visibilities', visibility)} class="rounded-full border border-edge px-2 py-0.5 font-mono text-[10px] text-muted">{visibility}</button>}</For></Show>
        </div>
        <Show when={(data()?.assets.length ?? 0) > 0 || selected().query || selected().formats.length || selected().visibilities.length} fallback={<p class="px-4 py-8 text-center font-mono text-xs text-faint">no assets yet</p>}>
          <table class="w-full border-collapse text-left text-sm"><thead class="hidden sm:table-header-group"><tr><For each={['title', 'type', 'ver', 'updated', '']}>{label => <th class="px-4 py-2.5"><MicroLabel>{label}</MicroLabel></th>}</For></tr></thead><tbody>
            <For each={assets()}>{(asset) => <tr class="border-t border-edge"><td class="w-full max-w-0 px-4 py-2.5"><span class="flex items-center gap-2"><a aria-label={`Open ${asset.title}`} href={asset.url} class="min-w-0 flex-1 truncate font-semibold text-fg hover:text-accent">{asset.title}</a><Show when={asset.visibility === 'public'}><Globe aria-label={`${asset.title} is public`} size={13} class="text-accent" /></Show></span></td><td class="px-4 py-2.5"><FormatBadge format={asset.format} /></td><td class="px-4 py-2.5"><span class="rounded border border-edge px-1.5 font-mono text-[10px] text-faint">v{asset.version}</span></td><td class="whitespace-nowrap px-4 py-2.5 font-mono text-xs text-muted">{timeAgo(asset.updated_at)}</td><td class="px-4 py-2.5"><RowActions row={asset as ShelfRow} level="full" folders={(data()?.folders ?? []) as ShelfRow[]} childCount={0} showEdit={false} onRemoved={id => setRemoved(current => [...current, id])} onChanged={() => void page.refresh(true)} /></td></tr>}</For>
          </tbody></table>
          <Show when={pageCount() > 1}><div class="flex items-center justify-between border-t border-edge px-4 py-2"><span aria-label="Page range" class="font-mono text-[10px] text-faint">{pageIndex() * (data()?.perPage ?? 50) + 1}-{Math.min((pageIndex() + 1) * (data()?.perPage ?? 50), data()?.total ?? 0)} of {data()?.total}</span><span class="flex gap-2"><button type="button" aria-label="Previous page" disabled={pageIndex() === 0} onClick={() => setSelection((current) => ({ ...current, page: pageIndex() - 1 }))}><ChevronLeft size={14} /></button><button type="button" aria-label="Next page" disabled={pageIndex() + 1 >= pageCount()} onClick={() => setSelection((current) => ({ ...current, page: pageIndex() + 1 }))}><ChevronRight size={14} /></button></span></div></Show>
        </Show>
      </section>}>
        <Show when={page.error()} fallback={<section aria-label="Loading assets" aria-busy="true" class={`${PANEL} flex h-24 items-center justify-center font-mono text-xs text-faint`}>loading assets…</section>}>
          <section aria-label="Assets unavailable" class={`${PANEL} flex h-24 items-center justify-center gap-3 px-4 font-mono text-xs text-faint`}>could not load assets <button type="button" aria-label="Retry assets" onClick={() => void page.refresh(true)} class="text-accent underline">retry</button></section>
        </Show>
      </Show>
    </main>
  </Show>;
}
