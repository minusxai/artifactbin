/* @jsxImportSource solid-js */
import { createMemo, createSignal, For, Show, type JSX } from 'solid-js';
import FolderIcon from 'lucide-solid/icons/folder';
import FolderPlus from 'lucide-solid/icons/folder-plus';
import Inbox from 'lucide-solid/icons/inbox';
import GridIcon from 'lucide-solid/icons/layout-grid';
import ListIcon from 'lucide-solid/icons/list';
import Globe from 'lucide-solid/icons/globe';
import Lock from 'lucide-solid/icons/lock';
import EyeOff from 'lucide-solid/icons/eye-off';
import Pencil from 'lucide-solid/icons/pencil';
import FolderInput from 'lucide-solid/icons/folder-input';
import Trash2 from 'lucide-solid/icons/trash-2';
import { writeBrowserArtifact } from '@/lib/artifact-backend/browser-artifact-write';
import { buildShelf, parentOfRow, type ShelfRow } from '@/lib/workspace/shelf';
import { CARD_HEIGHT, CARD_RENDER_GENERATION, CARD_WIDTH } from '@artifactbin/contracts';
import { pageDataChanged } from '@/solid/lib/page-data-events';
import { Badge, MicroLabel, timeAgo } from '../ui/ui';
import { Tooltip } from '../ui/Tooltip';
import { Button } from '../ui/Button';
import { Input, SearchField } from '../ui/Field';
import { Panel } from '../ui/Panel';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import { RowMenu } from '../ui/Menu';
import { ToggleGroup } from '../ui/ToggleGroup';
import ShareLink from './ShareLink';
import { TransferOwnershipDialog } from './TransferOwnershipDialog';
import { MoveToFolderDialog } from './MoveToFolderDialog';
import { apiFetch } from '../lib/api';
import { artifactLink } from '../lib/artifact-link';

type Actions = 'none' | 'share' | 'full';
interface Props {
  rows: ShelfRow[];
  groupId?: string | null;
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
  return <Show when={props.row.visibility}><Tooltip content={props.row.visibility}><span role="img" tabIndex={0} aria-label={`${nameOf(props.row)} is ${props.row.visibility}`} class="relative z-10 inline-flex shrink-0 bg-surface/85"><Badge><VisibilityGlyph visibility={props.row.visibility} /></Badge></span></Tooltip></Show>;
}

function VisibilityGlyph(props: { visibility?: string }): JSX.Element {
  return <Show when={props.visibility === 'public'} fallback={<Show when={props.visibility === 'private'} fallback={<EyeOff size={12} class="block" />}><Lock size={12} class="block" /></Show>}><Globe size={12} class="block" /></Show>;
}

/** One document jacket: preview, caption and independent actions share the same surface. */
function ArtifactCover(props: { row: ShelfRow; showVisibility: boolean; children: JSX.Element }): JSX.Element {
  return <div class="artifact-cover">
    <a {...artifactLink(props.row.url, props.row.format)} aria-label={`Open ${nameOf(props.row)}`} class="artifact-cover-link" />
    <div class="artifact-cover-preview"><img width={CARD_WIDTH} height={CARD_HEIGHT} src={`/a/${props.row.id}/export?format=jpg&mode=card&v=${props.row.version}&r=${CARD_RENDER_GENERATION}`} alt="" loading="lazy" /></div>
    <span class="artifact-cover-fold" aria-hidden="true" />
    <Show when={props.showVisibility}><div class="artifact-cover-visibility"><Visibility row={props.row} /></div></Show>
    <div class="artifact-cover-front">
      <span class="min-w-0 flex-1 line-clamp-2 font-mono text-xs font-semibold leading-4">{nameOf(props.row)}</span>
      <span class="relative z-[3] inline-flex shrink-0">{props.children}</span>
    </div>
  </div>;
}

