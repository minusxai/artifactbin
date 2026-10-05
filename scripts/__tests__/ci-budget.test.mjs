import {it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import yaml from 'yaml';
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
