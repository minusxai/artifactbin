/** One inert receiver. The offer stays in memory through authentication and recoverable writes. */
import {createSignal,Show,onCleanup,type JSX} from 'solid-js';
import {PREVIEW_CONNECT_CHANNEL,PREVIEW_CONNECT_MAX_BYTES,previewWorkspaceUrl,type PreviewConnectMessage} from '@artifactbin/contracts';
import {PageBar,DocumentTitle} from './PageBar';
import {runtimeId} from '../../lib/story-runtime/runtime-id';
import {FormPage,FORM_INPUT,FORM_PRIMARY_BUTTON,FORM_SECONDARY_BUTTON} from './FormControls';
interface ConnectOffer {html:string;filename:string}
interface ConnectInspection {title:string|null;comments:number;target:string;kind?:'local'|'update'|'copy';requiresAuth?:boolean;reason?:string}
export interface ConnectAdapter {
 hosted?:boolean;
 inspect(offer:ConnectOffer):Promise<ConnectInspection>;
 apply(offer:ConnectOffer,input:{target:string;mode:'update'|'copy'|'local';operationId:string}):Promise<{path:string}>;
}
class ConnectRequestError extends Error {constructor(message:string,readonly status:number){super(message);}}
export async function connectRequest<T>(path:string,body:unknown):Promise<T>{
 const response=await fetch(path,{method:'POST',credentials:'same-origin',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
 const value=await response.json();if(!response.ok)throw new ConnectRequestError([value.error,value.hint,value.fix].filter(Boolean).join(' ')||'Could not apply this file.',response.status);return value;
}
export function FileConnectReceiver(props:{adapter:ConnectAdapter;authentication?:(done:()=>void)=>JSX.Element}):JSX.Element {
 const [offer,setOffer]=createSignal<ConnectOffer>(),[inspection,setInspection]=createSignal<ConnectInspection>(),[target,setTarget]=createSignal(''),[error,setError]=createSignal(''),[busy,setBusy]=createSignal(false);
 let operationId=runtimeId();
 const requestId=new URLSearchParams(location.search).get('request'),opener=window.opener as Window|null;
 let peerOrigin:string|undefined;
 const reply=(message:PreviewConnectMessage)=>opener?.postMessage(message,peerOrigin==='null'||peerOrigin===undefined?'*':peerOrigin);
 const inspect=async(value:ConnectOffer,fresh=true)=>{
  if(busy())return;setBusy(true);setError('');setInspection(undefined);setOffer(value);if(fresh)operationId=runtimeId();
  try{const result=await props.adapter.inspect(value);setInspection(result);setTarget(result.target);}catch(error){setError(error instanceof Error?error.message:String(error));}finally{setBusy(false);}
 };
 const receive=(event:MessageEvent)=>{
  if(!opener||event.source!==opener||!requestId||peerOrigin!==undefined&&peerOrigin!==event.origin)return;
  const value=event.data as Partial<PreviewConnectMessage>;
  if(!value||value.channel!==PREVIEW_CONNECT_CHANNEL||value.requestId!==requestId||value.type!=='offer'||typeof value.html!=='string'||typeof value.filename!=='string')return;
  if(new Blob([value.html]).size>PREVIEW_CONNECT_MAX_BYTES){setError('The HTML file exceeds the 25 MB import limit.');return;}
  if(offer())return;peerOrigin=event.origin;void inspect({html:value.html,filename:value.filename});
 };
 window.addEventListener('message',receive);onCleanup(()=>window.removeEventListener('message',receive));
 if(opener&&requestId)reply({channel:PREVIEW_CONNECT_CHANNEL,type:'ready',requestId});
 const choose=async(event:Event)=>{
  const file=(event.currentTarget as HTMLInputElement).files?.[0];if(!file)return;
  if(file.size>PREVIEW_CONNECT_MAX_BYTES){setError('The HTML file exceeds the 25 MB import limit.');return;}
  await inspect({html:await file.text(),filename:file.name});
 };
 const submit=async(mode:'update'|'copy'|'local')=>{
  const incoming=offer();if(!incoming||busy())return;setBusy(true);setError('');
  try{
   const result=await props.adapter.apply(incoming,{target:target(),mode,operationId});
   if(!previewWorkspaceUrl(location.origin,result.path))throw Error('The server returned an invalid editor location.');
   if(requestId)reply({channel:PREVIEW_CONNECT_CHANNEL,type:'opened',requestId,path:result.path});
   location.replace(result.path);
  }catch(error){setError(error instanceof Error?error.message:String(error));if(error instanceof ConnectRequestError&&error.status===401){const current=inspection();if(current)setInspection({...current,requiresAuth:true});}setBusy(false);}
 };
 const title=()=>props.adapter.hosted?'Connect to artifactbin':'Preview server';
 return <><PageBar home={null} mobileTitle={title()} navigation={<><span class="shrink-0 text-muted">artifactbin</span><DocumentTitle title={title()}/><span class="text-xs text-muted">{props.adapter.hosted?'Hosted':'Local'}</span></>} actions={<></>}/><FormPage>
  <h1 class="text-base font-semibold">{props.adapter.hosted?'Connect an offline file':'Import an HTML file'}</h1>
  <p class="text-muted">Choose an artifactbin .jsx.html file, or use Connect to server in your offline file.</p>
  <p class="text-muted">{props.adapter.hosted?'Review the destination and confirm before anything is published. Your original HTML file stays unchanged.':'Importing creates or reconciles a copy in this server’s workspace. Your original HTML file stays unchanged. Nothing is published.'}</p>
  <Show when={offer()}>{incoming=><p class="break-words">Received file: <b>{incoming().filename}</b></p>}</Show>
  <label class="block space-y-2">{offer()?'Choose another file':'HTML file'} <input class={FORM_INPUT} aria-label="HTML file" type="file" accept=".html" disabled={busy()} onChange={event=>void choose(event)}/></label>
  <Show when={busy()}><p role="status">Working…</p></Show>
  <Show when={error()}><p role="alert" class="text-danger">{error()}</p><p>Your file and unsaved edits are still here.</p></Show>
  <Show when={offer()&&!inspection()&&!busy()}><button class={FORM_PRIMARY_BUTTON} onClick={()=>void inspect(offer()!,false)}>Retry review</button></Show>
  <Show when={inspection()}>{value=><Show when={!value().requiresAuth} fallback={<><p>Log in with email to continue. This file stays in this tab.</p>{props.authentication?.(()=>{const current=offer();if(current)void inspect(current,false);})}</>}>
   <form class="space-y-4" onSubmit={event=>{event.preventDefault();void submit(value().kind??'local');}}>
    <p role="status">Ready to {value().kind==='update'?'apply':'import'} “{value().title??'Untitled'}” with {value().comments} comment {value().comments===1?'thread':'threads'}.</p>
    <Show when={props.adapter.hosted} fallback={<><label class="block space-y-2">Workspace file <input class={FORM_INPUT} aria-label="Workspace file" required value={target()} onInput={event=>setTarget(event.currentTarget.value)} disabled={busy()}/></label><p>Existing files use the same conflict checks as CLI import. If both copies changed, the server retains both and reports the conflict.</p></>}>
     <Show when={value().kind==='update'} fallback={<p>{value().reason} Creating an independent copy makes a new unlisted document; it does not update the original.</p>}><p>Verified original: <b>{value().target}</b> on this server. Apply uses the same conflict checks as the live editor. Independent edits are retained; overlapping edits are refused.</p></Show>
    </Show>
    <div class="flex flex-wrap items-center gap-3">
    <button class={FORM_PRIMARY_BUTTON} type="submit" disabled={busy()}>{value().kind==='update'?'Apply to original':value().kind==='copy'?'Create independent copy':'Import and open'}</button>
    <Show when={value().kind==='update'}><button class={FORM_SECONDARY_BUTTON} type="button" disabled={busy()} onClick={()=>void submit('copy')}>Create independent copy instead</button></Show>
    </div>
   </form>
  </Show>}</Show>
 </FormPage></>;
}
