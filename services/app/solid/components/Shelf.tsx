/* @jsxImportSource solid-js */
import { createMemo, createSignal, For, Show, type JSX } from 'solid-js';
import FolderIcon from 'lucide-solid/icons/folder';
import FolderPlus from 'lucide-solid/icons/folder-plus';
import Inbox from 'lucide-solid/icons/inbox';
import GridIcon from 'lucide-solid/icons/layout-grid';
import ListIcon from 'lucide-solid/icons/list';
import Search from 'lucide-solid/icons/search';
import Globe from 'lucide-solid/icons/globe';
import Lock from 'lucide-solid/icons/lock';
import EyeOff from 'lucide-solid/icons/eye-off';
import Pencil from 'lucide-solid/icons/pencil';
import FolderInput from 'lucide-solid/icons/folder-input';
import Trash2 from 'lucide-solid/icons/trash-2';
import { writeBrowserArtifact } from '@/lib/artifacts/browser-artifact-write';
import { buildShelf, parentOfRow, type ShelfRow } from '@/lib/workspace/shelf';
import { CARD_HEIGHT, CARD_RENDER_GENERATION, CARD_WIDTH } from '@/lib/serving/og-card';
import { pageDataChanged } from '@/web/page-data-events';
import { MicroLabel, PANEL, timeAgo } from './ui';
import { Tooltip } from './Tooltip';
import { ConfirmDialog } from './ConfirmDialog';
import RowMenu from './RowMenu';
import ShareLink from './ShareLink';
import { MoveToFolderDialog } from './MoveToFolderDialog';
import { apiFetch } from '../lib/api';

type Actions = 'none' | 'share' | 'full';
interface Props {
  rows: ShelfRow[];
  actions?: Actions;
  scopeParentId?: string | null;
  parentId?: string | null;
  canCreateFolders?: boolean;
  assets?: boolean;
  showVisibility?: boolean;
  dates?: 'relative' | 'absolute';
  /** Home also filters "Shared with you" by this search box, so the caller hears every keystroke. */
  onQuery?: (query: string) => void;
}
const nameOf = (row: ShelfRow) => row.title ?? row.id;
const VISIBILITIES = ['public', 'unlisted', 'private'];

function Visibility(props: { row: ShelfRow }): JSX.Element {
  return <Show when={props.row.visibility}><Tooltip content={props.row.visibility}><span role="img" tabIndex={0} aria-label={`${nameOf(props.row)} is ${props.row.visibility}`} class="relative z-10 inline-flex shrink-0 rounded bg-slate-700/75 p-1 text-white"><Show when={props.row.visibility === 'public'} fallback={<Show when={props.row.visibility === 'private'} fallback={<EyeOff size={12} />}><Lock size={12} /></Show>}><Globe size={12} /></Show></span></Tooltip></Show>;
}

/** One document jacket: preview, caption and independent actions share the same surface. */
function ArtifactCover(props: { row: ShelfRow; showVisibility: boolean; children: JSX.Element }): JSX.Element {
  return <div class="artifact-cover">
    <a href={props.row.url} rel="external" aria-label={`Open ${nameOf(props.row)}`} class="artifact-cover-link" />
    <div class="artifact-cover-preview"><img width={CARD_WIDTH} height={CARD_HEIGHT} src={`/a/${props.row.id}/export?format=jpg&mode=card&v=${props.row.version}&r=${CARD_RENDER_GENERATION}`} alt="" loading="lazy" /></div>
    <span class="artifact-cover-fold" aria-hidden="true" />
    <Show when={props.showVisibility}><div class="artifact-cover-visibility"><Visibility row={props.row} /></div></Show>
    <div class="artifact-cover-front">
      <span class="min-w-0 flex-1 line-clamp-2 font-mono text-[12px] font-semibold leading-4">{nameOf(props.row)}</span>
      <span class="relative z-[3] inline-flex shrink-0">{props.children}</span>
    </div>
  </div>;
}

