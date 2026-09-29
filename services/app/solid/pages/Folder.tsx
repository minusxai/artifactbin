/* @jsxImportSource solid-js */
import { createEffect, createMemo, createSignal, onCleanup, Show, type JSX } from 'solid-js';
import { useParams } from '@solidjs/router';
import ChevronRight from 'lucide-solid/icons/chevron-right';
import { writeBrowserArtifact } from '@/lib/browser-artifact-write';
import type { FolderPage as FolderData } from '@/lib/folders';
import type { ArtifactRole } from '@/lib/share-roles';
import { canEdit } from '@/lib/share-roles';
import type { AccountWorkspace } from '@/lib/workspace';
import { STORY_DATA_EVENT } from '@/lib/story-runtime/contract';
import { pageDataChanged } from '@/web/page-data-events';
import { takeBootstrap } from '@/web/bootstrap';
import { replaceDocument } from '../shared/document-navigation';
import { PAGE_COLUMN } from '../components/ui';
import Shelf from '../components/Shelf';
import WorkspaceLayout, { HOME_WORKSPACE_COLUMN } from '../components/WorkspaceLayout';
import { usePageData } from '../web/use-page-data';

interface FolderProps { folder: FolderData; role: ArtifactRole; workspace?: AccountWorkspace; ownerUsername?: string | null }
const NAME_TYPE = 'font-mono text-base leading-normal font-medium tracking-[-0.01em] text-fg';
const summaryOf = ({ documents, folders }: FolderData['count']) => [documents ? `${documents} document${documents === 1 ? '' : 's'}` : '', folders ? `${folders} folder${folders === 1 ? '' : 's'}` : ''].filter(Boolean).join(' and ');

export function FolderPage(props: FolderProps): JSX.Element {
  const [folder, setFolder] = createSignal(props.folder);
  const [workspace, setWorkspace] = createSignal(props.workspace);
  const [editing, setEditing] = createSignal(false);
  const [draft, setDraft] = createSignal('');
  const folderId = createMemo(() => folder().id);
  const mayWrite = () => canEdit(props.role);
  createEffect(() => { if (props.folder.id !== folder().id) { setFolder(props.folder); setWorkspace(props.workspace); } });
  const reread = () => {
    pageDataChanged();
    void fetch(`/api/page/artifact/${folder().id}`, { credentials: 'same-origin' })
      .then(response => response.ok ? response.json() as Promise<{ folder?: FolderData; workspace?: AccountWorkspace }> : null)
      .then(page => { if (page?.folder) setFolder(page.folder); if (page?.workspace) setWorkspace(page.workspace); })
      .catch(() => {});
  };
  createEffect(() => {
    const id = folderId();
    const source = new EventSource(`/a/${id}/events`);
    source.addEventListener(STORY_DATA_EVENT, reread);
    onCleanup(() => { source.removeEventListener(STORY_DATA_EVENT, reread); source.close(); });
  });
  const save = () => {
    const title = draft().trim();
    setEditing(false);
    if (!title || title === folder().title) return;
    const id = folder().id;
    setFolder(current => ({ ...current, title })); pageDataChanged();
    void writeBrowserArtifact(id, { title }).catch(() => {});
  };
  const contents = () => <>
    <header class="mb-6 border-b border-edge pb-4"><div class="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1"><nav aria-label="Folder trail" class="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-3 gap-y-1 font-mono"><a href={props.role !== 'owner' && props.ownerUsername ? `/@${props.ownerUsername}` : '/'} class={`${NAME_TYPE} text-muted no-underline hover:text-accent`}>{props.role !== 'owner' && props.ownerUsername ? `@${props.ownerUsername}` : 'Home'}</a><ForTrail folder={folder()} /><ChevronRight size={14} aria-hidden="true" class="shrink-0 self-center text-faint" /><h1 aria-current="page" class="m-0 min-w-0 break-words"><Show when={editing()} fallback={<Show when={mayWrite()} fallback={<span class={NAME_TYPE}>{folder().title ?? 'Untitled folder'}</span>}><button type="button" aria-label="Rename folder" onClick={() => { setDraft(folder().title ?? ''); setEditing(true); }} class={`${NAME_TYPE} cursor-text border-b border-transparent bg-transparent p-0 text-left hover:border-edge-bright`}>{folder().title ?? 'Untitled folder'}</button></Show>}><input aria-label="Folder name" autofocus value={draft()} onInput={event => setDraft(event.currentTarget.value)} onBlur={save} onKeyDown={event => { if (event.key === 'Enter') save(); if (event.key === 'Escape') setEditing(false); }} class={`${NAME_TYPE} w-full min-w-0 border-b border-accent bg-transparent p-0 focus:outline-none`} /></Show></h1></nav><Show when={summaryOf(folder().count)}><p class="m-0 shrink-0 font-sans text-sm text-muted">{summaryOf(folder().count)}</p></Show></div></header>
    <Show when={folder().rows.length === 0}><div aria-label="Empty folder" class="mb-5 rounded-[6px] border border-dashed border-edge px-4 py-6"><p class="m-0 font-sans text-sm text-fg">Nothing here yet.</p><Show when={mayWrite()}><p class="m-0 mt-1 font-sans text-sm text-muted">Move a document in from its ⋯ menu, or give your agent <code class="rounded-sm bg-raised px-1 py-0.5 font-mono text-[0.9em] text-fg">parent_id: &quot;{folder().id}&quot;</code> when it publishes.</p></Show></div></Show>
    <Shelf rows={workspace()?.artifacts.map(row => ({ ...row, sparkline: row.sparkline ?? undefined })) ?? folder().rows} actions={mayWrite() ? 'full' : 'share'} canCreateFolders={mayWrite() && !workspace()} parentId={folder().id} scopeParentId={folder().id} assets={false} />
  </>;
  return <main aria-label="Folder" class={`${workspace() ? HOME_WORKSPACE_COLUMN : PAGE_COLUMN} mt-8 pb-24`}>
    <Show when={workspace()} fallback={contents()}>{owned => <WorkspaceLayout workspace={owned()} parentId={folder().id} onCreated={reread} label="Folder workspace">{contents()}</WorkspaceLayout>}</Show>
  </main>;
}

