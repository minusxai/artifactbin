import {it,expect} from 'vitest';
import {readFileSync, mkdtempSync, writeFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import yaml from 'yaml';
import {CI_BUDGETS, describeCiElapsed, measureCiElapsed} from '../lib/ci-elapsed.mjs';
import {JOBS, shardLoads} from '../ci/test-timings.mjs';
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
 const caches=Object.values(workflow().jobs).flatMap(job=>job.steps??[]).filter(step=>step.with?.key?.startsWith('install-v5-'));
 expect(caches.length).toBeGreaterThan(0);
 for(const cache of caches){
  expect(cache.with.key).toContain("hashFiles('.ci-cache-key/install.json')");
  expect(cache.with['restore-keys']).toBeUndefined();
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
 for(const command of ['check-local.mjs validate --part=types','check-local.mjs validate --part=lint','scripts/ci/fast-check.mjs','rhysd/actionlint','vitest.mjs run --config vitest.guard.config.ts'])expect(runs).toContain(command);
 expect(job.strategy.matrix.part).toEqual(['types','lint','tests','guards','guards-2','guards-3']);
 // The guard config runs as three time-packed shards, every guard part one of them, so each file runs exactly once.
 const shards=job.strategy.matrix.include.filter(entry=>entry.shard).map(entry=>[entry.part,entry.shard]);
 expect(shards).toEqual([['guards','1/3'],['guards-2','2/3'],['guards-3','3/3']]);
 expect(JOBS['pr-guards'].count).toBe(shards.length);
 expect(job.steps.find(step=>step.run?.includes('vitest.guard.config.ts'))).toMatchObject({if:'matrix.shard',run:expect.stringMatching(/ --shard=\$\{\{ matrix\.shard \}\}$/)});
 expect(readFileSync(new URL('../../vitest.guard.config.ts',import.meta.url),'utf8')).toContain('sequence: { sequencer: TimedSequencer }');
 expect(runs).not.toContain('docker run');
 expect(runs).toContain('sha256sum --check --strict');
 expect(JSON.stringify(lane)).not.toMatch(/tested-(tree|patch)/);
 expect(job.steps.filter(step=>step.uses?.startsWith('actions/upload-artifact')).map(step=>step.with.name)).toEqual(['tsgo-buildinfo']);
});
// #1138 (ui) and #1141 (api) each turned main red after a green pull request: neither suite ran before the merge.
it('runs every api, api-isolated, ui and islands test on every pull request, packed by measured time, each file once',()=>{
 const job=workflow('pr-fast.yml').jobs.fast;
 const suites=job.strategy.matrix.include.filter(entry=>entry.suite);
 const timings=JSON.parse(readFileSync(new URL('../ci/test-timings.json',import.meta.url),'utf8'));
 // Two groups, each one Vitest project set sharded whole: the api projects and the jsdom projects, as ci.yml's api and ui
 // jobs run them after the merge. Every project the full suite's api and ui jobs run is in exactly one group.
 const groups={api:JOBS['pr-api'],ui:JOBS['pr-ui']};
 expect([...groups.api.projects,...groups.ui.projects]).toEqual(['api','api-isolated','ui','islands']);
 expect(groups.api.projects).toEqual(JOBS.api.projects);expect(groups.ui.projects).toEqual(JOBS.ui.projects);
 const expected=Object.entries(groups).flatMap(([name,{projects,count}])=>Array.from({length:count},(_,i)=>({part:`${name}-${i+1}`,projects:projects.map(project=>`--project=${project}`).join(' '),suite:`${i+1}/${count}`})));
 expect(suites).toEqual(expected);
 // Every part the matrix adds is a job with the lane's one clock as its last step (asserted above).
 for(const entry of suites)expect(job.strategy.matrix.part).not.toContain(entry.part);
 const run=job.steps.find(step=>step.if==='matrix.suite'&&step.run?.includes('vitest.mjs run'));
 // The full suite's own configuration (vitest.config.ts) and its timed sequencer.
 expect(run.run).toBe('node node_modules/vitest/vitest.mjs run ${{ matrix.projects }} --shard=${{ matrix.suite }}');
 expect(readFileSync(new URL('../../vitest.config.ts',import.meta.url),'utf8')).toContain('sequence: { sequencer: TimedSequencer }');
 const loads=shardLoads(timings);
 for(const [name,{projects,count}] of Object.entries(groups)){
  expect(loads[`pr-${name}`]).toHaveLength(count);
  for(const project of projects)expect(Object.keys(timings.files[project]??{}).length,project).toBeGreaterThan(0);
 }
 // No browser: no file in these projects launches Chromium.
 expect(JSON.stringify(job.steps)).not.toContain('playwright');
 // The test builds restore before the run; only the first api runner saves, and only on an exact miss.
 const steps=job.steps,restore=steps.findIndex(step=>step.id==='test-builds');
 expect(restore).toBeGreaterThan(-1);expect(restore).toBeLessThan(steps.indexOf(run));
 expect(steps[restore].uses).toMatch(/^actions\/cache\/restore@/);
 const save=steps.filter(step=>step.uses?.startsWith('actions/cache/save')&&step.with.key.startsWith('test-builds-'));
 expect(save).toHaveLength(1);
 expect(save[0].if).toBe("matrix.part == 'api-1' && steps.test-builds.outputs.cache-hit != 'true'");
 expect(save[0].with).toEqual({path:steps[restore].with.path,key:steps[restore].with.key});
});
// The full suite's cheap node files ran only after the merge. pr fast runs them as one shared-graph batch, sharded by time.
it('runs the cheap node batch on every pull request: its own runners, its config\'s timed shards, each file once',()=>{
 const job=workflow('pr-fast.yml').jobs.fast;
 const batches=job.strategy.matrix.include.filter(entry=>entry.batch);
 const {count}=JOBS['pr-node'];
 expect(batches).toEqual(Array.from({length:count},(_,i)=>({part:`node-${i+1}`,batch:`${i+1}/${count}`})));
 for(const entry of batches)expect(job.strategy.matrix.part).not.toContain(entry.part);
 const run=job.steps.find(step=>step.if==='matrix.batch');
 expect(run.run).toBe('node node_modules/vitest/vitest.mjs run --config vitest.node-batch.config.ts --shard=${{ matrix.batch }}');
 const config=readFileSync(new URL('../../vitest.node-batch.config.ts',import.meta.url),'utf8');
 expect(config).toContain('sequence: { sequencer: TimedSequencer }');
 expect(config).toContain('isolate: false');
 // The batch restores the test builds (its global setup's server reader, and the schema image) before it runs.
 const steps=job.steps,restore=steps.findIndex(step=>step.id==='test-builds');
 expect(steps[restore].if).toContain('matrix.batch');
 expect(restore).toBeLessThan(steps.indexOf(run));
 expect(shardLoads(JSON.parse(readFileSync(new URL('../ci/test-timings.json',import.meta.url),'utf8')))['pr-node']).toHaveLength(count);
});
// The install cache holds Node 22's build of every native module; the lane may use the runner's own Node only when it is a 22.
it('uses Node 22 in every pr fast job: the runner\'s own when it is a 22, setup-node\'s otherwise',()=>{
 const steps=workflow('pr-fast.yml').jobs.fast.steps;
 const probe=steps.findIndex(step=>step.id==='runner-node'),setup=steps.findIndex(step=>step.uses?.startsWith('actions/setup-node@'));
 expect(steps[probe].run).toContain('node --version');
 expect(steps[probe].run).toContain('$GITHUB_OUTPUT');
 expect(steps[setup]).toMatchObject({if:"steps.runner-node.outputs.major != '22'",with:{'node-version':22}});
 expect(probe).toBeLessThan(setup);
 expect(setup).toBeLessThan(steps.findIndex(step=>step.id==='install'));
 expect(steps.find(step=>step.id==='install').with.key).toContain('-node22-');
});
it.each([['v22.23.4','22'],['v24.11.0','24']])('probes %s without starting a JavaScript evaluation', (version,major)=>{
 const directory=mkdtempSync(join(tmpdir(),'afbin-node-probe-')),output=join(directory,'output');
 try {
  const probe=workflow('pr-fast.yml').jobs.fast.steps.find(step=>step.id==='runner-node').run;
  const shell=`node(){ [ "$#" = 1 ] && [ "$1" = --version ] || return 91; printf '%s\\n' '${version}'; };\n${probe}`;
  const result=spawnSync('bash',['-e','-c',shell],{env:{...process.env,GITHUB_OUTPUT:output},encoding:'utf8'});
  expect(result.status,result.stderr).toBe(0);
  expect(readFileSync(output,'utf8')).toBe(`major=${major}\n`);
 } finally {rmSync(directory,{recursive:true,force:true});}
});
// A lock change misses the exact install key on every push; reconciling main's install beats a cold npm ci.
it('reconciles the nearest install on a lock miss, restore only, and falls back to npm ci if the lock would move',()=>{
 const steps=workflow('pr-fast.yml').jobs.fast.steps;
 const exact=steps.find(step=>step.id==='install'),near=steps.find(step=>step.id==='near-install');
 expect(near.uses).toMatch(/^actions\/cache\/restore@/);
 expect(near.if).toBe("${{ !matrix.install && steps.slim.outputs.cache-hit != 'true' && steps.install.outputs.cache-hit != 'true' }}");
 expect(near.with.path).toBe(exact.with.path);
 expect(near.with.key).toBe(exact.with.key);
 expect(near.with['restore-keys']).toBe('install-v5-${{ runner.os }}-${{ runner.arch }}-node22-');
 expect(steps.indexOf(near)).toBe(steps.indexOf(exact)+1);
 const reconcile=steps.find(step=>step.run?.startsWith('npm install '));
 expect(reconcile.if).toContain("steps.near-install.outputs.cache-matched-key != ''");
 expect(reconcile.run).toMatch(/git diff --quiet -- package-lock\.json[^\n]*\n[\s\S]*copy-assets\.mjs[\s\S]*else[\s\S]*git checkout -- package-lock\.json[\s\S]*npm ci /);
 const cold=steps.filter(step=>/^npm ci /.test(step.run??''));
 expect(cold.map(step=>step.if)).toEqual(["matrix.install && steps.own-install.outputs.cache-hit != 'true'","${{ !matrix.install && steps.slim.outputs.cache-hit != 'true' && steps.install.outputs.cache-hit != 'true' && steps.near-install.outputs.cache-matched-key == '' }}"]);
 // No stale install is ever saved from a pull request: the one install save is the `install` runner's clean `npm ci`,
 // only when this lock's exact key is missing, and every other runner skips it. The other save is the test builds.
 // (The slim install's own save, from the same runner, is scripts/__tests__/slim-install.test.mjs's.)
 const saves=steps.filter(step=>(step.uses?.startsWith('actions/cache/save')||step.uses?.startsWith('actions/cache@'))&&!step.with.key.startsWith('install-slim-'));
 expect(saves.map(step=>step.with.key)).toEqual([exact.with.key,'test-builds-v2-${{ runner.os }}-${{ steps.test-builds-key.outputs.key }}']);
 const own=steps.find(step=>step.id==='own-install');
 expect(own).toMatchObject({if:'matrix.install',with:{path:exact.with.path,key:exact.with.key,'lookup-only':true}});
 expect(saves[0]).toMatchObject({if:"matrix.install && steps.own-install.outputs.cache-hit != 'true'",with:{path:exact.with.path,key:exact.with.key}});
 expect(steps.indexOf(cold[0])).toBe(steps.findIndex(step=>step.id==='own-slim')+1);expect(steps.indexOf(saves[0])).toBe(steps.indexOf(cold[0])+1);
 expect(exact.if).toBe("${{ !matrix.install && steps.slim.outputs.cache-hit != 'true' }}");
 expect(workflow('pr-fast.yml').jobs.fast.strategy.matrix.include.filter(entry=>entry.install)).toEqual([{part:'install',install:true}]);
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
  const warning=run(45);
  expect(warning.status).toBe(0); expect(warning.stdout).toContain('::warning::PR CI took');
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
// The guard tier: node-project tests that read the repository by path, each a contract that once broke main.
it('enrolls existing node-project guard tests that the full suite also runs, once each, outside the fast list',()=>{
 const read=path=>JSON.parse(readFileSync(new URL(`../../${path}`,import.meta.url),'utf8'));
 const guards=read('scripts/ci/guard-tests.json'),fast=read('scripts/ci/fast-tests.json');
 expect(guards.length).toBeGreaterThan(0);
 expect(guards).toEqual([...new Set(guards)].sort());
 for(const file of guards){
  expect(readFileSync(new URL(`../../${file}`,import.meta.url),'utf8').length,file).toBeGreaterThan(0);
  expect(file).toMatch(/^(?:scripts\/(?:.+\/)?__tests__\/[^/]+\.test\.mjs|services\/app\/lib\/(?:.+\/)?__tests__\/[^/]+(?<!\.ui)\.test\.ts)$/);
  expect(fast).not.toContain(file);
 }
});
// The contract tier: route-level scenarios another repository runs against its production composition after merge.
it('enrolls node-project contract tests that the full suite also runs, once each, outside the other lists',()=>{
 const read=path=>JSON.parse(readFileSync(new URL(`../../${path}`,import.meta.url),'utf8'));
 const contracts=read('scripts/ci/contract-tests.json'),guards=read('scripts/ci/guard-tests.json'),fast=read('scripts/ci/fast-tests.json');
 expect(contracts).toContain('services/app/lib/page-doors/__tests__/native-acceptance.test.ts');
 expect(contracts).toEqual([...new Set(contracts)].sort());
 expect(readFileSync(new URL('../../vitest.guard.config.ts',import.meta.url),'utf8')).toContain("byIsolation('pr-contracts', 'contract-tests.json'");
 for(const file of contracts){
  expect(readFileSync(new URL(`../../${file}`,import.meta.url),'utf8').length,file).toBeGreaterThan(0);
  expect(file).toMatch(/^services\/app\/lib\/(?:.+\/)?__tests__\/[^/]+(?<!\.ui)\.test\.ts$/);
  expect(fast).not.toContain(file);expect(guards).not.toContain(file);
 }
});
