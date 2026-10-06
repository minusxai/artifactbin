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
 expect(jobs['cli-pack'].name).toBe('CLI npm pack');
});
it('installs isolated acceptance tooling only for experience checks before consumer runtime selection',()=>{
 const jobs=workflow().jobs,native=jobs.cli.steps;
 const cache=native.find(step=>step.id==='install');
 expect(cache.with.path.trim()).toBe('scripts/ci/npm-acceptance/node_modules');
 expect(cache.with.key).toContain('npm-acceptance-v1-');
 expect(cache.with.key).toContain('scripts/ci/npm-acceptance/package-lock.json');
 const cached=native.indexOf(cache),install=native.findIndex(step=>step.run==='npm ci --prefix scripts/ci/npm-acceptance --no-audit --no-fund');
 expect(cached).toBeLessThan(install);
 expect(native.some(step=>step.run==='npm ci')).toBe(false);
 expect(jobs.cli.strategy.matrix.phase).toEqual(['native','runtime','preview','local']);
 expect(native.find(step=>step.run==='node scripts/ci/link-npm-acceptance.mjs').if).toBe("matrix.phase != 'native'");
 expect(cache.if).toBe("matrix.phase != 'native'");
 expect(native[install].if).toBe("matrix.phase != 'native' && steps.install.outputs.cache-hit != 'true'");
 expect(native.find(step=>step.name==='Same-tarball native npm and warmed offline acceptance').if).toBe("matrix.phase == 'native'");
 const runtimes=native.filter(step=>step.uses?.startsWith('actions/setup-node@'));
 expect(runtimes.map(step=>step.with['node-version'])).toEqual(['22.22.3','${{ matrix.node }}']);
 expect(native.indexOf(runtimes[1])).toBeGreaterThan(install);
});

it('runs invariant declarations on Linux and Windows once while keeping every consumer journey',()=>{
 const steps=workflow().jobs.cli.steps;
 const types=steps.find(step=>step.name==='Installed npm runtime boundary, terminal exit and declarations');
 expect(types.run).toContain("matrix.node == '22.22.3'");
 expect(types.run).toContain("runner.os == 'Windows'");
 expect(types.run).toContain("runner.os == 'Linux' && runner.arch == 'X64'");
 expect(types.run).toContain("&& '--types' || ''");
 const experience=steps.find(step=>step.name==='Installed npm preview and export, with process shutdown');
 expect(experience.if).toBe("matrix.phase == 'preview' || matrix.phase == 'local'");
 expect(experience.run).toContain('playwright/cli.js install chromium');
});
it('pins browser tooling to its actual aliased manifest and installs OS dependencies on every fresh Linux runner',()=>{
 const steps=workflow().jobs.cli.steps,cache=steps.find(step=>step.with?.key?.startsWith('chromium-'));
 expect(cache?.with.key).toContain("hashFiles('scripts/ci/npm-acceptance/node_modules/playwright/browsers.json')");
 const deps=steps.find(step=>step.name==='Install Linux acceptance browser dependencies');
 expect(deps?.if).toBe("(matrix.phase == 'preview' || matrix.phase == 'local') && runner.os == 'Linux'");
 const proof=steps.find(step=>step.name==='Installed npm preview and export, with process shutdown');
 expect(proof.run).toContain('playwright/cli.js install chromium');
 expect(proof.run).not.toContain('--with-deps');
});