export function RowActions(props: { row: ShelfRow; level: Actions; folders: ShelfRow[]; childCount: number; onRemoved: (id: string) => void; onChanged: () => void; showEdit?: boolean }): JSX.Element {
  const [confirm, setConfirm] = createSignal(false);
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  const [moving, setMoving] = createSignal(false);
  const [sharing, setSharing] = createSignal(false);
  const [renaming, setRenaming] = createSignal(false);
  const [draft, setDraft] = createSignal('');
  const [parentId, setParentId] = createSignal(parentOfRow(props.row));
  const saveName = async () => {
    const title = draft().trim();
    setRenaming(false);
    if (!title || title === props.row.title) return;
    const result = await writeBrowserArtifact(props.row.id, { title }).catch(() => null);
    if (result?.ok) { props.row.title = title; props.onChanged(); pageDataChanged(); }
  };
  const move = async (id: string | null) => {
    const result = await writeBrowserArtifact(props.row.id, { parent_id: id }).catch(() => null);
    if (!result?.ok) return false;
    setParentId(id); setMoving(false); props.onChanged(); pageDataChanged();
    return true;
  };
  const remove = async () => {
    setBusy(true); setError(null);
    const result = await fetch(`/api/my/artifacts/${props.row.id}`, { method: 'DELETE' }).catch(() => null);
    setBusy(false);
    if (!result?.ok) { setError('Could not delete this artifact.'); return; }
    setConfirm(false); props.onRemoved(props.row.id); pageDataChanged();
  };
  return <>
    <Show when={renaming()}><input aria-label="Folder name" autofocus value={draft()} onInput={event => setDraft(event.currentTarget.value)} onBlur={() => void saveName()} onKeyDown={event => { if (event.key === 'Enter') void saveName(); if (event.key === 'Escape') setRenaming(false); }} class="relative z-20 w-32 border-b border-accent bg-transparent font-mono text-xs focus:outline-none" /></Show>
    <Show when={props.level === 'full'}>
      <span class="relative z-10 inline-flex shrink-0 items-center gap-1">
        <Show when={props.row.format !== 'folder' && props.showEdit !== false}><Tooltip content="edit"><a aria-label={`Edit ${nameOf(props.row)}`} href={`/a/${props.row.id}#edit`} class="shelf-secondary-action text-muted hover:text-accent"><Pencil size={13} /></a></Tooltip></Show>
        <RowMenu name={nameOf(props.row)} items={[
          { label: `Manage sharing for ${nameOf(props.row)}`, text: 'share', icon: () => <span>↗</span>, onSelect: () => setSharing(true) },
          ...(props.row.format === 'folder' ? [{ label: `Rename ${nameOf(props.row)}`, text: 'rename', icon: () => <Pencil size={12} />, onSelect: () => { setDraft(props.row.title ?? ''); setRenaming(true); } }] : []),
          { label: `Move ${nameOf(props.row)}`, text: 'move to folder', icon: () => <FolderInput size={12} />, onSelect: () => setMoving(true) },
          { label: `Delete ${nameOf(props.row)}`, text: props.childCount ? `delete (${props.childCount} inside)` : 'delete', icon: () => <Trash2 size={12} />, danger: true, onSelect: () => setConfirm(true) },
        ]} />
        <Show when={sharing()}><ShareLink artifactId={props.row.id} title={nameOf(props.row)} format={props.row.format} editable url={props.row.url} startOpen onClose={() => setSharing(false)} /></Show>
      </span>
    </Show>
    <Show when={moving()}><MoveToFolderDialog title={nameOf(props.row)} artifactId={props.row.id} currentParentId={parentId()} folders={props.folders} onMove={move} onClose={() => setMoving(false)} /></Show>
    <Show when={confirm()}><ConfirmDialog title={`Delete ${nameOf(props.row)}?`} description={props.childCount ? `Delete ${nameOf(props.row)} and the ${props.childCount} item${props.childCount === 1 ? '' : 's'} inside it? They go to the trash, and you can restore them any time.` : `Delete ${nameOf(props.row)}? It goes to the trash, and you can restore it any time.`} action="Delete" confirmLabel="Confirm delete" danger busy={busy()} error={error()} onCancel={() => setConfirm(false)} onConfirm={() => void remove()} /></Show>
  </>;
}

