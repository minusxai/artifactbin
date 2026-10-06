/** Required checks consume the package they prove without redundant serial acceptance. */
import {readFileSync,mkdtempSync,writeFileSync,chmodSync,rmSync} from 'node:fs';
import {describe,it,expect} from 'vitest';
import yaml from 'yaml';
import {spawnSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
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
 expect(pack).toBeGreaterThan(steps.findIndex(step=>step.run?.includes('npm run build -w services/cli')));
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
 expect(pack).toBeGreaterThan(job.steps.findIndex(step=>step.run?.includes('npm run build -w services/cli')));
 expect(prune).toBeGreaterThan(pack);
 expect(job.steps[pack].run).toContain('dist/npm-candidate');
});
it('requires one isolated cold Windows bootstrap whenever the native CLI matrix is selected',()=>{
 const jobs=workflow().jobs,job=jobs['cli-bootstrap'];
 expect(job).toBeDefined();
 expect(job.needs).toEqual(['plan']);
 expect(job.if).toBe("needs.plan.outputs.cli-bootstrap == 'true'");
 expect(job['runs-on']).toBe('windows-2022');
 expect(job.strategy).toBeUndefined();
 expect(job.steps.some(step=>step.with?.name==='afbin-npm-release')).toBe(false);
 const proof=job.steps.find(step=>step.run?.includes('test-node-bootstrap.ps1'));
 expect(proof.shell).toBe('powershell');expect(proof.run).toContain('-WaitForArtifact');
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
 expect(pack.indexOf(reader)).toBeLessThan(pack.findIndex(step=>step.run?.includes('npm run build -w services/cli')));
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
 expect(reference.some(step=>step.run?.includes('npm run build -w services/cli'))).toBe(false);
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

it('overlaps the same standard-user bootstrap with pack instead of waiting to create the user',()=>{
 const job=workflow().jobs['cli-bootstrap'];
 expect(job.needs).toEqual(['plan']);
 expect(job.permissions.actions).toBe('read');
 expect(job.steps.some(step=>step.with?.name==='afbin-npm-release')).toBe(false);
 expect(job.steps.find(step=>step.run?.includes('test-node-bootstrap.ps1')).run).toContain('-WaitForArtifact');
 const source=readFileSync(new URL('../../services/cli/scripts/test-node-bootstrap.ps1',import.meta.url),'utf8');
 expect(source.indexOf("$process=Start-StandardProcess $encoded 'bootstrap'")).toBeLessThan(source.indexOf('ci-artifact-wait.mjs'));
 expect(source.indexOf("$phase='wait for exact current-run candidate'")).toBeLessThan(source.indexOf("$phase='standard-user online npx query'"));
});
it('waits only for current-attempt artifacts and fails on packaging failures or deadline',async()=>{
 const {waitForCurrentArtifact}=await import('../lib/ci-artifact-wait.mjs');
 let time=0,calls=0;
 const options={startedAt:'2026-10-06T00:00:00Z',now:()=>time,sleep:async()=>{time+=5000;},jobs:async()=>({jobs:[{name:'CLI npm pack',status:'in_progress'}]}),artifacts:async()=>({artifacts:++calls===1?[{id:1,name:'afbin-npm-release',created_at:'2026-10-05T00:00:00Z'}]:[{id:2,name:'afbin-npm-release',created_at:'2026-10-06T00:01:00Z'}]})};
 expect((await waitForCurrentArtifact(options)).id).toBe(2);
 expect(calls).toBe(2);
 await expect(waitForCurrentArtifact({...options,jobs:async()=>({jobs:[{name:'CLI npm pack',status:'completed',conclusion:'failure'}]})})).rejects.toThrow(/pack failed/);
 time=0;
 await expect(waitForCurrentArtifact({...options,timeout:5000,artifacts:async()=>({artifacts:[]})})).rejects.toThrow(/timed out/);
});

it('preserves GitHub artifact archive checksum verification',async()=>{
 const {verifyArtifactArchive}=await import('../lib/ci-artifact-wait.mjs');
 const digest='sha256:ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad';
 expect(()=>verifyArtifactArchive(Buffer.from('abc'),digest)).not.toThrow();
 expect(()=>verifyArtifactArchive(Buffer.from('tampered'),digest)).toThrow(/checksum/);
 expect(()=>verifyArtifactArchive(Buffer.from('abc'),undefined)).toThrow(/checksum/);
});

it('releases the signed candidate before seed uploads and waits for each native platform seed',()=>{
 const jobs=workflow().jobs,pack=jobs['cli-pack'].steps;
 const candidate=pack.findIndex(step=>step.with?.name==='afbin-npm-release');
 const seeds=pack.map((step,index)=>step.with?.name?.startsWith('afbin-npm-dependency-seed-')?index:-1).filter(index=>index>=0);
 expect(seeds).toHaveLength(5);
 for(const index of seeds)expect(candidate).toBeLessThan(index);
 const steps=jobs.cli.steps,wait=steps.findIndex(step=>step.name==="Wait for this attempt's platform seed"),download=steps.findIndex(step=>step.with?.name?.startsWith('afbin-npm-dependency-seed-'));
 expect(wait).toBeGreaterThan(-1);expect(wait).toBeLessThan(download);
 expect(steps[wait].run).toContain('afbin-npm-dependency-seed-${{ runner.os }}-${{ runner.arch }}');
 expect(steps[wait].run).toContain('--wait-only');
});

it('prepares all consumer prerequisites before waiting for the same-run candidate',()=>{
 const job=workflow().jobs.cli,steps=job.steps;
 expect(job.needs).toEqual(['plan']);expect(job.permissions).toEqual({contents:'read',actions:'read'});
 const waiting=steps.findIndex(step=>step.run?.includes('ci-artifact-wait.mjs'));
 expect(waiting).toBeGreaterThan(steps.findIndex(step=>step.id==='dependency-cache-path'));
 expect(waiting).toBeGreaterThan(steps.findIndex(step=>step.id==='acceptance-browser'));
 expect(steps[waiting].run).toContain('--wait-only');
 expect(steps[waiting].env.GH_TOKEN).toBe('${{ github.token }}');
 expect(waiting).toBeLessThan(steps.findIndex(step=>step.with?.name==='afbin-npm-release'));
});
it('wait-only CLI checks exact attempt and accepts readiness without downloading a duplicate zip',()=>{
 const directory=mkdtempSync(join(tmpdir(),'afbin-wait-only-'));
 const calls=join(directory,'calls');
 const gh=join(directory,'gh');
 writeFileSync(gh,`#!${process.execPath}
const fs=require('node:fs');const path=process.argv[3];fs.appendFileSync(${JSON.stringify(calls)},path+'\\n');console.log(JSON.stringify(path.endsWith('/attempts/2')?{run_started_at:'2026-10-06T00:00:00Z'}:path.includes('/jobs?')?{jobs:[{name:'CLI npm pack',status:'in_progress'}]}:{artifacts:[{id:123,name:'afbin-npm-release',created_at:'2026-10-06T00:01:00Z'}]}));
`);chmodSync(gh,0o755);
 try{
  const result=spawnSync(process.execPath,[fileURLToPath(new URL('../lib/ci-artifact-wait.mjs',import.meta.url)),'--wait-only','minusxai/artifactbin','100','2'],{encoding:'utf8',env:{...process.env,PATH:directory+':'+process.env.PATH}});
  expect(result.status,result.stderr).toBe(0);expect(result.stdout).toContain('Ready');
  const requested=readFileSync(calls,'utf8');expect(requested).toContain('/runs/100/attempts/2');expect(requested).not.toContain('/zip');
 }finally{rmSync(directory,{recursive:true,force:true});}
});

it('builds pack-only candidates without preparing or uploading unused native download seeds',()=>{
 const steps=workflow().jobs['cli-pack'].steps;
 const selected=steps.filter(step=>step.run?.includes('prepare-seed')||step.run?.includes('pack-seeds')||step.with?.name?.startsWith('afbin-npm-dependency-seed-'));
 expect(selected).toHaveLength(7);expect(selected.every(step=>step.if.startsWith("needs.plan.outputs.cli == 'true'"))).toBe(true);
 expect(steps.find(step=>step.run==='npm run build -w services/cli').if).toBe("needs.plan.outputs.cli != 'true'");
 expect(steps.find(step=>step.run==='npm run pack:release -w services/cli').if).toBeUndefined();
 expect(steps.find(step=>step.with?.name==='afbin-npm-packages').if).toBeUndefined();
});

it('reuses current-attempt waiting for prepared CLI packages without accepting other producers or stale artifacts',async()=>{
 const {waitForCurrentArtifact}=await import('../lib/ci-artifact-wait.mjs');
 let time=0,calls=0;
 const current={id:3,name:'prepared-cli',created_at:'2026-10-06T00:01:00Z'};
 const options={jobName:'package',artifactName:'prepared-cli',startedAt:'2026-10-06T00:00:00Z',now:()=>time,sleep:async()=>{time+=5000;},jobs:async()=>({jobs:[{name:'package',status:'in_progress'},{name:'CLI npm pack',status:'completed',conclusion:'failure'}]}),artifacts:async()=>({artifacts:++calls===1?[{...current,id:1,created_at:'2026-10-05T00:01:00Z'},{...current,id:2,expired:true},{...current,id:4,name:'afbin-npm-release'}]:[current]})};
 expect((await waitForCurrentArtifact(options)).id).toBe(3);expect(calls).toBe(2);
 await expect(waitForCurrentArtifact({...options,jobs:async()=>({jobs:[{name:'package',status:'completed',conclusion:'failure'}]})})).rejects.toThrow('package failed');
 await expect(waitForCurrentArtifact({...options,artifacts:async()=>({artifacts:[current,{...current,id:5}]})})).rejects.toThrow(/Multiple current-attempt/);
 time=0;await expect(waitForCurrentArtifact({...options,timeout:5000,artifacts:async()=>({artifacts:[{...current,expired:true}]})})).rejects.toThrow(/timed out/);
});
