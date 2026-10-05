/* @jsxImportSource solid-js */
import {createSignal,createEffect,onCleanup,Show,type JSX} from 'solid-js';
import type {ProgramDefinition,RunSnapshot} from '@artifactbin/contracts';
import {apiRequest} from '../lib/api';
import {useSession} from '../lib/session';
const FIELD='mt-1 w-full rounded border border-edge bg-bg p-2 font-mono text-xs';
const BUTTON='rounded border border-edge px-3 py-2 font-mono text-xs disabled:opacity-50 hover:bg-raised';
const EXAMPLE:ProgramDefinition={version:1,command:['node','-e','console.log("Hello from the program")'],compute:{vcpu:1,memoryMiB:2048,ttlSeconds:600}};
interface ProgramWire{id:string;title:string|null;version:number;state:string;program:ProgramDefinition}
export function ProgramPage(props:{artifactId?:string;owner?:boolean}={}):JSX.Element{
 const {session}=useSession();const [id,setId]=createSignal(props.artifactId),[version,setVersion]=createSignal(0),[state,setState]=createSignal('');
 const [owner,setOwner]=createSignal(props.owner??!props.artifactId),[title,setTitle]=createSignal(''),[source,setSource]=createSignal(JSON.stringify(EXAMPLE,null,2));
 const [busy,setBusy]=createSignal(false),[loading,setLoading]=createSignal(!!props.artifactId),[dirty,setDirty]=createSignal(!props.artifactId),[error,setError]=createSignal(''),[notice,setNotice]=createSignal(''),[run,setRun]=createSignal<RunSnapshot|null>(null);
 const abort=new AbortController();let poll:ReturnType<typeof setInterval>|undefined;let pendingRunId:string|undefined;
 onCleanup(()=>{abort.abort();if(poll)clearInterval(poll);});
 let loadGeneration=0;
 createEffect(()=>{
  const artifactId=props.artifactId,suppliedOwner=props.owner,generation=++loadGeneration;
  if(!artifactId)return;
  setId(artifactId);setLoading(true);setRun(null);setError('');setNotice('');pendingRunId=undefined;
  if(poll){clearInterval(poll);poll=undefined;}
  const active=()=>generation===loadGeneration&&!abort.signal.aborted;
  void (async()=>{try{
   const role=suppliedOwner===undefined?(await apiRequest<{role:string}>(`/api/page/artifact/${artifactId}`,'GET',undefined,{signal:abort.signal})).role==='owner':suppliedOwner;
   if(!active())return;setOwner(role);
   const artifact=await apiRequest<ProgramWire>(`/api/artifacts/${artifactId}`,'GET',undefined,{signal:abort.signal});
   if(!active())return;if(!artifact.program)throw Error('This artifact is not a program.');setTitle(artifact.title??'');setSource(JSON.stringify(artifact.program,null,2));setVersion(artifact.version);setState(artifact.state);setDirty(false);
  }catch(error){if(active())setError(error instanceof Error?error.message:'Could not load program.');}finally{if(active())setLoading(false);}})();
 });
 const save=async(event:SubmitEvent)=>{event.preventDefault();if(busy())return;setBusy(true);setError('');setNotice('');try{
  let program:ProgramDefinition;try{program=JSON.parse(source());}catch{throw Error('Program must be valid JSON.');}
  const artifact=await apiRequest<ProgramWire>(id()?`/api/my/artifacts/${id()}`:'/api/my/artifacts',id()?'PUT':'POST',{title:title(),program,...(id()?{expectedVersion:version(),expectedState:state()}:{visibility:'private'})});setId(artifact.id);setVersion(artifact.version);setState(artifact.state);setDirty(false);setNotice('Program saved.');
 }catch(error){setError(error instanceof Error?error.message:'Could not save program.');}finally{setBusy(false);}};
 const invoke=async()=>{if(!id()||busy())return;setBusy(true);setError('');try{
  const requestId=pendingRunId??crypto.randomUUID();pendingRunId=requestId;
  const started=await apiRequest<{runId:string}>(`/api/artifacts/${id()}/invoke`,'POST',{requestId,input:null});pendingRunId=undefined;
  const refresh=async()=>{try{const state=await apiRequest<RunSnapshot>(`/api/runs/${started.runId}`,'GET',undefined,{signal:abort.signal});setRun(state);if(!['queued','running'].includes(state.status)&&poll){clearInterval(poll);poll=undefined;}}catch(error){if(!abort.signal.aborted){setError(error instanceof Error?error.message:'Could not read run status.');if(poll)clearInterval(poll);poll=undefined;}}};
  if(poll)clearInterval(poll);poll=setInterval(()=>void refresh(),2000);await refresh();
 }catch(error){setError(error instanceof Error?error.message:'Could not run program.');}finally{setBusy(false);}};
 return <main class="mx-auto max-w-4xl space-y-6 px-4 py-8"><header><h1 class="text-2xl font-semibold">{props.artifactId?'Saved program':'New program'}</h1><p class="mt-2 text-sm text-muted">A saved command runs in a temporary compute box. Its home directory persists between runs. Keep credentials out of the definition.</p></header>
 <Show when={error()}><p role="alert" class="text-danger">{error()}</p></Show><Show when={notice()}><p role="status">{notice()}</p></Show><Show when={loading()}><p role="status">Loading program…</p></Show>
 <Show when={session()?.user} fallback={<p><a href="/login" class="underline">Sign in</a> to create a program.</p>}><form onSubmit={event=>void save(event)} class="space-y-4 rounded border border-edge bg-surface p-5">
 <label for="program-title" class="block text-sm">Program title<input id="program-title" required value={title()} readOnly={!owner()} onInput={event=>{setTitle(event.currentTarget.value);setDirty(true);}} class={FIELD}/></label>
 <label for="program-source" class="block text-sm">Program JSON<textarea id="program-source" spellcheck={false} rows={16} value={source()} readOnly={!owner()} onInput={event=>{setSource(event.currentTarget.value);setDirty(true);}} class={`${FIELD} leading-relaxed`}/></label>
 <p class="text-xs text-muted">Version 1 requires a command array. Compute and environment configuration are optional. Defaults: 1 vCPU, 2 GiB RAM. Runtime authentication is supplied separately.</p>
 <Show when={owner()} fallback={<p>Only the owner can run or schedule this program.</p>}><div class="flex flex-wrap gap-2"><button type="submit" class={BUTTON} disabled={busy()||loading()}>Save program</button><Show when={id()}><button type="button" class={BUTTON} disabled={busy()||dirty()||['queued','running'].includes(run()?.status??'')} onClick={()=>void invoke()}>Run program</button><a aria-label="Schedule program" class={BUTTON} href={`/schedules?artifact=${encodeURIComponent(id()!)}`}>Schedule</a></Show></div><Show when={dirty()&&id()}><p class="mt-2 text-xs text-muted">Save your changes before running.</p></Show></Show>
 </form></Show><Show when={id()}><a href={`/a/${id()}`} class="text-sm underline">Open saved program</a></Show>
 <Show when={run()}>{state=><section aria-label="Program run" class="rounded border border-edge p-4"><h2 class="font-semibold">Run {state().runId}</h2><p role="status" class="mt-2">{state().status}</p><Show when={state().receipt?.reason}><p role="alert" class="text-danger">{state().receipt?.reason}</p></Show><Show when={state().output!==null}><details><summary>Output</summary><pre class="mt-2 overflow-auto whitespace-pre-wrap text-xs">{JSON.stringify(state().output,null,2)}</pre></details></Show></section>}</Show></main>;
}
