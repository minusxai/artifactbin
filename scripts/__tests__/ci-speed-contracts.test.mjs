/** Required checks consume the package they prove without redundant serial acceptance. */
import {readFileSync} from 'node:fs';
import {describe,it,expect} from 'vitest';
import yaml from 'yaml';
const workflow=()=>yaml.parse(readFileSync(new URL('../../.github/workflows/ci.yml',import.meta.url),'utf8'));
describe('release critical path',()=>{
 it('runs Intel preview/export through the supported-platform experience proof once',()=>{
  const jobs=workflow().jobs;
  expect(jobs['cli-preview']).toBeUndefined();
  expect(jobs.cli.steps.some(step=>step.run?.includes('test-installed-npm.mjs experience'))).toBe(true);
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
