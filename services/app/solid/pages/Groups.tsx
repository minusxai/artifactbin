/* @jsxImportSource solid-js */
import { createSignal, For, Show, type JSX } from 'solid-js';
import type { GroupDetail, GroupSummary } from '@artifactbin/contracts';
import { usePageData } from '../lib/use-page-data';
import { apiRequest } from '../lib/api';
export function CreateGroup(props:{created:(group:GroupSummary)=>void}):JSX.Element {
 const [name,setName]=createSignal('');const [handle,setHandle]=createSignal('');const [error,setError]=createSignal('');const [busy,setBusy]=createSignal(false);
 return <form class="my-6 space-y-3" onSubmit={async e=>{e.preventDefault();if(busy())return;setBusy(true);setError('');try{const result=await apiRequest<GroupDetail|GroupSummary>('/api/groups','POST',{name:name(),handle:handle()});props.created('group' in result?result.group:result);}catch(err){setError(err instanceof Error?err.message:'Could not create group.');}finally{setBusy(false);}}}><h2 class="text-lg">Create a group</h2><label class="block">Group name<input class="ml-3 rounded border border-edge p-2" required value={name()} onInput={e=>setName(e.currentTarget.value)}/></label><label class="block">Group handle<input class="ml-3 rounded border border-edge p-2" required value={handle()} onInput={e=>setHandle(e.currentTarget.value)}/></label><Show when={error()}><p role="alert">{error()}</p></Show><button type="submit" disabled={busy()}>Create group</button></form>;
}
export function GroupsPage():JSX.Element {
 const page=usePageData<{groups:GroupSummary[]}>('/api/groups');
 return <main class="workspace-page"><h1 class="text-3xl">Groups</h1><Show when={page.error()}><p role="alert">Could not load groups. <button type="button" onClick={()=>void page.refresh(true)}>Retry</button></p></Show><ul class="mt-6"><For each={page.data()?.groups}>{group=><li class="py-3"><a href={`/@${group.handle}`}>{group.name}</a><span class="ml-3 text-muted">{group.role}</span></li>}</For></ul><CreateGroup created={group=>window.location.assign(`/@${group.handle}`)}/></main>;
}
