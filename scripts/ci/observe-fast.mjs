/** Run by pr-fast-timing.yml when a `pr fast` run completes: publish the required `pr fast timing` status, measured
 * from its first job's start through the last workload job's final runner step (scripts/lib/ci-elapsed.mjs budgets).
 *
 * The observer's own run is red only when it found something: the attempt over budget, or a successful attempt whose
 * evidence does not match. An attempt that itself failed or was cancelled gets a `failure` status naming that
 * conclusion and a green observer run: its red `pr fast` already says so. Until 2026-11-20 every such attempt was also
 * timed, refused as "Incomplete or mismatched completed fast attempt" and turned this workflow red (6 of 30 runs). An
 * event a newer attempt or run has superseded publishes nothing: that attempt's own observer publishes. */
import {readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {api as githubApi,inspectAttempt} from './merge-fast.mjs';
import {describeCiElapsed} from '../lib/ci-elapsed.mjs';

/** What to publish for one completed `pr fast` event: `{skip}`, or `{state,description,exitCode}`. */
export function observe({event,repository,api=githubApi,inspect=inspectAttempt}){
 const run=event.workflow_run;
 if(run?.repository?.full_name!==repository||run.event!=='pull_request'||run.path!=='.github/workflows/pr-fast.yml'||run.status!=='completed')throw new Error('Unexpected observer event');
 const latest=api(`repos/${repository}/actions/runs/${run.id}`);
 if(latest.head_sha!==run.head_sha)throw new Error('Stale observer event');
 if(latest.run_attempt!==run.run_attempt)return {skip:`Attempt ${run.run_attempt} was re-run as attempt ${latest.run_attempt}; that attempt's observer publishes.`};
 const runs=api(`repos/${repository}/actions/workflows/pr-fast.yml/runs?event=pull_request&head_sha=${run.head_sha}&per_page=100`);
 if(runs.total_count>100)throw new Error('Too many pr fast runs for one head');
 if(runs.workflow_runs.some(r=>r.id>run.id))return {skip:'A newer pr fast run of this head publishes.'};
 let result={state:'failure',description:`pr fast ${latest.conclusion}: no timing measured`,exitCode:0};
 if(latest.conclusion==='success'){
  result={state:'failure',description:'Completed fast attempt evidence rejected',exitCode:1};
  try{
   const evidence=inspect(repository,run.id,run.head_sha);
   if(evidence.run.run_attempt!==run.run_attempt)throw new Error('Stale observer attempt');
   const failed=evidence.result.status==='failed';
   result={state:failed?'failure':'success',description:describeCiElapsed(evidence.result,'pr'),exitCode:failed?1:0};
  }catch(error){console.error(error.message);}
 }
 if(api(`repos/${repository}/actions/runs/${run.id}`).run_attempt!==run.run_attempt)return {skip:'The attempt was re-run before publication; that attempt\'s observer publishes.'};
 return result;
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const event=JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH,'utf8')),repository=process.env.GITHUB_REPOSITORY,run=event.workflow_run;
 const started=Date.now(),outcome=observe({event,repository});
 if(outcome.skip)console.log(outcome.skip);
 else{
  // Status belongs to the exact workload head. Merge admission also independently verifies the latest attempt.
  githubApi(`repos/${repository}/statuses/${run.head_sha}`,{state:outcome.state,context:'pr fast timing',description:outcome.description.slice(0,140),target_url:run.html_url});
  console.log(outcome.description);console.log(`Observer API/publication overhead: ${Date.now()-started}ms; excludes runner setup and teardown.`);
  process.exitCode=outcome.exitCode;
 }
}
