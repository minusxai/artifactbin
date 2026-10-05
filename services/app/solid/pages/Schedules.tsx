/* @jsxImportSource solid-js */
import {createResource,createSignal,For,Show,type JSX} from 'solid-js';
import type {ScheduleRecord,ScheduleOccurrence,RunnerJson} from '@artifactbin/contracts';
import {newRequestId} from '../lib/request-id';
import {apiRequest} from '../lib/api';
import {useSession} from '../lib/session';
const FIELD='mt-1 w-full rounded border border-edge bg-bg p-2 font-mono text-xs';
const BUTTON='rounded border border-edge px-3 py-2 font-mono text-xs disabled:opacity-50 hover:bg-raised';
export function SchedulesPage(props:{artifactId?:string}={}):JSX.Element{
 const {session}=useSession();
 const [records,{refetch}]=createResource(()=>session()?.user?.id,()=>apiRequest<{schedules:ScheduleRecord[]}>('/api/schedules'));
 const [artifact,setArtifact]=createSignal(props.artifactId||new URLSearchParams(window.location.search).get('artifact')||'');
 const [cron,setCron]=createSignal('0 * * * *'),[timezone,setTimezone]=createSignal('UTC'),[input,setInput]=createSignal('null');
 const [maxAttempts,setMaxAttempts]=createSignal(1),[backoff,setBackoff]=createSignal(60),[editing,setEditing]=createSignal<string|null>(null);
 const [busy,setBusy]=createSignal(false),[error,setError]=createSignal(''),[notice,setNotice]=createSignal('');
 const [history,setHistory]=createSignal<{id:string;artifact:string;rows:ScheduleOccurrence[]}|null>(null),[deleting,setDeleting]=createSignal<string|null>(null);
 const pendingRunIds=new Map<string,string>();
 const action=async(task:()=>Promise<void>)=>{if(busy())return;setBusy(true);setError('');setNotice('');try{await task();}catch(error){setError(error instanceof Error?error.message:'The request failed.');}finally{setBusy(false);}};
 const save=(event:SubmitEvent)=>{event.preventDefault();void action(async()=>{
  let value:RunnerJson;try{value=JSON.parse(input());}catch{throw Error('Input must be valid JSON.');}
  const body={cron:cron(),timezone:timezone(),input:value,maxAttempts:maxAttempts(),retryBackoffSeconds:backoff()};
  await apiRequest(editing()?`/api/schedules/${editing()}`:'/api/schedules',editing()?'PATCH':'POST',editing()?body:{artifactId:artifact().trim(),...body});
  setEditing(null);setNotice('Schedule saved.');await refetch();
 });};
 const edit=(record:ScheduleRecord)=>{setEditing(record.id);setArtifact(record.artifactId);setCron(record.cron);setTimezone(record.timezone);setInput(JSON.stringify(record.input,null,2));setMaxAttempts(record.maxAttempts);setBackoff(record.retryBackoffSeconds);setError('');document.getElementById('schedule-cron')?.focus();};
 const loadHistory=async(record:Pick<ScheduleRecord,'id'|'artifactId'>)=>{const result=await apiRequest<{history:ScheduleOccurrence[]}>(`/api/schedules/${record.id}/history`);setHistory({id:record.id,artifact:record.artifactId,rows:result.history});};
 return <main class="mx-auto max-w-5xl space-y-8 px-4 py-8"><header><h1 class="text-2xl font-semibold">Schedules</h1><p class="mt-2 max-w-2xl text-sm text-muted">Run the current version of an artifact on a schedule. Native programs require ownership; server handlers use artifact access permissions. The shortest interval is one minute.</p></header>
 <Show when={session()?.user} fallback={<p><a href="/login" class="underline">Sign in</a> to manage schedules.</p>}>
 <Show when={error()}><p role="alert" class="text-danger">{error()}</p></Show><Show when={notice()}><p role="status">{notice()}</p></Show>
 <form onSubmit={save} class="rounded border border-edge bg-surface p-5"><h2 class="mb-4 text-lg font-semibold">{editing()?'Edit schedule':'New schedule'}</h2><div class="grid gap-4 sm:grid-cols-2">
 <label class="text-sm" for="schedule-artifact">Artifact ID<input id="schedule-artifact" required readOnly={!!editing()} value={artifact()} onInput={e=>setArtifact(e.currentTarget.value)} class={FIELD}/></label>
 <label class="text-sm" for="schedule-cron">Cron expression<input id="schedule-cron" aria-label="Cron expression" required value={cron()} onInput={e=>setCron(e.currentTarget.value)} class={FIELD} aria-describedby="cron-help"/><span id="cron-help" class="mt-1 block text-xs text-muted">Five fields: minute, hour, day, month, weekday. Example: */5 * * * * runs every five minutes.</span></label>
 <label class="text-sm" for="schedule-timezone">Timezone<input id="schedule-timezone" aria-label="Timezone" required value={timezone()} onInput={e=>setTimezone(e.currentTarget.value)} class={FIELD}/><span class="text-xs text-muted">IANA name, such as UTC or America/New_York.</span></label>
 <label class="text-sm" for="schedule-input">Input JSON<textarea id="schedule-input" value={input()} onInput={e=>setInput(e.currentTarget.value)} class={FIELD} rows={3}/></label>
 <label class="text-sm" for="schedule-attempts">Maximum attempts<input id="schedule-attempts" aria-label="Maximum attempts" type="number" min="1" max="10" required value={maxAttempts()} onInput={e=>setMaxAttempts(Number(e.currentTarget.value))} class={FIELD}/><span class="text-xs text-muted">Includes the first attempt. Retries may repeat side effects.</span></label>
 <label class="text-sm" for="schedule-backoff">Retry backoff (seconds)<input id="schedule-backoff" type="number" min="1" required value={backoff()} onInput={e=>setBackoff(Number(e.currentTarget.value))} class={FIELD}/></label>
 </div><div class="mt-5 flex gap-2"><button class={BUTTON} disabled={busy()} type="submit">{editing()?'Save schedule':'Create schedule'}</button><Show when={editing()}><button class={BUTTON} type="button" onClick={()=>setEditing(null)}>Cancel edit</button></Show></div></form>
 <section aria-label="Your schedules"><h2 class="mb-3 text-lg font-semibold">Your schedules</h2><Show when={records.error}><p role="alert">Could not load schedules. <button onClick={()=>void refetch()}>Retry</button></p></Show><Show when={records.loading}><p role="status">Loading schedules…</p></Show><Show when={records()?.schedules.length===0}><p class="text-muted">No schedules yet.</p></Show>
 <For each={records()?.schedules}>{record=><article class="mb-3 rounded border border-edge p-4"><div class="flex flex-wrap justify-between gap-2"><a class="font-semibold underline" href={`/a/${record.artifactId}`}>{record.artifactId}</a><span>{record.enabled?'Active':'Paused'}</span></div><p class="mt-2 font-mono text-sm"><code>{record.cron}</code> · {record.timezone}</p><p class="mt-1 text-xs text-muted">{record.enabled?`Next: ${new Date(record.nextDueAt).toLocaleString()}`:'No automatic runs while paused'} · {record.maxAttempts} maximum attempts</p><div class="mt-3 flex flex-wrap gap-2">
 <button class={BUTTON} disabled={busy()} aria-label={`Edit ${record.artifactId}`} onClick={()=>edit(record)}>Edit</button>
 <button class={BUTTON} disabled={busy()} aria-label={`${record.enabled?'Pause':'Resume'} ${record.artifactId}`} onClick={()=>void action(async()=>{await apiRequest(`/api/schedules/${record.id}`,'PATCH',{enabled:!record.enabled});await refetch();})}>{record.enabled?'Pause':'Resume'}</button>
 <button class={BUTTON} disabled={busy()||!record.enabled} aria-label={`Run now ${record.artifactId}`} onClick={()=>void action(async()=>{const requestId=pendingRunIds.get(record.id)??newRequestId();pendingRunIds.set(record.id,requestId);await apiRequest(`/api/schedules/${record.id}/run`,'POST',{requestId});pendingRunIds.delete(record.id);setNotice('Run requested.');await loadHistory(record);})}>Run now</button><Show when={!record.enabled}><span class="self-center text-xs text-muted">Resume to run.</span></Show>
 <button class={BUTTON} disabled={busy()} aria-label={`History ${record.artifactId}`} onClick={()=>void action(()=>loadHistory(record))}>History</button>
 <button class={BUTTON} disabled={busy()} aria-label={`Delete ${record.artifactId}`} onClick={()=>setDeleting(record.id)}>Delete</button>
 <Show when={deleting()===record.id}><span class="flex items-center gap-2 text-sm">Delete this schedule? Existing runs remain.<button class={BUTTON} onClick={()=>void action(async()=>{await apiRequest(`/api/schedules/${record.id}`,'DELETE');setDeleting(null);await refetch();})}>Confirm delete</button><button class={BUTTON} onClick={()=>setDeleting(null)}>Keep schedule</button></span></Show>
 </div></article>}</For></section>
 <Show when={history()}>{value=><section aria-label="Schedule history" class="rounded border border-edge p-5"><h2 class="text-lg font-semibold">History · {value().artifact}</h2><button class={`${BUTTON} mt-3`} disabled={busy()} onClick={()=>void action(()=>loadHistory({id:value().id,artifactId:value().artifact}))}>Refresh history</button><Show when={!value().rows.length}><p>No runs yet.</p></Show><For each={value().rows}>{occurrence=><div class="mt-4 border-t border-edge pt-3"><p>{new Date(occurrence.scheduledFor).toLocaleString()} · {occurrence.status}</p><For each={occurrence.attempts}>{attempt=><div class="mt-2 pl-3 text-sm"><p>Attempt {attempt.attemptNumber}: {attempt.status}<Show when={attempt.runId}> · Run {attempt.runId}</Show></p><Show when={attempt.error}><p class="text-danger">{attempt.error}</p></Show><Show when={attempt.result}><details><summary>Run result</summary><pre class="overflow-auto whitespace-pre-wrap text-xs">{JSON.stringify(attempt.result,null,2)}</pre></details></Show></div>}</For></div>}</For><button class={`${BUTTON} mt-4`} onClick={()=>setHistory(null)}>Close history</button></section>}</Show>
 </Show></main>;
}
