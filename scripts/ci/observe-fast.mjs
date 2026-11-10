/** Run by pr-fast-timing.yml when a `pr fast` run completes: publish the required `pr fast timing` status, measured
 * from the run's start to its last workload job's completion (scripts/lib/ci-elapsed.mjs budgets). */
import {readFileSync} from 'node:fs';
import {api,inspectAttempt} from './merge-fast.mjs';
import {describeCiElapsed} from '../lib/ci-elapsed.mjs';
const event=JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH,'utf8'));
const run=event.workflow_run,repository=process.env.GITHUB_REPOSITORY;
if(run?.repository?.full_name!==repository||run.event!=='pull_request'||run.path!=='.github/workflows/pr-fast.yml'||run.status!=='completed')throw new Error('Unexpected observer event');
const latest=api(`repos/${repository}/actions/runs/${run.id}`);
if(latest.run_attempt!==run.run_attempt||latest.head_sha!==run.head_sha)throw new Error('Stale observer event');
const runs=api(`repos/${repository}/actions/workflows/pr-fast.yml/runs?event=pull_request&head_sha=${run.head_sha}&per_page=100`);
if(runs.total_count>100||runs.workflow_runs.some(r=>r.id>run.id))throw new Error('Superseded observer run');
const started=Date.now();let state='failure',description='Completed fast attempt evidence rejected';
try{
 const evidence=inspectAttempt(repository,run.id,run.head_sha);
 if(evidence.run.run_attempt!==run.run_attempt)throw new Error('Stale observer attempt');
 state=evidence.result.status==='failed'?'failure':'success';description=describeCiElapsed(evidence.result,'pr');
}catch(error){console.error(error.message);}
if(api(`repos/${repository}/actions/runs/${run.id}`).run_attempt!==run.run_attempt)throw new Error('Attempt changed before publication');
// Status belongs to the exact workload head. Merge admission also independently verifies the latest attempt.
api(`repos/${repository}/statuses/${run.head_sha}`,{state,context:'pr fast timing',description:description.slice(0,140),target_url:run.html_url});
console.log(description);console.log(`Observer API/publication overhead: ${Date.now()-started}ms; excludes runner setup and teardown.`);
if(state!=='success')process.exitCode=1;
