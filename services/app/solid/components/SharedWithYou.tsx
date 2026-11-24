/* @jsxImportSource solid-js */
import { createMemo, createSignal, createUniqueId, createEffect, on, For, Show, type JSX } from 'solid-js';
import type { WorkspaceSharedItem } from '@/lib/workspace';
import { SHARE_ROLE_LABEL, SHARE_ROLES } from '@artifactbin/contracts/sharing';
import { FormatBadge, formatLabel, LINK, MicroLabel, timeAgo } from '../ui/ui';
import { Button } from '../ui/Button';
import { Field, Input, SearchField } from '../ui/Field';
import { Panel } from '../ui/Panel';
import { Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow } from '../ui/Table';
import { ToggleGroup } from '../ui/ToggleGroup';
import { StatusMessage } from '../ui/StatusMessage';
import { artifactLink } from '../lib/artifact-link';

// Legacy markup and folders remain document navigation; all other formats are assets.
const isDocument = (item: WorkspaceSharedItem) => ['html', 'markup', 'folder'].includes(item.format ?? 'markup');
const PAGE_SIZE = 10;
const FORMAT_ORDER = ['markup', 'dataset', 'viz', 'image', 'pdf'];
const ownerLabel = (item: WorkspaceSharedItem) => item.owner_name?.trim() || (item.owner_username ? `@${item.owner_username}` : 'Unknown owner');
const ownerKey = (item: WorkspaceSharedItem) => item.owner_username ? `handle:${item.owner_username}` : `name:${ownerLabel(item)}`;
type Column = 'Owner' | 'Permission' | 'Updated';

function localDay(timestamp: string) {
  const date = new Date(timestamp);
  return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('-');
}
/** `query`: Home's own "search artifacts" box, ANDed with this panel's own — typing there filters
 * both shelves at once, and this panel's box still narrows further within that result. */
