/* @jsxImportSource solid-js */
import { createSignal, For, Show, type JSX } from 'solid-js';
import type { GroupDetail, GroupSummary } from '@artifactbin/contracts';
import Users from 'lucide-solid/icons/users';
import ChevronRight from 'lucide-solid/icons/chevron-right';
import Plus from 'lucide-solid/icons/plus';
import { usePageData } from '../lib/use-page-data';
import { apiRequest } from '../lib/api';
import WorkspaceHeading from '../components/WorkspaceHeading';
import { FORM_INPUT, FORM_PRIMARY_BUTTON, FORM_SECONDARY_BUTTON } from '../ui/FormControls';

export function CreateGroup(props:{created:(group:GroupSummary)=>void}):JSX.Element {
 const [name,setName]=createSignal('');const [handle,setHandle]=createSignal('');const [error,setError]=createSignal('');const [busy,setBusy]=createSignal(false);
 return <form class="group-create-form" onSubmit={async e=>{e.preventDefault();if(busy())return;setBusy(true);setError('');try{const result=await apiRequest<GroupDetail|GroupSummary>('/api/groups','POST',{name:name(),handle:handle()});props.created('group' in result?result.group:result);}catch(err){setError(err instanceof Error?err.message:'Could not create group.');}finally{setBusy(false);}}}>
  <div><h2 class="text-lg font-semibold">Create a group</h2><p class="mt-2 text-sm leading-relaxed text-muted">A shared place for your team’s files, folders and people.</p></div>
  <label class="grid gap-2 text-sm font-medium">Group name<input class={FORM_INPUT} required placeholder="e.g. Design team" value={name()} onInput={e=>setName(e.currentTarget.value)}/></label>
  <label class="grid gap-2 text-sm font-medium">Group handle<input class={FORM_INPUT} required aria-label="Group handle" aria-describedby="group-handle-help" placeholder="e.g. design-team" value={handle()} onInput={e=>setHandle(e.currentTarget.value)}/><span id="group-handle-help" class="break-all text-xs font-normal text-muted">Your group’s address: /@{handle()||'group-handle'}</span></label>
  <Show when={error()}><p role="alert" class="text-sm text-danger">{error()}</p></Show>
  <button type="submit" class={FORM_PRIMARY_BUTTON} disabled={busy()}><Plus size={16} aria-hidden="true"/>{busy()?'Creating…':'Create group'}</button>
 </form>;
}
export function GroupsPage():JSX.Element {
 const page=usePageData<{groups:GroupSummary[]}>('/api/groups');
 return <main class="workspace-page groups-page">
  <WorkspaceHeading title="Groups" description="Work together in shared spaces. Each group has its own people, files and folders."/>
  <div class="groups-overview">
   <section aria-label="Your groups" class="min-w-0">
    <div class="mb-4 flex items-center justify-between"><h2 class="text-base font-semibold">Your groups</h2><Show when={page.data()}><span class="text-sm text-muted">{page.data()!.groups.length}</span></Show></div>
    <Show when={page.error()}><div role="alert" class="group-panel space-y-3"><p>Could not load groups.</p><button class={FORM_SECONDARY_BUTTON} type="button" onClick={()=>void page.refresh(true)}>Retry</button></div></Show>
    <Show when={page.data()} fallback={<Show when={!page.error()}><p role="status" class="group-panel text-sm text-muted">Loading groups…</p></Show>}>
     <Show when={page.data()!.groups.length} fallback={<div class="group-empty"><Users size={28} aria-hidden="true"/><h3 class="mt-4 font-semibold text-fg">Your team starts here</h3><p class="mt-2 max-w-sm text-sm leading-relaxed">Create a group, then invite people to read or contribute. Groups you join will appear here.</p></div>}>
      <ul class="group-directory"><For each={page.data()!.groups}>{group=><li><a class="group-directory-link" href={`/@${group.handle}`}><span class="group-avatar" aria-hidden="true"><Users size={22}/></span><span class="min-w-0 flex-1"><span class="block truncate font-semibold">{group.name}</span><span class="mt-1 block truncate text-sm text-muted">@{group.handle}</span></span><span class="group-role">{group.role==='editor'?'Editor':'Viewer'}</span><ChevronRight size={18} aria-hidden="true" class="text-muted"/></a></li>}</For></ul>
     </Show>
    </Show>
   </section>
   <aside><CreateGroup created={group=>window.location.assign(`/@${group.handle}`)}/></aside>
  </div>
 </main>;
}