function ForTrail(props: { folder: FolderData }): JSX.Element {
  return <>{props.folder.trail.map(crumb => <span class="flex min-w-0 items-baseline gap-x-3"><ChevronRight size={14} aria-hidden="true" class="shrink-0 self-center text-faint" /><a href={crumb.url} class={`${NAME_TYPE} text-muted no-underline hover:text-accent`}>{crumb.title ?? crumb.id}</a></span>)}</>;
}

interface ArtifactAnswer { folder?: FolderData; role: ArtifactRole; workspace?: AccountWorkspace; ownerUsername?: string | null; surface?: unknown }
/** The server chose this entry after admitting a folder. A client link to a document crosses entries. */
export function FolderRoute(): JSX.Element {
  const params = useParams<{ id: string }>();
  const initial = takeBootstrap<ArtifactAnswer>(window.location.pathname, 'artifact');
  const url = () => `/api/page/artifact/${params.id ?? initial?.folder?.id ?? ''}`;
  const page = usePageData<ArtifactAnswer>(url, { seed: () => initial });
  createEffect(() => { if (page.data()?.surface) replaceDocument(window.location.pathname + window.location.search + window.location.hash); });
  return <Show when={page.data()?.folder} fallback={<main aria-label="Loading folder" class={`${PAGE_COLUMN} mt-8 pb-24`}><Show when={page.error()} fallback="Loading folder…"><button type="button" aria-label="Retry folder" onClick={() => void page.refresh(true)}>Could not load folder. Retry</button></Show></main>}>
    {folder => <FolderPage folder={folder()} role={page.data()!.role} workspace={page.data()?.workspace} ownerUsername={page.data()?.ownerUsername} />}
  </Show>;
}
