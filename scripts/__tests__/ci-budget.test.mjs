import {it,expect} from 'vitest';
import {readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import yaml from 'yaml';
import {CI_BUDGETS, describeCiElapsed, measureCiElapsed} from '../lib/ci-elapsed.mjs';
import {JOBS, shardLoads} from '../ci/test-timings.mjs';
import {NODE_TIMINGS_ARTIFACT} from '../lib/node-batch.mjs';
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
 // The test builds restore before the run, each runner its own kind's entry (its configuration's module cache: see
 // scripts/__tests__/ci-plan.test.mjs); only the last runner of each kind saves, and only on an exact miss. Packing puts
 // the longest files first, often one to a runner (api-1 and guards held a single file in run 44142401757), so the last
 // runner holds the most files and its entry the most modules.
 const steps=job.steps,restore=steps.findIndex(step=>step.id==='test-builds');
 expect(restore).toBeGreaterThan(-1);expect(restore).toBeLessThan(steps.indexOf(run));
 expect(steps[restore].uses).toMatch(/^actions\/cache\/restore@/);
 expect(steps[restore].with.key).toBe('test-builds-v3-${{ runner.os }}-${{ env.TEST_BUILDS_KIND }}-${{ steps.test-builds-key.outputs.key }}-${{ steps.test-builds-key.outputs.modules }}');
 expect(job.env.TEST_BUILDS_KIND).toBe("${{ matrix.shard && 'guards' || matrix.batch && 'node' || matrix.suite && startsWith(matrix.part, 'ui-') && 'ui' || 'api' }}");
 const save=steps.filter(step=>step.uses?.startsWith('actions/cache/save')&&step.with.key.startsWith('test-builds-'));
 expect(save).toHaveLength(1);
 expect(save[0].if).toBe("contains(fromJSON('[\"api-32\",\"ui-7\",\"guards-3\",\"node-3\"]'), matrix.part) && steps.test-builds.outputs.cache-hit != 'true'");
 expect(save[0].with).toEqual({path:steps[restore].with.path,key:steps[restore].with.key});
 // Saved after every test step, so a saver's own transforms are in its entry.
 expect(steps.indexOf(save[0])).toBeGreaterThan(Math.max(...steps.flatMap((step,i)=>(step.run??'').includes('vitest.mjs run')?[i]:[])));
 const savers=JSON.parse(save[0].if.match(/fromJSON\('(.*?)'\)/)[1]);
 const parts=job.strategy.matrix.include.filter(entry=>entry.suite||entry.shard||entry.batch).map(entry=>entry.part);
 // The last runner of each kind, and no other.
 expect(savers).toEqual([parts.findLast(part=>part.startsWith('api-')),parts.findLast(part=>part.startsWith('ui-')),parts.findLast(part=>part.startsWith('guards')),parts.findLast(part=>part.startsWith('node-'))]);
});
// The full suite's cheap node files ran only after the merge. pr fast runs them as one shared-graph batch, sharded by time.
it('runs the cheap node batch on every pull request: its own runners, its config\'s timed shards, each file once',()=>{
 const job=workflow('pr-fast.yml').jobs.fast;
 const batches=job.strategy.matrix.include.filter(entry=>entry.batch);
 const {count}=JOBS['pr-node'];
 expect(batches).toEqual(Array.from({length:count},(_,i)=>({part:`node-${i+1}`,batch:`${i+1}/${count}`})));
 for(const entry of batches)expect(job.strategy.matrix.part).not.toContain(entry.part);
 const run=job.steps.find(step=>step.if==='matrix.batch'&&(step.run??'').includes('vitest'));
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
// A node file with no recorded time never ran on a pull request until someone refreshed the table by hand (70 of 668 on
// 2026-11-17). Main measures them after each green ci run, and every node runner lays those times over the table.
it('lays main\'s measured node times over the table on every node runner, fetched beside the install and awaited before the batch',()=>{
 const steps=workflow('pr-fast.yml').jobs.fast.steps;
 const at=(predicate)=>steps.findIndex(predicate);
 const fetch=at(step=>(step.run??'').includes('scripts/ci/ci.mjs node-timings'));
 const wait=at(step=>(step.run??'').includes('node-timings.status')&&!(step.run??'').includes('ci.mjs'));
 const batch=at(step=>step.if==='matrix.batch'&&(step.run??'').includes('vitest.node-batch.config.ts'));
 for(const index of [fetch,wait])expect(steps[index].if).toBe('matrix.batch');
 // Started right after checkout (ci.mjs is builtin-only, so any Node runs it), in the background.
 expect(fetch).toBe(steps.findIndex(step=>step.uses?.startsWith('actions/checkout@'))+1);
 expect(steps[fetch].run.trim()).toMatch(/&$/);
 expect(steps[fetch].run).toContain('< /dev/null > /dev/null 2>&1 &');
 expect(steps[fetch].env.GH_TOKEN).toBe('${{ github.token }}');
 // Its status is written whole (moved into place), so the wait never reads a half-written one.
 expect(steps[fetch].run).toContain('mv "$RUNNER_TEMP/node-timings.part" "$RUNNER_TEMP/node-timings.status"');
 // Run as Actions runs them (bash -e), a fetch that fails hands its status and log to the wait, which fails with it,
 // instead of leaving the wait spinning to the job's timeout; one that succeeds lets the batch run.
 for(const [fetcher,status] of [['sh -c "echo answered 503, twice >&2; exit 7"',7],['echo chosen',0]]){
  const temp=mkdtempSync(join(tmpdir(),'node-timings-step-'));
  try{
   const env={PATH:process.env.PATH,RUNNER_TEMP:temp};
   const started=spawnSync('bash',['-e','-c',`${steps[fetch].run.replace('node scripts/ci/ci.mjs node-timings',fetcher)}\nwait`],{env,encoding:'utf8'});
   expect(started.status).toBe(0);
   const waited=spawnSync('bash',['-e','-c',steps[wait].run],{env,encoding:'utf8',timeout:5000});
   expect(waited.status).toBe(status);
   expect(waited.stdout).toContain(status?'answered 503, twice':'chosen');
  }finally{rmSync(temp,{recursive:true,force:true});}
 }
 expect(fetch).toBeLessThan(at(step=>step.id==='slim'));
 expect(wait).toBe(batch-1);
 // No other runner fetches them: the api, ui and guard runners pack by the committed table alone.
 expect(steps.filter(step=>(step.run??'').includes('node-timings')).map(step=>step.if)).toEqual(['matrix.batch','matrix.batch']);
});
it('measures the node batch on main after each green ci push run, checks it, and only then publishes it, starting nothing',()=>{
 const flow=workflow('node-timings.yml');
 expect(flow.on.workflow_run).toEqual({workflows:['ci'],types:['completed'],branches:['main']});
 expect(Object.keys(flow.on).sort()).toEqual(['workflow_dispatch','workflow_run']);
 expect(flow.permissions).toEqual({contents:'read',actions:'read'});
 const [[,job]]=Object.entries(flow.jobs);
 expect(Object.keys(flow.jobs)).toHaveLength(1);
 expect(job.permissions).toBeUndefined();
 expect(job.if).toContain("github.event.workflow_run.conclusion == 'success'");
 expect(job.if).toContain("github.event.workflow_run.event == 'push'");
 expect(job.steps[0].with.ref).toBe('${{ github.event.workflow_run.head_sha || github.sha }}');
 const runs=job.steps.map(step=>step.run??'').join('\n');
 // Nothing it does starts another run, so it cannot loop: no push, dispatch, pull request or comment.
 expect(runs).not.toMatch(/git push|gh (workflow|pr|issue|api)|repository_dispatch/);
 // Several green runs, each file's median.
 expect(runs).toContain('--status success --limit 3');
 expect(runs).toContain('node scripts/ci/test-timings.mjs --measured tmp/node-timings/node-timings.json "${args[@]}"');
 const check=job.steps.find(step=>step.id==='check');
 expect(check['continue-on-error']).toBe(true);
 expect(check.run).toContain('node scripts/ci/test-timings.mjs --apply tmp/node-timings/node-timings.json');
 // The batch as pr fast's node runners run it: the same config and shard count.
 const {count}=JOBS['pr-node'];
 expect(check.run).toContain(`for shard in ${Array.from({length:count},(_,i)=>`${i+1}/${count}`).join(' ')}; do`);
 expect(check.run).toContain('node node_modules/vitest/vitest.mjs run --config vitest.node-batch.config.ts --shard="$shard"');
 const upload=job.steps.find(step=>step.uses?.startsWith('actions/upload-artifact@'));
 expect(upload.if).toBe("steps.check.outcome == 'success'");
 expect(upload.with).toMatchObject({name:NODE_TIMINGS_ARTIFACT,path:'tmp/node-timings/node-timings.json','if-no-files-found':'error'});
 expect(job.steps.find(step=>step.if==="steps.check.outcome != 'success'").run).toMatch(/^echo "::warning::/);
 // Nothing waits for it: no workflow names it as a need, and pr fast never runs on its account.
 expect(workflow('pr-fast.yml').on).not.toHaveProperty('workflow_run');
});
// The install cache holds Node 22's build of every native module. The hosted tool cache's newest 22 goes on PATH (the runner's
// own is a 24 on ubuntu-latest): setup-node found that very directory too, then spent 0.6s median, 2.9s p90 and 6.3s at
// worst printing npm's and yarn's versions from a cold disk (pr fast runs 44027030734-44133274884), plus a post step.
// Without it, the first start of that Node from the cold disk moved into the next step (lock-fingerprint: up to 4s, run
// 44139796324), so the probe runs first, before checkout, and reads the binary into the page cache in the background
// while checkout runs. It starts no Node itself when the cache has a 22; the runner's own serves when it is a 22, and
// setup-node remains for a runner with neither.
it('uses Node 22 in every pr fast job: the tool cache\'s, else the runner\'s own 22, else setup-node\'s, chosen first',()=>{
 const steps=workflow('pr-fast.yml').jobs.fast.steps;
 const probe=steps.findIndex(step=>step.id==='runner-node'),setup=steps.findIndex(step=>step.uses?.startsWith('actions/setup-node@'));
 expect(probe).toBe(0);
 expect(steps[1].uses).toMatch(/^actions\/checkout@/);
 expect(steps[probe].run).toContain('node --version');
 expect(steps[probe].run).toContain('$GITHUB_OUTPUT');
 expect(steps[probe].run).toContain('$GITHUB_PATH');
 expect(steps[setup]).toMatchObject({if:"steps.runner-node.outputs.major != '22'",with:{'node-version':22}});
 expect(probe).toBeLessThan(setup);
 expect(setup).toBeLessThan(steps.findIndex(step=>step.id==='install'));
 expect(steps.find(step=>step.id==='install').with.key).toContain('-node22-');
});
// No step of pr fast fetches or pushes after checkout, so its token is never written into the checkout's git config: that
// saves the auth setup (~0.3s, run 44114175470's api-14) and the post step that removed it again after the tests, and no
// test can reach a credential through git.
it('checks out without persisting the token',()=>{
 const checkout=workflow('pr-fast.yml').jobs.fast.steps.find(step=>step.uses?.startsWith('actions/checkout@'));
 expect(checkout.with).toEqual({'persist-credentials':false});
});
// Runs the probe step's shell with `node` answering only --version: any JavaScript evaluation fails the probe.
// The default `gh` and `cat` answer at once; the probe returns only once its background fetch has landed, so nothing still
// writes into the directory the test removes.
function probeRun(version,{toolCache,gh=`gh(){ printf '{}'; }`,cat='cat(){ :; }',node,settle=true}={}){
 const directory=mkdtempSync(join(tmpdir(),'afbin-node-probe-')),output=join(directory,'output'),pathFile=join(directory,'path');
 const probe=workflow('pr-fast.yml').jobs.fast.steps.find(step=>step.id==='runner-node').run;
 const shell=`${node??`node(){ [ "$#" = 1 ] && [ "$1" = --version ] || return 91; printf '%s\\n' '${version}'; }`};\n${gh};\n${cat};\n${probe}`;
 const result=spawnSync('bash',['-e','-c',shell],{env:{...process.env,GITHUB_OUTPUT:output,GITHUB_PATH:pathFile,RUNNER_TEMP:directory,GITHUB_REPOSITORY:'o/r',GITHUB_RUN_ID:'7',GITHUB_RUN_ATTEMPT:'1',RUNNER_TOOL_CACHE:toolCache??join(directory,'no-tool-cache')},encoding:'utf8',timeout:5000});
 const read=(file)=>{try{return readFileSync(file,'utf8');}catch{return '';}};
 if(settle)waitFor(join(directory,'pr-attempt.json'));
 return {directory,result,output:read(output),path:read(pathFile)};
}
function waitFor(file){
 const until=Date.now()+3000;
 while(!existsSync(file)&&Date.now()<until)spawnSync('sleep',['0.02']);
}
function toolCacheWith(versions){
 const cache=mkdtempSync(join(tmpdir(),'afbin-tool-cache-'));
 for(const version of versions){const bin=join(cache,'node',version,'x64','bin');mkdirSync(bin,{recursive:true});writeFileSync(join(bin,'node'),'#!/bin/sh\nexit 92\n',{mode:0o755});}
 return cache;
}
it.each([['v22.23.4','22'],['v24.11.0','24']])('probes the runner\'s %s, with no cached 22, without starting a JavaScript evaluation', (version,major)=>{
 const {directory,result,output,path}=probeRun(version);
 try {
  expect(result.status,result.stderr).toBe(0);
  expect(output).toBe(`major=${major}\n`);
  expect(path).toBe('');
 } finally {rmSync(directory,{recursive:true,force:true});}
});
it('puts the tool cache\'s newest Node 22 on PATH, starts no Node, and warms that one\'s binary in the background',()=>{
 const cache=toolCacheWith(['20.19.5','22.9.0','22.23.4','24.11.0']);
 const release=join(cache,'release'),read=join(cache,'read');
 // Any node at all fails the probe; cat records what it reads and then blocks until the test releases it: had the step
 // waited for it, the 5s spawn timeout would fail the probe.
 const cat=`cat(){ printf '%s\\n' "$*" >> '${read}'; while [ ! -e '${release}' ]; do sleep 0.01; done; }`;
 const {directory,result,output,path}=probeRun('v24.11.0',{toolCache:cache,cat,node:'node(){ return 91; }'});
 try {
  expect(result.error).toBeUndefined();
  expect(result.status,result.stderr).toBe(0);
  expect(output).toBe('major=22\n');
  const bin=join(cache,'node','22.23.4','x64','bin');
  expect(path).toBe(`${bin}\n`);
  waitFor(read);
  expect(readFileSync(read,'utf8')).toBe(`${bin}/node\n`);
 } finally {writeFileSync(release,'');rmSync(directory,{recursive:true,force:true});spawnSync('sleep',['0.05']);rmSync(cache,{recursive:true,force:true});}
});
// THE CLOCK'S ATTEMPT, FETCHED OFF THE CRITICAL PATH. The clock reads only the attempt's run_started_at, fixed for the
// attempt, so the first step fetches it in the background; the clock's own `gh api` took 0.6s median, 2.0s p90 and 4.1s at
// worst after every job's tests (the same runs). The clock still runs last, on always(), and fetches it itself when the
// prefetch has not landed. Every stream of the background fetch is redirected, or the runner holds the step open until it ends.
it('prefetches the clock\'s attempt in the background, returning before the fetch ends, and lands it whole',()=>{
 const steps=workflow('pr-fast.yml').jobs.fast.steps,probe=steps.find(step=>step.id==='runner-node');
 expect(probe.env).toEqual({GH_TOKEN:'${{ github.token }}'});
 const release=join(mkdtempSync(join(tmpdir(),'afbin-attempt-release-')),'release');
 // gh blocks until the test releases it: had the step waited for it, the 5s spawn timeout would fail the probe.
 const gh=`gh(){ [ "$1" = api ] && [ "$2" = /repos/o/r/actions/runs/7/attempts/1 ] || return 93; while [ ! -e '${release}' ]; do sleep 0.01; done; printf '{"run_started_at":"2026-11-17T00:00:00Z"}'; }`;
 const {directory,result}=probeRun('v22.23.4',{gh,settle:false});
 try {
  expect(result.error).toBeUndefined();
  expect(result.status,result.stderr).toBe(0);
  expect(existsSync(join(directory,'pr-attempt.json'))).toBe(false);
  writeFileSync(release,'');
  waitFor(join(directory,'pr-attempt.json'));
  expect(JSON.parse(readFileSync(join(directory,'pr-attempt.json'),'utf8'))).toEqual({run_started_at:'2026-11-17T00:00:00Z'});
 } finally {rmSync(directory,{recursive:true,force:true});rmSync(dirname(release),{recursive:true,force:true});}
});
it('clocks from the prefetched attempt without fetching it again, and fetches it itself when the prefetch never landed',()=>{
 const clock=workflow('pr-fast.yml').jobs.fast.steps.at(-1);
 const started=new Date(Date.now()-5000).toISOString();
 const run=(prefetched)=>{
  const directory=mkdtempSync(join(tmpdir(),'afbin-pr-clock-')),calls=join(directory,'calls');
  if(prefetched)writeFileSync(join(directory,'pr-attempt.json'),JSON.stringify({run_started_at:started}));
  const gh=`gh(){ printf '%s\\n' "$*" >> '${calls}'; printf '{"run_started_at":"${started}"}'; }`;
  const result=spawnSync('bash',['-e','-c',`${gh};\n${clock.run}`],{cwd:fileURLToPath(new URL('../..',import.meta.url)),env:{...process.env,GH_TOKEN:'test',GITHUB_REPOSITORY:'o/r',GITHUB_RUN_ID:'7',GITHUB_RUN_ATTEMPT:'1',RUNNER_TEMP:directory,GITHUB_STEP_SUMMARY:join(directory,'summary.md')},encoding:'utf8',timeout:10000});
  const fetched=existsSync(calls)?readFileSync(calls,'utf8'):'';
  rmSync(directory,{recursive:true,force:true});
  return {result,fetched};
 };
 const warm=run(true);
 expect(warm.result.status,warm.result.stderr).toBe(0);
 expect(warm.result.stdout).toContain('(target): aim for 40s; the limit is 60s');
 expect(warm.fetched).toBe('');
 const cold=run(false);
 expect(cold.result.status,cold.result.stderr).toBe(0);
 expect(cold.result.stdout).toContain('(target): aim for 40s; the limit is 60s');
 expect(cold.fetched).toBe('api /repos/o/r/actions/runs/7/attempts/1\n');
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
 expect(saves.map(step=>step.with.key)).toEqual([exact.with.key,'test-builds-v3-${{ runner.os }}-${{ env.TEST_BUILDS_KIND }}-${{ steps.test-builds-key.outputs.key }}-${{ steps.test-builds-key.outputs.modules }}']);
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
it('enrolls node and API contract tests that the full suite also runs, once each, outside the other lists',()=>{
 const read=path=>JSON.parse(readFileSync(new URL(`../../${path}`,import.meta.url),'utf8'));
 const contracts=read('scripts/ci/contract-tests.json'),guards=read('scripts/ci/guard-tests.json'),fast=read('scripts/ci/fast-tests.json');
 expect(contracts).toContain('services/app/lib/page-doors/__tests__/native-acceptance.test.ts');
 expect(contracts).toContain('services/app/server/__tests__/user-host.test.ts');
 expect(contracts).toEqual([...new Set(contracts)].sort());
 expect(readFileSync(new URL('../../vitest.guard.config.ts',import.meta.url),'utf8')).toContain("byIsolation('pr-contracts', 'contract-tests.json'");
 for(const file of contracts){
  expect(readFileSync(new URL(`../../${file}`,import.meta.url),'utf8').length,file).toBeGreaterThan(0);
  expect(file).toMatch(/^services\/app\/(?:lib|server)\/(?:.+\/)?__tests__\/[^/]+(?<!\.ui)\.test\.ts$/);
  expect(fast).not.toContain(file);expect(guards).not.toContain(file);
 }
});
