import {it, expect} from 'vitest';
import {completedFastAttempt} from '../lib/merge-admission.mjs';
const sha='a'.repeat(40), repo='example/repo';
const started='2026-11-07T09:41:56Z';
const at=seconds=>new Date(Date.parse(started)+seconds*1000).toISOString();
const steps=(seconds,start=0)=>[
 {name:'Set up job',number:1,status:'completed',conclusion:'success',started_at:at(start),completed_at:at(start+1)},
 {name:'Run tests',number:2,status:'completed',conclusion:'success',started_at:at(start+1),completed_at:at(seconds)},
 {name:'Complete job',number:3,status:'completed',conclusion:'success',started_at:at(seconds),completed_at:at(seconds)},
];
const fixture=(seconds=60,reportedSeconds=seconds)=>({run:{id:1,workflow_id:2,run_attempt:1,head_sha:sha,event:'pull_request',path:'.github/workflows/pr-fast.yml',repository:{full_name:repo},status:'completed',conclusion:'success',run_started_at:'2026-11-07T09:40:00Z'},jobs:{total_count:1,jobs:[{id:3,run_id:1,run_attempt:1,head_sha:sha,name:'fast (guards)',status:'completed',conclusion:'success',started_at:started,completed_at:at(reportedSeconds),steps:steps(seconds)}]}});
const check=f=>completedFastAttempt({...f,repository:repo,head:sha,workflowId:2,attempt:1,expected:['fast (guards)']});
it('times the completed workload from the first job start through runner cleanup, excluding later job finalization',()=>{
 expect(check(fixture(19,108))).toMatchObject({seconds:19,status:'target'});
 expect(check(fixture(40)).status).toBe('slow');
 expect(check(fixture()).seconds).toBe(60);
 expect(check(fixture(60.001,108)).status).toBe('failed');
 const f=fixture(19,108);
 const complete=f.jobs.jobs[0].steps.pop();
 f.jobs.jobs[0].steps.push({name:'Post cleanup',number:3,status:'completed',conclusion:'success',started_at:at(19),completed_at:at(61)},
  {...complete,number:4,started_at:at(61),completed_at:at(61)});
 expect(check(f)).toMatchObject({seconds:61,status:'failed'});
});
it('refuses missing, ambiguous or impossible runner step evidence',()=>{
 for(const mutate of [
  job=>delete job.steps,job=>job.steps=[],job=>job.steps.pop(),job=>job.steps[1].name='Complete job',
  job=>job.steps[2].status='in_progress',job=>job.steps[2].conclusion='skipped',
  job=>job.steps[2].completed_at=null,job=>job.steps[2].completed_at=at(109),
  job=>job.steps[1].completed_at=at(20),job=>job.steps[1].started_at=at(-1),
  job=>job.steps[1].number=3,job=>job.started_at=null,job=>job.completed_at=at(-1),
 ]){const f=fixture(19,108);mutate(f.jobs.jobs[0]);expect(()=>check(f)).toThrow(/Incomplete or mismatched/);}
});
it('refuses incomplete, stale, ambiguous, wrong attempt and unsuccessful evidence',()=>{
 for(const mutate of [f=>f.run.status='in_progress',f=>f.run.head_sha='b'.repeat(40),f=>f.run.event='push',f=>f.run.repository.full_name='other/repo',f=>f.run.path='other.yml',f=>f.jobs.jobs[0].head_sha='old',f=>f.jobs.jobs[0].run_id=9,f=>f.jobs.jobs[0].status='queued',f=>f.run.workflow_id=4,f=>f.run.run_attempt=2,f=>f.jobs.total_count=2,f=>f.jobs.jobs.push(f.jobs.jobs[0]),f=>f.jobs.jobs[0].completed_at=null,f=>f.jobs.jobs[0].run_attempt=2,f=>f.jobs.jobs[0].name='other',...['failure','skipped','cancelled','timed_out',null].map(c=>f=>f.jobs.jobs[0].conclusion=c)]){const f=fixture();mutate(f);expect(()=>check(f)).toThrow();}
});
it('admits jobs a pull request adds to the lane and times them, but never a lane missing a job main expects',()=>{
 // The observer reads main's workflow, so `expected` is main's job set: a head that adds runners has more jobs.
 const added=(seconds=40)=>{const f=fixture(40);f.jobs.jobs.push({...f.jobs.jobs[0],id:4,name:'fast (node-1)',started_at:at(1),completed_at:at(seconds+1),steps:steps(seconds+1,1)});f.jobs.total_count=2;return f;};
 expect(check(added()).seconds).toBe(41);
 expect(check(added(61)).status).toBe('failed');
 for(const mutate of [f=>f.jobs.jobs[1].conclusion='failure',f=>f.jobs.jobs[1].status='in_progress',f=>f.jobs.jobs[1].name='deploy',f=>f.jobs.jobs[1].name='fast (guards)',f=>f.jobs.jobs[0].name='fast (renamed)',f=>f.jobs.jobs[1].head_sha='old']){const f=added();mutate(f);expect(()=>check(f)).toThrow();}
});

