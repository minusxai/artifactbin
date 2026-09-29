/* @jsxImportSource solid-js */
import { createEffect, createSignal, onCleanup, Show, type JSX } from 'solid-js';
import { Portal } from 'solid-js/web';
import ChevronDown from 'lucide-solid/icons/chevron-down';
import Plus from 'lucide-solid/icons/plus';
import FilePlus2 from 'lucide-solid/icons/file-plus-2';
import FolderPlus from 'lucide-solid/icons/folder-plus';
import FileUp from 'lucide-solid/icons/file-up';
import DatabasePlus from 'lucide-solid/icons/database-plus';
import Database from 'lucide-solid/icons/database';
import Trash2 from 'lucide-solid/icons/trash-2';
import { pageDataChanged } from '@/web/page-data-events';
import GetStarted from './GetStarted';

const ITEM = 'group flex w-full cursor-pointer items-center gap-2.5 rounded-[4px] px-2.5 py-2 text-left font-mono text-[11.5px] text-fg no-underline hover:bg-accent-soft hover:text-accent';
type Kind = 'artifact' | 'folder';
export default function WorkspaceCreate(props: { onCreated: () => void; parentId?: string | null }): JSX.Element {
  const [open, setOpen] = createSignal(false);
  const [dialog, setDialog] = createSignal<Kind | null>(null);
  const [name, setName] = createSignal('');
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal('');
  let root!: HTMLDivElement;
  createEffect(() => {
    if (!open()) return;
    const away = (event: MouseEvent) => { if (!root.contains(event.target as Node)) setOpen(false); };
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', away); window.addEventListener('keydown', escape);
    onCleanup(() => { document.removeEventListener('mousedown', away); window.removeEventListener('keydown', escape); });
  });
  const choose = (kind: Kind) => { setOpen(false); setDialog(kind); };
  const createFolder = async (event: SubmitEvent) => {
    event.preventDefault();
    const title = name().trim(); if (!title || busy()) return;
    setBusy(true); setError('');
    const response = await fetch('/api/my/artifacts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ format: 'folder', title, parent_id: props.parentId ?? null }) }).catch(() => null);
    setBusy(false);
    if (!response?.ok) { setError('Could not create the folder. Try again.'); return; }
    pageDataChanged(); props.onCreated(); setDialog(null); setName('');
  };
  return <div ref={root} class="relative z-30 lg:border-b lg:border-edge lg:pb-3">
    <button type="button" aria-label="Create" aria-expanded={open()} aria-haspopup="menu" onClick={() => setOpen(value => !value)} class="group flex h-9 w-full items-center rounded-[5px] border border-accent bg-accent px-3 font-mono text-xs font-semibold text-bg"><Plus size={15} /><span class="ml-2">Create</span><ChevronDown size={14} class="ml-auto" /></button>
    <Show when={open()}><div role="menu" aria-label="Create menu" class="absolute inset-x-0 top-[calc(100%+0.35rem)] z-40 rounded-[6px] border border-edge-bright bg-surface p-1 shadow-xl"><button type="button" role="menuitem" class={ITEM} onClick={() => choose('artifact')}><FilePlus2 size={14} />Artifact</button><button type="button" role="menuitem" class={ITEM} onClick={() => choose('folder')}><FolderPlus size={14} />Folder</button><div class="mt-1 border-t border-edge pt-1"><span class="block px-2.5 pt-1.5 pb-1 font-mono text-[9.5px] uppercase tracking-[0.14em] text-faint">assets</span><a role="menuitem" href={props.parentId ? `/files/new?parent_id=${encodeURIComponent(props.parentId)}` : '/files/new'} class={ITEM}><FileUp size={14} />File</a><a role="menuitem" href="/datasets/new" class={ITEM}><DatabasePlus size={14} />Dataset</a></div></div></Show>
    <nav aria-label="Workspace shortcuts" class="mt-2 grid grid-cols-2 gap-1"><a href="/assets" aria-label="Assets" class="flex h-7 items-center justify-center gap-1.5 rounded border border-edge bg-raised font-mono text-[11px] text-muted"><Database size={13} />Assets</a><a href="/trash" aria-label="Trash" class="flex h-7 items-center justify-center gap-1.5 rounded border border-edge bg-raised font-mono text-[11px] text-muted"><Trash2 size={13} />Trash</a></nav>
    <Show when={dialog()}>{kind => <Portal mount={document.body}><div class="fixed inset-0 z-[100] flex items-center justify-center p-3"><button type="button" aria-label="Close create dialog by clicking outside" onClick={() => setDialog(null)} class="absolute inset-0 bg-black/45" /><div role="dialog" aria-modal="true" aria-label={kind() === 'artifact' ? 'Create new artifact' : 'Create new folder'} class={`relative z-10 w-full rounded-[9px] border border-edge-bright bg-surface shadow-2xl ${kind() === 'artifact' ? 'max-w-3xl' : 'max-w-md'}`}><header class="flex items-center justify-between border-b border-edge p-4"><h2 class="font-mono text-sm font-semibold">New {kind()}</h2><button type="button" aria-label="Close create dialog" onClick={() => setDialog(null)}>×</button></header><Show when={kind() === 'folder'} fallback={<div class="p-5"><Show when={props.parentId}><p class="mb-3 font-mono text-xs">create inside this folder with <code>parent_id: &quot;{props.parentId}&quot;</code></p></Show><GetStarted heading={false} frame={false} /></div>}><form onSubmit={event => void createFolder(event)} class="p-5"><label for="workspace-folder-name" class="block font-mono text-xs">Folder name</label><input id="workspace-folder-name" autofocus required value={name()} onInput={event => setName(event.currentTarget.value)} class="mt-2 w-full rounded border border-edge bg-bg p-2 font-mono text-xs" /><Show when={error()}><p role="alert" class="text-danger">{error()}</p></Show><div class="mt-5 flex justify-end gap-2"><button type="button" onClick={() => setDialog(null)}>cancel</button><button type="submit" disabled={!name().trim() || busy()} class="rounded bg-accent px-3 py-1 text-bg">{busy() ? 'creating…' : 'create folder'}</button></div></form></Show></div></div></Portal>}</Show>
  </div>;
}
