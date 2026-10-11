/* @jsxImportSource solid-js */
import { createSignal, For, Show, type JSX } from 'solid-js';
import type { DeploymentState, GroupSummary } from '@artifactbin/contracts';
import { FORM_INPUT, FORM_PRIMARY_BUTTON, FORM_SECONDARY_BUTTON } from '../ui/FormControls';
import { CreateGroup } from './Groups';
import { apiRequest } from '../lib/api';
import { usePageData } from '../lib/use-page-data';
export function CompanySetup(props:{deployment:DeploymentState;complete:()=>void}):JSX.Element {
 const groups=usePageData<{groups:GroupSummary[]}>('/api/groups',{enabled:()=>props.deployment.is_owner});
 const [selected,setSelected]=createSignal(''); const [error,setError]=createSignal('');const [busy,setBusy]=createSignal(false);
 const confirm=async()=>{if(!selected()||busy())return;setBusy(true);setError('');try{await apiRequest('/api/deployment/setup','POST',{group_id:selected()});props.complete();}catch(err){setError(err instanceof Error?err.message:'Could not finish setup.');}finally{setBusy(false);}};
 return <main class="mx-auto my-10 max-w-2xl rounded-xl border border-edge bg-surface p-6 font-sans sm:p-10"><h1 class="text-3xl font-semibold tracking-tight">Set up your company workspace</h1><Show when={props.deployment.is_owner} fallback={<p role="status" class="mt-6">Your deployment owner needs to finish setup before you can continue.</p>}><p class="my-4 text-sm leading-relaxed text-muted">Choose the group everyone starts in. Confirm to open the deployment.</p><Show when={groups.error()}><p role="alert">Could not load groups. <button class={FORM_SECONDARY_BUTTON} onClick={()=>void groups.refresh(true)}>Retry groups</button></p></Show><label class="my-6 grid gap-2 text-sm font-medium">Company group<select class={FORM_INPUT} value={selected()} onChange={e=>setSelected(e.currentTarget.value)}><option value="" selected={!selected()}>Choose a group</option><For each={groups.data()?.groups.filter(group=>group.role==='editor')}>{group=><option value={group.id} selected={selected()===group.id}>{group.name}</option>}</For></select></label><CreateGroup created={group=>{setSelected(group.id);void groups.refresh(true);}}/><p class="text-sm leading-relaxed text-muted">New accounts join as viewers unless invited as editors.</p><Show when={error()}><p role="alert">{error()}</p></Show><button class={`${FORM_PRIMARY_BUTTON} mt-5 w-full`} type="button" disabled={!selected()||busy()} onClick={()=>void confirm()}>Confirm company setup</button></Show></main>;
}
