import {it, expect} from 'vitest';
import {completedFastAttempt} from '../lib/merge-admission.mjs';
const sha='a'.repeat(40), repo='example/repo';
const fixture=(seconds=60)=>({run:{id:1,workflow_id:2,run_attempt:1,head_sha:sha,event:'pull_request',path:'.github/workflows/pr-fast.yml',repository:{full_name:repo},status:'completed',conclusion:'success',run_started_at:'2026-11-07T09:41:56Z'},jobs:{total_count:1,jobs:[{id:3,run_id:1,run_attempt:1,head_sha:sha,name:'fast (guards)',status:'completed',conclusion:'success',completed_at:new Date(Date.parse('2026-11-07T09:41:56Z')+seconds*1000).toISOString(),steps:[{completed_at:'2026-11-07T09:42:54Z'}]}]}});
const check=f=>completedFastAttempt({...f,repository:repo,head:sha,workflowId:2,attempt:1,expected:['fast (guards)']});
it('uses completed job time: historical 58s clock hides 61s; inclusive 60s, exclusive 60.001s',()=>{
 expect(check(fixture(61)).status).toBe('failed'); expect(check(fixture()).seconds).toBe(60);expect(check(fixture(60.001)).status).toBe('failed');expect(check(fixture(40)).status).toBe('normal');
});
it('refuses incomplete, stale, ambiguous, wrong attempt and unsuccessful evidence',()=>{
 for(const mutate of [f=>f.run.status='in_progress',f=>f.run.head_sha='b'.repeat(40),f=>f.run.event='push',f=>f.run.repository.full_name='other/repo',f=>f.run.path='other.yml',f=>f.jobs.jobs[0].head_sha='old',f=>f.jobs.jobs[0].run_id=9,f=>f.jobs.jobs[0].status='queued',f=>f.run.workflow_id=4,f=>f.run.run_attempt=2,f=>f.jobs.total_count=2,f=>f.jobs.jobs.push(f.jobs.jobs[0]),f=>f.jobs.jobs[0].completed_at=null,f=>f.jobs.jobs[0].run_attempt=2,f=>f.jobs.jobs[0].name='other',...['failure','skipped','cancelled','timed_out',null].map(c=>f=>f.jobs.jobs[0].conclusion=c)]){const f=fixture();mutate(f);expect(()=>check(f)).toThrow();}
});
it('admits jobs a pull request adds to the lane and times them, but never a lane missing a job main expects',()=>{
 // The observer reads main's workflow, so `expected` is main's job set: a head that adds runners has more jobs.
 const added=(seconds=40)=>{const f=fixture(40);f.jobs.jobs.push({...f.jobs.jobs[0],id:4,name:'fast (node-1)',completed_at:new Date(Date.parse('2026-11-07T09:41:56Z')+seconds*1000).toISOString()});f.jobs.total_count=2;return f;};
 expect(check(added()).status).toBe('normal');
 expect(check(added(61)).status).toBe('failed');
 for(const mutate of [f=>f.jobs.jobs[1].conclusion='failure',f=>f.jobs.jobs[1].status='in_progress',f=>f.jobs.jobs[1].name='deploy',f=>f.jobs.jobs[1].name='fast (guards)',f=>f.jobs.jobs[0].name='fast (renamed)',f=>f.jobs.jobs[1].head_sha='old']){const f=added();mutate(f);expect(()=>check(f)).toThrow();}
});

import {readFileSync} from 'node:fs';
import yaml from 'yaml';
import {fastContexts} from '../lib/merge-admission.mjs';
it('derives all matrix contexts and uses a trusted bounded completed-workflow observer',()=>{
 const read=p=>readFileSync(new URL('../../'+p,import.meta.url),'utf8');
 expect(fastContexts(read('.github/workflows/pr-fast.yml'))).toHaveLength(35);
 const w=yaml.parse(read('.github/workflows/pr-fast-timing.yml'));
 expect(w.on.workflow_run).toEqual({workflows:['pr fast'],types:['completed']});
 expect(w.permissions).toEqual({contents:'read',actions:'read',statuses:'write'});
 expect(w.jobs.timing['timeout-minutes']).toBe(2);
 const checkout=w.jobs.timing.steps[0];expect(checkout.with.ref).toBe('${{ github.event.repository.default_branch }}');expect(checkout.with['persist-credentials']).toBe(false);
 expect(JSON.stringify(w)).not.toMatch(/workflow_run.head_sha|download-artifact|npm /);
 const merge=read('scripts/ci/merge-fast.mjs');
 for(const flag of ['--squash','--admin','--match-head-commit'])expect(merge).toContain(flag);
 expect(read('AGENTS.md')).toContain('node scripts/ci/merge-fast.mjs owner/repo PR');
});
import {mergeFast} from '../ci/merge-fast.mjs';
it('integrates exact-head squash admission and emits no merge for invalid evidence or a moving head',()=>{
 for(const mode of ['green','red','missing','moving']){
  const commands=[];let reads=0;
  const read=path=>{
   if(path.includes('/pulls/'))return {state:'open',base:{ref:'main',repo:{full_name:repo}},head:{sha:mode==='moving'&&reads++?'b'.repeat(40):sha}};
   if(path.includes('/status?'))return {statuses:mode==='missing'?[]:[{context:'pr fast timing',state:'success'}]};
   return {total_count:1,workflow_runs:[{id:1,head_sha:sha}]};
  };
  const invoke=()=>mergeFast(repo,'1',{read,execute:args=>commands.push(args),inspect:()=>({result:{...check(fixture()),status:mode==='red'?'failed':'slow'}})});
  if(mode==='green'){invoke();expect(commands).toEqual([['pr','merge','1','--repo',repo,'--squash','--admin','--match-head-commit',sha]]);}
  else{expect(invoke).toThrow();expect(commands).toEqual([]);}
 }
});
it('admits the complete 35-context workload and refuses a missing matrix job',()=>{
 const expected=fastContexts(readFileSync(new URL('../../.github/workflows/pr-fast.yml',import.meta.url),'utf8'));
 const f=fixture();f.jobs={total_count:35,jobs:expected.map((name,i)=>({...f.jobs.jobs[0],id:i+1,name}))};
 const invoke=()=>completedFastAttempt({...f,repository:repo,head:sha,workflowId:2,attempt:1,expected});
 expect(invoke().seconds).toBe(60);f.jobs.jobs.pop();expect(invoke).toThrow();
});
