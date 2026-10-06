import {it,expect} from 'vitest';
import {readFileSync,mkdtempSync,writeFileSync,rmSync,mkdirSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync,spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
import yaml from 'yaml';
import * as seeds from '../lib/npm-dependency-cache.mjs';
import {installNpmConsumer} from '../lib/npm-consumer-install.mjs';
const npmCli=()=>process.env.npm_execpath??join(execFileSync('npm',['root','-g'],{encoding:'utf8'}).trim(),'npm/bin/npm-cli.js');
const workflow=()=>yaml.parse(readFileSync(new URL('../../.github/workflows/ci.yml',import.meta.url),'utf8'));

it('gives every browser a disjoint immutable cache that the main warmer also populates',()=>{
 const jobs=workflow().jobs;
 const warm=jobs['warm-caches'].steps;
 const browsers=['chromium','firefox','webkit'];
 for(const browser of browsers){
  const reader=jobs.gates.steps.find(step=>step.id===`browser-${browser}`);
  const writer=warm.find(step=>step.id===`browser-${browser}`);
  expect(reader,`${browser} must have its own cache`).toBeDefined();
  expect(reader.with).toEqual(writer.with);
  expect(reader.with.key).toContain(`playwright-v2-${browser}-`);
  expect(reader.with.path).toContain(`/${browser}-*`);
  for(const other of browsers.filter(name=>name!==browser))expect(reader.with.path).not.toContain(`/${other}-*`);
  if(browser!=='chromium')expect(reader.if).toContain(`'${browser}'`);
 }
 for(const name of ['api','node']){
  const chromium=jobs[name].steps.find(step=>step.id==='playwright');
  expect(chromium.with).toEqual(warm.find(step=>step.id==='browser-chromium').with);
 }
 // Reference conformance uses the same runner/browser prerequisite as Chromium-only gates.
 const reference=jobs['reference-compatibility'];
 expect(reference['runs-on']).toBe(jobs.gates['runs-on']);
 expect(reference.steps.find(step=>step.id==='browser-chromium').with).toEqual(warm.find(step=>step.id==='browser-chromium').with);
 const referenceInstall=reference.steps.find(step=>step.run?.includes('npx playwright install'));
 expect(referenceInstall.run).toBe('npx playwright install chromium');
 const selection=jobs.gates.steps.findIndex(step=>step.id==='gate-browsers');
 expect(selection).toBeLessThan(jobs.gates.steps.findIndex(step=>step.id==='browser-chromium'));
 const install=warm.find(step=>step.run?.includes('install --with-deps chromium firefox webkit'));
 for(const browser of browsers)expect(install.if).toContain(`steps.browser-${browser}.outputs.cache-hit != 'true'`);
});

it('keys platform seed archives by dependency inputs instead of candidate versions',()=>{
 const lock={name:'@afbin/cli',version:'1.0.0',packages:{'':{name:'@afbin/cli',version:'1.0.0',dependencies:{a:'1.0.0'}},'node_modules/a':{version:'1.0.0',resolved:'https://registry.npmjs.org/a/-/a-1.0.0.tgz',integrity:'sha512-a',os:['linux']}}};
 expect(seeds.npmPlatformSeedCacheKey).toBeTypeOf('function');
 const key=seeds.npmPlatformSeedCacheKey(JSON.stringify(lock));
 const bumped=structuredClone(lock);bumped.version=bumped.packages[''].version='1.0.1';
 expect(seeds.npmPlatformSeedCacheKey(JSON.stringify(bumped))).toBe(key);
 for(const field of ['integrity','resolved','os']){
  const changed=structuredClone(lock);changed.packages['node_modules/a'][field]=field==='os'?['win32']:'different';
  expect(seeds.npmPlatformSeedCacheKey(JSON.stringify(changed))).not.toBe(key);
 }
 expect(()=>seeds.npmPlatformSeedCacheKey(JSON.stringify({packages:{}}))).toThrow(/shrinkwrap/);
});

it('reuses only public platform archives and still uploads them from the current run',()=>{
 const jobs=workflow().jobs,pack=jobs['cli-pack'].steps,warm=jobs['warm-caches'].steps;
 const reader=pack.find(step=>step.id==='npm-seeds'),writer=warm.find(step=>step.id==='npm-seeds');
 expect(reader).toBeDefined();expect(reader.with).toEqual(writer.with);
 expect(reader.with.path).toBe('.ci-cache-key/npm-platform-seeds/*.tar');
 expect(reader.with.key).toContain('steps.npm-seed-key.outputs.key');
 expect(reader.with.key).toContain('scripts/lib/npm-dependency-cache.mjs');
 const build=pack.find(step=>step.name==='Prepare public downloads while building the CLI');
 expect(build.env.SEED_CACHE_HIT).toBe('${{ steps.npm-seeds.outputs.cache-hit }}');
 expect(build.run).toContain('"$SEED_CACHE_HIT" != true');
 const archives=pack.find(step=>step.run?.includes('pack-seeds'));
 expect(archives.if).toContain("steps.npm-seeds.outputs.cache-hit != 'true'");
 const uploads=pack.filter(step=>step.with?.name?.startsWith('afbin-npm-dependency-seed-'));
 expect(uploads).toHaveLength(5);
 expect(uploads.every(step=>step.if==="needs.plan.outputs.cli == 'true'")).toBe(true);
 expect(uploads.every(step=>step.with.path.startsWith('.ci-cache-key/npm-platform-seeds/'))).toBe(true);
 const merge=jobs.cli.steps.find(step=>step.run?.includes('merge-seed'));
 expect(merge.run).toContain('${{ runner.os }}');expect(merge.run).toContain('${{ runner.arch }}');
});

it('installs isolated candidates offline after a seed and retains the cold bootstrap network proof',()=>{
 const source=readFileSync(new URL('../../services/cli/scripts/test-npm-package.mjs',import.meta.url),'utf8');
 expect(source).toContain('installNpmConsumer');
 expect(source).not.toContain("spawnSync(process.execPath,[npm,'install'");
 const cold=workflow().jobs['cli-bootstrap'];
 expect(cold.steps.some(step=>step.run?.includes('--dependency-cache'))).toBe(false);
});

it('bounds and streams real consumer subprocesses, retaining failed installer output',async()=>{
 const directory=mkdtempSync(join(tmpdir(),'afbin-install-contract-'));
 const script=join(directory,'npm.cjs');
 const output=[];
 const options={npm:script,tarball:'candidate.tgz',cwd:directory,env:{...process.env},seeded:true,onOutput:chunk=>output.push(chunk),heartbeatMs:10,timeoutMs:1000};
 try{
  writeFileSync(script,"process.stdout.write(JSON.stringify(process.argv.slice(2)));process.stderr.write('native lifecycle scripts enabled');setTimeout(()=>{},25);");
  const result=await installNpmConsumer(options);
  expect(result.output).toContain('--offline');expect(result.output).toContain('--full-metadata');expect(result.output).toContain('--foreground-scripts');expect(result.output).toContain('--timing');
  expect(result.output).not.toContain('--ignore-scripts');
  expect(output.join('')).toContain('native lifecycle scripts enabled');
  expect(output.join('')).toContain('npm install still running');
  writeFileSync(script,"process.stderr.write('broken native dependency');process.exitCode=7;");
  await expect(installNpmConsumer(options)).rejects.toThrow(/broken native dependency/);
  writeFileSync(script,"setInterval(()=>{},1000);");
  await expect(installNpmConsumer({...options,timeoutMs:30})).rejects.toThrow(/exceeded/);
  writeFileSync(script,"process.stdout.write(JSON.stringify(process.argv.slice(2)));");
  expect((await installNpmConsumer({...options,seeded:false})).output).not.toContain('--offline');
 }finally{rmSync(directory,{recursive:true,force:true});}
});

it('kills lifecycle descendants that inherit npm output pipes when the install deadline expires',async()=>{
 const directory=mkdtempSync(join(tmpdir(),'afbin-install-tree-'));
 const script=join(directory,'npm.cjs'),marker=join(directory,'orphan');
 try{
  writeFileSync(script,`require('node:child_process').spawn(process.execPath,['-e',${JSON.stringify("setTimeout(()=>{require('fs').writeFileSync("+JSON.stringify(marker)+",'orphan');},700)")}],{stdio:'inherit'});setInterval(()=>{},1000);`);
  const started=performance.now();
  await expect(installNpmConsumer({npm:script,tarball:'candidate.tgz',cwd:directory,env:{...process.env},timeoutMs:150,onOutput:()=>{}})).rejects.toThrow(/exceeded/);
  expect(performance.now()-started).toBeLessThan(600);
  await new Promise(resolve=>setTimeout(resolve,750));
  expect(existsSync(marker)).toBe(false);
 }finally{rmSync(directory,{recursive:true,force:true});}
});

it('does not restore and save a duplicate npm download cache when every consumer receives a complete seed',()=>{
 const steps=workflow().jobs.cli.steps;
 expect(steps.some(step=>step.id==='dependency-cache')).toBe(false);
 const path=steps.find(step=>step.id==='dependency-cache-path');
 expect(path.run).toContain('$RUNNER_TEMP/npm-consumer-downloads');
 const source=readFileSync(new URL('../../services/cli/scripts/test-npm-package.mjs',import.meta.url),'utf8');
 expect(source).not.toContain('mergeNpmDependencyCache(env.npm_config_cache,dependencyCache)');
});

it('rejects incomplete or wrong-platform archives before copying a seed into the consumer',()=>{
 const directory=mkdtempSync(join(tmpdir(),'afbin-platform-seed-contract-'));
 const index=join(directory,'seed','_cacache','index-v5');mkdirSync(index,{recursive:true});
 const lock=readFileSync(new URL('../../services/cli/npm-shrinkwrap.json',import.meta.url),'utf8');
 const dependencies=seeds.npmSeedDependencies(lock,{os:'linux',cpu:'x64'});
 const archive=join(directory,'seed.tar'),target=join(directory,'consumer');
 const run=(os='Linux',arch='X64')=>spawnSync(process.execPath,[fileURLToPath(new URL('../lib/npm-dependency-cache.mjs',import.meta.url)),'merge-seed',archive,target,os,arch],{encoding:'utf8'});
 const pack=(selected,{manifests=true}={})=>{
  const records=selected.flatMap(dependency=>{
   const tarball={key:'make-fetch-happen:request-cache:'+dependency.resolved,integrity:dependency.integrity,metadata:{url:dependency.resolved}};
   const name=dependency.spec.slice(0,dependency.spec.lastIndexOf('@'));
   const url='https://registry.npmjs.org/'+name;
   return manifests?[tarball,{key:'make-fetch-happen:request-cache:'+url,integrity:'sha512-manifest-fixture',metadata:{url}}]:[tarball];
  });
  writeFileSync(join(index,'entry'),records.map(record=>'checksum\t'+JSON.stringify(record)+'\n').join(''));
  execFileSync('tar',['-cf',archive,'-C',join(directory,'seed'),'_cacache']);
 };
 try{
  pack(dependencies.slice(1));expect(run().status).toBe(1);expect(existsSync(join(target,'_cacache'))).toBe(false);
  pack(dependencies,{manifests:false});const missingManifest=run();expect(missingManifest.status).toBe(1);expect(missingManifest.stderr).toContain('manifest');
  pack(dependencies);expect(run('Unsupported','X64').status).toBe(1);
  expect(run().status).toBe(0);expect(existsSync(join(target,'_cacache','index-v5','entry'))).toBe(true);
  pack([{...dependencies[0],integrity:'sha512-wrong'},...dependencies.slice(1)]);
  const wrong=run();expect(wrong.status).toBe(1);expect(wrong.stderr).toContain('integrity');
 }finally{rmSync(directory,{recursive:true,force:true});}
});

it('installs a real npm tarball with cached pinned dependencies offline and still runs lifecycle scripts',async()=>{
 const directory=mkdtempSync(join(tmpdir(),'afbin-real-offline-install-'));
 const npm=npmCli();
 const cacache=createRequire(npm)('cacache');
 const dependencyDir=join(directory,'dependency','package'),candidateDir=join(directory,'candidate','package');
 const consumer=join(directory,'consumer'),cache=join(directory,'cache');
 for(const path of [dependencyDir,candidateDir,consumer])mkdirSync(path,{recursive:true});
 const dependencyArchive=join(directory,'dependency.tgz'),candidateArchive=join(directory,'candidate.tgz');
 const resolved='https://registry.npmjs.org/afbin-ci-fixture/-/afbin-ci-fixture-1.0.0.tgz';
 const output=[];
 try{
  writeFileSync(join(dependencyDir,'package.json'),JSON.stringify({name:'afbin-ci-fixture',version:'1.0.0',main:'index.cjs'}));
  writeFileSync(join(dependencyDir,'index.cjs'),'module.exports=42;');
  execFileSync('tar',['-czf',dependencyArchive,'-C',join(directory,'dependency'),'package']);
  const bytes=readFileSync(dependencyArchive),integrity='sha512-'+createHash('sha512').update(bytes).digest('base64');
  await cacache.put(join(cache,'_cacache'),'make-fetch-happen:request-cache:'+resolved,bytes,{metadata:{time:Date.now(),url:resolved,reqHeaders:{},resHeaders:{'content-type':'application/octet-stream'}}});
  const manifestUrl='https://registry.npmjs.org/afbin-ci-fixture';
  const manifest={name:'afbin-ci-fixture','dist-tags':{latest:'1.0.0'},versions:{'1.0.0':{name:'afbin-ci-fixture',version:'1.0.0',dist:{tarball:resolved,integrity}}}};
  await cacache.put(join(cache,'_cacache'),'make-fetch-happen:request-cache:'+manifestUrl,JSON.stringify(manifest),{metadata:{time:Date.now(),url:manifestUrl,reqHeaders:{accept:'application/json'},resHeaders:{'content-type':'application/json'}}});
  const pkg={name:'afbin-ci-consumer',version:'1.0.0',dependencies:{'afbin-ci-fixture':'1.0.0'},scripts:{postinstall:`node -e "require('fs').writeFileSync('lifecycle-ran','yes')"`}};
  writeFileSync(join(candidateDir,'package.json'),JSON.stringify(pkg));
  writeFileSync(join(candidateDir,'npm-shrinkwrap.json'),JSON.stringify({name:pkg.name,version:pkg.version,lockfileVersion:3,requires:true,packages:{'':pkg,'node_modules/afbin-ci-fixture':{version:'1.0.0',resolved,integrity}}}));
  execFileSync('tar',['-czf',candidateArchive,'-C',join(directory,'candidate'),'package']);
  writeFileSync(join(consumer,'package.json'),'{}');
  const env={...process.env,HOME:join(directory,'home'),USERPROFILE:join(directory,'home'),npm_config_cache:cache,npm_config_registry:'https://registry.npmjs.org',npm_config_fetch_retries:'0'};
  await installNpmConsumer({npm,tarball:candidateArchive,cwd:consumer,env,seeded:true,onOutput:chunk=>output.push(chunk)});
  const installed=join(consumer,'node_modules','afbin-ci-consumer');
  expect(readFileSync(join(installed,'lifecycle-ran'),'utf8')).toBe('yes');
  expect(createRequire(join(installed,'package.json'))('afbin-ci-fixture')).toBe(42);
  expect(output.join('')).toContain('offline blob-cached');
  const empty=join(directory,'empty');mkdirSync(empty);writeFileSync(join(empty,'package.json'),'{}');
  await expect(installNpmConsumer({npm,tarball:candidateArchive,cwd:empty,env:{...env,npm_config_cache:join(directory,'empty-cache')},seeded:true,onOutput:()=>{}})).rejects.toThrow(/ENOTCACHED/);
 }finally{rmSync(directory,{recursive:true,force:true});}
});

it('accepts only manifests for pinned public dependencies, including scoped package URLs',async()=>{
 const directory=mkdtempSync(join(tmpdir(),'afbin-manifest-seed-'));
 const index=join(directory,'_cacache','index-v5');mkdirSync(index,{recursive:true});
 const dependency={resolved:'https://registry.npmjs.org/@scope/a/-/a-1.2.3.tgz',integrity:'sha512-pinned'};
 const tarball={key:'make-fetch-happen:request-cache:'+dependency.resolved,integrity:dependency.integrity};
 const manifest={key:'make-fetch-happen:request-cache:https://registry.npmjs.org/@scope%2fa',integrity:'sha512-manifest'};
 const store=records=>writeFileSync(join(index,'entry'),records.map(record=>'checksum\t'+JSON.stringify(record)+'\n').join(''));
 try{
  expect(seeds.npmSeedRequest(dependency)).toBe('@scope/a@1.2.3');
  const alias={key:'pacote:tarball:@scope/a@1.2.3',integrity:dependency.integrity};
  store([tarball,manifest,alias]);expect(await seeds.assertPublicNpmCache(directory,[dependency])).toBe(3);
  store([tarball,{...alias,integrity:'sha512-wrong'}]);
  await expect(seeds.assertPublicNpmCache(directory,[dependency])).rejects.toThrow(/integrity/);
  store([tarball,{...manifest,key:'make-fetch-happen:request-cache:https://registry.npmjs.org/unrelated'}]);
  await expect(seeds.assertPublicNpmCache(directory,[dependency])).rejects.toThrow(/outside/);
 }finally{rmSync(directory,{recursive:true,force:true});}
});

it('prunes platform aliases without deleting shared npm content or breaking subsequent removals',async()=>{
 const directory=mkdtempSync(join(tmpdir(),'afbin-pack-seeds-'));
 const source=join(directory,'source'),output=join(directory,'output');
 const cacache=createRequire(npmCli())('cacache');
 const bytes=Buffer.from('shared pinned fixture'),integrity='sha512-'+createHash('sha512').update(bytes).digest('base64');
 const all={version:'1.0.0',resolved:'https://registry.npmjs.org/all/-/all-1.0.0.tgz',integrity};
 const linux={version:'1.0.0',resolved:'https://registry.npmjs.org/linux-only/-/linux-only-1.0.0.tgz',integrity,os:['linux'],cpu:['x64']};
 try{
  for(const [name,dep] of [['all',all],['linux-only',linux]]){
   for(const key of ['make-fetch-happen:request-cache:'+dep.resolved,`pacote:tarball:${name}@1.0.0`])await cacache.put(join(source,'_cacache'),key,bytes);
   const manifest={name,versions:{'1.0.0':{name,version:'1.0.0',dist:{tarball:dep.resolved,integrity}}}};
   await cacache.put(join(source,'_cacache'),'make-fetch-happen:request-cache:https://registry.npmjs.org/'+name,JSON.stringify(manifest));
  }
  const lock=JSON.stringify({packages:{'':{},'node_modules/all':all,'node_modules/linux-only':linux}});
  await seeds.packPlatformNpmSeeds(source,output,lock);
  const entries=await cacache.ls(join(output,'macOS-ARM64','_cacache'));
  expect(Object.keys(entries)).toHaveLength(3);
  expect(Object.keys(entries).every(key=>!key.includes('linux-only'))).toBe(true);
  expect(await seeds.assertPublicNpmCache(join(output,'macOS-ARM64'),[{...all,spec:'all@1.0.0'}])).toBe(3);
 }finally{rmSync(directory,{recursive:true,force:true});}
});
