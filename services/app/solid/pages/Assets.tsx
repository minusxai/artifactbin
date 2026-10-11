import { FORM_SECONDARY_BUTTON } from '../ui/FormControls';
import WorkspaceHeading from '../components/WorkspaceHeading';
/* @jsxImportSource solid-js */
import { createEffect, createMemo, createSignal, For, Show, type JSX } from 'solid-js';
import { Navigate } from '@solidjs/router';
import DatabasePlus from 'lucide-solid/icons/database-plus';
import FileUp from 'lucide-solid/icons/file-up';
import ChevronLeft from 'lucide-solid/icons/chevron-left';
import ChevronRight from 'lucide-solid/icons/chevron-right';
import Globe from 'lucide-solid/icons/globe';
import type { AssetSelection, WorkspaceAssets } from '@/lib/workspace/inventory';
import { rowTitle } from '@/lib/document/display-title';
import type { ShelfRow } from '@/lib/workspace/shelf';
import { Badge, MicroLabel, FormatBadge, timeAgo } from '../ui/ui';
import { Button } from '../ui/Button';
import { Panel } from '../ui/Panel';
import { SearchField } from '../ui/Field';
import { StatusMessage } from '../ui/StatusMessage';
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
  const assets = createMemo(() => (data()?.assets ?? []).filter(asset => !removed().includes(asset.id)).map(asset => ({ ...asset, title: rowTitle(asset) })));
  const selected = () => selection();
  const toggle = (kind: 'formats' | 'visibilities', value: string) => setSelection((current) => ({ ...current, page: 0,
    [kind]: current[kind].includes(value) ? current[kind].filter((item) => item !== value) : [...current[kind], value],
  }));
  const pageCount = () => Math.max(1, Math.ceil((data()?.total ?? 0) / (data()?.perPage ?? 50)));
  const pageIndex = () => data()?.page ?? selected().page;
  return <Show when={!session() || session()?.user} fallback={<Navigate href="/login?callbackUrl=/assets" />}>
    <main class="workspace-page">
      <WorkspaceHeading title="Assets" description="The material documents are built from.">
        <div class="flex flex-wrap items-center gap-2">
          <a href="/files/new" aria-label="Upload file" class={FORM_SECONDARY_BUTTON}><FileUp aria-hidden="true" size={13} />Upload file</a>
          <a href="/datasets/new" aria-label="Create dataset" class={FORM_SECONDARY_BUTTON}><DatabasePlus aria-hidden="true" size={13} />Create dataset</a>
        </div>
      </WorkspaceHeading>
      <Show when={!data()} fallback={<Panel label="Assets" padding="none">
        <div aria-busy={page.pending()}>
        <Show when={page.error()}><Button variant="secondary" size="sm" class="m-3" aria-label="Retry assets" onClick={() => void page.refresh(true)}>Could not refresh assets. Retry</Button></Show>
        <div class="flex flex-wrap items-center gap-2 border-b border-edge bg-raised/30 px-4 py-3">
          <SearchField size="sm" label="Search assets" placeholder="search assets" value={selected().query} onValue={(query) => setSelection((current) => ({ ...current, query, page: 0 }))} class="min-w-32 flex-1" />
          <Show when={(data()?.formats.length ?? 0) >= 2}><For each={data()?.formats ?? []}>{(format) => <Button size="sm" variant={selected().formats.includes(format) ? 'secondary' : 'ghost'} aria-label={`Filter ${format}`} aria-pressed={selected().formats.includes(format)} onClick={() => toggle('formats', format)}>{format}</Button>}</For></Show>
          <Show when={(data()?.visibilities.length ?? 0) >= 2}><For each={data()?.visibilities ?? []}>{(visibility) => <Button size="sm" variant={selected().visibilities.includes(visibility) ? 'secondary' : 'ghost'} aria-label={`Filter ${visibility}`} aria-pressed={selected().visibilities.includes(visibility)} onClick={() => toggle('visibilities', visibility)}>{visibility}</Button>}</For></Show>
        </div>
        <Show when={(data()?.assets.length ?? 0) > 0 || selected().query || selected().formats.length || selected().visibilities.length} fallback={<StatusMessage kind="empty" class="justify-center px-5 py-12">no assets yet</StatusMessage>}>
          <table class="w-full border-collapse text-left text-sm"><thead class="hidden sm:table-header-group"><tr><For each={['title', 'type', 'ver', 'updated', '']}>{label => <th class="px-4 py-2.5"><MicroLabel>{label}</MicroLabel></th>}</For></tr></thead><tbody>
            <For each={assets()}>{(asset) => <tr class="border-t border-edge transition-colors hover:bg-raised/40"><td class="w-full max-w-0 px-4 py-2.5"><span class="flex items-center gap-2"><a aria-label={`Open ${asset.title}`} href={asset.url} class="min-w-0 flex-1 truncate font-semibold text-fg hover:text-accent">{asset.title}</a><Show when={asset.visibility === 'public'}><Globe aria-label={`${asset.title} is public`} size={13} class="text-accent" /></Show></span><span class="mt-1 block text-xs text-muted sm:hidden">{asset.format} · {timeAgo(asset.updated_at)}</span></td><td class="hidden px-4 py-2.5 sm:table-cell"><FormatBadge format={asset.format} /></td><td class="hidden px-4 py-2.5 sm:table-cell"><Badge tone="dim">v{asset.version}</Badge></td><td class="hidden whitespace-nowrap px-4 py-2.5 text-xs text-muted sm:table-cell">{timeAgo(asset.updated_at)}</td><td class="px-4 py-2.5"><RowActions row={asset as ShelfRow} level="full" folders={(data()?.folders ?? []) as ShelfRow[]} childCount={0} showEdit={false} onRemoved={id => setRemoved(current => [...current, id])} onChanged={() => void page.refresh(true)} /></td></tr>}</For>
          </tbody></table>
          <Show when={pageCount() > 1}><div class="flex items-center justify-between border-t border-edge px-4 py-2"><span aria-label="Page range" class="font-mono text-micro text-faint">{pageIndex() * (data()?.perPage ?? 50) + 1}-{Math.min((pageIndex() + 1) * (data()?.perPage ?? 50), data()?.total ?? 0)} of {data()?.total}</span><span class="flex gap-2"><Button variant="secondary" size="sm" icon aria-label="Previous page" disabled={pageIndex() === 0} onClick={() => setSelection((current) => ({ ...current, page: pageIndex() - 1 }))}><ChevronLeft size={14} /></Button><Button variant="secondary" size="sm" icon aria-label="Next page" disabled={pageIndex() + 1 >= pageCount()} onClick={() => setSelection((current) => ({ ...current, page: pageIndex() + 1 }))}><ChevronRight size={14} /></Button></span></div></Show>
        </Show>
        </div>
      </Panel>}>
        <Show when={page.error()} fallback={<Panel label="Loading assets" class="flex h-32 items-center justify-center"><StatusMessage kind="loading">loading assets…</StatusMessage></Panel>}>
          <Panel label="Assets unavailable" class="flex min-h-32 items-center justify-center"><StatusMessage kind="error" action={<Button variant="link" aria-label="Retry assets" onClick={() => void page.refresh(true)}>retry</Button>}>could not load assets</StatusMessage></Panel>
        </Show>
      </Show>
    </main>
  </Show>;
}
