import {useCallback,useEffect,useState} from 'react';
import type {MutationNotificationJobView} from '@artifactbin/contracts';
import {Button} from './ui';

/** Trusted app chrome. Recovery retries a notification job, never its successful mutation. */
export function MutationNotificationStatus({runId}:{runId:string}){
 const [jobs,setJobs]=useState<MutationNotificationJobView[]|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState<string|null>(null);
 const load=useCallback(async()=>{
  const response=await fetch(`/api/notification-runs/${encodeURIComponent(runId)}/jobs`);
  if(!response.ok)throw Error('Could not load notification status.');
  const data=await response.json();if(!Array.isArray(data.jobs))throw Error('Could not load notification status.');
  setJobs(data.jobs);setError('');return data.jobs as MutationNotificationJobView[];
 },[runId]);
 useEffect(()=>{setJobs(null);setError('');void load().catch(()=>setError('Could not load notification status.'));},[load]);
 useEffect(()=>{if(!jobs?.some(job=>['pending','running','retrying'].includes(job.status)))return;const timer=setTimeout(()=>void load().catch(()=>setError('Could not load notification status.')),2000);return()=>clearTimeout(timer);},[jobs,load]);
 async function retry(job:MutationNotificationJobView){setBusy(job.id);setError('');try{const response=await fetch(`/api/notification-jobs/${encodeURIComponent(job.id)}/retry`,{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});if(!response.ok)throw Error('Could not retry the notification.');await load();}catch(e){setError(e instanceof Error?e.message:'Could not retry the notification.');}finally{setBusy(null);}}
 return <section aria-label="Mutation notification status" className="mb-5 rounded-lg border border-edge bg-surface p-4"><h2 className="text-base font-semibold">Notification status</h2><p className="mb-3 text-sm text-muted">The mutation succeeded. Retrying here only retries its notification query.</p>
  {error&&<p role="alert">{error} <Button onClick={()=>void load().catch(()=>setError('Could not load notification status.'))}>Refresh status</Button></p>}
  {!jobs&&!error&&<p role="status">Loading notification status…</p>}
  {jobs?.length===0&&<p>No notification jobs are available for this run.</p>}
  <ul className="space-y-3">{jobs?.map(job=><li key={job.id}><span className="font-medium">{job.notification_name}</span>{' — '}<span role="status">{{pending:'Pending',running:'Running',retrying:'Retrying',completed:'Completed',failed:'Failed'}[job.status]}</span>{job.error_code&&<p className="text-xs text-muted">{job.error_code}</p>}{job.status==='failed'&&<Button disabled={busy!==null} aria-label={`Retry notification ${job.notification_name}`} onClick={()=>void retry(job)}>Retry notification</Button>}</li>)}</ul>
 </section>;
}
