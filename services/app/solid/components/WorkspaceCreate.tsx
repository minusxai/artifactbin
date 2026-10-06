/* @jsxImportSource solid-js */
import { createSignal, For, Show, type JSX } from 'solid-js';
import { Portal } from 'solid-js/web';
import ChevronDown from 'lucide-solid/icons/chevron-down';
import Plus from 'lucide-solid/icons/plus';
import FilePlus2 from 'lucide-solid/icons/file-plus-2';
import FolderPlus from 'lucide-solid/icons/folder-plus';
import FileUp from 'lucide-solid/icons/file-up';
import DatabasePlus from 'lucide-solid/icons/database-plus';
import FileText from 'lucide-solid/icons/file-text';
import Newspaper from 'lucide-solid/icons/newspaper';
import Presentation from 'lucide-solid/icons/presentation';
import LayoutDashboard from 'lucide-solid/icons/layout-dashboard';
import ListChecks from 'lucide-solid/icons/list-checks';
import PanelTop from 'lucide-solid/icons/panel-top';
import ScrollText from 'lucide-solid/icons/scroll-text';
import AppWindow from 'lucide-solid/icons/app-window';
import { pageDataChanged } from '@/web/page-data-events';
import ChevronRight from 'lucide-solid/icons/chevron-right';
import { ARTIFACT_STARTERS, artifactStarter } from '@/lib/workspace/artifact-starters';
import type { StoryTemplateName } from '@/lib/validation/atlas-schemas';
import { openDocument } from '../lib/document-navigation';
import { DialogShell } from '@/solid/components/DialogShell';
import { popupDismiss } from '@/lib/islands/kit/popup-dismiss';
import { apiFetch } from '../lib/api';

