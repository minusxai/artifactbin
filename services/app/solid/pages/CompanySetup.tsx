/* @jsxImportSource solid-js */
import { createSignal, For, Show, type JSX } from 'solid-js';
import type { DeploymentState, GroupSummary } from '@artifactbin/contracts';
import { CreateGroup } from './Groups';
import { apiRequest } from '../lib/api';
import { usePageData } from '../lib/use-page-data';
export function CompanySetup(props:{deployment:DeploymentState;complete:()=>void}):JSX.Element {
 const groups=usePageData<{groups:GroupSummary[]}>('/api/groups',{enabled:()=>props.deployment.is_owner});
 const [selected,setSelected]=createSignal(''); const [error,setError]=createSignal('');const [busy,setBusy]=createSignal(false);
 const confirm=async()=>{if(!selected()||busy())return;setBusy(true);setError('');try{await apiRequest('/api/deployment/setup','POST',{group_id:selected()});props.complete();}catch(err){setError(err instanceof Error?err.message:'Could not finish setup.');}finally{setBusy(false);}};
 return <main class="mx-auto max-w-3xl px-6 py-12"><h1 class="text-3xl">Set up your company workspace</h1><Show when={props.deployment.is_owner} fallback={<p role="status" class="mt-6">Your deployment owner needs to finish setup before you can continue.</p>}><p class="my-4">Choose the group everyone starts in. Confirm to open the deployment.</p><Show when={groups.error()}><p role="alert">Could not load groups. <button onClick={()=>void groups.refresh(true)}>Retry groups</button></p></Show><label>Company group<select class="ml-3 rounded border border-edge p-2" value={selected()} onChange={e=>setSelected(e.currentTarget.value)}><option value="">Choose a group</option><For each={groups.data()?.groups.filter(group=>group.role==='editor')}>{group=><option value={group.id}>{group.name}</option>}</For></select></label><CreateGroup created={group=>{setSelected(group.id);void groups.refresh(true);}}/><p>New accounts join as viewers unless invited as editors.</p><Show when={error()}><p role="alert">{error()}</p></Show><button class="mt-4" type="button" disabled={!selected()||busy()} onClick={()=>void confirm()}>Confirm company setup</button></Show></main>;
}
