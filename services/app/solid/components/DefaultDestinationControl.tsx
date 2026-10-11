/* @jsxImportSource solid-js */
import { createSignal, Show, type JSX } from 'solid-js';
import type { AccountPreferences, DefaultDestination, DeploymentState } from '@artifactbin/contracts';
import Check from 'lucide-solid/icons/check';
import { apiRequest } from '../lib/api';
import { usePageData } from '../lib/use-page-data';
import { FORM_SECONDARY_BUTTON } from '../ui/FormControls';

/** One account preference, shared with Home's resource. A reset chooses Personal even on a company host. */
export function DefaultDestinationControl(props:{group?:{id:string;name:string}}):JSX.Element {
 const preferences=usePageData<AccountPreferences>('/api/me/preferences');
 const deployment=usePageData<DeploymentState>('/api/deployment');
 const [busy,setBusy]=createSignal(false);
 const [error,setError]=createSignal('');
 const [message,setMessage]=createSignal('');
 const ready=()=>!!preferences.data()&&!!deployment.data();
 const effectiveGroup=()=>{const destination=preferences.data()?.default_destination;return destination?.type==='group'?destination.id:destination?.type==='personal'?null:deployment.data()?.default_group?.id??null;};
 const selected=()=>ready()&&(props.group?effectiveGroup()===props.group.id:effectiveGroup()===null);
 const save=async(destination:DefaultDestination)=>{
  if(busy()||!ready())return;
  setBusy(true);setError('');setMessage('');
  try{
   const saved=await apiRequest<AccountPreferences>('/api/me/preferences','PUT',{default_destination:destination});
   preferences.seed(saved);
   setMessage(destination.type==='group'?`${props.group!.name} is now your default. New artifacts will be published here.`:'Personal is now your default. Existing artifacts stay where they are.');
  }catch(err){setError(err instanceof Error?err.message:'Could not save your default. Try again.');}
  finally{setBusy(false);}
 };
 return <div class="default-destination">
  <div class="flex flex-wrap items-center gap-3">
   <Show when={selected()} fallback={<button type="button" class={FORM_SECONDARY_BUTTON} disabled={!ready()||busy()} onClick={()=>void save(props.group?{type:'group',id:props.group.id}:{type:'personal'})}>{busy()?'Saving…':props.group?'Set as default':'Set Personal as default'}</button>}>
    <span class="default-destination-badge"><Check size={16} aria-hidden="true"/>{props.group?'Default group':'Personal is your default'}</span>
    <Show when={props.group}><button type="button" class={FORM_SECONDARY_BUTTON} disabled={busy()} onClick={()=>void save({type:'personal'})}>{busy()?'Saving…':'Remove default'}</button></Show>
   </Show>
  </div>
  <p class="mt-2 max-w-lg text-sm leading-relaxed text-muted">{props.group?(selected()?'Your homepage and new artifacts start here. Remove the default to use Personal.':'Make this group your homepage and the default for new artifacts.'):'Choose where your homepage opens and new artifacts are published.'}</p>
  <Show when={message()}><p role="status" class="mt-2 text-sm text-accent">{message()}</p></Show>
  <Show when={error()}><p role="alert" class="mt-2 text-sm text-danger">{error()}</p></Show>
  <Show when={preferences.error()||deployment.error()}><div role="alert" class="mt-2 text-sm text-danger">Could not load your default. <button type="button" class="font-semibold underline underline-offset-4" onClick={()=>{void preferences.refresh(true);void deployment.refresh(true);}}>Retry</button></div></Show>
 </div>;
}
