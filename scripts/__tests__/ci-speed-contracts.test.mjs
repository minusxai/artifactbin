/** Required checks consume the package they prove without redundant serial acceptance. */
import {readFileSync} from 'node:fs';
import {describe,it,expect} from 'vitest';
import yaml from 'yaml';
const workflow=()=>yaml.parse(readFileSync(new URL('../../.github/workflows/ci.yml',import.meta.url),'utf8'));
describe('release critical path',()=>{
 it('runs Intel preview/export through the supported-platform experience proof once',()=>{
  const jobs=workflow().jobs;
  expect(jobs['cli-preview']).toBeUndefined();
  expect(jobs.cli.steps.some(step=>step.run?.includes('test-installed-npm.mjs ${{ matrix.phase }}'))).toBe(true);
 });
 it('starts ID-first conformance from the packed candidate instead of waiting on unrelated native proofs',()=>{
  const job=workflow().jobs['reference-compatibility'];
  expect(job.needs).toContain('cli-pack');
  expect(job.needs).not.toContain('cli');
  expect(job.steps.some(step=>step.with?.name==='afbin-npm-release')).toBe(true);
 });
});

it('supplies ordinary composition the cached exact-tree universal package before pruning the host',()=>{
 const jobs=workflow().jobs,steps=jobs.build.steps;
 const pack=steps.findIndex(step=>step.run?.includes('pack:release'));
 const prune=steps.findIndex(step=>step.run?.includes('rm -rf services/cli/dist/runtime'));
 const upload=steps.find(step=>step.with?.name==='afbin-npm-packages');
 expect(pack).toBeGreaterThan(steps.findIndex(step=>step.run==='npm run build -w services/cli'));
 expect(prune).toBeGreaterThan(pack);
 expect(steps[pack].run).toContain('dist/npm-candidate');
 expect(upload.with.path).toBe('dist/npm-candidate/*.tgz');
 expect(upload.if).toBe("needs.plan.outputs.cli != 'true'");
 const cache=steps.find(step=>step.id==='build-cache');
 expect(cache.with.path).toMatch(/^dist$/m);
 expect(cache.with.key).toContain('app-build-v2-');
 expect(cache.with.key).toContain('needs.plan.outputs.cli');
 expect(jobs['reference-compatibility'].steps.find(step=>step.with?.name==='afbin-npm-packages')).toBeUndefined();
 const release=jobs['cli-pack'].steps.find(step=>step.with?.name==='afbin-npm-packages');
 expect(release.with.path).toBe('services/cli/dist/packages/*.tgz');
 expect(release.if).toBeUndefined();
});
it('does not compile the app twice or repeat email-source conformance in the reference proof',()=>{
 const steps=workflow().jobs['reference-compatibility'].steps;
 expect(steps.find(step=>step.name==='Build OSS host').run).toBe('node scripts/build/build-server.mjs dist/server.mjs');
 const command=steps.find(step=>step.name==='ID-first conformance for source bundle and installed npm package').run;
 expect(command.match(/wait_pair\n/g)).toHaveLength(1);
 expect(command).toContain('CONFORMANCE__CREDENTIAL_SOURCE=outbox-oauth');
});
it('warms the complete ordinary package cache without a nonexistent plan dependency',()=>{
 const job=workflow().jobs['warm-caches'];
 expect(job.needs).toBeUndefined();
 const cache=job.steps.find(step=>step.id==='build-cache');
 expect(cache.with.key).not.toContain('needs.');
 expect(cache.with.key).toMatch(/-npm-false$/);
 const pack=job.steps.findIndex(step=>step.run?.includes('pack:release'));
 const prune=job.steps.findIndex(step=>step.run?.includes('rm -rf services/cli/dist/runtime'));
 expect(pack).toBeGreaterThan(job.steps.findIndex(step=>step.run==='npm run build -w services/cli'));
 expect(prune).toBeGreaterThan(pack);
 expect(job.steps[pack].run).toContain('dist/npm-candidate');
});
it('requires one isolated cold Windows bootstrap whenever the native CLI matrix is selected',()=>{
 const jobs=workflow().jobs,job=jobs['cli-bootstrap'];
 expect(job).toBeDefined();
 expect(job.needs).toEqual(['plan','cli-pack']);
 expect(job.if).toBe("needs.plan.outputs.cli-bootstrap == 'true'");
 expect(job['runs-on']).toBe('windows-2022');
 expect(job.strategy).toBeUndefined();
 expect(job.steps.find(step=>step.with?.name==='afbin-npm-release')).toBeDefined();
 const proof=job.steps.find(step=>step.run?.includes('test-node-bootstrap.ps1'));
 expect(proof.shell).toBe('powershell');expect(proof.run).toContain('npm-candidate/*.tgz');
 expect(jobs.test.needs).toContain('cli-bootstrap');
 expect(jobs['notify-consumer'].needs).toContain('cli-bootstrap');
 expect(jobs.cli.steps.find(step=>step.name==='Same-tarball native npm and warmed offline acceptance').run).toContain("runner.os != 'Windows'");
});
it('restores normalized tooling and content-verified reader builds before release packing',()=>{
 const jobs=workflow().jobs,pack=jobs['cli-pack'].steps;
 const install=pack.find(step=>step.id==='install'),reference=jobs['reference-compatibility'].steps.find(step=>step.id==='install');
 expect(install?.with).toEqual(reference.with);
 expect(pack.find(step=>step.run==='npm ci')?.if).toBe("steps.install.outputs.cache-hit != 'true'");
 const reader=pack.find(step=>step.id==='test-builds');
 expect(reader?.with.path).toContain('node_modules/.cache/build-islands.json');
 expect(pack.indexOf(reader)).toBeLessThan(pack.findIndex(step=>step.run==='npm run build -w services/cli'));
});
it('hands the source build from the current pack run to reference proof without recompiling',()=>{
 const jobs=workflow().jobs,pack=jobs['cli-pack'].steps,reference=jobs['reference-compatibility'].steps;
 const archive=pack.find(step=>step.name==='Archive the source build for reference conformance');
 expect(archive?.run).toContain('services/cli/dist');
 expect(archive?.run).toContain('services/app/lib/build-assets');
 const upload=pack.find(step=>step.with?.name==='afbin-reference-build');
 const download=reference.find(step=>step.with?.name==='afbin-reference-build');
 expect(upload?.with.path).toBe('afbin-reference-build.tar');
 expect(download?.with['run-id']).toBeUndefined();
 expect(download?.with.path).toBe('.');
 expect(reference.some(step=>step.run==='npm run build -w services/cli')).toBe(false);
 expect(reference.some(step=>step.run==='tar -xf afbin-reference-build.tar')).toBe(true);
 expect(pack.indexOf(archive)).toBeGreaterThan(pack.findIndex(step=>step.run==='npm run pack:release -w services/cli'));
});
it('splits independent credential and database host proofs into required parallel lanes',()=>{
 const job=workflow().jobs['reference-compatibility'];
 expect(job.strategy?.matrix.proof).toEqual(['accounts','team']);
 expect(job.steps.find(step=>step.name==='ID-first conformance for source bundle and installed npm package').if).toBe("matrix.proof == 'accounts'");
 expect(job.steps.find(step=>step.name==='Team hosts with isolated PGLite and PostgreSQL').if).toBe("matrix.proof == 'team'");
 expect(job.strategy['fail-fast']).toBe(false);
});
it('separates CPU-heavy installed proofs while retaining every platform journey',()=>{
 const job=workflow().jobs.cli;
 expect(job.strategy.matrix.phase).toEqual(['native','runtime','preview','local']);
 const proofs=job.steps.filter(step=>step.run?.includes('test-installed-npm.mjs'));
 expect(proofs.map(step=>step.if)).toEqual(["matrix.phase == 'runtime'","matrix.phase == 'preview' || matrix.phase == 'local'"]);
 expect(proofs[0].run).toContain('test-installed-npm.mjs runtime');
 expect(proofs[1].run).toContain('test-installed-npm.mjs ${{ matrix.phase }}');
});