export default function SharedWithYou(props: { items: WorkspaceSharedItem[]; query?: string }): JSX.Element {
  const [view, setView] = createSignal('documents');
  const [page, setPage] = createSignal(0);
  const inventory = createMemo(() => props.items.filter(item => isDocument(item) === (view() === 'documents')));
  const [query, setQuery] = createSignal('');
  const [formatPicks, setFormatPicks] = createSignal<string[]>([]);
  const [rolePicks, setRolePicks] = createSignal<string[]>([]);
  const [owner, setOwner] = createSignal('');
  const [from, setFrom] = createSignal('');
  const [to, setTo] = createSignal('');
  const [column, setColumn] = createSignal<Column | null>(null);
  const controlsId = createUniqueId();
  const owners = createMemo(() => {
    const distinct = new Map(inventory().map(item => [ownerKey(item), item]));
    const names = new Set<string>();
    const duplicates = new Set<string>();
    for (const item of distinct.values()) {
      const name = ownerLabel(item);
      if (names.has(name)) duplicates.add(name);
      names.add(name);
    }
    return Array.from(distinct, ([key, item]) => {
      const name = ownerLabel(item);
      const label = duplicates.has(name) && item.owner_username ? `${name} (@${item.owner_username})` : name;
      return { key, label };
    }).sort((a, b) => a.label.localeCompare(b.label));
  });
  const reset = () => {
    setFormatPicks([]); setRolePicks([]); setOwner(''); setFrom(''); setTo(''); setColumn(null); setPage(0);
  };
  createEffect(on(() => props.query, () => setPage(0), { defer: true }));
  const header = (name: Column, active: () => boolean) => <TableHeaderCell class="max-sm:px-0">
    <Button size="sm" variant="ghost" aria-label={name} pressed={active()} aria-expanded={column() === name}
      aria-controls={column() === name ? controlsId : undefined}
      onClick={() => setColumn(column() === name ? null : name)}>{name} ▾</Button>
  </TableHeaderCell>;
  const toggle = (kind: 'format' | 'role', value: string) => { const set = kind === 'format' ? setFormatPicks : setRolePicks; set(current => current.includes(value) ? current.filter(item => item !== value) : [...current, value]); setPage(0); };
  const formats = createMemo(() => { const present = new Set<string>(inventory().map(item => item.format ?? 'markup')); return [...FORMAT_ORDER.filter(format => present.has(format)), ...[...present].filter(format => !FORMAT_ORDER.includes(format))]; });
  const roles = createMemo(() => SHARE_ROLES.filter(role => inventory().some(item => item.role === role)));
  const outer = () => (props.query ?? '').trim().toLowerCase();
  const q = () => query().trim().toLowerCase();
  const localFilters = () => Boolean(query() || formatPicks().length || rolePicks().length || owner() || from() || to());
  const filtering = () => outer() || localFilters();
  const visible = createMemo(() => inventory().filter(item => {
    const format = item.format ?? 'markup';
    if (owner() && ownerKey(item) !== owner()) return false;
    if (from() || to()) {
      const day = localDay(item.updated_at);
      if ((from() && day < from()) || (to() && day > to())) return false;
    }
    const searchable = [item.title, item.owner_name, item.description, item.id, item.owner_username ? `@${item.owner_username}` : null, formatLabel(format), SHARE_ROLE_LABEL[item.role]].filter(Boolean).join(' ').toLowerCase();
    return (!outer() || searchable.includes(outer())) && (!q() || searchable.includes(q())) && (!formatPicks().length || formatPicks().includes(format)) && (!rolePicks().length || rolePicks().includes(item.role));
  }));
  const pageIndex = () => Math.min(page(), Math.max(0, Math.ceil(visible().length / PAGE_SIZE) - 1));
  const paged = () => visible().slice(pageIndex() * PAGE_SIZE, (pageIndex() + 1) * PAGE_SIZE);
  return <Show when={props.items.length}><section aria-label="Shared with you" class="mt-8"><div class="mb-2"><MicroLabel>shared with you</MicroLabel></div>
    <Panel padding="none">
      <div class="flex flex-wrap items-center gap-2 border-b border-edge px-4 py-2">
        <ToggleGroup label="Shared inventory" value={view()} onChange={value => { setView(value); reset(); }} options={[{ value: 'documents', label: 'Documents', ariaLabel: 'Shared documents' }, { value: 'assets', label: 'Assets', ariaLabel: 'Shared assets' }]} />
        <SearchField class="min-w-32 flex-1" label="Search shared artifacts" value={query()} onValue={value => { setQuery(value); setPage(0); }} />
        <Show when={formats().length >= 2}><span class="flex max-w-full flex-wrap items-center gap-1.5 border-edge sm:ml-auto sm:border-l sm:pl-2">
          <For each={formats()}>{format => <Button size="sm" variant="ghost" aria-label={`Filter ${format}`} pressed={formatPicks().includes(format)} onClick={() => toggle('format', format)}>{formatLabel(format)}</Button>}</For>
        </span></Show>
        <Show when={localFilters()}><Button size="sm" variant="link" onClick={() => { reset(); setQuery(''); }}>Clear filters</Button></Show>
        <Show when={filtering()}><span aria-label="Shared result count" class="shrink-0 border-l border-edge pl-2 font-mono text-micro text-faint">{visible().length}/{inventory().length}</span></Show>
      </div>
      <Table label="Shared artifacts" density="sm" fixed>
        <TableHead class="max-sm:block max-sm:[&>tr]:flex max-sm:[&>tr]:flex-wrap max-sm:[&>tr]:px-2">
          <TableHeaderCell class="max-sm:sr-only">Artifact</TableHeaderCell>
          {header('Owner', () => Boolean(owner()))}
          {header('Permission', () => rolePicks().length > 0)}
          <TableHeaderCell class="max-sm:sr-only sm:w-20">Format</TableHeaderCell>
          {header('Updated', () => Boolean(from() || to()))}
        </TableHead>
        <TableBody>
          <Show when={column()}><TableRow interactive={false} class="max-sm:block"><TableCell colSpan={5} class="max-sm:block">
            <div id={controlsId} role="group" aria-label={`${column()} filter`} class="flex max-h-64 flex-wrap items-end gap-2 overflow-y-auto">
              <Show when={column() === 'Owner'}>
                <Button size="sm" pressed={!owner()} onClick={() => { setOwner(''); setPage(0); }}>All owners</Button>
                <For each={owners()}>{option => <Button size="sm" pressed={owner() === option.key}
                  onClick={() => { setOwner(option.key); setPage(0); }}><span class="max-w-48 truncate">{option.label}</span></Button>}</For>
              </Show>
              <Show when={column() === 'Permission'}><For each={roles()}>{role =>
                <Button size="sm" variant="ghost" aria-label={`Filter ${role}`} pressed={rolePicks().includes(role)}
                  onClick={() => toggle('role', role)}>{SHARE_ROLE_LABEL[role]}</Button>
              }</For></Show>
              <Show when={column() === 'Updated'}>
                <Field label="Updated from"><Input type="date" size="sm" value={from()} max={to() || undefined}
                  onInput={event => { setFrom(event.currentTarget.value); setPage(0); }} /></Field>
                <Field label="Updated to"><Input type="date" size="sm" value={to()} min={from() || undefined}
                  onInput={event => { setTo(event.currentTarget.value); setPage(0); }} /></Field>
              </Show>
            </div>
          </TableCell></TableRow></Show>
          <Show when={!visible().length}><TableRow interactive={false}><TableCell colSpan={5}><StatusMessage kind="empty" class="justify-center">{q() ? <>nothing matches &ldquo;{query().trim()}&rdquo;</> : outer() ? <>nothing matches &ldquo;{(props.query ?? '').trim()}&rdquo;</> : filtering() ? 'nothing matches the active filters' : `no shared ${view()}`}</StatusMessage></TableCell></TableRow></Show>
          <For each={paged()}>{item => <TableRow class="max-sm:grid max-sm:grid-cols-2">
            <TableCell class="min-w-0 max-sm:col-span-2"><a {...artifactLink(`/a/${item.id}`, item.format ?? 'markup')} aria-label={`Open shared artifact ${item.id}`} class={`block truncate ${LINK}`}>{item.title || item.id}</a></TableCell>
            <TableCell class="truncate">{ownerLabel(item)}</TableCell>
            <TableCell aria-label={`Your role on ${item.id}`}>{SHARE_ROLE_LABEL[item.role]}</TableCell>
            <TableCell><FormatBadge format={item.format} /></TableCell>
            <TableCell>{timeAgo(item.updated_at)}</TableCell>
          </TableRow>}</For>
        </TableBody>
      </Table>
      <Show when={visible().length > PAGE_SIZE}><div class="flex items-center justify-between border-t border-edge px-4 py-2 font-mono text-micro text-faint">
        <span aria-label="Shared page range">{pageIndex() * PAGE_SIZE + 1}-{Math.min((pageIndex() + 1) * PAGE_SIZE, visible().length)} of {visible().length}</span>
        <span class="flex gap-2"><Button size="sm" variant="secondary" aria-label="Previous shared page" disabled={pageIndex() === 0} onClick={() => setPage(pageIndex() - 1)}>Previous</Button><Button size="sm" variant="secondary" aria-label="Next shared page" disabled={(pageIndex() + 1) * PAGE_SIZE >= visible().length} onClick={() => setPage(pageIndex() + 1)}>Next</Button></span>
      </div></Show>
    </Panel>
  </section></Show>;
}
