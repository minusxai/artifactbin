import {measureCiElapsed} from './ci-elapsed.mjs';

export function fastContexts(source) {
  const base=source.match(/part: \[([^\]]+)\]/)?.[1].split(',').map(s=>s.trim())??[];
  const parts=[...base,...Array.from(source.matchAll(/^\s+- part: ([\w-]+)$/gm),m=>m[1])];
  if(!parts.length) throw new Error('Missing fast matrix');
  return [...new Set(parts)].map(part=>`fast (${part})`);
}

/**
 * Completed workload only; observer scheduling/publication is reported separately.
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
    if(job.run_id!==run.id||job.run_attempt!==attempt||job.head_sha!==head||job.status!=='completed'||job.conclusion!=='success'||!/^fast \([\w-]+\)$/.test(job.name)||seen.has(job.name)||!Number.isFinite(Date.parse(job.completed_at)))refuse();
    seen.add(job.name);finish=Math.max(finish,Date.parse(job.completed_at));
  }
  if(expected.some(name=>!seen.has(name))) refuse();
  return measureCiElapsed(run.run_started_at,new Date(finish).toISOString(),{lane:'pr'});
}