const ITEM = 'group flex w-full cursor-pointer items-center gap-2.5 rounded-[4px] px-2.5 py-2 text-left font-mono text-[11.5px] text-fg no-underline hover:bg-accent-soft hover:text-accent';
const TYPE_ICONS = { doc: FileText, editorial: Newspaper, deck: Presentation, dashboard: LayoutDashboard, plan: ListChecks, landing: PanelTop, scrolly: ScrollText, app: AppWindow } satisfies Record<StoryTemplateName, typeof FileText>;
type Kind = 'folder';
export default function WorkspaceCreate(props: { onCreated: () => void; parentId?: string | null }): JSX.Element {
  const [open, setOpen] = createSignal(false);
  const [typesOpen, setTypesOpen] = createSignal(false);
  let artifactButton!: HTMLButtonElement;
  let typesMenu!: HTMLDivElement;
  const [dialog, setDialog] = createSignal<Kind | null>(null);
  const [name, setName] = createSignal('');
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal('');
  let root!: HTMLDivElement;
  let button!: HTMLButtonElement;
  const announce = popupDismiss(open, () => setOpen(false), () => button, () => root);
  const choose = (kind: Kind) => { setOpen(false); setTypesOpen(false); setError(''); setDialog(kind); };
  const showTypes = (focus = false) => { setTypesOpen(true); if (focus) queueMicrotask(() => typesMenu?.querySelector<HTMLButtonElement>('button')?.focus()); };
  const menuKeys = (event: KeyboardEvent) => {
    const menu = (event.target as HTMLElement).closest('[role="menu"]');
    const items = [...(menu?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])].filter(item => item.closest('[role="menu"]') === menu);
    const index = items.indexOf(event.target as HTMLElement);
    if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
      event.preventDefault(); event.stopPropagation();
      items[event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus();
    } else if (menu === typesMenu && ['ArrowLeft', 'Escape'].includes(event.key)) {
      event.preventDefault(); event.stopPropagation(); setTypesOpen(false); artifactButton.focus();
    }
  };
  const createArtifact = async (template: StoryTemplateName) => {
    if (busy()) return;
    setBusy(true); setError('');
    try {
      const response = await apiFetch('/api/my/artifacts', 'POST', artifactStarter(template, props.parentId));
      if (!response.ok) throw new Error('create failed');
      const body = await response.json() as { id?: string };
      if (!body.id) throw new Error('missing artifact');
      pageDataChanged();
      // Browser Back can restore this exact component from the page cache.
      setOpen(false); setTypesOpen(false); setBusy(false);
      openDocument(`/a/${encodeURIComponent(body.id)}${template === 'doc' ? '/edit' : ''}`);
    } catch { setError('Could not create the artifact. Try again.'); setBusy(false); }
  };
  const createFolder = async (event: SubmitEvent) => {
    event.preventDefault();
    const title = name().trim(); if (!title || busy()) return;
    setBusy(true); setError('');
    const response = await apiFetch('/api/my/artifacts', 'POST', { format: 'folder', title, parent_id: props.parentId ?? null }).catch(() => null);
    setBusy(false);
    if (!response?.ok) { setError('Could not create the folder. Try again.'); return; }
    pageDataChanged(); props.onCreated(); setDialog(null); setName('');
  };
  return <div ref={root} class="workspace-create relative z-30">
    <button ref={button} type="button" aria-label="Create" aria-expanded={open()} aria-haspopup="menu" onClick={() => { if (!open()) announce(); setTypesOpen(false); setError(''); setOpen(value => !value); }} class="group flex h-9 w-full items-center rounded-[5px] border border-accent bg-accent px-3 font-mono text-xs font-semibold text-bg"><Plus size={15} /><span class="ml-2">Create</span><ChevronDown size={14} class="ml-auto" /></button>
    <Show when={open()}><div role="menu" aria-label="Create menu" onKeyDown={menuKeys} class="absolute inset-x-0 top-[calc(100%+0.35rem)] z-40 rounded-[6px] border border-edge-bright bg-surface p-1 shadow-xl">
      <div class="workspace-artifact-menu" onMouseEnter={() => showTypes()}>
        <button ref={artifactButton} type="button" role="menuitem" aria-haspopup="menu" aria-expanded={typesOpen()} class={ITEM} onClick={() => showTypes(true)} onKeyDown={event => { if (event.key === 'ArrowRight') { event.preventDefault(); showTypes(true); } }}><FilePlus2 size={14} />Artifact<ChevronRight size={13} class="ml-auto" /></button>
        <Show when={typesOpen()}><div class="workspace-type-flyout"><div ref={typesMenu} role="menu" aria-label="Artifact types" class="rounded-[6px] border border-edge-bright bg-surface p-1 shadow-xl">
          <For each={ARTIFACT_STARTERS}>{(starter, index) => { const Icon = TYPE_ICONS[starter.template]; return <><Show when={index() === 1}><div class="mt-1 border-t border-edge px-2.5 pt-3 pb-1 font-mono text-[9px] uppercase tracking-[0.12em] text-faint">Templates</div></Show><button type="button" role="menuitem" disabled={busy()} class={ITEM} onClick={() => void createArtifact(starter.template)}><Icon size={14} class="shrink-0 text-muted group-hover:text-accent" aria-hidden="true" />{starter.label}</button></>; }}</For>
          <Show when={busy()}><p role="status" class="px-2.5 py-2 text-xs text-muted">Creating artifact…</p></Show>
          <Show when={error()}><p role="alert" class="px-2.5 py-2 text-xs text-danger">{error()}</p></Show>
        </div></div></Show>
      </div>
      <button type="button" role="menuitem" class={ITEM} onMouseEnter={() => setTypesOpen(false)} onClick={() => choose('folder')}><FolderPlus size={14} />Folder</button>
      <a role="menuitem" href="/programs/new" class={ITEM} onMouseEnter={() => setTypesOpen(false)}><FilePlus2 size={14} />Program</a>
      <div class="mt-1 border-t border-edge pt-1" onMouseEnter={() => setTypesOpen(false)}><span class="block px-2.5 pt-1.5 pb-1 font-mono text-[9.5px] uppercase tracking-[0.14em] text-faint">assets</span><a role="menuitem" href={props.parentId ? `/files/new?parent_id=${encodeURIComponent(props.parentId)}` : '/files/new'} class={ITEM}><FileUp size={14} />File</a><a role="menuitem" href="/datasets/new" class={ITEM}><DatabasePlus size={14} />Dataset</a></div>
    </div></Show>
    <Show when={dialog()}>{kind => <Portal mount={document.body}><DialogShell onClose={() => setDialog(null)} initialFocus="[autofocus]"><div class="fixed inset-0 z-[100] flex items-center justify-center p-3"><button type="button" aria-label="Close create dialog by clicking outside" onClick={() => setDialog(null)} class="absolute inset-0 bg-black/45" /><div role="dialog" aria-modal="true" aria-label="Create new folder" class="relative z-10 w-full max-w-md rounded-[9px] border border-edge-bright bg-surface shadow-2xl"><header class="flex items-center justify-between border-b border-edge p-4"><h2 class="font-mono text-sm font-semibold">New {kind()}</h2><button type="button" aria-label="Close create dialog" onClick={() => setDialog(null)}>×</button></header><form onSubmit={event => void createFolder(event)} class="p-5"><label for="workspace-folder-name" class="block font-mono text-xs">Folder name</label><input id="workspace-folder-name" autofocus required value={name()} onInput={event => setName(event.currentTarget.value)} class="mt-2 w-full rounded border border-edge bg-bg p-2 font-mono text-xs" /><Show when={error()}><p role="alert" class="text-danger">{error()}</p></Show><div class="mt-5 flex justify-end gap-2"><button type="button" onClick={() => setDialog(null)}>cancel</button><button type="submit" disabled={!name().trim() || busy()} class="rounded bg-accent px-3 py-1 text-bg">{busy() ? 'creating…' : 'create folder'}</button></div></form></div></div></DialogShell></Portal>}</Show>
  </div>;
}
