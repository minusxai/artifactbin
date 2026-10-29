import {it,expect} from 'vitest';
import {readFileSync, mkdtempSync, writeFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import yaml from 'yaml';
import {CI_BUDGETS, describeCiElapsed, measureCiElapsed} from '../lib/ci-elapsed.mjs';
const workflow=(name='ci.yml')=>yaml.parse(readFileSync(new URL(`../../.github/workflows/${name}`,import.meta.url),'utf8'));

it('reports four-minute per-job diagnostics while the complete chain owns the hard limit',()=>{
 const jobs=workflow().jobs,step=jobs.test.steps.find(step=>step.env?.BUDGET_S);
 expect(step.env.BUDGET_S).toBe('240');expect(step.env).not.toHaveProperty('SLOW_BUDGET_S');
 expect(step.run).not.toContain('SLOW_BUDGET_S');
 expect(step.run).toContain('budget="$BUDGET_S"');
 expect(step.run).not.toContain('exit 1');
 expect(step.run).toContain('::warning::');
 expect(step['continue-on-error']).toBe(true);
});
it('measures the complete attempt chain including waits instead of individual job durations',()=>{
 const start='2026-10-06T00:00:00Z';
 expect(measureCiElapsed(start,'2026-10-06T00:08:01Z')).toEqual({seconds:481,status:'failed',targetSeconds:180,normalSeconds:240,hardSeconds:480});
});
it('keeps the hard limit inclusive and reports target and normal ranges separately',()=>{
 const start='2026-10-06T00:00:00Z';
 for(const [seconds,status] of [[179,'target'],[180,'normal'],[239,'normal'],[240,'slow'],[300,'slow'],[480,'slow'],[480.001,'failed']]) {
  expect(measureCiElapsed(start,new Date(Date.parse(start)+seconds*1000).toISOString()).status).toBe(status);
 }
});
it('fails closed on missing, malformed or reversed attempt timestamps',()=>{
 for(const start of [undefined,null,'','nonsense']) expect(()=>measureCiElapsed(start,'2026-10-06T00:05:01Z')).toThrow(/timestamp/);
 expect(()=>measureCiElapsed('2026-10-06T00:05:01Z','2026-10-06T00:00:00Z')).toThrow(/before/);
});
it('enforces chained time on main and pull requests before receipts and at the final rollup step',()=>{
 const steps=workflow().jobs.test.steps;
 const chain=steps.filter(step=>step.run?.includes('ci-elapsed.mjs'));
 expect(chain).toHaveLength(2);
 expect(chain.every(step=>step.if==='always()' && step['continue-on-error']===undefined)).toBe(true);
 expect(chain[0].run).toContain('/attempts/${GITHUB_RUN_ATTEMPT}');
 expect(steps.indexOf(chain[0])).toBeLessThan(steps.findIndex(step=>step.id==='tree'));
 expect(steps.at(-1)).toBe(chain[1]);
 expect(chain.every(step=>!step.run.includes('pull_request'))).toBe(true);
});

it('exits nonzero for an over-limit attempt and missing start, but accepts a fresh rerun',()=>{
 const directory=mkdtempSync(join(tmpdir(),'afbin-ci-elapsed-'));
 const attempt=join(directory,'attempt.json'),summary=join(directory,'summary.md');
 const run=(payload)=>{
  writeFileSync(attempt,JSON.stringify(payload));
  return spawnSync(process.execPath,[fileURLToPath(new URL('../lib/ci-elapsed.mjs',import.meta.url)),attempt,summary],{encoding:'utf8'});
 };
 try {
  const old=run({run_started_at:new Date(Date.now()-481000).toISOString()});
  expect(old.status).toBe(1); expect(old.stdout).toContain('::error::');
  const fresh=run({run_started_at:new Date(Date.now()-1000).toISOString()});
  expect(fresh.status).toBe(0); expect(fresh.stdout).toContain('(target)');
  expect(readFileSync(summary,'utf8')).toContain('hard failure >480s');
  expect(run({created_at:'2020-01-01T00:00:00Z'}).status).toBe(1);
 } finally {rmSync(directory,{recursive:true,force:true});}
});
it('warns rather than fails when a PR consumer includes a long prerequisite wait',()=>{
 const step=workflow().jobs.test.steps.find(step=>step.env?.BUDGET_S),directory=mkdtempSync(join(tmpdir(),'afbin-job-time-warning-'));
 const summary=join(directory,'summary.md');
 writeFileSync(join(directory,'gh'),"#!/bin/sh\nprintf '%s\\n' '259\tapi (1/4)\tsuccess\tWait for current attempt 65s'\n",{mode:0o755});
 try{
  const result=spawnSync('bash',['-c',step.run],{cwd:directory,encoding:'utf8',env:{PATH:directory+':'+process.env.PATH,BUDGET_S:'240',GITHUB_REPOSITORY:'test/repo',GITHUB_RUN_ID:'1',GITHUB_RUN_ATTEMPT:'1',GITHUB_EVENT_NAME:'pull_request',GITHUB_STEP_SUMMARY:summary}});
  expect(result.status,result.stderr).toBe(0);expect(result.stdout).toContain('::warning::');expect(result.stdout).toContain('259s');
  expect(readFileSync(summary,'utf8')).toContain('259');
 }finally{rmSync(directory,{recursive:true,force:true});}
});

it('keys repository install caches on the shared font pipeline without removed vendored inputs',()=>{
 const caches=Object.values(workflow().jobs).flatMap(job=>job.steps??[]).filter(step=>step.with?.key?.startsWith('install-v4-'));
 expect(caches.length).toBeGreaterThan(0);
 for(const cache of caches){
  expect(cache.with.key).toContain('services/app/scripts/system-font-packages.mjs');
  expect(cache.with.key).not.toContain('design-systems/font-assets');
  expect(cache.with.key).not.toContain('design-systems/lib/font-assets.mjs');
 }
});

// The pull request lane: aim for 40s, fail over 60s (scripts/lib/ci-elapsed.mjs). Never raise it.
it('makes the pull request lane the one that enforces the 60-second limit, in every job, as its last step',()=>{
 const lane=workflow('pr-fast.yml');
 expect(lane.on.pull_request.branches).toEqual(['main']);
 expect(lane.concurrency).toBeUndefined();
 const job=lane.jobs.fast;
 expect(job['timeout-minutes']).toBeLessThanOrEqual(2);
 expect(job.strategy['fail-fast']).toBe(false);
 const clock=job.steps.at(-1);
 expect(clock.if).toBe('always()');
 expect(clock.run).toContain('/attempts/${GITHUB_RUN_ATTEMPT}');
 expect(clock.run).toContain('node scripts/lib/ci-elapsed.mjs --pr ');
 expect(job.steps.filter(step=>step.run?.includes('ci-elapsed.mjs'))).toHaveLength(1);
 // The lane covers all of validate and the fast module list, and records no tested-tree evidence: only
 // ci.yml's full suite may let main's push skip its tests.
 const runs=job.steps.map(step=>step.run??'').join('\n');
 for(const command of ['check-local.mjs validate --part=types','check-local.mjs validate --part=lint','scripts/ci/fast-check.mjs','rhysd/actionlint'])expect(runs).toContain(command);
 expect(job.strategy.matrix.part).toEqual(['types','lint','tests']);
 expect(JSON.stringify(lane)).not.toMatch(/tested-(tree|patch)/);
 expect(job.steps.filter(step=>step.uses?.startsWith('actions/upload-artifact')).map(step=>step.with.name)).toEqual(['tsgo-buildinfo']);
});
it('fails the pull request lane past 60 seconds with the plain budget message',()=>{
 const directory=mkdtempSync(join(tmpdir(),'afbin-pr-elapsed-'));
 const attempt=join(directory,'attempt.json'),summary=join(directory,'summary.md');
 const run=(seconds)=>{
  writeFileSync(attempt,JSON.stringify({run_started_at:new Date(Date.now()-seconds*1000).toISOString()}));
  return spawnSync(process.execPath,[fileURLToPath(new URL('../lib/ci-elapsed.mjs',import.meta.url)),'--pr',attempt,summary],{encoding:'utf8'});
 };
 try {
  const slow=run(75);
  expect(slow.status).toBe(1);
  expect(slow.stdout).toMatch(/::error::PR CI took 7\d\.\ds: the limit is 60s \(aim for 40s\)\. Fix the critical path; do not raise the budget\./);
  const fast=run(5);
  expect(fast.status).toBe(0); expect(fast.stdout).toContain('(target): aim for 40s; the limit is 60s');
 } finally {rmSync(directory,{recursive:true,force:true});}
});

// THE PULL REQUEST CI BUDGET IS A HARD RULE: aim for 40s; the limit is 60s. These fail when anyone
// raises it. Do not edit the numbers here to make a slow lane pass: fix the critical path.
const prStart = '2026-10-29T00:00:00Z';
const after = seconds => new Date(Date.parse(prStart) + seconds * 1000).toISOString();

it('keeps the pull request budget at a 40-second aim and a 60-second hard limit', () => {
  expect(CI_BUDGETS.pr).toEqual({targetSeconds: 40, normalSeconds: 60, hardSeconds: 60});
  expect(Object.isFrozen(CI_BUDGETS.pr)).toBe(true);
});

it('fails a pull request run just past 60 seconds and passes one at 60', () => {
  for (const [seconds, status] of [[0, 'target'], [39.999, 'target'], [40, 'normal'], [59.999, 'normal'], [60, 'slow'], [60.001, 'failed'], [235, 'failed']]) {
    expect(measureCiElapsed(prStart, after(seconds), {lane: 'pr'}).status, `${seconds}s`).toBe(status);
  }
});

it('says what failed and that the budget must not be raised', () => {
  const failed = measureCiElapsed(prStart, after(75), {lane: 'pr'});
  expect(describeCiElapsed(failed, 'pr')).toBe('PR CI took 75.0s: the limit is 60s (aim for 40s). Fix the critical path; do not raise the budget.');
  expect(describeCiElapsed(measureCiElapsed(prStart, after(30), {lane: 'pr'}), 'pr')).toContain('aim for 40s; the limit is 60s');
});

it('keeps the full-suite budget separate and rejects unknown lanes', () => {
  expect(measureCiElapsed(prStart, after(75)).status).toBe('target');
  expect(() => measureCiElapsed(prStart, after(1), {lane: 'quick'})).toThrow(/Unknown CI lane/);
});
