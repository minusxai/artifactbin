/* @jsxImportSource solid-js */
import { createMemo, createSignal, For, Show, type JSX } from 'solid-js';
import ChevronRight from 'lucide-solid/icons/chevron-right';
import Folder from 'lucide-solid/icons/folder';
import FolderOpen from 'lucide-solid/icons/folder-open';
import House from 'lucide-solid/icons/house';
import Check from 'lucide-solid/icons/check';
import { parentOfRow, type ShelfRow } from '@/lib/workspace/shelf';
import { rowTitle } from '@/lib/document/display-title';
import { Button } from '../ui/Button';
import { Dialog } from '../ui/Dialog';
import { SearchField } from '../ui/Field';
import { StatusMessage } from '../ui/StatusMessage';

type FolderNode = {id: string | null; name: string; parent: string | null; children: FolderNode[]};

/** Destination selection is local; the caller owns the authenticated move and refresh. */
export function MoveToFolderDialog(props: {
  title: string; artifactId: string; currentParentId: string | null; folders: ShelfRow[];
  onMove: (id: string | null) => Promise<boolean>; onClose: () => void;
}): JSX.Element {
  const [query, setQuery] = createSignal('');
  const [selected, setSelected] = createSignal(props.currentParentId);
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal('');
  const root: FolderNode = {id: null, name: 'Workspace', parent: null, children: []};
  const tree = createMemo(() => {
    const nodes = new Map(props.folders.map(folder => [folder.id, {id: folder.id, name: rowTitle(folder), parent: parentOfRow(folder), children: []} as FolderNode]));
    const result = {...root, children: [] as FolderNode[]};
    for (const node of nodes.values()) (nodes.get(node.parent ?? '') ?? result).children.push(node);
    for (const node of [result, ...nodes.values()]) node.children.sort((a, b) => a.name.localeCompare(b.name, undefined, {numeric: true}) || String(a.id).localeCompare(String(b.id)));
    return {root: result, nodes};
  });
  const ancestors = (id: string | null): FolderNode[] => {
    const result: FolderNode[] = [], seen = new Set<string>();
    while (id && !seen.has(id)) {
      seen.add(id);
      const node = tree().nodes.get(id);
      if (!node) break;
      result.unshift(node); id = node.parent;
    }
    return result;
  };
  const [expanded, setExpanded] = createSignal(new Set<string | null>([null, ...ancestors(props.currentParentId).map(node => node.id)]));
  const blocked = (id: string | null) => id !== null && (id === props.artifactId || ancestors(id).some(node => node.id === props.artifactId)
    || props.folders.find(folder => folder.id === id)?.ancestor_ids?.includes(props.artifactId) === true);
  const isExpanded = (id: string | null) => !!query().trim() || expanded().has(id);
  // Keep node identities stable so expansion preserves the focused DOM row.
  const visible = createMemo(() => {
    const q = query().trim().toLowerCase();
    const matching = new Set<string | null>();
    if (q) for (const node of tree().nodes.values()) if (node.name.toLowerCase().includes(q)) for (const ancestor of ancestors(node.id)) matching.add(ancestor.id);
    const result: FolderNode[] = [];
    const visit = (node: FolderNode) => {
      if (q && node.id !== null && !matching.has(node.id)) return;
      result.push(node);
      if (isExpanded(node.id)) node.children.forEach(visit);
    };
    visit(tree().root);
    return result;
  });
  const toggle = (id: string | null) => setExpanded(previous => {const next = new Set(previous); if (next.has(id)) next.delete(id); else next.add(id); return next;});
  const select = (id: string | null) => {if (!busy() && !blocked(id)) {setSelected(id); setError('');}};
  const focusRow = (container: HTMLElement, index: number) => container.querySelectorAll<HTMLElement>('[role="treeitem"]')[index]?.focus();
  const keydown = (event: KeyboardEvent, node: FolderNode, index: number) => {
    const container = (event.currentTarget as HTMLElement).closest<HTMLElement>('[role="tree"]');
    if (!container || busy()) return;
    switch (event.key) {
      case 'ArrowDown': focusRow(container, Math.min(index + 1, visible().length - 1)); break;
      case 'ArrowUp': focusRow(container, Math.max(index - 1, 0)); break;
      case 'Home': focusRow(container, 0); break;
      case 'End': focusRow(container, visible().length - 1); break;
      case 'ArrowRight':
        if (node.children.length) {if (!isExpanded(node.id)) toggle(node.id); else focusRow(container, index + 1);} break;
      case 'ArrowLeft':
        if (node.children.length && isExpanded(node.id) && !query()) toggle(node.id);
        else focusRow(container, visible().findIndex(row => row.id === node.parent)); break;
      case 'Enter': case ' ': select(node.id); break;
      default: return;
    }
    event.preventDefault();
  };
  const move = async () => {
    if (busy() || blocked(selected()) || selected() === props.currentParentId) return;
    setBusy(true); setError('');
    try {if (!await props.onMove(selected())) setError('Could not move this item. Try another folder or retry.');}
    catch {setError('Could not move this item. Try another folder or retry.');}
    finally {setBusy(false);}
  };
  return <Dialog title={`Move ${props.title}`} description="Choose a destination folder." size="md" busy={busy()} onClose={props.onClose} lockScroll
    footer={<><Button variant="secondary" aria-label="Close folder picker" disabled={busy()} onClick={props.onClose}>Cancel</Button><Button disabled={busy() || blocked(selected()) || selected() === props.currentParentId} onClick={() => void move()}>{busy() ? 'Moving…' : 'Move here'}</Button></>}>
    <SearchField label="Filter folders" placeholder="Find a folder…" disabled={busy()} value={query()} onValue={setQuery} />
    <div class="mt-3 max-h-72 min-h-48 overflow-y-auto">
      <div role="tree" aria-label="Destination folders" aria-busy={busy()}><For each={visible()}>{node => <div role="treeitem" aria-label={node.id === null ? 'Move to root' : `Move to ${node.name}`}
        aria-level={ancestors(node.id).length + 1} aria-selected={selected() === node.id} aria-expanded={node.children.length ? isExpanded(node.id) : undefined} aria-disabled={blocked(node.id) || busy()}
        aria-current={props.currentParentId === node.id ? 'location' : undefined} tabIndex={selected() === node.id ? 0 : -1}
        onClick={() => select(node.id)} onKeyDown={event => keydown(event, node, visible().indexOf(node))}
        class={`my-0.5 flex min-h-9 cursor-pointer items-center gap-2 rounded-control pr-3 outline-none focus-visible:ring-2 focus-visible:ring-accent ${blocked(node.id) ? 'opacity-40' : ''} ${selected() === node.id ? 'bg-accent-soft text-accent' : 'hover:bg-raised'}`}
        style={{'padding-left': `${8 + ancestors(node.id).length * 20}px`}}>
        <Show when={node.children.length} fallback={<span class="w-5 shrink-0" />}><Button variant="ghost" size="sm" icon tabIndex={-1} aria-label={`${isExpanded(node.id) ? 'Collapse' : 'Expand'} ${node.name}`} disabled={busy() || !!query()} onClick={event => {event.stopPropagation(); toggle(node.id);}} class="h-6 w-5"><ChevronRight size={13} class={isExpanded(node.id) ? 'rotate-90' : ''} /></Button></Show>
        <Show when={node.id !== null} fallback={<House size={17} class="shrink-0 text-muted" />}><Show when={isExpanded(node.id) && node.children.length} fallback={<Folder size={18} class="shrink-0 fill-accent/15 text-accent" />}><FolderOpen size={18} class="shrink-0 fill-accent/15 text-accent" /></Show></Show>
        <span class="min-w-0 flex-1 truncate">{node.name}</span>
        <Show when={props.currentParentId === node.id}><span class="text-micro text-muted">Current</span></Show>
        <Show when={selected() === node.id}><Check size={14} class="shrink-0" /></Show>
      </div>}</For></div>
      <Show when={query().trim() && visible().length === 1}><StatusMessage kind="empty" class="justify-center py-6">No folders match your search.</StatusMessage></Show>
    </div>
    <p aria-label="Selected destination" class="mt-3 break-words text-xs text-muted">{['Workspace', ...ancestors(selected()).map(node => node.name)].join(' / ')}</p>
    <Show when={error()}><StatusMessage kind="error" class="mt-3">{error()}</StatusMessage></Show>
  </Dialog>;
}
