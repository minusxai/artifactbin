/* @jsxImportSource solid-js */
import {createSignal,For,Show,type JSX} from 'solid-js';
import {Portal} from 'solid-js/web';
import type {ArtifactDestination,GroupSummary} from '@artifactbin/contracts';
import {trustedPortalOf} from '@/lib/islands/trusted-portal';
import {apiRequest} from '../lib/api';
import {usePageData} from '../lib/use-page-data';
import {DialogShell} from '../ui/DialogShell';
import {Button} from '../ui/ui';
/** Ownership transfer is separate from folder placement. The server authorizes the complete move. */
export function TransferOwnershipDialog(props:{id:string;title:string;currentGroupId?:string|null;onClose:()=>void;onTransferred:(destination:ArtifactDestination)=>void}):JSX.Element {
 const groups=usePageData<{groups:GroupSummary[]}>('/api/groups');
 const [selected,setSelected]=createSignal('');const [busy,setBusy]=createSignal(false);const [error,setError]=createSignal('');
 const choices=()=>groups.data()?.groups.filter(group=>group.role==='editor'&&group.id!==props.currentGroupId)??[];
 const destination=():ArtifactDestination=>selected()==='personal'?{type:'personal'}:{type:'group',id:selected()};
 const close=()=>{if(!busy())props.onClose();};
 const transfer=async()=>{if(!selected()||busy())return;setBusy(true);setError('');try{const next=destination();await apiRequest(`/api/artifacts/${encodeURIComponent(props.id)}/transfer`,'POST',{destination:next});props.onTransferred(next);}catch(err){setError(err instanceof Error?err.message:'Could not transfer ownership.');}finally{setBusy(false);}};
 return <Portal mount={trustedPortalOf(document) ?? undefined}><DialogShell onClose={close} lockScroll initialFocus="select"><div role="dialog" aria-modal="true" aria-label={`Transfer ownership of ${props.title}`} class="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4"><div class="w-full max-w-lg rounded-lg border border-edge bg-surface p-5 shadow-lg"><h2 class="text-lg font-semibold">Transfer ownership of {props.title}</h2><p class="mt-2 text-sm text-muted">The selected group or your Personal workspace becomes the owner. This changes who can manage the artifact. Moving between folders keeps its current owner.</p><Show when={groups.pending()}><p role="status">Loading destinations…</p></Show><Show when={groups.error()}><p role="alert">Could not load groups. <button type="button" onClick={()=>void groups.refresh(true)}>Retry destinations</button></p></Show><label class="mt-4 block text-sm">New owner<select class="mt-2 w-full rounded border border-edge bg-bg p-2" value={selected()} disabled={busy()} onChange={e=>setSelected(e.currentTarget.value)}><option value="">Choose a destination</option><Show when={props.currentGroupId}><option value="personal">Personal</option></Show><For each={choices()}>{group=><option value={group.id}>{group.name}</option>}</For></select></label><Show when={selected()}><p class="mt-3 text-sm">Confirm to transfer this artifact to {selected()==='personal'?'Personal':choices().find(group=>group.id===selected())?.name}.</p></Show><Show when={error()}><p class="mt-3 text-sm text-danger" role="alert">{error()}</p></Show><div class="mt-5 flex justify-end gap-3"><Button variant="ghost" disabled={busy()} onClick={close}>Cancel</Button><Button aria-label="Confirm ownership transfer" disabled={!selected()||busy()} onClick={()=>void transfer()}>{busy()?'Transferring…':'Confirm transfer'}</Button></div></div></div></DialogShell></Portal>;
}
