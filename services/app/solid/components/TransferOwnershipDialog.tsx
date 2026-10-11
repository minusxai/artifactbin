/* @jsxImportSource solid-js */
import {createSignal,Show,type JSX} from 'solid-js';
import type {ArtifactDestination,GroupSummary} from '@artifactbin/contracts';
import {apiRequest} from '../lib/api';
import {usePageData} from '../lib/use-page-data';
import {Dialog} from '../ui/Dialog';
import {Button} from '../ui/Button';
import {Field} from '../ui/Field';
import {Select} from '../ui/Select';
import {StatusMessage} from '../ui/StatusMessage';
/** Ownership transfer is separate from folder placement. The server authorizes the complete move. */
export function TransferOwnershipDialog(props:{id:string;title:string;currentGroupId?:string|null;onClose:()=>void;onTransferred:(destination:ArtifactDestination)=>void}):JSX.Element {
 const groups=usePageData<{groups:GroupSummary[]}>('/api/groups');
 const [selected,setSelected]=createSignal('');const [busy,setBusy]=createSignal(false);const [error,setError]=createSignal('');
 const choices=()=>groups.data()?.groups.filter(group=>group.role==='editor'&&group.id!==props.currentGroupId)??[];
 const options=()=>[...(props.currentGroupId?[{value:'personal',label:'Personal'}]:[]),...choices().map(group=>({value:group.id,label:group.name}))];
 const destination=():ArtifactDestination=>selected()==='personal'?{type:'personal'}:{type:'group',id:selected()};
 const transfer=async()=>{if(!selected()||busy())return;setBusy(true);setError('');try{const next=destination();await apiRequest(`/api/artifacts/${encodeURIComponent(props.id)}/transfer`,'POST',{destination:next});props.onTransferred(next);}catch(err){setError(err instanceof Error?err.message:'Could not transfer ownership.');}finally{setBusy(false);}};
 return <Dialog size="md" lockScroll busy={busy()} onClose={props.onClose} title={`Transfer ownership of ${props.title}`}
  description="The selected group or your Personal workspace becomes the owner. This changes who can manage the artifact. Moving between folders keeps its current owner."
  footer={<><Button variant="secondary" disabled={busy()} onClick={props.onClose}>Cancel</Button><Button aria-label="Confirm ownership transfer" disabled={!selected()||busy()} onClick={()=>void transfer()}>{busy()?'Transferring…':'Confirm transfer'}</Button></>}>
  <Show when={groups.pending()}><StatusMessage kind="loading" class="mb-3">Loading destinations…</StatusMessage></Show>
  <Show when={groups.error()}><StatusMessage kind="error" class="mb-3" action={<Button variant="link" type="button" onClick={()=>void groups.refresh(true)}>Retry destinations</Button>}>Could not load groups.</StatusMessage></Show>
  <Field label="New owner"><Select value={selected()} options={options()} placeholder="Choose a destination" disabled={busy()} onChange={setSelected}/></Field>
  <Show when={selected()}><p class="mt-3 text-sm">Confirm to transfer this artifact to {selected()==='personal'?'Personal':choices().find(group=>group.id===selected())?.name}.</p></Show>
  <Show when={error()}><p class="mt-3 text-sm text-danger" role="alert">{error()}</p></Show>
 </Dialog>;
}
