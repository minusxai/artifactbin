import {it,expect} from 'vitest';
import {readFileSync, mkdtempSync, writeFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import yaml from 'yaml';
import {measureCiElapsed} from '../lib/ci-elapsed.mjs';
const workflow=()=>yaml.parse(readFileSync(new URL('../../.github/workflows/ci.yml',import.meta.url),'utf8'));

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
