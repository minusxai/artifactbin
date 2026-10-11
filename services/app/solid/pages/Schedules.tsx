import WorkspaceHeading from '../components/WorkspaceHeading';
/* @jsxImportSource solid-js */
import {createResource,createSignal,For,Show,type JSX} from 'solid-js';
import {useSearchParams} from '@solidjs/router';
import type {ScheduleRecord,ScheduleOccurrence,RunnerJson} from '@artifactbin/contracts';
import {runtimeId as newRequestId} from '@artifactbin/utils/runtime-id';
import {apiRequest} from '../lib/api';
import {useSession} from '../lib/session';
import { Disclosure } from '../ui/Disclosure';
import {Badge} from '../ui/ui';
import {Button} from '../ui/Button';
import {Field,Input,Textarea} from '../ui/Field';
import {SectionHeading} from '../ui/PageHeader';
import {Panel} from '../ui/Panel';
import {StatusMessage} from '../ui/StatusMessage';
/** Router location advances before window.history during client navigation. */
export function SchedulesRoute():JSX.Element{
 const [params]=useSearchParams();
 return <SchedulesPage artifactId={typeof params.artifact==='string'?params.artifact:''}/>;
}
export function SchedulesPage(props:{artifactId?:string}={}):JSX.Element{
 const {session}=useSession();
 const [records,{refetch}]=createResource(()=>session()?.user?.id,()=>apiRequest<{schedules:ScheduleRecord[]}>('/api/schedules'));
 const [artifact,setArtifact]=createSignal(props.artifactId||new URLSearchParams(window.location.search).get('artifact')||'');
 const [cron,setCron]=createSignal('0 * * * *'),[timezone,setTimezone]=createSignal('UTC'),[input,setInput]=createSignal('null');
 const [maxAttempts,setMaxAttempts]=createSignal(1),[backoff,setBackoff]=createSignal(60),[editing,setEditing]=createSignal<string|null>(null);
 const [busy,setBusy]=createSignal(false),[error,setError]=createSignal(''),[notice,setNotice]=createSignal('');
 const [history,setHistory]=createSignal<{id:string;artifact:string;rows:ScheduleOccurrence[]}|null>(null),[deleting,setDeleting]=createSignal<string|null>(null);
 // Reading a failed resource rethrows its error, so every read of the list goes through here: a failed load shows the retry line instead.
 const schedules=()=>records.error?undefined:records()?.schedules;
 let cronInput:HTMLInputElement|undefined;
 const pendingRunIds=new Map<string,string>();
 const action=async(task:()=>Promise<void>)=>{if(busy())return;setBusy(true);setError('');setNotice('');try{await task();}catch(error){const message=error instanceof Error?error.message:'The request failed.';setError(message==='invalid_schedule'?'Check the five cron fields, IANA timezone, 1–10 attempts, and 1–86,400 seconds of retry backoff.':message);}finally{setBusy(false);}};
 const save=(event:SubmitEvent)=>{event.preventDefault();void action(async()=>{
  let value:RunnerJson;try{value=JSON.parse(input());}catch{throw Error('Input must be valid JSON.');}
  const body={cron:cron(),timezone:timezone(),input:value,maxAttempts:maxAttempts(),retryBackoffSeconds:backoff()};
  await apiRequest(editing()?`/api/schedules/${editing()}`:'/api/schedules',editing()?'PATCH':'POST',editing()?body:{artifactId:artifact().trim(),...body});
  setEditing(null);setNotice('Schedule saved.');await refetch();
 });};
 const edit=(record:ScheduleRecord)=>{setEditing(record.id);setArtifact(record.artifactId);setCron(record.cron);setTimezone(record.timezone);setInput(JSON.stringify(record.input,null,2));setMaxAttempts(record.maxAttempts);setBackoff(record.retryBackoffSeconds);setError('');cronInput?.focus();};
 const loadHistory=async(record:Pick<ScheduleRecord,'id'|'artifactId'>)=>{const result=await apiRequest<{history:ScheduleOccurrence[]}>(`/api/schedules/${record.id}/history`);setHistory({id:record.id,artifact:record.artifactId,rows:result.history});};
 return <main class="workspace-page workspace-sections"><WorkspaceHeading title="Schedules" description="Run the current version of an artifact on a schedule. Native programs require ownership; server handlers use artifact access permissions. The shortest interval is one minute." />
 <Show when={session()?.user} fallback={<p><a href="/login" class="underline">Sign in</a> to manage schedules.</p>}>
 <Show when={error()}><StatusMessage kind="error">{error()}</StatusMessage></Show><Show when={notice()}><StatusMessage kind="notice">{notice()}</StatusMessage></Show>
 <form onSubmit={save}><Panel title={editing()?'Edit schedule':'New schedule'}><div class="grid gap-4 sm:grid-cols-2">
 <Field label="Artifact ID"><Input required readOnly={!!editing()} value={artifact()} onInput={e=>setArtifact(e.currentTarget.value)}/></Field>
 <Field label="Cron expression" hint="Five fields: minute, hour, day, month, weekday. Example: */5 * * * * runs every five minutes."><Input ref={cronInput} required value={cron()} onInput={e=>setCron(e.currentTarget.value)}/></Field>
 <Field label="Timezone" hint="IANA name, such as UTC or America/New_York."><Input required value={timezone()} onInput={e=>setTimezone(e.currentTarget.value)}/></Field>
 <Field label="Input JSON"><Textarea size="sm" value={input()} onInput={e=>setInput(e.currentTarget.value)} rows={3}/></Field>
 <Field label="Maximum attempts" hint="Includes the first attempt. Retries may repeat side effects."><Input type="number" min="1" max="10" required value={maxAttempts()} onInput={e=>setMaxAttempts(Number(e.currentTarget.value))}/></Field>
 <Field label="Retry backoff (seconds)" hint="1 to 86,400 seconds."><Input type="number" min="1" max="86400" required value={backoff()} onInput={e=>setBackoff(Number(e.currentTarget.value))}/></Field>
 </div><div class="mt-5 flex gap-2"><Button disabled={busy()} type="submit">{editing()?'Save schedule':'Create schedule'}</Button><Show when={editing()}><Button variant="secondary" type="button" onClick={()=>setEditing(null)}>Cancel edit</Button></Show></div></Panel></form>
 <section aria-label="Your schedules"><SectionHeading class="mb-3">Your schedules</SectionHeading><Show when={records.error}><StatusMessage kind="error" action={<Button variant="secondary" size="sm" onClick={()=>void refetch()}>Retry</Button>}>Could not load schedules.</StatusMessage></Show><Show when={records.loading}><StatusMessage kind="loading">Loading schedules…</StatusMessage></Show><Show when={schedules()?.length===0}><StatusMessage kind="empty" class="rounded-panel border border-dashed border-edge bg-surface px-5 py-8">No schedules yet.</StatusMessage></Show>
 <For each={schedules()}>{record=><Panel padding="sm" class="mb-3"><div class="flex flex-wrap justify-between gap-2"><a class="min-w-0 break-all font-semibold text-accent underline-offset-4 hover:underline" href={`/a/${record.artifactId}`}>{record.artifactId}</a><Badge tone={record.enabled?'accent':'default'}>{record.enabled?'Active':'Paused'}</Badge></div><p class="mt-2 font-mono text-sm"><code>{record.cron}</code> · {record.timezone}</p><p class="mt-1 text-xs text-muted">{record.enabled?`Next: ${new Date(record.nextDueAt).toLocaleString()}`:'No automatic runs while paused'} · {record.maxAttempts} maximum attempts</p><div class="mt-3 flex flex-wrap gap-2">
 <Button variant="secondary" size="sm" type="button" disabled={busy()} aria-label={`Edit ${record.artifactId}`} onClick={()=>edit(record)}>Edit</Button>
 <Button variant="secondary" size="sm" type="button" disabled={busy()} aria-label={`${record.enabled?'Pause':'Resume'} ${record.artifactId}`} onClick={()=>void action(async()=>{await apiRequest(`/api/schedules/${record.id}`,'PATCH',{enabled:!record.enabled});await refetch();})}>{record.enabled?'Pause':'Resume'}</Button>
 <Button variant="secondary" size="sm" type="button" disabled={busy()||!record.enabled} aria-label={`Run now ${record.artifactId}`} onClick={()=>void action(async()=>{const requestId=pendingRunIds.get(record.id)??newRequestId();pendingRunIds.set(record.id,requestId);await apiRequest(`/api/schedules/${record.id}/run`,'POST',{requestId});pendingRunIds.delete(record.id);setNotice('Run requested.');await loadHistory(record);})}>Run now</Button><Show when={!record.enabled}><span class="self-center text-xs text-muted">Resume to run.</span></Show>
 <Button variant="secondary" size="sm" type="button" disabled={busy()} aria-label={`History ${record.artifactId}`} onClick={()=>void action(()=>loadHistory(record))}>History</Button>
 <Button variant="secondary" size="sm" type="button" disabled={busy()} aria-label={`Delete ${record.artifactId}`} onClick={()=>setDeleting(record.id)}>Delete</Button>
 <Show when={deleting()===record.id}><span class="flex flex-wrap items-center gap-2 text-sm">Delete this schedule? Existing runs remain.<Button variant="danger" size="sm" type="button" onClick={()=>void action(async()=>{await apiRequest(`/api/schedules/${record.id}`,'DELETE');setDeleting(null);await refetch();})}>Confirm delete</Button><Button variant="secondary" size="sm" type="button" onClick={()=>setDeleting(null)}>Keep schedule</Button></span></Show>
 </div></Panel>}</For></section>
 <Show when={history()}>{value=><Panel label="Schedule history"><SectionHeading class="break-all">History · {value().artifact}</SectionHeading><Button variant="secondary" size="sm" type="button" class="mt-3" disabled={busy()} onClick={()=>void action(()=>loadHistory({id:value().id,artifactId:value().artifact}))}>Refresh history</Button><Show when={!value().rows.length}><p>No runs yet.</p></Show><For each={value().rows}>{occurrence=><div class="mt-4 border-t border-edge pt-3"><p>{new Date(occurrence.scheduledFor).toLocaleString()} · {occurrence.status}</p><For each={occurrence.attempts}>{attempt=><div class="mt-2 pl-3 text-sm"><p>Attempt {attempt.attemptNumber}: {attempt.status}<Show when={attempt.runId}> · Run {attempt.runId}</Show></p><Show when={attempt.error}><p class="text-danger">{attempt.error}</p></Show><Show when={attempt.result}><Disclosure size="sm" summary="Run result"><pre class="mt-2 overflow-auto whitespace-pre-wrap text-xs">{JSON.stringify(attempt.result,null,2)}</pre></Disclosure></Show></div>}</For></div>}</For><Button variant="secondary" size="sm" type="button" class="mt-4" onClick={()=>setHistory(null)}>Close history</Button></Panel>}</Show>
 </Show></main>;
}
