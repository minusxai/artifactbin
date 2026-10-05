/** Compatible preview-service receiver. Offers remain inert until the user confirms a workspace import. */
import {createSignal,Show,onCleanup} from 'solid-js';
import {render} from 'solid-js/web';
import {PREVIEW_CONNECT_CHANNEL,PREVIEW_CONNECT_INSPECT_PATH,PREVIEW_CONNECT_IMPORT_PATH,PREVIEW_CONNECT_MAX_BYTES,type PreviewConnectMessage} from '../../../contracts/src/preview-connect';

interface Offer {html:string;filename:string}
interface Inspection {title:string|null;comments:number;target:string}
async function request<T>(path:string,body:unknown):Promise<T>{
 const response=await fetch(path,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
 const value=await response.json();if(!response.ok)throw Error([value.error,value.fix].filter(Boolean).join(' ')||'Import failed.');return value;
}
function Connect(){
 const [offer,setOffer]=createSignal<Offer>(),[inspection,setInspection]=createSignal<Inspection>(),[target,setTarget]=createSignal(''),[error,setError]=createSignal(''),[busy,setBusy]=createSignal(false);
 const requestId=new URLSearchParams(location.search).get('request');
 const opener=window.opener as Window|null;
 let peerOrigin:string|undefined;
 const reply=(message:PreviewConnectMessage)=>{if(opener)opener.postMessage(message,peerOrigin==='null'||peerOrigin===undefined?'*':peerOrigin);};
 const inspect=async(value:Offer)=>{
  if(busy())return;
  setBusy(true);setError('');setInspection(undefined);setOffer(undefined);
  try{const result=await request<Inspection>(PREVIEW_CONNECT_INSPECT_PATH,value);setOffer(value);setInspection(result);setTarget(result.target);}catch(error){setError(error instanceof Error?error.message:String(error));}finally{setBusy(false);}
 };
 const receive=(event:MessageEvent)=>{
  if(!opener||event.source!==opener||!requestId)return;
  const value=event.data as Partial<PreviewConnectMessage>;
  if(!value||value.channel!==PREVIEW_CONNECT_CHANNEL||value.requestId!==requestId||value.type!=='offer'||typeof value.html!=='string'||typeof value.filename!=='string')return;
  if(new Blob([value.html]).size>PREVIEW_CONNECT_MAX_BYTES){setError('The HTML file exceeds the 25 MB import limit.');return;}
  peerOrigin=event.origin;
  void inspect({html:value.html,filename:value.filename});
 };
 window.addEventListener('message',receive);onCleanup(()=>window.removeEventListener('message',receive));
 if(opener&&requestId)reply({channel:PREVIEW_CONNECT_CHANNEL,type:'ready',requestId});
 const choose=async(event:Event)=>{
  const file=(event.currentTarget as HTMLInputElement).files?.[0];if(!file)return;
  if(file.size>PREVIEW_CONNECT_MAX_BYTES){setError('The HTML file exceeds the 25 MB import limit.');return;}
  await inspect({html:await file.text(),filename:file.name});
 };
 const submit=async(event:SubmitEvent)=>{
  event.preventDefault();const incoming=offer();if(!incoming||busy())return;setBusy(true);setError('');
  try{
   const result=await request<{path:string}>(PREVIEW_CONNECT_IMPORT_PATH,{...incoming,target:target()});
   if(!result.path.startsWith('/workspace/')||result.path.includes('\\')||result.path.includes('#')||result.path.includes('?'))throw Error('The server returned an invalid editor location.');
   if(requestId)reply({channel:PREVIEW_CONNECT_CHANNEL,type:'opened',requestId,path:result.path});
   location.replace(result.path);
  }catch(error){const message=error instanceof Error?error.message:String(error);setError(message);if(requestId)reply({channel:PREVIEW_CONNECT_CHANNEL,type:'error',requestId,message});setBusy(false);}
 };
 return <div class="mx-auto max-w-xl p-6 space-y-4">
  <h1 class="text-2xl font-semibold">Import an HTML file</h1>
  <p>Choose an artifactbin .jsx.html file, or use Connect to server in your offline file.</p>
  <p>Importing creates or reconciles a copy in this server’s workspace. Your original HTML file stays unchanged. Nothing is published.</p>
  <label class="block">HTML file <input aria-label="HTML file" type="file" accept=".html" disabled={busy()} onChange={event=>void choose(event)} /></label>
  <Show when={busy()}><p role="status">Working…</p></Show>
  <Show when={error()}><p role="alert">{error()}</p><p>Your original file and unsaved edits remain available. Resolve the reported conflict, or import into a separate workspace to keep an independent copy.</p></Show>
  <Show when={inspection()}>{value=><form class="space-y-4" onSubmit={event=>void submit(event)}>
   <p role="status">Ready to import “{value().title??'Untitled'}” with {value().comments} comment {value().comments===1?'thread':'threads'}.</p>
   <label class="block">Workspace file <input aria-label="Workspace file" required value={target()} onInput={event=>setTarget(event.currentTarget.value)} disabled={busy()} /></label>
   <p>Existing files use the same conflict checks as CLI import. If both copies changed, the server retains both and reports the conflict.</p>
   <button type="submit" disabled={busy()}>Import and open</button>
  </form>}</Show>
 </div>;
}
const mount=document.getElementById('afbin-connect');if(mount)render(()=> <Connect />,mount);
