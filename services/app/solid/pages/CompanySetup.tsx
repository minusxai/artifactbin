/* @jsxImportSource solid-js */
import { createSignal, Show, type JSX } from 'solid-js';
import type { DeploymentState, GroupSummary } from '@artifactbin/contracts';
import { Button } from '../ui/Button';
import { Field } from '../ui/Field';
import { Select } from '../ui/Select';
import { StatusMessage } from '../ui/StatusMessage';
import { CreateGroup } from './Groups';
import { apiRequest } from '../lib/api';
import { usePageData } from '../lib/use-page-data';
export function CompanySetup(props:{deployment:DeploymentState;complete:()=>void}):JSX.Element {
 const groups=usePageData<{groups:GroupSummary[]}>('/api/groups',{enabled:()=>props.deployment.is_owner});
 const [selected,setSelected]=createSignal(''); const [error,setError]=createSignal('');const [busy,setBusy]=createSignal(false);
 const options=()=>(groups.data()?.groups??[]).filter(group=>group.role==='editor').map(group=>({value:group.id,label:group.name}));
 const confirm=async()=>{if(!selected()||busy())return;setBusy(true);setError('');try{await apiRequest('/api/deployment/setup','POST',{group_id:selected()});props.complete();}catch(err){setError(err instanceof Error?err.message:'Could not finish setup.');}finally{setBusy(false);}};
 return <main class="mx-auto my-10 max-w-2xl rounded-dialog border border-edge bg-surface p-6 font-sans sm:p-10"><h1 class="text-3xl font-semibold tracking-tight">Set up your company workspace</h1><Show when={props.deployment.is_owner} fallback={<StatusMessage kind="notice" class="mt-6">Your deployment owner needs to finish setup before you can continue.</StatusMessage>}><p class="my-4 text-sm leading-relaxed text-muted">Choose the group everyone starts in. Confirm to open the deployment.</p><Show when={groups.error()}><StatusMessage kind="error" action={<Button variant="secondary" type="button" onClick={()=>void groups.refresh(true)}>Retry groups</Button>}>Could not load groups.</StatusMessage></Show><Field label="Company group" class="my-6"><Select value={selected()} options={options()} placeholder="Choose a group" onChange={setSelected}/></Field><CreateGroup created={group=>{setSelected(group.id);void groups.refresh(true);}}/><p class="text-sm leading-relaxed text-muted">New accounts join as viewers unless invited as editors.</p><Show when={error()}><StatusMessage kind="error" class="mt-3">{error()}</StatusMessage></Show><Button class="mt-5 w-full" type="button" disabled={!selected()||busy()} onClick={()=>void confirm()}>Confirm company setup</Button></Show></main>;
}
