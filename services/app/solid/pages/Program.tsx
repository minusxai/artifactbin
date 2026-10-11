import WorkspaceHeading from '../components/WorkspaceHeading';
/* @jsxImportSource solid-js */
import { creationDestination } from '../lib/creation-destination';
import {createSignal,createEffect,onCleanup,Show,type JSX} from 'solid-js';
import type {ProgramDefinition,RunSnapshot} from '@artifactbin/contracts';
import {runtimeId as newRequestId} from '@artifactbin/utils/runtime-id';
import {pageDataChanged} from '@/solid/lib/page-data-events';
import {apiRequest} from '../lib/api';
import {runFailureMessage} from '../lib/run-failure-message';
import {useSession} from '../lib/session';
import {DocumentSharing} from '../document/DocumentSharing';
import {Button} from '../ui/Button';
import {Field,Input,Textarea} from '../ui/Field';
import {SectionHeading} from '../ui/PageHeader';
import {Panel} from '../ui/Panel';
import {StatusMessage} from '../ui/StatusMessage';
import { artifactLink } from '../lib/artifact-link';
const EXAMPLE:ProgramDefinition={version:1,command:['node','-e','console.log("Hello from the program")'],compute:{vcpu:1,memoryMiB:2048,ttlSeconds:600}};
interface ProgramWire{id:string;title:string|null;version:number;state:string;program:ProgramDefinition}
export function ProgramPage(props:{artifactId?:string;owner?:boolean}={}):JSX.Element{
 const {session}=useSession();const [id,setId]=createSignal(props.artifactId),[version,setVersion]=createSignal(0),[state,setState]=createSignal('');
 const [owner,setOwner]=createSignal(props.owner??!props.artifactId),[title,setTitle]=createSignal(''),[source,setSource]=createSignal(props.artifactId?'':JSON.stringify(EXAMPLE,null,2));
 const [busy,setBusy]=createSignal(false),[loading,setLoading]=createSignal(!!props.artifactId),[dirty,setDirty]=createSignal(!props.artifactId),[error,setError]=createSignal(''),[notice,setNotice]=createSignal(''),[run,setRun]=createSignal<RunSnapshot|null>(null);
 const canManage=()=>owner()&&!!session()?.user;
 const abort=new AbortController();let poll:ReturnType<typeof setInterval>|undefined;let pendingRunId:string|undefined;
 onCleanup(()=>{abort.abort();if(poll)clearInterval(poll);});
 let loadGeneration=0;
 createEffect(()=>{
  const artifactId=props.artifactId,suppliedOwner=props.owner,generation=++loadGeneration;
  if(!artifactId)return;
  setId(artifactId);setLoading(true);setSource('');setTitle('');setRun(null);setError('');setNotice('');pendingRunId=undefined;
  if(poll){clearInterval(poll);poll=undefined;}
  const active=()=>generation===loadGeneration&&!abort.signal.aborted;
  void (async()=>{try{
   type PageAnswer={role:string;surface:{format:string;title:string|null;source:string|null}};
   const page=suppliedOwner===undefined?await apiRequest<PageAnswer>(`/api/page/artifact/${artifactId}`,'GET',undefined,{signal:abort.signal}):undefined;
   const role=suppliedOwner??page?.role==='owner';
   if(!active())return;setOwner(role);
   if(!role){
    const answer=page??await apiRequest<PageAnswer>(`/api/page/artifact/${artifactId}`,'GET',undefined,{signal:abort.signal});
    if(!active())return;if(answer.surface.format!=='program')throw Error('This artifact is not a program.');
    const program=JSON.parse(answer.surface.source??'');setTitle(answer.surface.title??'');setSource(JSON.stringify(program,null,2));setDirty(false);return;
   }
   const artifact=await apiRequest<ProgramWire>(`/api/my/artifacts/${artifactId}`,'GET',undefined,{signal:abort.signal});
   if(!active())return;if(!artifact.program)throw Error('This artifact is not a program.');setTitle(artifact.title??'');setSource(JSON.stringify(artifact.program,null,2));setVersion(artifact.version);setState(artifact.state);setDirty(false);

  }catch(error){if(active())setError(error instanceof Error?error.message:'Could not load program.');}finally{if(active())setLoading(false);}})();
 });
 const save=async(event:SubmitEvent)=>{event.preventDefault();if(busy()||!canManage())return;setBusy(true);setError('');setNotice('');try{
  let program:ProgramDefinition;try{program=JSON.parse(source());}catch{throw Error('Program must be valid JSON.');}
  const artifact=await apiRequest<ProgramWire>(id()?`/api/my/artifacts/${id()}`:'/api/my/artifacts',id()?'PUT':'POST',{title:title(),program,...(id()?{expectedVersion:version(),expectedState:state()}:{visibility:'private',destination:creationDestination(window.location.search),parent_id:new URLSearchParams(window.location.search).get('parent_id')})});setId(artifact.id);setVersion(artifact.version);setState(artifact.state);setDirty(false);setNotice('Program saved.');pageDataChanged();
 }catch(error){setError(error instanceof Error?error.message:'Could not save program.');}finally{setBusy(false);}};
 const invoke=async()=>{if(!id()||busy())return;setBusy(true);setError('');try{
  const requestId=pendingRunId??newRequestId();pendingRunId=requestId;
  const started=await apiRequest<{runId:string}>(`/api/artifacts/${id()}/runs`,'POST',{requestId,input:null});pendingRunId=undefined;
  const refresh=async()=>{try{const state=await apiRequest<RunSnapshot>(`/api/runs/${started.runId}`,'GET',undefined,{signal:abort.signal});setRun(state);if(!['queued','running'].includes(state.status)&&poll){clearInterval(poll);poll=undefined;}}catch(error){if(!abort.signal.aborted){setError(error instanceof Error?error.message:'Could not read run status.');if(poll)clearInterval(poll);poll=undefined;}}};
  if(poll)clearInterval(poll);poll=setInterval(()=>void refresh(),2000);await refresh();
 }catch(error){setError(error instanceof Error?error.message:'Could not run program.');}finally{setBusy(false);}};
 return <main class="workspace-page space-y-6"><WorkspaceHeading title={props.artifactId?'Saved program':'New program'} description="A saved command runs in a temporary compute box. Its home directory persists between runs. Keep credentials out of the definition." />
 <Show when={error()}><StatusMessage kind="error">{error()}</StatusMessage></Show><Show when={notice()}><StatusMessage kind="notice">{notice()}</StatusMessage></Show><Show when={loading()}><StatusMessage kind="loading">Loading program…</StatusMessage></Show>
 <Show when={props.artifactId||session()?.user} fallback={<p><a href="/login" class="underline">Sign in</a> to create a program.</p>}><Show when={!props.artifactId||source()}><form onSubmit={event=>void save(event)}><Panel class="space-y-4">
 <Field label="Program title"><Input required value={title()} readOnly={!canManage()} onInput={event=>{setTitle(event.currentTarget.value);setDirty(true);}}/></Field>
 <Field label="Program JSON"><Textarea size="sm" spellcheck={false} rows={16} value={source()} readOnly={!canManage()} onInput={event=>{setSource(event.currentTarget.value);setDirty(true);}}/></Field>
 <p class="text-xs text-muted">Version 1 requires a command array. Compute and environment configuration are optional. Defaults: 1 vCPU, 2 GiB RAM. Runtime authentication is supplied separately.</p>
 <Show when={canManage()} fallback={<p>Only the owner can run or schedule this program.</p>}><div class="flex flex-wrap gap-2"><Button type="submit" disabled={busy()||loading()}>Save program</Button><Show when={id()}><Button variant="secondary" type="button" disabled={busy()||dirty()||['queued','running'].includes(run()?.status??'')} onClick={()=>void invoke()}>Run program</Button><Button variant="secondary" aria-label="Schedule program" href={`/schedules?artifact=${encodeURIComponent(id()!)}`}>Schedule</Button></Show></div><Show when={dirty()&&id()}><p class="mt-2 text-xs text-muted">Save your changes before running.</p></Show></Show>
 </Panel></form></Show></Show><Show when={canManage()&&id()}><DocumentSharing id={id()!} title={title()} owner version={version()} format="program" /></Show><Show when={id()}><a {...artifactLink(`/a/${id()}`, 'program')} class="text-sm underline">Open saved program</a></Show>
 <Show when={run()}>{state=><Panel label="Program run"><SectionHeading class="break-all">Run {state().runId}</SectionHeading><StatusMessage kind="notice" class="mt-2">{state().status}</StatusMessage><Show when={state().receipt?.reason}><StatusMessage kind="error">{runFailureMessage(state().receipt!.reason!)}</StatusMessage></Show><Show when={state().output!==null}><details><summary>Output</summary><pre class="mt-2 overflow-auto whitespace-pre-wrap text-xs">{JSON.stringify(state().output,null,2)}</pre></details></Show></Panel>}</Show></main>;
}
