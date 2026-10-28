/* @jsxImportSource solid-js */
import { createSignal, Show, type JSX } from 'solid-js';
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
import { pageDataChanged } from '@/solid/lib/page-data-events';
import { ARTIFACT_STARTERS, artifactStarter,type ArtifactStarterTemplate } from '@/lib/workspace/artifact-starters';
import { openDocument } from '../lib/document-navigation';
import { Button } from '../ui/Button';
import { Dialog } from '../ui/Dialog';
import { Field, Input } from '../ui/Field';
import { Menu, type MenuEntry } from '../ui/Menu';
import HtmlUpload from './HtmlUpload';
import { apiFetch } from '../lib/api';

const TYPE_ICONS = { doc: FileText, editorial: Newspaper, deck: Presentation, dashboard: LayoutDashboard, plan: ListChecks, landing: PanelTop, scrolly: ScrollText, app: AppWindow } satisfies Record<ArtifactStarterTemplate, typeof FileText>;
export default function WorkspaceCreate(props: { onCreated: () => void; parentId?: string | null; groupId?: string; personal?: boolean }): JSX.Element {
  const [uploadHtml, setUploadHtml] = createSignal(false);
  const [dialog, setDialog] = createSignal(false);
  const [name, setName] = createSignal('');
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal('');
  const choose = () => { setError(''); setDialog(true); };
  const creationHref = (path:string) => { const params=new URLSearchParams();if(props.parentId)params.set('parent_id',props.parentId);if(props.groupId)params.set('group_id',props.groupId);else if(props.personal)params.set('personal','1');return `${path}${params.size?'?'+params.toString():''}`;};
  const createArtifact = async (template: ArtifactStarterTemplate) => {
    if (busy()) return;
    setBusy(true); setError('');
    try {
      const response = await apiFetch('/api/my/artifacts', 'POST', { ...artifactStarter(template, props.parentId), ...(props.groupId ? {destination:{type:'group',id:props.groupId}} : props.personal ? {destination:{type:'personal'}} : {}) });
      if (!response.ok) throw new Error('create failed');
      const body = await response.json() as { id?: string };
      if (!body.id) throw new Error('missing artifact');
      pageDataChanged();
      // Browser Back can restore this exact component from the page cache.
      setBusy(false);
      openDocument(`/a/${encodeURIComponent(body.id)}`);
    } catch { setError('Could not create the artifact. Try again.'); setBusy(false); }
  };
  const createFolder = async (event: SubmitEvent) => {
    event.preventDefault();
    const title = name().trim(); if (!title || busy()) return;
    setBusy(true); setError('');
    const response = await apiFetch('/api/my/artifacts', 'POST', { format: 'folder', title, parent_id: props.parentId ?? null, ...(props.groupId ? {destination:{type:'group',id:props.groupId}} : props.personal ? {destination:{type:'personal'}} : {}) }).catch(() => null);
    setBusy(false);
    if (!response?.ok) { setError('Could not create the folder. Try again.'); return; }
    pageDataChanged(); props.onCreated(); setDialog(false); setName('');
  };
  const starterItem = (starter: (typeof ARTIFACT_STARTERS)[number]) => { const Icon = TYPE_ICONS[starter.template]; return { label: starter.label, text: starter.label, icon: () => <Icon size={14} class="shrink-0 text-muted" aria-hidden="true" />, disabled: busy(), onSelect: () => void createArtifact(starter.template) }; };
  const entries = (): MenuEntry[] => [
    { label: 'Artifact', text: 'Artifact', icon: () => <FilePlus2 size={14} />, items: [starterItem(ARTIFACT_STARTERS[0]!), { section: 'Templates', items: ARTIFACT_STARTERS.slice(1).map(starterItem) }] },
    { label: 'Upload HTML', text: 'Upload HTML', icon: () => <FileUp size={14} />, onSelect: () => setUploadHtml(true) },
    { label: 'Folder', text: 'Folder', icon: () => <FolderPlus size={14} />, onSelect: choose },
    { section: 'assets', items: [
      { label: 'File', text: 'File', icon: () => <FileUp size={14} />, href: creationHref('/files/new') },
      { label: 'Dataset', text: 'Dataset', icon: () => <DatabasePlus size={14} />, href: creationHref('/datasets/new') },
    ] },
  ];
  return <div class="workspace-create relative z-30">
    <Menu label="Create menu" width="trigger" align="start" items={entries()} trigger={(attrs) =>
      <Button {...attrs} aria-label="Create" class="w-full" onClick={() => { setError(''); attrs.onClick(); }}><Plus size={15} /><span>Create</span><ChevronDown size={14} class="ml-auto" /></Button>} />
    <Show when={!dialog() && busy()}><p role="status" class="mt-2 text-xs text-muted">Creating artifact…</p></Show>
    <Show when={!dialog() && error()}><p role="alert" class="mt-2 text-xs text-danger">{error()}</p></Show>
    <Show when={uploadHtml()}><HtmlUpload parentId={props.parentId} destination={props.groupId ? {type:'group',id:props.groupId} : props.personal ? {type:'personal'} : undefined} onClose={() => setUploadHtml(false)} /></Show>
    <Show when={dialog()}><Dialog title="Create new folder" busy={busy()} onClose={() => setDialog(false)} initialFocus="[autofocus]"
      footer={<><Button variant="secondary" onClick={() => setDialog(false)}>cancel</Button><Button type="submit" form="workspace-folder-form" disabled={!name().trim() || busy()}>{busy() ? 'creating…' : 'create folder'}</Button></>}>
      <form id="workspace-folder-form" onSubmit={event => void createFolder(event)} class="grid gap-3">
        <Field label="Folder name"><Input autofocus required value={name()} onInput={event => setName(event.currentTarget.value)} /></Field>
        <Show when={error()}><p role="alert" class="text-sm text-danger">{error()}</p></Show>
      </form>
    </Dialog></Show>
  </div>;
}
