// Shared GitHub Actions evidence for publishing PR timing and admitting a squash merge.
import {attemptStart,measureCiElapsed} from './ci-elapsed.mjs';

export function fastContexts(source) {
  const base=source.match(/part: \[([^\]]+)\]/)?.[1].split(',').map(s=>s.trim())??[];
  const parts=[...base,...Array.from(source.matchAll(/^\s+- part: ([\w-]+)$/gm),m=>m[1])];
  if(!parts.length) throw new Error('Missing fast matrix');
  return [...new Set(parts)].map(part=>`fast (${part})`);
}

// GitHub's runner reports "Complete job" after post-action work and orphan cleanup. The later job record
// still has to report success, but its finalization timestamp is only an upper bound on this runner work.
function runnerFinish(job, refuse) {
  const start=Date.parse(job.started_at), reported=Date.parse(job.completed_at);
  if(!Number.isFinite(start)||!Number.isFinite(reported)||reported<start||!Array.isArray(job.steps))refuse();
  const last=job.steps.at(-1);
  if(job.steps.length<2||last?.name!=='Complete job'||last.conclusion!=='success')refuse();
  let previousNumber=0, previousEnd=start;
  for(const step of job.steps){
    const begin=Date.parse(step?.started_at), end=Date.parse(step?.completed_at);
    if(step?.status!=='completed'||!Number.isInteger(step.number)||step.number<=previousNumber||
      (step!==last&&step.name==='Complete job')||!Number.isFinite(begin)||!Number.isFinite(end)||
      begin<previousEnd||end<begin||end>reported)refuse();
    previousNumber=step.number;
    previousEnd=end;
  }
  return previousEnd;
}

/**
 * Completed workload through each runner's final step. GitHub job finalization and observer publication are separate.
 *
 * `expected` is the lane as the caller's checkout defines it. The observer's checkout is main, so a pull request
 * that ADDS runners to the lane has more jobs than `expected`: every expected job must be there and successful,
 * and any other job must be a successful `fast (…)` workload job too, timed with the rest. A head that drops or
 * renames a job main expects is refused: the lane only shrinks in a change that lands on main first.
 */
export function completedFastAttempt({run,jobs,repository,head,workflowId,attempt,expected}) {
  const refuse=()=>{throw new Error('Incomplete or mismatched completed fast attempt');};
  if(run.repository?.full_name!==repository||run.head_sha!==head||run.workflow_id!==workflowId||run.run_attempt!==attempt||run.event!=='pull_request'||run.path!=='.github/workflows/pr-fast.yml'||run.status!=='completed'||run.conclusion!=='success') refuse();
  if(!expected.length||new Set(expected).size!==expected.length||jobs.total_count<expected.length||jobs.jobs.length!==jobs.total_count) refuse();
  const seen=new Set();let finish=0;
  for(const job of jobs.jobs){
    if(job.run_id!==run.id||job.run_attempt!==attempt||job.head_sha!==head||job.status!=='completed'||job.conclusion!=='success'||!/^fast \([\w-]+\)$/.test(job.name)||seen.has(job.name))refuse();
    seen.add(job.name);finish=Math.max(finish,runnerFinish(job,refuse));
  }
  if(expected.some(name=>!seen.has(name))) refuse();
  return measureCiElapsed(attemptStart(jobs),new Date(finish).toISOString(),{lane:'pr'});
}
