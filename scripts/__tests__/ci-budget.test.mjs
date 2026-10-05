import {it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import yaml from 'yaml';
const workflow=()=>yaml.parse(readFileSync(new URL('../../.github/workflows/ci.yml',import.meta.url),'utf8'));
it('keeps npm release jobs in the existing CLI budget and ordinary jobs in their own budget',()=>{
 const jobs=workflow().jobs,step=jobs.test.steps.find(step=>step.env?.SLOW_BUDGET_S);
 expect(step.env.BUDGET_S).toBe('240');expect(step.env.SLOW_BUDGET_S).toBe('420');
 const classify=step.run.match(/case "\$name" in[^\n]*esac/)[0];
 for(const [name,budget] of [['CLI npm (macos-15-intel Node 22.22.3)','420'],['CLI npm pack','420'],['CLI (macos-15-intel preview)','420'],['CLI distributions against ID-first host','420'],['node (2)','240'],['gates (2)','240']]){
  const run=spawnSync('bash',['-c',`name="$1";budget="$BUDGET_S";${classify};printf '%s' "$budget"`,'classify',name],{encoding:'utf8',env:{...process.env,...step.env}});
  expect(run.status,run.stderr).toBe(0);expect(run.stdout,name).toBe(budget);
 }
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
