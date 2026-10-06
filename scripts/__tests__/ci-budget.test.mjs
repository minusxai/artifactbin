import {it,expect} from 'vitest';
import {readFileSync, mkdtempSync, writeFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import yaml from 'yaml';
import {measureCiElapsed} from '../lib/ci-elapsed.mjs';
const workflow=()=>yaml.parse(readFileSync(new URL('../../.github/workflows/ci.yml',import.meta.url),'utf8'));
it('gives every required job the same four-minute budget',()=>{
 const jobs=workflow().jobs,step=jobs.test.steps.find(step=>step.env?.BUDGET_S);
 expect(step.env.BUDGET_S).toBe('240');expect(step.env).not.toHaveProperty('SLOW_BUDGET_S');
 expect(step.run).not.toContain('SLOW_BUDGET_S');
 expect(step.run).toContain('budget="$BUDGET_S"');
 expect(step.run).toContain('exit 1');
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
 expect(jobs.cli.strategy.matrix.phase).toEqual(['native','experience']);
 expect(native.find(step=>step.run==='node scripts/ci/link-npm-acceptance.mjs').if).toBe("matrix.phase == 'experience'");
 expect(cache.if).toBe("matrix.phase == 'experience'");
 expect(native[install].if).toBe("matrix.phase == 'experience' && steps.install.outputs.cache-hit != 'true'");
 expect(native.find(step=>step.name==='Same-tarball native npm and warmed offline acceptance').if).toBe("matrix.phase == 'native'");
 const runtimes=native.filter(step=>step.uses?.startsWith('actions/setup-node@'));
 expect(runtimes.map(step=>step.with['node-version'])).toEqual(['22.22.3','${{ matrix.node }}']);
 expect(native.indexOf(runtimes[1])).toBeGreaterThan(install);
});

it('runs invariant declarations on Linux and Windows once while keeping every consumer journey',()=>{
 const steps=workflow().jobs.cli.steps;
 const types=steps.find(step=>step.name==='Installed npm preview and export, with process shutdown');
 expect(types.run).toContain("matrix.node == '22.22.3'");
 expect(types.run).toContain("runner.os == 'Windows'");
 expect(types.run).toContain("runner.os == 'Linux' && runner.arch == 'X64'");
 expect(types.run).toContain("&& '--types' || ''");
 const experience=steps.find(step=>step.run?.includes('test-installed-npm.mjs experience'));
 expect(experience.if).toBe("matrix.phase == 'experience'");
 expect(experience.run).toContain('playwright/cli.js install chromium');
});
it('pins browser tooling to its actual aliased manifest and installs OS dependencies only on Linux misses',()=>{
 const steps=workflow().jobs.cli.steps,cache=steps.find(step=>step.with?.key?.startsWith('chromium-'));
 expect(cache?.with.key).toContain("hashFiles('scripts/ci/npm-acceptance/node_modules/playwright/browsers.json')");
 const deps=steps.find(step=>step.name==='Install Linux acceptance browser dependencies');
 expect(deps?.if).toBe("matrix.phase == 'experience' && runner.os == 'Linux' && steps.acceptance-browser.outputs.cache-hit != 'true'");
 const proof=steps.find(step=>step.name==='Installed npm preview and export, with process shutdown');
 expect(proof.run).toContain('playwright/cli.js install chromium');
 expect(proof.run).not.toContain('--with-deps');
});

it('keeps ten cold native consumers and six complete platform/runtime journeys',()=>{
 const matrix=workflow().jobs.cli.strategy.matrix;
 const expanded=matrix.os.flatMap(os=>matrix.node.flatMap(node=>matrix.phase.map(phase=>({os,node,phase}))));
 const selected=expanded.filter(row=>!(matrix.exclude??[]).some(excluded=>Object.entries(excluded).every(([key,value])=>row[key]===value)));
 expect(selected.filter(row=>row.phase==='native')).toHaveLength(10);
 const experience=selected.filter(row=>row.phase==='experience');
 expect(experience).toHaveLength(6);
 expect(experience.filter(row=>row.node==='22.22.3').map(row=>row.os).sort()).toEqual([...matrix.os].sort());
 expect(experience.filter(row=>row.node==='24.21.0')).toEqual([{os:'ubuntu-24.04',node:'24.21.0',phase:'experience'}]);
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
 expect(measureCiElapsed(start,'2026-10-06T00:05:01Z')).toEqual({seconds:301,status:'failed',targetSeconds:180,normalSeconds:240,hardSeconds:300});
});
it('keeps the hard limit inclusive and reports target and normal ranges separately',()=>{
 const start='2026-10-06T00:00:00Z';
 for(const [seconds,status] of [[179,'target'],[180,'normal'],[239,'normal'],[240,'slow'],[300,'slow'],[300.001,'failed']]) {
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
  const old=run({run_started_at:new Date(Date.now()-301000).toISOString()});
  expect(old.status).toBe(1); expect(old.stdout).toContain('::error::');
  const fresh=run({run_started_at:new Date(Date.now()-1000).toISOString()});
  expect(fresh.status).toBe(0); expect(fresh.stdout).toContain('(target)');
  expect(readFileSync(summary,'utf8')).toContain('hard failure >300s');
  expect(run({created_at:'2020-01-01T00:00:00Z'}).status).toBe(1);
 } finally {rmSync(directory,{recursive:true,force:true});}
});