export function RowActions(props: { row: ShelfRow; level: Actions; folders: ShelfRow[]; childCount: number; onRemoved: (id: string) => void; onChanged: () => void; showEdit?: boolean; groupId?: string | null }): JSX.Element {
  const [confirm, setConfirm] = createSignal(false);
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  const [moving, setMoving] = createSignal(false);
  const [transferring,setTransferring]=createSignal(false);
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
    <Show when={renaming()}><span class="relative z-20 inline-block w-36"><Input size="sm" aria-label="Folder name" autofocus value={draft()} onInput={event => setDraft(event.currentTarget.value)} onBlur={() => void saveName()} onKeyDown={event => { if (event.key === 'Enter') void saveName(); if (event.key === 'Escape') setRenaming(false); }} /></span></Show>
    <Show when={props.level === 'full'}>
      <span class="relative z-10 inline-flex shrink-0 items-center gap-1">
        <Show when={props.row.format === 'dataset' && props.showEdit !== false}><Tooltip content="edit"><a aria-label={`Edit ${nameOf(props.row)}`} {...artifactLink(`/a/${props.row.id}/edit`, props.row.format)} class="shelf-secondary-action text-muted hover:text-accent"><Pencil size={13} /></a></Tooltip></Show>
        <RowMenu name={nameOf(props.row)} items={[
          { label: `Manage sharing for ${nameOf(props.row)}`, text: 'share', icon: () => <span>↗</span>, onSelect: () => setSharing(true) },
          ...(props.row.format === 'folder' ? [{ label: `Rename ${nameOf(props.row)}`, text: 'rename', icon: () => <Pencil size={12} />, onSelect: () => { setDraft(props.row.title ?? ''); setRenaming(true); } }] : []),
          { label: `Move ${nameOf(props.row)}`, text: 'move to folder', icon: () => <FolderInput size={12} />, onSelect: () => setMoving(true) },
          { label: `Transfer ownership of ${nameOf(props.row)}`, text: 'transfer ownership', icon: () => <FolderInput size={12}/>, onSelect: () => setTransferring(true) },
          { label: `Delete ${nameOf(props.row)}`, text: props.childCount ? `delete (${props.childCount} inside)` : 'delete', icon: () => <Trash2 size={12} />, danger: true, onSelect: () => setConfirm(true) },
        ]} />
        <Show when={sharing()}><ShareLink artifactId={props.row.id} title={nameOf(props.row)} format={props.row.format} editable url={props.row.url} startOpen onClose={() => setSharing(false)} /></Show>
      </span>
    </Show>
    <Show when={moving()}><MoveToFolderDialog title={nameOf(props.row)} artifactId={props.row.id} currentParentId={parentId()} folders={props.folders} onMove={move} onClose={() => setMoving(false)} /></Show>
    <Show when={transferring()}><TransferOwnershipDialog id={props.row.id} title={nameOf(props.row)} currentGroupId={props.groupId} onClose={()=>setTransferring(false)} onTransferred={()=>{setTransferring(false);props.onRemoved(props.row.id);pageDataChanged();}}/></Show>
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
    <Panel padding="none" class="mb-5 flex flex-col gap-2 px-3 py-1.5 sm:flex-row sm:flex-wrap sm:items-center">
      <div class="min-w-0 sm:flex-1"><SearchField label="Search artifacts" value={query()} onValue={value => { setQuery(value); setPage(0); props.onQuery?.(value); }} /></div>
      <div class="flex flex-wrap items-center gap-2 sm:contents">
        <Show when={availableFilters().length >= 2}><For each={availableFilters()}>{value => <Button size="sm" variant="ghost" aria-label={`Filter ${value}`} pressed={filters().includes(value)} onClick={() => toggle(value)}>{value}</Button>}</For></Show>
        <ToggleGroup label="Shelf view" iconOnly value={view()} onChange={next => setView(next as 'grid' | 'list')} class="ml-auto shrink-0 border-l border-edge pl-1.5"
          options={[{ value: 'grid', label: 'Grid view', icon: () => <GridIcon size={14} /> }, { value: 'list', label: 'List view', icon: () => <ListIcon size={14} /> }]} />
        <Show when={props.canCreateFolders}>
          <Show when={naming()} fallback={<Tooltip content="create a folder here"><Button size="sm" variant="ghost" aria-label="New folder" onClick={() => setNaming(true)}><FolderPlus size={12} />new folder</Button></Tooltip>}>
            <Input size="sm" aria-label="Folder name" autofocus value={name()} onInput={event => setName(event.currentTarget.value)} onKeyDown={event => { if (event.key === 'Enter') void createFolder(); if (event.key === 'Escape') setNaming(false); }} class="w-36" />
            <span class="font-mono text-micro text-faint">{creating() ? 'creating…' : 'enter'}</span>
          </Show>
        </Show>
      </div>
    </Panel>
    <Show when={shelf().folders.length}><section aria-label="Folders" class="relative z-20 mb-6"><div class="mb-2"><MicroLabel>folders</MicroLabel></div><ul class={view() === 'grid' ? 'grid grid-cols-2 gap-3 lg:grid-cols-4' : 'grid grid-cols-1 gap-3 sm:grid-cols-2'}><For each={shelf().folders}>{row => {
      const papers = () => all().filter(item => parentOfRow(item) === row.id && item.format === 'html').slice(0, 5);
      return <li class={view() === 'grid' ? 'group relative rounded-md p-3 hover:bg-raised/60' : 'group relative min-w-0'}>
        <Show when={view() === 'grid'} fallback={<Panel padding="none" class="flex items-center gap-2 p-3"><FolderIcon size={15} class="shrink-0 text-accent" /><a {...artifactLink(row.url, row.format)} aria-label={`Open folder ${nameOf(row)}`} class="min-w-0 flex-1 truncate font-mono text-sm font-semibold text-fg after:absolute after:inset-0">{nameOf(row)}</a><Show when={childCount(row.id)}><span class="font-mono text-micro text-faint">{childCount(row.id)}</span></Show><Show when={props.showVisibility !== false}><Visibility row={row} /></Show><RowActions groupId={props.groupId} row={row} level={props.actions ?? 'none'} folders={folders()} childCount={childCount(row.id)} onRemoved={remove} onChanged={() => setRevision(value => value + 1)} /></Panel>}>
          <div aria-label={`Preview of folder ${nameOf(row)}`} class="folder-cover">
            <a {...artifactLink(row.url, row.format)} aria-label={`Open folder ${nameOf(row)}`} class="absolute inset-0 z-[2] rounded-md focus-visible:outline-2 focus-visible:outline-accent" />
            <div class="folder-cover-tab"><span class="truncate font-mono text-micro tabular-nums">{childCount(row.id) ? `${childCount(row.id)} artifact${childCount(row.id) === 1 ? '' : 's'}` : 'empty folder'}</span></div>
            <div class="folder-cover-back" />
            <Show when={!papers().length}><div class="folder-cover-empty" aria-hidden="true"><Inbox size={28} /></div></Show>
            <Show when={props.showVisibility !== false && row.visibility}><span class="absolute left-2 top-[27px] z-[3]"><Visibility row={row} /></span></Show>
            <div class="folder-cover-papers" style={{ '--paper-width': papers().length > 2 ? '48%' : '61%' }}><For each={papers()}>{(item, index) => <div class="folder-cover-paper" style={{ '--paper-position': index() / Math.max(1, papers().length - 1) }}><img src={`/a/${item.id}/export?format=jpg&mode=card&v=${item.version}&r=${CARD_RENDER_GENERATION}`} alt="" loading="lazy" /></div>}</For></div>
            <div class="folder-cover-front"><span class="min-w-0 flex-1 truncate pr-2 font-mono text-sm font-semibold">{nameOf(row)}</span><span class="relative z-[3] ml-auto"><RowActions groupId={props.groupId} row={row} level={props.actions ?? 'none'} folders={folders()} childCount={childCount(row.id)} onRemoved={remove} onChanged={() => setRevision(value => value + 1)} /></span></div>
          </div>
        </Show>
      </li>;
    }}</For></ul></section></Show>
    <Show when={docs().length}><section aria-label="Artifacts">
      <div class="mb-2"><MicroLabel>artifacts</MicroLabel></div>
      <ul aria-label={view() === 'grid' ? 'Artifact grid' : 'Artifact list'} class={view() === 'grid' ? 'grid grid-cols-2 gap-3 lg:grid-cols-4' : 'flex flex-col gap-2'}>
        <For each={docs()}>{row => <li class={view() === 'grid' ? 'group relative min-w-0 rounded-md p-3 hover:bg-raised/60' : 'group relative'}>
          <Show when={view() === 'grid'} fallback={<Panel padding="none" class="flex items-center gap-3 px-3 py-2">
            <a {...artifactLink(row.url, row.format)} aria-label={`Open ${nameOf(row)}`} class="flex min-w-0 flex-1 items-center gap-2 font-mono text-sm font-medium text-fg hover:text-accent"><img src={`/a/${row.id}/export?format=jpg&mode=card&v=${row.version}&r=${CARD_RENDER_GENERATION}`} alt="" width={24} height={24} loading="lazy" class="size-6 shrink-0 rounded-sm border border-edge bg-raised object-cover object-top" /><span class="truncate">{nameOf(row)}</span></a>
            <Show when={props.showVisibility !== false}><Visibility row={row} /></Show>
            <span class="font-mono text-micro text-faint">{timeAgo(row.updated_at)}</span>
            <RowActions groupId={props.groupId} row={row} level={props.actions ?? 'none'} folders={folders()} childCount={0} onRemoved={remove} onChanged={() => setRevision(value => value + 1)} />
          </Panel>}>
            <ArtifactCover row={row} showVisibility={props.showVisibility !== false}>
              <RowActions groupId={props.groupId} row={row} level={props.actions ?? 'none'} folders={folders()} childCount={0} onRemoved={remove} onChanged={() => setRevision(value => value + 1)} />
            </ArtifactCover>
          </Show>
        </li>}</For>
      </ul>
    </section></Show>
    <Show when={view() === 'list' && shelf().documents.length > 10}><div class="mt-3 flex items-center justify-between font-mono text-xs"><span aria-label="Page range">{page() * 10 + 1}-{Math.min((page() + 1) * 10, shelf().documents.length)} of {shelf().documents.length}</span><span class="flex gap-2"><Button size="sm" variant="secondary" aria-label="Previous page" disabled={page() === 0} onClick={() => setPage(value => value - 1)}>Previous</Button><Button size="sm" variant="secondary" aria-label="Next page" disabled={(page() + 1) * 10 >= shelf().documents.length} onClick={() => setPage(value => value + 1)}>Next</Button></span></div></Show>
    <Show when={!shelf().folders.length && !shelf().documents.length && (query() || filters().length)}><p aria-label="No matches" class="font-mono text-xs text-faint">nothing matches the active {query() ? 'search' : 'filters'}</p></Show>
  </div>;
}