export default function Shelf(props: Props): JSX.Element {
  const [added, setAdded] = createSignal<ShelfRow[]>([]);
  const [removed, setRemoved] = createSignal<string[]>([]);
  const [revision, setRevision] = createSignal(0);
  const [query, setQuery] = createSignal('');
  const [filters, setFilters] = createSignal<string[]>([]);
  const [view, setView] = createSignal<'grid' | 'list'>('grid');
  const [page, setPage] = createSignal(0);
  const [naming, setNaming] = createSignal(false);
  const [name, setName] = createSignal('');
  const [creating, setCreating] = createSignal(false);
  const all = createMemo(() => { revision(); return [...props.rows.filter(row => !removed().includes(row.id)), ...added()]; });
  const scoped = createMemo(() => props.scopeParentId === undefined ? all() : all().filter(row => parentOfRow(row) === props.scopeParentId));
  const filtered = createMemo(() => scoped().filter(row => (!query().trim() || `${row.title ?? ''} ${row.id}`.toLowerCase().includes(query().trim().toLowerCase())) && (!filters().length || filters().includes(row.visibility ?? ''))));
  const shelf = createMemo(() => buildShelf(filtered()));
  const folders = createMemo(() => all().filter(row => row.format === 'folder'));
  const availableFilters = createMemo(() => VISIBILITIES.filter(value => scoped().some(row => row.visibility === value)));
  const toggle = (value: string) => { setFilters(current => current.includes(value) ? current.filter(item => item !== value) : [...current, value]); setPage(0); };
  const childCount = (id: string) => all().filter(row => parentOfRow(row) === id).length;
  const remove = (id: string) => setRemoved(current => [...current, id, ...all().filter(row => (row.ancestor_ids ?? []).includes(id)).map(row => row.id)]);
  const createFolder = async () => {
    const title = name().trim();
    if (!title || creating()) return;
    setCreating(true);
    const response = await apiFetch('/api/my/artifacts', 'POST', { format: 'folder', title, parent_id: props.parentId ?? null }).catch(() => null);
    setCreating(false);
    if (!response?.ok) return;
    const body = await response.json() as Partial<ShelfRow> & { id: string };
    setAdded(current => [...current, { id: body.id, url: body.url ?? `/a/${body.id}`, title: body.title ?? title, format: 'folder', version: body.version ?? 1, visibility: body.visibility ?? 'private', updated_at: body.updated_at ?? new Date().toISOString(), parent_id: body.parent_id ?? props.parentId ?? null }]);
    setName(''); setNaming(false); pageDataChanged();
  };
  const docs = () => shelf().documents.slice(view() === 'list' ? page() * 10 : 0, view() === 'list' ? page() * 10 + 10 : undefined);
  return <div aria-label="Shelf" class="min-w-0">
    <div class="mb-5 flex min-w-0 flex-col gap-2 rounded-[6px] border border-edge bg-surface px-3 py-1.5 sm:flex-row sm:flex-wrap sm:items-center"><div class="flex min-w-0 items-center gap-2 sm:flex-1"><Search size={13} class="shrink-0 text-faint" /><input aria-label="Search artifacts" placeholder="search artifacts" value={query()} onInput={event => { setQuery(event.currentTarget.value); setPage(0); props.onQuery?.(event.currentTarget.value); }} class="h-7 min-w-0 flex-1 border-0 bg-transparent font-mono text-xs text-fg placeholder:text-faint focus:outline-none" /></div><div class="flex flex-wrap items-center gap-2 sm:contents"><Show when={availableFilters().length >= 2}><For each={availableFilters()}>{value => <button type="button" aria-label={`Filter ${value}`} aria-pressed={filters().includes(value)} onClick={() => toggle(value)} class="rounded-full border border-edge px-2 py-0.5 font-mono text-[10px] text-muted">{value}</button>}</For></Show><span role="group" aria-label="Shelf view" class="ml-auto inline-flex shrink-0 gap-1 border-l border-edge pl-1.5"><button type="button" aria-label="Grid view" aria-pressed={view() === 'grid'} onClick={() => setView('grid')} class={view() === 'grid' ? 'rounded bg-accent-soft p-1.5 text-accent' : 'p-1.5 text-faint'}><GridIcon size={14} /></button><button type="button" aria-label="List view" aria-pressed={view() === 'list'} onClick={() => setView('list')} class={view() === 'list' ? 'rounded bg-accent-soft p-1.5 text-accent' : 'p-1.5 text-faint'}><ListIcon size={14} /></button></span><Show when={props.canCreateFolders}><Show when={naming()} fallback={<Tooltip content="create a folder here"><button type="button" aria-label="New folder" onClick={() => setNaming(true)} class="inline-flex h-7 items-center gap-1 px-2 font-mono text-[10px] text-muted"><FolderPlus size={12} />new folder</button></Tooltip>}><input aria-label="Folder name" autofocus value={name()} onInput={event => setName(event.currentTarget.value)} onKeyDown={event => { if (event.key === 'Enter') void createFolder(); if (event.key === 'Escape') setNaming(false); }} class="h-7 w-36 rounded border border-edge bg-transparent px-1.5 font-mono text-xs" /><span class="font-mono text-[10px] text-faint">{creating() ? 'creating…' : 'enter'}</span></Show></Show></div></div>
    <Show when={shelf().folders.length}><section aria-label="Folders" class="relative z-20 mb-6"><div class="mb-2"><MicroLabel>folders</MicroLabel></div><ul class={view() === 'grid' ? 'grid grid-cols-2 gap-3 lg:grid-cols-4' : 'grid grid-cols-1 gap-3 sm:grid-cols-2'}><For each={shelf().folders}>{row => {
      const papers = () => all().filter(item => parentOfRow(item) === row.id && item.format === 'markup').slice(0, 5);
      return <li class={view() === 'grid' ? 'group relative rounded-md p-3 hover:bg-raised/60' : `group relative flex min-w-0 items-center gap-2 rounded-[6px] p-3 ${PANEL}`}>
        <Show when={view() === 'grid'} fallback={<><FolderIcon size={15} class="shrink-0 text-accent" /><a href={row.url} rel="external" aria-label={`Open folder ${nameOf(row)}`} class="min-w-0 flex-1 truncate font-mono text-sm font-semibold text-fg after:absolute after:inset-0">{nameOf(row)}</a><Show when={childCount(row.id)}><span class="font-mono text-[10px] text-faint">{childCount(row.id)}</span></Show><Show when={props.showVisibility !== false}><Visibility row={row} /></Show><RowActions row={row} level={props.actions ?? 'none'} folders={folders()} childCount={childCount(row.id)} onRemoved={remove} onChanged={() => setRevision(value => value + 1)} /></>}>
          <div aria-label={`Preview of folder ${nameOf(row)}`} class="folder-cover">
            <a href={row.url} rel="external" aria-label={`Open folder ${nameOf(row)}`} class="absolute inset-0 z-[2] rounded-md focus-visible:outline-2 focus-visible:outline-accent" />
            <div class="folder-cover-tab"><span class="truncate font-mono text-[10px] tabular-nums">{childCount(row.id) ? `${childCount(row.id)} artifact${childCount(row.id) === 1 ? '' : 's'}` : 'empty folder'}</span></div>
            <div class="folder-cover-back" />
            <Show when={!papers().length}><div class="folder-cover-empty" aria-hidden="true"><Inbox size={28} /></div></Show>
            <Show when={props.showVisibility !== false && row.visibility}><span aria-label={`${nameOf(row)} is ${row.visibility}`} class="folder-cover-visibility absolute left-2 top-[27px] z-[3] rounded bg-slate-700/75 p-1 text-white"><Show when={row.visibility === 'public'} fallback={<Show when={row.visibility === 'private'} fallback={<EyeOff size={12} />}><Lock size={12} /></Show>}><Globe size={12} /></Show></span></Show>
            <div class="folder-cover-papers" style={{ '--paper-width': papers().length > 2 ? '48%' : '61%' }}><For each={papers()}>{(item, index) => <div class="folder-cover-paper" style={{ '--paper-position': index() / Math.max(1, papers().length - 1) }}><img src={`/a/${item.id}/export?format=jpg&mode=card&v=${item.version}&r=${CARD_RENDER_GENERATION}`} alt="" loading="lazy" /></div>}</For></div>
            <div class="folder-cover-front"><span class="min-w-0 flex-1 truncate pr-2 font-mono text-[13px] font-semibold">{nameOf(row)}</span><span class="relative z-[3] ml-auto"><RowActions row={row} level={props.actions ?? 'none'} folders={folders()} childCount={childCount(row.id)} onRemoved={remove} onChanged={() => setRevision(value => value + 1)} /></span></div>
          </div>
        </Show>
      </li>;
    }}</For></ul></section></Show>
    <Show when={docs().length}><section aria-label="Artifacts">
      <div class="mb-2"><MicroLabel>artifacts</MicroLabel></div>
      <ul aria-label={view() === 'grid' ? 'Artifact grid' : 'Artifact list'} class={view() === 'grid' ? 'grid grid-cols-2 gap-3 lg:grid-cols-4' : 'flex flex-col gap-2'}>
        <For each={docs()}>{row => <li class={view() === 'grid' ? 'group relative min-w-0 rounded-md p-3 hover:bg-raised/60' : `group relative ${PANEL} flex items-center gap-3 px-3 py-2`}>
          <Show when={view() === 'grid'} fallback={<>
            <a href={row.url} rel="external" aria-label={`Open ${nameOf(row)}`} class="flex min-w-0 flex-1 items-center gap-2 font-mono text-sm font-medium text-fg hover:text-accent"><img src={`/a/${row.id}/export?format=jpg&mode=card&v=${row.version}&r=${CARD_RENDER_GENERATION}`} alt="" width={24} height={24} loading="lazy" class="size-6 shrink-0 rounded-sm border border-edge bg-raised object-cover object-top" /><span class="truncate">{nameOf(row)}</span></a>
            <Show when={props.showVisibility !== false}><Visibility row={row} /></Show>
            <span class="font-mono text-[10px] text-faint">{timeAgo(row.updated_at)}</span>
            <RowActions row={row} level={props.actions ?? 'none'} folders={folders()} childCount={0} onRemoved={remove} onChanged={() => setRevision(value => value + 1)} />
          </>}>
            <ArtifactCover row={row} showVisibility={props.showVisibility !== false}>
              <RowActions row={row} level={props.actions ?? 'none'} folders={folders()} childCount={0} onRemoved={remove} onChanged={() => setRevision(value => value + 1)} />
            </ArtifactCover>
          </Show>
        </li>}</For>
      </ul>
    </section></Show>
    <Show when={view() === 'list' && shelf().documents.length > 10}><div class="mt-3 flex justify-between font-mono text-xs"><span aria-label="Page range">{page() * 10 + 1}-{Math.min((page() + 1) * 10, shelf().documents.length)} of {shelf().documents.length}</span><span class="flex gap-2"><button type="button" aria-label="Previous page" disabled={page() === 0} onClick={() => setPage(value => value - 1)}>Previous</button><button type="button" aria-label="Next page" disabled={(page() + 1) * 10 >= shelf().documents.length} onClick={() => setPage(value => value + 1)}>Next</button></span></div></Show>
    <Show when={!shelf().folders.length && !shelf().documents.length && (query() || filters().length)}><p aria-label="No matches" class="font-mono text-xs text-faint">nothing matches the active {query() ? 'search' : 'filters'}</p></Show>
  </div>;
}