it('keeps ten cold native consumers and six complete platform/runtime journeys',()=>{
 const matrix=workflow().jobs.cli.strategy.matrix;
 const expanded=matrix.os.flatMap(os=>matrix.node.flatMap(node=>matrix.phase.map(phase=>({os,node,phase}))));
 const selected=expanded.filter(row=>!(matrix.exclude??[]).some(excluded=>Object.entries(excluded).every(([key,value])=>row[key]===value)));
 expect(selected.filter(row=>row.phase==='native')).toHaveLength(10);
 for(const phase of ['runtime','preview','local']) {
  const experience=selected.filter(row=>row.phase===phase);
  expect(experience).toHaveLength(6);
  expect(experience.filter(row=>row.node==='22.22.3').map(row=>row.os).sort()).toEqual([...matrix.os].sort());
  expect(experience.filter(row=>row.node==='24.21.0')).toEqual([{os:'ubuntu-24.04',node:'24.21.0',phase}]);
 }
});
it('keeps a cold standard-user query without repeating native offline acceptance',()=>{
 const script=readFileSync(new URL('../../services/cli/scripts/test-node-bootstrap.ps1',import.meta.url),'utf8');
 expect(script).toContain("Set-ExecutionPolicy -Scope CurrentUser Restricted -Force");
 expect(script).toContain("throw 'Expected standard user'");
 expect(script).toContain("throw 'Expected Node-free PATH'");
 expect(script).toContain("throw 'Expected genuinely cold npm cache'");
 expect(script).toContain("Invoke-Candidate 'npx.cmd' @('--yes','--package','__ROOT__\\candidate.tgz','afbin','query',$rows,'--json')");
 expect(script).not.toContain('warmed-npx-consumer');
 expect(script).not.toContain('warmed-offline-query');
 expect(script).not.toContain('expected-package.json');
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
it('shares only verified npm download blobs, never installed modules or npx state',async()=>{
 const {mergeNpmDependencyCache}=await import('../lib/npm-dependency-cache.mjs');
 const directory=mkdtempSync(join(tmpdir(),'afbin-npm-cas-'));
 const source=join(directory,'source'),target=join(directory,'target');
 const {mkdirSync,existsSync}=await import('node:fs');
 try{
  mkdirSync(join(source,'_cacache'),{recursive:true});writeFileSync(join(source,'_cacache','blob'),'content');
  mkdirSync(join(source,'_npx'));writeFileSync(join(source,'_npx','stale'),'wrong candidate');
  expect(await mergeNpmDependencyCache(source,target)).toBe(true);
  expect(readFileSync(join(target,'_cacache','blob'),'utf8')).toBe('content');
  expect(existsSync(join(target,'_npx'))).toBe(false);
  writeFileSync(join(target,'_cacache','blob'),'stale index');
  expect(await mergeNpmDependencyCache(source,target)).toBe(true);
  expect(readFileSync(join(target,'_cacache','blob'),'utf8')).toBe('content');
  expect(await mergeNpmDependencyCache(join(directory,'absent'),target)).toBe(false);
 }finally{rmSync(directory,{recursive:true,force:true});}
});
it('warms only normal matrix download blobs while keeping the standard-user bootstrap cold',()=>{
 const jobs=workflow().jobs,steps=jobs.cli.steps;
 const path=steps.find(step=>step.id==='dependency-cache-path');
 expect(path).toBeDefined();
 expect(steps.some(step=>step.id==='dependency-cache')).toBe(false);
 expect(steps.find(step=>step.name==='Same-tarball native npm and warmed offline acceptance').run).toContain('--dependency-cache');
 expect(steps.find(step=>step.name==='Install the same candidate for experience checks').run).toContain('--dependency-cache');
 expect(jobs['cli-bootstrap'].steps.some(step=>step.id==='dependency-cache')).toBe(false);
});

it('refuses credential/private seed metadata',async()=>{
 const {assertPublicNpmCache}=await import('../lib/npm-dependency-cache.mjs');
 const directory=mkdtempSync(join(tmpdir(),'afbin-npm-public-'));
 const {mkdirSync}=await import('node:fs');
 const index=join(directory,'_cacache','index-v5');mkdirSync(index,{recursive:true});
 const record={key:'make-fetch-happen:request-cache:https://registry.npmjs.org/is-number',integrity:'sha512-pinned',metadata:{url:'https://registry.npmjs.org/is-number'}};
 const store=value=>writeFileSync(join(index,'entry'),'checksum\t'+JSON.stringify(value)+'\n');
 try{
  store(record);expect(await assertPublicNpmCache(directory)).toBe(1);
  const pinned={...record,integrity:'sha512-pinned'};
  writeFileSync(join(index,'entry'),'checksum\t'+JSON.stringify(pinned)+'\nchecksum\t'+JSON.stringify(pinned)+'\n');
  expect(await assertPublicNpmCache(directory,[{resolved:record.metadata.url,integrity:pinned.integrity}])).toBe(1);
  const removed={...pinned,key:'make-fetch-happen:request-cache:https://registry.npmjs.org/removed'};
  writeFileSync(join(index,'entry'),[pinned,removed,{...removed,integrity:null}].map(value=>'checksum\t'+JSON.stringify(value)+'\n').join(''));
  expect(await assertPublicNpmCache(directory,[{resolved:record.metadata.url,integrity:pinned.integrity}])).toBe(1);
  await expect(assertPublicNpmCache(directory,[{resolved:record.metadata.url,integrity:'sha512-wrong'}])).rejects.toThrow(/integrity/);
  const tarball={key:'make-fetch-happen:request-cache:https://registry.npmjs.org/is-number/-/is-number-1.0.0.tgz',integrity:'sha512-tarball',metadata:{url:'https://registry.npmjs.org/is-number/-/is-number-1.0.0.tgz'}};
  writeFileSync(join(index,'entry'),[record,tarball].map(value=>'checksum\t'+JSON.stringify(value)+'\n').join(''));
  const dependency={resolved:tarball.metadata.url,integrity:tarball.integrity,spec:'is-number@1.0.0'};
  expect(await assertPublicNpmCache(directory,[dependency])).toBe(1);
  writeFileSync(join(index,'entry'),'checksum\t'+JSON.stringify(tarball)+'\n');
  await expect(assertPublicNpmCache(directory,[dependency])).rejects.toThrow(/manifest/);
  writeFileSync(join(index,'entry'),[record,tarball].map(value=>'checksum\t'+JSON.stringify(value)+'\n').join(''));
  await expect(assertPublicNpmCache(directory,[{...dependency,spec:'other@1.0.0'}])).rejects.toThrow(/integrity/);

  store({...record,metadata:{...record.metadata,reqHeaders:{authorization:'secret-test'}}});await expect(assertPublicNpmCache(directory)).rejects.toThrow(/Credential/);
  store({...record,key:'make-fetch-happen:request-cache:https://private.example/package'});await expect(assertPublicNpmCache(directory)).rejects.toThrow(/Non-public/);
 }finally{rmSync(directory,{recursive:true,force:true});}
});

it('seeds only pinned public shrinkwrap tarballs including optional native platforms',async()=>{
 const {npmSeedDependencies,npmSupportedSeedDependencies}=await import('../lib/npm-dependency-cache.mjs');
 const lock={packages:{'':{name:'@afbin/cli'},'node_modules/a':{resolved:'https://registry.npmjs.org/a/-/a-1.tgz',integrity:'sha512-a'},'node_modules/b':{optional:true,os:['win32'],resolved:'https://registry.npmjs.org/b/-/b-1.tgz',integrity:'sha512-b'}}};
 expect(npmSeedDependencies(JSON.stringify(lock),{os:'linux',cpu:'x64'})).toEqual([{resolved:lock.packages['node_modules/a'].resolved,integrity:'sha512-a'}]);
 expect(npmSeedDependencies(JSON.stringify(lock),{os:'win32',cpu:'x64'})).toHaveLength(2);
 lock.packages['node_modules/freebsd']={os:['freebsd'],resolved:'https://registry.npmjs.org/freebsd/-/a.tgz',integrity:'sha512-freebsd'};
 expect(npmSupportedSeedDependencies(JSON.stringify(lock))).toHaveLength(2);
 delete lock.packages['node_modules/freebsd'];
 expect(npmSeedDependencies(JSON.stringify(lock))).toEqual([lock.packages['node_modules/a'],lock.packages['node_modules/b']].map(({resolved,integrity})=>({resolved,integrity})));
 for(const resolved of ['file:local.tgz','https://private.example/a.tgz','https://registry.npmjs.org/a.tgz?token=hidden']){
  lock.packages['node_modules/a'].resolved=resolved;expect(()=>npmSeedDependencies(JSON.stringify(lock))).toThrow(/public registry/);
 }
});
it('creates a fresh seed with bounded npm cache operations instead of selecting arbitrary host caches',async()=>{
 const {populateNpmSeed,npmSeedRequest}=await import('../lib/npm-dependency-cache.mjs');
 const directory=mkdtempSync(join(tmpdir(),'afbin-clean-seed-'));
 const dependencies=Array.from({length:19},(_,i)=>({resolved:`https://registry.npmjs.org/a/-/a-${i}.0.0.tgz`,integrity:'sha512-test'}));
 let active=0,max=0;const calls=[];
 try {
  await populateNpmSeed(dependencies,directory,async(args)=>{calls.push(args);active++;max=Math.max(max,active);await new Promise(resolve=>setTimeout(resolve,2));active--;});
  expect(max).toBeLessThanOrEqual(8);expect(calls).toHaveLength(22);
  const downloads=calls.filter(args=>args[0]==='cache'),manifests=calls.filter(args=>args[0]==='view');
  expect(downloads).toHaveLength(3);
  expect(downloads.flatMap(args=>args.slice(2,args.indexOf('--cache')))).toEqual(dependencies.map(d=>d.resolved));
  expect(manifests.map(args=>args[1])).toEqual(dependencies.map(npmSeedRequest));
  expect(manifests.every(args=>args.includes('--json'))).toBe(true);
  expect(calls.every(args=>args.includes('--ignore-scripts')&&args.includes('--userconfig'))).toBe(true);
  const steps=workflow().jobs['cli-pack'].steps;expect(steps.some(step=>step.id==='npm-seed-key')).toBe(true);
  expect(steps.some(step=>step.run?.includes('prepare-seed'))).toBe(true);
  expect(steps.filter(step=>step.with?.name?.startsWith('afbin-npm-dependency-seed-')).map(step=>step.with.name)).toEqual(['Windows-X64','Linux-X64','Linux-ARM64','macOS-X64','macOS-ARM64'].map(platform=>'afbin-npm-dependency-seed-'+platform));
  expect(workflow().jobs.cli.steps.find(step=>step.with?.name?.startsWith('afbin-npm-dependency-seed-')).with.name).toBe('afbin-npm-dependency-seed-${{ runner.os }}-${{ runner.arch }}');
 }finally{rmSync(directory,{recursive:true,force:true});}
});

it('warns rather than fails when a PR consumer includes a long prerequisite wait',()=>{
 const step=workflow().jobs.test.steps.find(step=>step.env?.BUDGET_S),directory=mkdtempSync(join(tmpdir(),'afbin-job-time-warning-'));
 const summary=join(directory,'summary.md');
 writeFileSync(join(directory,'gh'),"#!/bin/sh\nprintf '%s\\n' '259\tCLI npm Windows preview\tsuccess\tWait for current attempt 65s'\n",{mode:0o755});
 try{
  const result=spawnSync('bash',['-c',step.run],{cwd:directory,encoding:'utf8',env:{PATH:directory+':'+process.env.PATH,BUDGET_S:'240',GITHUB_REPOSITORY:'test/repo',GITHUB_RUN_ID:'1',GITHUB_RUN_ATTEMPT:'1',GITHUB_EVENT_NAME:'pull_request',GITHUB_STEP_SUMMARY:summary}});
  expect(result.status,result.stderr).toBe(0);expect(result.stdout).toContain('::warning::');expect(result.stdout).toContain('259s');
  expect(readFileSync(summary,'utf8')).toContain('259');
 }finally{rmSync(directory,{recursive:true,force:true});}
});

it('packs independent platform seeds with bounded concurrent npm processes',async()=>{
 const {packPlatformNpmSeeds}=await import('../lib/npm-dependency-cache.mjs');
 const directory=mkdtempSync(join(tmpdir(),'afbin-pack-concurrency-')),source=join(directory,'source');
 const {mkdir,writeFile}=await import('node:fs/promises');await mkdir(join(source,'_cacache/index-v5'),{recursive:true});
 const url='https://registry.npmjs.org/a/-/a-1.tgz',integrity='sha512-test';
 await writeFile(join(source,'_cacache/index-v5/entry'),'hash\t'+JSON.stringify({key:'make-fetch-happen:request-cache:'+url,integrity})+'\n');
 const lock=JSON.stringify({packages:{'':{},'node_modules/a':{resolved:url,integrity}}});
 let active=0,max=0;const archives=[];
 try {
  await packPlatformNpmSeeds(source,join(directory,'output'),lock,{concurrency:2,run:async(command,args)=>{
   active++;max=Math.max(max,active);await new Promise(resolve=>setTimeout(resolve,10));
   if(command==='tar'){archives.push(args[1]);await writeFile(args[1],'test archive');}active--;
  }});
  expect(max).toBe(2);expect(archives).toHaveLength(5);
 }finally{rmSync(directory,{recursive:true,force:true});}
});