import {readFileSync} from 'node:fs';
import yaml from 'yaml';
import {fastContexts} from '../lib/merge-admission.mjs';
it('derives all matrix contexts and uses a trusted bounded completed-workflow observer',()=>{
 const read=p=>readFileSync(new URL('../../'+p,import.meta.url),'utf8');
 expect(fastContexts(read('.github/workflows/pr-fast.yml'))).toHaveLength(53);
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
it('integrates exact-head squash admission and emits no merge for invalid evidence, a moving head, a stale base or a moving main',()=>{
 // stale: the green check ran on a main the head does not contain (two PRs, each green alone, broke main together).
 for(const mode of ['green','red','missing','moving','stale','main-moving']){
  const commands=[];let reads=0,mains=0;
  const read=path=>{
   if(path.endsWith('/git/ref/heads/main'))return {object:{sha:mode==='main-moving'&&mains++?'d'.repeat(40):'c'.repeat(40)}};
   if(path.includes('/compare/')){expect(path).toBe(`repos/${repo}/compare/${'c'.repeat(40)}...${sha}`);return {status:mode==='stale'?'diverged':'ahead',behind_by:mode==='stale'?1:0};}
   if(path.includes('/pulls/'))return {state:'open',base:{ref:'main',repo:{full_name:repo}},head:{sha:mode==='moving'&&reads++?'b'.repeat(40):sha}};
   if(path.includes('/status?'))return {statuses:mode==='missing'?[]:[{context:'pr fast timing',state:'success'}]};
   return {total_count:1,workflow_runs:[{id:1,head_sha:sha}]};
  };
  const invoke=()=>mergeFast(repo,'1',{read,execute:args=>commands.push(args),inspect:()=>({result:check(fixture(mode==='red'?61:19,108))})});
  if(mode==='green'){invoke();expect(commands).toEqual([['pr','merge','1','--repo',repo,'--squash','--admin','--match-head-commit',sha]]);}
  else{expect(invoke).toThrow(mode==='red'?/Completed workload exceeds budget/:mode==='stale'?/does not contain main/:mode==='main-moving'?/main moved/:/./);expect(commands).toEqual([]);}
 }
});
it('admits the complete workload and refuses a missing matrix job',()=>{
 const expected=fastContexts(readFileSync(new URL('../../.github/workflows/pr-fast.yml',import.meta.url),'utf8'));
 const f=fixture();f.jobs={total_count:expected.length,jobs:expected.map((name,i)=>({...f.jobs.jobs[0],id:i+1,name}))};
 const invoke=()=>completedFastAttempt({...f,repository:repo,head:sha,workflowId:2,attempt:1,expected});
 expect(invoke().seconds).toBe(60);f.jobs.jobs.pop();expect(invoke).toThrow();
});

import {observe} from '../ci/observe-fast.mjs';
it('the timing observer fails a red attempt\'s status without failing itself, and leaves a superseded event to the newer attempt',()=>{
 // pr fast 44704512620 failed; its observer (44704608999) timed it anyway, refused it as "Incomplete or mismatched
 // completed fast attempt" and went red: 6 of 30 observer runs on 2026-11-20 were red pr fast attempts or re-runs.
 const event=conclusion=>({workflow_run:{id:1,run_attempt:1,head_sha:sha,event:'pull_request',path:'.github/workflows/pr-fast.yml',repository:{full_name:repo},status:'completed',conclusion,html_url:'u'}});
 const reader=({attempt=1,later=attempt,conclusion='success',newer=false}={})=>{let reads=0;return path=>{
  if(path===`repos/${repo}/actions/runs/1`)return {run_attempt:reads++?later:attempt,head_sha:sha,conclusion};
  if(path.startsWith(`repos/${repo}/actions/workflows/pr-fast.yml/runs?`))return {total_count:newer?2:1,workflow_runs:[{id:1},...(newer?[{id:2}]:[])]};
  throw new Error('unexpected '+path);
 };};
 const inspected=[],inspect=(seconds,reportedSeconds=seconds)=>(_r,id,head)=>{inspected.push(id);const f=fixture(seconds,reportedSeconds);return {run:f.run,result:check(f)};};
 for(const conclusion of ['failure','cancelled','timed_out'])
  expect(observe({event:event(conclusion),repository:repo,api:reader({conclusion}),inspect:inspect(30)})).toEqual({state:'failure',description:`pr fast ${conclusion}: no timing measured`,exitCode:0});
 expect(inspected).toEqual([]);
 expect(observe({event:event('success'),repository:repo,api:reader(),inspect:inspect(19,108)})).toMatchObject({state:'success',description:expect.stringContaining('19.0s'),exitCode:0});
 expect(observe({event:event('success'),repository:repo,api:reader(),inspect:inspect(61,108)})).toMatchObject({state:'failure',description:expect.stringContaining('61.0s'),exitCode:1});
 expect(observe({event:event('success'),repository:repo,api:reader(),inspect:()=>{throw new Error('Incomplete or mismatched completed fast attempt');}})).toEqual({state:'failure',description:'Completed fast attempt evidence rejected',exitCode:1});
 // A re-run before the observer read the run, or before it published, and a newer run of the head: nothing published.
 for(const api of [reader({attempt:2}),reader({later:2}),reader({newer:true})])expect(observe({event:event('failure'),repository:repo,api,inspect:inspect(30)})).toHaveProperty('skip');
 expect(()=>observe({event:{workflow_run:{...event('success').workflow_run,event:'push'}},repository:repo,api:reader(),inspect:inspect(30)})).toThrow('Unexpected observer event');
});
