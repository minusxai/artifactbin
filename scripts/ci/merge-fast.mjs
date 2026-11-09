#!/usr/bin/env node
// Operational boundary: only GitHub JSON is input; never execute PR sources with privileged tokens.
import {execFileSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {completedFastAttempt,fastContexts} from '../lib/merge-admission.mjs';
import {describeCiElapsed} from '../lib/ci-elapsed.mjs';

function github(args,input) {
 return execFileSync('gh',args,{encoding:'utf8',timeout:15000,input,maxBuffer:4*1024*1024});
}
export function api(path,payload) {
 return JSON.parse(github(['api',path,...(payload?['--method','POST','--input','-']:[])],payload?JSON.stringify(payload):undefined));
}
export function inspectAttempt(repository,id,head) {
 const workflow=api(`repos/${repository}/actions/workflows/pr-fast.yml`);
 const latest=api(`repos/${repository}/actions/runs/${id}`);
 const run=api(`repos/${repository}/actions/runs/${id}/attempts/${latest.run_attempt}`);
 // At most two pages; total_count mismatch fails closed rather than accepting partial evidence.
 const path=`repos/${repository}/actions/runs/${id}/attempts/${latest.run_attempt}/jobs?per_page=100`;
 const jobs=api(path);
 if(jobs.total_count>100){const second=api(`${path}&page=2`);jobs.jobs.push(...second.jobs);}
 const result=completedFastAttempt({run,jobs,repository,head,workflowId:workflow.id,attempt:latest.run_attempt,expected:fastContexts(readFileSync(new URL('../../.github/workflows/pr-fast.yml',import.meta.url),'utf8'))});
 if(api(`repos/${repository}/actions/runs/${id}`).run_attempt!==run.run_attempt)throw new Error('Attempt changed during admission');
 return {run,result};
}
export function mergeFast(repository,number,{read=api,execute=github,inspect=inspectAttempt}={}) {
 if(!/^[\w.-]+\/[\w.-]+$/.test(repository)||!/^\d+$/.test(number))throw new Error('Usage: merge-fast.mjs owner/repo PR');
 const path=`repos/${repository}/pulls/${number}`,pr=read(path);
 if(pr.state!=='open'||pr.base.ref!=='main'||pr.base.repo.full_name!==repository)throw new Error('Expected open PR into main');
 const runs=read(`repos/${repository}/actions/workflows/pr-fast.yml/runs?event=pull_request&head_sha=${pr.head.sha}&per_page=100`);
 if(runs.total_count>100||runs.total_count!==runs.workflow_runs.length||!runs.workflow_runs.length)throw new Error('Missing or incomplete run list');
 const matching=runs.workflow_runs.filter(r=>r.head_sha===pr.head.sha).sort((a,b)=>b.id-a.id);
 const {result}=inspect(repository,matching[0].id,pr.head.sha);
 console.log(describeCiElapsed(result,'pr'));
 if(result.status==='failed')throw new Error('Completed workload exceeds budget');
 const statuses=read(`repos/${repository}/commits/${pr.head.sha}/status?per_page=100`);
 const timing=statuses.statuses.filter(s=>s.context==='pr fast timing');
 if(!timing.length||timing[0].state!=='success')throw new Error('Required timing observer has not passed');
 if(read(path).head.sha!==pr.head.sha)throw new Error('PR head changed');
 execute(['pr','merge',number,'--repo',repository,'--squash','--admin','--match-head-commit',pr.head.sha]);
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){try{mergeFast(...process.argv.slice(2));}catch(error){console.error(error.message);process.exitCode=1;}}
