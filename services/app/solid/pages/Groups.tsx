/* @jsxImportSource solid-js */
import { createSignal, For, Show, type JSX } from 'solid-js';
import type { GroupDetail, GroupSummary } from '@artifactbin/contracts';
import Users from 'lucide-solid/icons/users';
import ChevronRight from 'lucide-solid/icons/chevron-right';
import Plus from 'lucide-solid/icons/plus';
import { usePageData } from '../lib/use-page-data';
import { apiRequest } from '../lib/api';
import WorkspaceHeading from '../components/WorkspaceHeading';
import { Button } from '../ui/Button';
import { Field, Input } from '../ui/Field';
import { SectionHeading } from '../ui/PageHeader';
import { StatusMessage } from '../ui/StatusMessage';
import { Badge } from '../ui/ui';

export function CreateGroup(props:{created:(group:GroupSummary)=>void}):JSX.Element {
 const [name,setName]=createSignal('');const [handle,setHandle]=createSignal('');const [error,setError]=createSignal('');const [busy,setBusy]=createSignal(false);
 return <form class="group-create-form" onSubmit={async e=>{e.preventDefault();if(busy())return;setBusy(true);setError('');try{const result=await apiRequest<GroupDetail|GroupSummary>('/api/groups','POST',{name:name(),handle:handle()});props.created('group' in result?result.group:result);}catch(err){setError(err instanceof Error?err.message:'Could not create group.');}finally{setBusy(false);}}}>
  <div><SectionHeading>Create a group</SectionHeading><p class="mt-2 text-sm leading-relaxed text-muted">A shared place for your team’s files, folders and people.</p></div>
  <Field label="Group name"><Input required placeholder="e.g. Design team" value={name()} onInput={e=>setName(e.currentTarget.value)}/></Field>
  <Field label="Group handle" hint={<span class="break-all">Your group’s address: /@{handle()||'group-handle'}</span>}><Input required placeholder="e.g. design-team" value={handle()} onInput={e=>setHandle(e.currentTarget.value)}/></Field>
  <Show when={error()}><StatusMessage kind="error">{error()}</StatusMessage></Show>
  <Button type="submit" disabled={busy()}><Plus size={16} aria-hidden="true"/>{busy()?'Creating…':'Create group'}</Button>
 </form>;
}
export function GroupsPage():JSX.Element {
 const page=usePageData<{groups:GroupSummary[]}>('/api/groups');
 return <main class="workspace-page groups-page">
  <WorkspaceHeading title="Groups" description="Work together in shared spaces. Each group has its own people, files and folders."/>
  <div class="groups-overview">
   <section aria-label="Your groups" class="min-w-0">
    <div class="mb-4 flex items-center justify-between"><SectionHeading>Your groups</SectionHeading><Show when={page.data()}><span class="text-sm text-muted">{page.data()!.groups.length}</span></Show></div>
    <Show when={page.error()}><StatusMessage kind="error" action={<Button variant="secondary" type="button" onClick={()=>void page.refresh(true)}>Retry</Button>}>Could not load groups.</StatusMessage></Show>
    <Show when={page.data()} fallback={<Show when={!page.error()}><StatusMessage kind="loading">Loading groups…</StatusMessage></Show>}>
     <Show when={page.data()!.groups.length} fallback={<div class="group-empty"><Users size={28} aria-hidden="true"/><h3 class="mt-4 font-semibold text-fg">Your team starts here</h3><p class="mt-2 max-w-sm text-sm leading-relaxed">Create a group, then invite people to read or contribute. Groups you join will appear here.</p></div>}>
      <ul class="group-directory"><For each={page.data()!.groups}>{group=><li><a class="group-directory-link" href={`/@${group.handle}`}><span class="group-avatar" aria-hidden="true"><Users size={22}/></span><span class="min-w-0 flex-1"><span class="block truncate font-semibold">{group.name}</span><span class="mt-1 block truncate text-sm text-muted">@{group.handle}</span></span><Badge>{group.role==='editor'?'Editor':'Viewer'}</Badge><ChevronRight size={18} aria-hidden="true" class="text-muted"/></a></li>}</For></ul>
     </Show>
    </Show>
   </section>
   <aside><CreateGroup created={group=>window.location.assign(`/@${group.handle}`)}/></aside>
  </div>
 </main>;
}
