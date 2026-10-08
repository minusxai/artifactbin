import {it,expect,vi} from 'vitest';
import {readFileSync,mkdtempSync,writeFileSync,rmSync,mkdirSync,existsSync,symlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFile,execFileSync,spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
import {gzipSync} from 'node:zlib';
import {createServer} from 'node:http';
import {promisify} from 'node:util';
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
 const consumers=jobs.cli.steps.filter(step=>['Same-tarball native npm and warmed offline acceptance','Install the same candidate for experience checks'].includes(step.name));
 expect(consumers).toHaveLength(2);
 expect(consumers.every(step=>step.run.includes('--dependency-seed'))).toBe(true);
 // npm -w changes cwd: hand the root-downloaded archive across that boundary absolutely.
 expect(consumers.every(step=>step.run.includes('--dependency-seed "${{ github.workspace }}/'))).toBe(true);
 expect(consumers.every(step=>step.run.includes('npm-dependency-seed-${{ runner.os }}-${{ runner.arch }}.tar'))).toBe(true);
 expect(jobs.cli.steps.some(step=>step.run?.includes('merge-seed'))).toBe(false);
});

it('installs isolated candidates offline after a seed and retains the cold bootstrap network proof',()=>{
 const source=readFileSync(new URL('../../services/cli/scripts/test-npm-package.mjs',import.meta.url),'utf8');
 expect(source).toContain('installNpmConsumer');
 expect(source).not.toContain("spawnSync(process.execPath,[npm,'install'");
 const cold=workflow().jobs['cli-bootstrap'];
 expect(cold.steps.some(step=>step.run?.includes('--dependency-cache'))).toBe(false);
});

it('seeds only the same-run Windows bootstrap cache and leaves online cache-miss fallback enabled',()=>{
 const source=readFileSync(new URL('../../services/cli/scripts/test-node-bootstrap.ps1',import.meta.url),'utf8');
 const bootstrap=workflow().jobs['cli-bootstrap'].steps.find(step=>step.run?.includes('test-node-bootstrap.ps1'));
 expect(bootstrap.run).toContain('-WaitForArtifact');
 expect(source).toContain('afbin-npm-dependency-seed-Windows-X64');
 expect(source).toContain('scripts/lib/npm-dependency-cache.mjs merge-seed');
 expect(source).toContain("'_cacache\\_lastverified'");
 expect(source).toContain('Expected verified same-run npm dependency seed');
 expect(source).toContain("$env:npm_config_cache=Join-Path '__ROOT__' 'npm-cache'");
 expect(source).toContain('& icacls.exe $root /grant');
 expect(source).not.toContain('$env:npm_config_offline');
 expect(source).toContain("$phase='standard-user online npx query'");
 expect(source).toContain("$phase='standard-user setup global and skills'");
 const acl=source.indexOf('& icacls.exe $root /grant'),seed=source.indexOf('scripts/lib/npm-dependency-cache.mjs merge-seed');
 const candidateWait=source.indexOf("while(!(Test-Path '__ROOT__\\candidate.tgz'))"),seedCheck=source.indexOf('Expected verified same-run npm dependency seed'),query=source.indexOf("$phase='standard-user online npx query'");
 expect(acl).toBeGreaterThanOrEqual(0);expect(seed).toBeGreaterThan(acl);
 expect(candidateWait).toBeGreaterThan(-1);expect(candidateWait).toBeLessThan(seedCheck);expect(seedCheck).toBeLessThan(query);
});

it('repeats setup through the exact global install instead of re-resolving the candidate with npx',()=>{
 const source=readFileSync(new URL('../../services/cli/scripts/test-node-bootstrap.ps1',import.meta.url),'utf8');
 const repeat=source.slice(source.indexOf("$phase='repeat setup retains skills'"),source.indexOf("$phase='fresh-shell global afbin.cmd'"));
 expect(repeat).toContain('Invoke-Candidate $setup.global.bin');
 expect(repeat).toContain("@('setup','--harness','claude','--harness','codex','--yes','--json')");
 expect(repeat).toContain("$repeat.global.status -ne 'installed'");
 expect(repeat).toContain("$_.status -ne 'unchanged'");
 expect(repeat).not.toContain("Invoke-Candidate 'npx.cmd'");
});

it('bounds and streams real consumer subprocesses, retaining failed installer output',async()=>{
 const directory=mkdtempSync(join(tmpdir(),'afbin-install-contract-'));
 const script=join(directory,'npm.cjs'),tarball=join(directory,'candidate.tgz');
 const output=[];
 const options={npm:script,tarball:'candidate.tgz',cwd:directory,env:{...process.env},seeded:true,onOutput:chunk=>output.push(chunk),heartbeatMs:10,timeoutMs:1000};
 try{
  writeFileSync(tarball,gzipSync('valid candidate gzip'));
  options.tarball=tarball;
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

it('retries only a verified seeded candidate EOF in its bundled runtime assets',async()=>{
 const directory=mkdtempSync(join(tmpdir(),'afbin-install-eof-retry-'));
 const script=join(directory,'npm.cjs'),tarball=join(directory,'candidate.tgz'),countFile=join(directory,'attempts'),argsFile=join(directory,'args');
 const output=[];
 try{
  writeFileSync(tarball,gzipSync('valid candidate gzip'));
  writeFileSync(script,`const fs=require('node:fs');const file=${JSON.stringify(countFile)},args=${JSON.stringify(argsFile)},asset=process.env.ASSET_PATH||'dist/runtime/dist/web/assets';const attempt=Number(fs.existsSync(file)?fs.readFileSync(file,'utf8'):0)+1;fs.writeFileSync(file,String(attempt));fs.appendFileSync(args,JSON.stringify({argv:process.argv.slice(2),cache:process.env.npm_config_cache})+'\\n');if(attempt===1){process.stderr.write('npm warn tar TAR_ENTRY_ERROR ENOENT lstat '+asset+'\\nnpm error code Z_BUF_ERROR\\nnpm error zlib: unexpected end of file');process.exitCode=251}else process.stdout.write('retry finished');`);
  const cache=join(directory,'cache');
  const result=await installNpmConsumer({npm:script,tarball,cwd:directory,env:{...process.env,npm_config_cache:cache},seeded:true,onOutput:chunk=>output.push(chunk),heartbeatMs:10,timeoutMs:1000});
  expect(readFileSync(countFile,'utf8')).toBe('2');
  const attempts=readFileSync(argsFile,'utf8').trim().split('\n').map(line=>JSON.parse(line));
  expect(attempts[0]).toEqual(attempts[1]);
  expect(attempts[0].argv).toContain('--offline');expect(attempts[0].argv).toContain('--full-metadata');expect(attempts[0].argv).toContain('--foreground-scripts');
  expect(attempts[0].cache).toBe(cache);
  expect(result.output).toContain('npm error zlib: unexpected end of file');
  expect(result.output).toContain('retry finished');
  expect(result.output).toMatch(/first install took .* retrying once/i);
  expect(result.output).toContain('candidate.tgz');
  expect(output.join('')).toContain('npm warn tar TAR_ENTRY_ERROR');
  expect(result.output.match(/sha256=([a-f0-9]{64})/)?.[1]).toBe(createHash('sha256').update(readFileSync(tarball)).digest('hex'));
  rmSync(countFile,{force:true});
  const windowsSeparatorPath=String.raw`dist\runtime\dist\web\assets`;
  const windowsResult=await installNpmConsumer({npm:script,tarball,cwd:directory,env:{...process.env,ASSET_PATH:windowsSeparatorPath},seeded:true,onOutput:()=>{},timeoutMs:1000});
  expect(readFileSync(countFile,'utf8')).toBe('2');
  expect(windowsResult.output).toContain('Retrying once');
 }finally{rmSync(directory,{recursive:true,force:true});}
});

it('does not retry generic, corrupt, auth, lifecycle, or repeated candidate install failures',async()=>{
 const directory=mkdtempSync(join(tmpdir(),'afbin-install-no-retry-'));
 const script=join(directory,'npm.cjs'),tarball=join(directory,'candidate.tgz'),countFile=join(directory,'attempts');
 try{
  writeFileSync(script,`const fs=require('node:fs');const file=${JSON.stringify(countFile)};const attempt=Number(fs.existsSync(file)?fs.readFileSync(file,'utf8'):0)+1;fs.writeFileSync(file,String(attempt));const mode=process.env.FAILURE_MODE,marker='npm warn tar TAR_ENTRY_ERROR ENOENT lstat dist/runtime/dist/web/assets\\n';if(mode==='generic')process.stderr.write('npm error zlib: unexpected end of file');else if(mode==='auth')process.stderr.write('npm error code E401\\nnpm error zlib: unexpected end of file');else if(mode==='lifecycle')process.stderr.write('npm error command failed: lifecycle script\\nnpm error zlib: unexpected end of file');else if(mode==='auth-candidate')process.stderr.write(marker+'npm error code E401\\nnpm error zlib: unexpected end of file');else if(mode==='lifecycle-candidate')process.stderr.write(marker+'npm error command failed: lifecycle script\\nnpm error code Z_BUF_ERROR\\nnpm error zlib: unexpected end of file');else if(mode==='candidate')process.stderr.write(marker+'npm error code Z_BUF_ERROR\\nnpm error zlib: unexpected end of file');process.exitCode=251;`);
  writeFileSync(tarball,gzipSync('valid candidate gzip'));
  for(const mode of ['generic','auth','lifecycle','auth-candidate','lifecycle-candidate']){
   rmSync(countFile,{force:true});
   await expect(installNpmConsumer({npm:script,tarball,cwd:directory,env:{...process.env,FAILURE_MODE:mode},seeded:true,onOutput:()=>{},timeoutMs:1000})).rejects.toThrow(/npm install exited/);
   expect(readFileSync(countFile,'utf8'),mode).toBe('1');
  }
  writeFileSync(tarball,'not a gzip candidate');rmSync(countFile,{force:true});
  await expect(installNpmConsumer({npm:script,tarball,cwd:directory,env:{...process.env,FAILURE_MODE:'candidate'},seeded:true,onOutput:()=>{},timeoutMs:1000})).rejects.toThrow(/gzip|npm install exited/i);
  expect(readFileSync(countFile,'utf8')).toBe('1');
  writeFileSync(tarball,gzipSync('valid candidate gzip'));rmSync(countFile,{force:true});
  writeFileSync(script,`const fs=require('node:fs');const file=${JSON.stringify(countFile)};const attempt=Number(fs.existsSync(file)?fs.readFileSync(file,'utf8'):0)+1;fs.writeFileSync(file,String(attempt));if(attempt===1){fs.writeFileSync(${JSON.stringify(tarball)},'mutated candidate');process.stderr.write('npm warn tar TAR_ENTRY_ERROR ENOENT lstat dist/runtime/dist/web/assets\\nnpm error code Z_BUF_ERROR\\nnpm error zlib: unexpected end of file');process.exitCode=251}else process.stdout.write('retry finished');`);
  await expect(installNpmConsumer({npm:script,tarball,cwd:directory,env:{...process.env},seeded:true,onOutput:()=>{},timeoutMs:1000})).rejects.toThrow(/candidate bytes changed/);
  expect(readFileSync(countFile,'utf8')).toBe('1');
  writeFileSync(tarball,gzipSync('valid candidate gzip'));rmSync(countFile,{force:true});
  writeFileSync(script,`const fs=require('node:fs');const file=${JSON.stringify(countFile)};const attempt=Number(fs.existsSync(file)?fs.readFileSync(file,'utf8'):0)+1;fs.writeFileSync(file,String(attempt));process.stderr.write('candidate attempt '+attempt+'\\nnpm warn tar TAR_ENTRY_ERROR ENOENT lstat dist/runtime/dist/web/assets\\nnpm error code Z_BUF_ERROR\\nnpm error zlib: unexpected end of file');process.exitCode=251;`);
  let twiceFailed;
  try{await installNpmConsumer({npm:script,tarball,cwd:directory,env:{...process.env,FAILURE_MODE:'candidate'},seeded:true,onOutput:()=>{},timeoutMs:1000});}catch(error){twiceFailed=error;}
  expect(twiceFailed?.message).toMatch(/retry.*failed/i);
  expect(twiceFailed?.message).toContain('candidate attempt 1');expect(twiceFailed?.message).toContain('candidate attempt 2');
  expect(readFileSync(countFile,'utf8')).toBe('2');
 }finally{rmSync(directory,{recursive:true,force:true});}
});

it('keeps candidate EOF retries inside the original deadline and never retries a timeout',async()=>{
 const directory=mkdtempSync(join(tmpdir(),'afbin-install-eof-deadline-')),tarball=join(directory,'candidate.tgz');
 vi.useFakeTimers({toFake:['setTimeout','clearTimeout']});
 try{
  writeFileSync(tarball,gzipSync('valid candidate gzip'));
  let clock=0;const budgets=[];
  const options={npm:'unused',tarball,cwd:directory,env:{},seeded:true,onOutput:()=>{},timeoutMs:140,now:()=>clock};
  await expect(installNpmConsumer({...options,attemptRunner:async({attempt,timeoutMs})=>{
   budgets.push(timeoutMs);
   if(attempt===1){clock=100;return {code:251,output:'candidate.tgz npm error code Z_BUF_ERROR',timedOut:false,seconds:0.1};}
   clock+=timeoutMs;return {code:null,output:'',timedOut:true,seconds:timeoutMs/1000};
  }})).rejects.toThrow(/exceeded/);
  expect(budgets).toEqual([140,40]);expect(clock).toBe(140);
  clock=0;const attempts=[];
  await expect(installNpmConsumer({...options,attemptRunner:async({attempt})=>{
   attempts.push(attempt);clock=140;return {code:null,output:'',timedOut:true,seconds:0.14};
  }})).rejects.toThrow(/exceeded/);
  expect(attempts).toEqual([1]);
 }finally{vi.useRealTimers();rmSync(directory,{recursive:true,force:true});}
});

it('kills the real npm child after readiness without allowing its late side effect',async()=>{
 const directory=mkdtempSync(join(tmpdir(),'afbin-install-ready-timeout-')),script=join(directory,'npm.cjs'),marker=join(directory,'late-marker');
 vi.useFakeTimers({toFake:['setTimeout','clearTimeout','setInterval','clearInterval']});
 try{
  writeFileSync(script,`process.stdout.write('READY');setTimeout(()=>require('fs').writeFileSync(${JSON.stringify(marker)},'late'),220);setInterval(()=>{},1000);`);
  let ready;const readiness=new Promise(resolve=>{ready=resolve;});
  const install=installNpmConsumer({npm:script,tarball:'unused',cwd:directory,env:{...process.env},timeoutMs:100,onOutput:chunk=>{if(chunk.includes('READY'))ready();}});
  const rejected=expect(install).rejects.toThrow(/exceeded/);
  await readiness;
  vi.advanceTimersByTime(100);await rejected;
  vi.useRealTimers();await new Promise(resolve=>setTimeout(resolve,250));
  expect(existsSync(marker)).toBe(false);
 }finally{vi.useRealTimers();rmSync(directory,{recursive:true,force:true});}
});

it('kills lifecycle descendants that inherit npm output pipes when the install deadline expires',async()=>{
 const directory=mkdtempSync(join(tmpdir(),'afbin-install-tree-'));
 const script=join(directory,'npm.cjs'),marker=join(directory,'orphan');
 vi.useFakeTimers({toFake:['setTimeout','clearTimeout','setInterval','clearInterval']});
 try{
  const descendant=`setTimeout(()=>{require('fs').writeFileSync(${JSON.stringify(marker)},'orphan');},700);process.stdout.write('DESCENDANT_READY');`;
  writeFileSync(script,`require('node:child_process').spawn(process.execPath,['-e',${JSON.stringify(descendant)}],{stdio:'inherit'});setInterval(()=>{},1000);`);
  let ready;const readiness=new Promise(resolve=>{ready=resolve;});
  const install=installNpmConsumer({npm:script,tarball:'candidate.tgz',cwd:directory,env:{...process.env},timeoutMs:150,onOutput:chunk=>{if(chunk.includes('DESCENDANT_READY'))ready();}});
  const rejected=expect(install).rejects.toThrow(/exceeded/);
  await readiness;vi.advanceTimersByTime(150);await rejected;
  vi.useRealTimers();await new Promise(resolve=>setTimeout(resolve,750));
  expect(existsSync(marker)).toBe(false);
 }finally{vi.useRealTimers();rmSync(directory,{recursive:true,force:true});}
});

it('does not restore and save a duplicate npm download cache when every consumer receives a complete seed',()=>{
 const steps=workflow().jobs.cli.steps;
 expect(steps.some(step=>step.id==='dependency-cache')).toBe(false);
 expect(steps.some(step=>step.id==='dependency-cache-path')).toBe(false);
 const source=readFileSync(new URL('../../services/cli/scripts/test-npm-package.mjs',import.meta.url),'utf8');
 expect(source).toContain('extractValidatedNpmSeed(dependencySeed,env.npm_config_cache');
 expect(source).toContain('--dependency-cache');
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
  rmSync(target,{recursive:true,force:true});
  pack([{...dependencies[0],integrity:'sha512-wrong'},...dependencies.slice(1)]);
  const wrong=run();expect(wrong.status).toBe(1);expect(wrong.stderr).toContain('integrity');
 }finally{rmSync(directory,{recursive:true,force:true});}
});

it('extracts a verified platform archive directly into empty independent consumer caches',async()=>{
 const directory=mkdtempSync(join(tmpdir(),'afbin-direct-seed-extract-'));
 const source=join(directory,'seed'),cacheRoot=join(source,'_cacache'),index=join(cacheRoot,'index-v5'),archive=join(directory,'seed.tar');
 mkdirSync(index,{recursive:true});
 writeFileSync(join(cacheRoot,'_lastverified'),'npm-cache-ok\n');
 const dependency={version:'1.0.0',resolved:'https://registry.npmjs.org/a/-/a-1.0.0.tgz',integrity:'sha512-a',os:['linux'],cpu:['x64']};
 const lock=JSON.stringify({name:'@afbin/cli',packages:{'':{name:'@afbin/cli'},'node_modules/a':dependency}});
 const deps=seeds.npmSeedDependencies(lock,{os:'linux',cpu:'x64'}),manifestUrl='https://registry.npmjs.org/a';
 const records=[
  {key:'make-fetch-happen:request-cache:'+dependency.resolved,integrity:dependency.integrity,metadata:{url:dependency.resolved}},
  {key:'make-fetch-happen:request-cache:'+manifestUrl,integrity:'sha512-manifest',metadata:{url:manifestUrl}},
 ];
 writeFileSync(join(index,'entry'),records.map(record=>'checksum\t'+JSON.stringify(record)+'\n').join(''));
 execFileSync('tar',['-cf',archive,'-C',source,'_cacache']);
 const archiveHash=createHash('sha256').update(readFileSync(archive)).digest('hex');
 const extract=seeds.extractValidatedNpmSeed;
 const first=join(directory,'consumer-one','cache'),second=join(directory,'consumer-two','cache');
 try{
  expect(extract,'consumer preparation needs the archive-to-private-cache boundary').toBeTypeOf('function');
  const result=await extract(archive,first,lock,{os:'linux',cpu:'x64'});
  expect(result.records).toBe(2);
  expect(result.phases).toEqual({inspectMs:expect.any(Number),extractMs:expect.any(Number),validateMs:expect.any(Number)});
  expect(readFileSync(join(first,'_cacache','index-v5','entry'),'utf8')).toBe(readFileSync(join(index,'entry'),'utf8'));
  expect(readFileSync(join(first,'_cacache','_lastverified'),'utf8')).toBe('npm-cache-ok\n');
  expect(existsSync(archive+'.seed')).toBe(false);
  await extract(archive,second,lock,{os:'linux',cpu:'x64'});
  writeFileSync(join(first,'_cacache','index-v5','entry'),'consumer mutation');
  expect(readFileSync(join(second,'_cacache','index-v5','entry'),'utf8')).toBe(readFileSync(join(index,'entry'),'utf8'));
  expect(createHash('sha256').update(readFileSync(archive)).digest('hex')).toBe(archiveHash);
  const occupied=join(directory,'occupied');mkdirSync(occupied);writeFileSync(join(occupied,'keep'),'untouched');
  await expect(extract(archive,occupied,lock,{os:'linux',cpu:'x64'})).rejects.toThrow(/empty/i);
  expect(readFileSync(join(occupied,'keep'),'utf8')).toBe('untouched');
  const wrongPlatform=join(directory,'wrong-platform');
  await expect(extract(archive,wrongPlatform,lock,{os:'win32',cpu:'x64'})).rejects.toThrow(/dependency graph|platform/i);
  expect(existsSync(wrongPlatform)).toBe(false);
  const linked=join(directory,'linked-seed'),linkedIndex=join(linked,'_cacache','index-v5');mkdirSync(linkedIndex,{recursive:true});
  writeFileSync(join(linkedIndex,'entry'),readFileSync(join(index,'entry')));
  symlinkSync('outside',join(linked,'_cacache','_lastverified'));
  const linkedArchive=join(directory,'linked.tar');execFileSync('tar',['-cf',linkedArchive,'-C',linked,'_cacache']);
  const refused=join(directory,'refused');
  await expect(extract(linkedArchive,refused,lock,{os:'linux',cpu:'x64'})).rejects.toThrow(/link or unsupported/i);
  expect(existsSync(refused)).toBe(false);
  const folder=join(directory,'folder-seed'),folderCache=join(folder,'_cacache');mkdirSync(join(folderCache,'_lastverified'),{recursive:true});
  const folderArchive=join(directory,'folder.tar');execFileSync('tar',['-cf',folderArchive,'-C',folder,'_cacache']);
  const folderRefused=join(directory,'folder-refused');
  await expect(extract(folderArchive,folderRefused,lock,{os:'linux',cpu:'x64'})).rejects.toThrow(/marker must be a regular file/i);
  expect(existsSync(folderRefused)).toBe(false);
 }finally{rmSync(directory,{recursive:true,force:true});}
});

it('installs a real npm tarball with cached pinned dependencies offline and still runs lifecycle scripts',async()=>{
 const directory=mkdtempSync(join(tmpdir(),'afbin-real-offline-install-'));
 const npm=npmCli();
 const cacache=createRequire(npm)('cacache');
 const dependencyDir=join(directory,'dependency','package'),candidateDir=join(directory,'candidate','package');
 const consumer=join(directory,'consumer'),sourceCache=join(directory,'producer-cache'),cache=join(directory,'consumer-cache');
 for(const path of [dependencyDir,candidateDir,consumer])mkdirSync(path,{recursive:true});
 const dependencyArchive=join(directory,'dependency.tgz'),candidateArchive=join(directory,'candidate.tgz'),seedArchive=join(directory,'seed.tar');
 const resolved='https://registry.npmjs.org/afbin-ci-fixture/-/afbin-ci-fixture-1.0.0.tgz';
 const output=[];
 try{
  writeFileSync(join(dependencyDir,'package.json'),JSON.stringify({name:'afbin-ci-fixture',version:'1.0.0',main:'index.cjs'}));
  writeFileSync(join(dependencyDir,'index.cjs'),'module.exports=42;');
  execFileSync('tar',['-czf',dependencyArchive,'-C',join(directory,'dependency'),'package']);
  const bytes=readFileSync(dependencyArchive),integrity='sha512-'+createHash('sha512').update(bytes).digest('base64');
  await cacache.put(join(sourceCache,'_cacache'),'make-fetch-happen:request-cache:'+resolved,bytes,{metadata:{time:Date.now(),url:resolved,reqHeaders:{},resHeaders:{'content-type':'application/octet-stream'}}});
  const manifestUrl='https://registry.npmjs.org/afbin-ci-fixture';
  const manifest={name:'afbin-ci-fixture','dist-tags':{latest:'1.0.0'},versions:{'1.0.0':{name:'afbin-ci-fixture',version:'1.0.0',dist:{tarball:resolved,integrity}}}};
  await cacache.put(join(sourceCache,'_cacache'),'make-fetch-happen:request-cache:'+manifestUrl,JSON.stringify(manifest),{metadata:{time:Date.now(),url:manifestUrl,reqHeaders:{accept:'application/json'},resHeaders:{'content-type':'application/json'}}});
  const pkg={name:'afbin-ci-consumer',version:'1.0.0',dependencies:{'afbin-ci-fixture':'1.0.0'},scripts:{postinstall:`node -e "require('fs').writeFileSync('lifecycle-ran','yes')"`}};
  writeFileSync(join(candidateDir,'package.json'),JSON.stringify(pkg));
  const lockText=JSON.stringify({name:pkg.name,version:pkg.version,lockfileVersion:3,requires:true,packages:{'':pkg,'node_modules/afbin-ci-fixture':{version:'1.0.0',resolved,integrity,os:[process.platform],cpu:[process.arch]}}});
  writeFileSync(join(candidateDir,'npm-shrinkwrap.json'),lockText);
  execFileSync('tar',['-czf',candidateArchive,'-C',join(directory,'candidate'),'package']);
  execFileSync('tar',['-cf',seedArchive,'-C',sourceCache,'_cacache']);
  await seeds.extractValidatedNpmSeed(seedArchive,cache,lockText,{os:process.platform,cpu:process.arch});
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

it('caches only Linux browser deb archives and still provisions the full browser dependency set on every consumer',()=>{
 const cli=workflow().jobs.cli;expect(cli['timeout-minutes']).toBe(7);
 const key=cli.steps.find(step=>step.id==='acceptance-apt-key'),cache=cli.steps.find(step=>step.id==='acceptance-apt');
 expect(key).toBeDefined();expect(key.run).toContain('ImageOS');expect(key.run).toContain('ImageVersion');expect(key.run).toContain('playwright/browsers.json');
 expect(cache.with.path).toBe('.ci-cache-key/acceptance-apt/*.deb');expect(cache.with.key).toContain('steps.acceptance-apt-key.outputs.key');
 expect(cache.with['restore-keys']).toBeUndefined();expect(cache.if).toContain("runner.os == 'Linux'");
 const install=cli.steps.find(step=>step.name==='Install Linux acceptance browser dependencies');
 expect(install.run).toContain('linux-acceptance-deps.mjs');expect(install.run).toContain('playwright/cli.js');expect(install.if).not.toContain('cache-hit');
 expect(install.if).toContain("matrix.phase == 'preview'");expect(install.if).toContain("matrix.phase == 'local'");
 expect(cli.strategy.matrix.os).toEqual(['ubuntu-24.04','ubuntu-24.04-arm','macos-14','macos-15-intel','windows-2022']);
});


it('reuses the verified first-npx entry for real candidate setup while published setup stays npx',()=>{
 const source=readFileSync(new URL('../../services/cli/scripts/test-node-bootstrap.ps1',import.meta.url),'utf8');
 expect(source).toContain("Copy-Item services/cli/scripts/windows-bootstrap-candidate.mjs (Join-Path $root 'windows-bootstrap-candidate.mjs')");
 expect(source).toContain("$result=Invoke-Candidate 'npx.cmd' @('--yes','--package','__ROOT__\\candidate.tgz','afbin','query',$rows,'--json')");
 const setup=source.slice(source.indexOf("$phase='candidate registry startup'"),source.indexOf("$phase='repeat setup retains skills'"));
 expect(setup).toContain("$phase='verify npm-owned candidate entry'");expect(setup).toContain("$env:npm_config_cache,'__ROOT__\\candidate.tgz',$ready.version");
 expect(setup).toContain("$setupCommand=Join-Path $private 'node.exe'");expect(setup).toContain("$setupArgs=@($entry,'setup')");
 expect(setup).toContain("$setupCommand='npx.cmd'");expect(setup).toContain("$setupArgs=@('--yes','@afbin/cli@latest','setup')");
 expect(setup).toContain('Invoke-Candidate $setupCommand $setupArgs');expect(setup).toContain("$setup.global.status -ne 'installed'");
 expect(setup).not.toContain("$setupArgs=@('--yes','--package'");
});

it('prefers verified full-metadata seeds online only on the unpublished seeded path',()=>{
 const source=readFileSync(new URL('../../services/cli/scripts/test-node-bootstrap.ps1',import.meta.url),'utf8');
 const seed=source.slice(source.indexOf('if($seededCache){'),source.indexOf("$phase='standard-user online npx query'"));
 expect(seed).toContain("$env:npm_config_prefer_offline='true'");
 expect(seed).toContain("$env:npm_config_full_metadata='true'");
 expect(source.match(/npm_config_prefer_offline=/g)).toHaveLength(1);
 expect(source).not.toContain("npm_config_offline='true'");
});


it('uses full cached npm metadata without fetching it and fetches missing dependencies online in a fresh install',async()=>{
 const directory=mkdtempSync(join(tmpdir(),'afbin-real-prefer-offline-')),npm=npmCli(),cache=join(directory,'cache'),consumer=join(directory,'consumer');
 const cacache=createRequire(npm)('cacache'),requests=[],routes=new Map();
 const server=createServer((req,res)=>{requests.push(req.url);const route=routes.get(req.url);if(!route){res.writeHead(404);res.end();return;}res.setHeader('content-type',route.type);res.end(route.bytes);});
 try{
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const registry=`http://127.0.0.1:${server.address().port}`;
  for(const name of ['cached-fixture','missing-fixture']){
   const root=join(directory,name),pkg=join(root,'package');mkdirSync(pkg,{recursive:true});
   writeFileSync(join(pkg,'package.json'),JSON.stringify({name,version:'1.0.0',main:'index.cjs'}));writeFileSync(join(pkg,'index.cjs'),'module.exports=42;');
   const archive=join(root,'fixture.tgz');execFileSync('tar',['-czf',archive,'-C',root,'package']);
   const bytes=readFileSync(archive),path=`/${name}/-/fixture.tgz`,url=registry+path;
   const manifest=JSON.stringify({name,'dist-tags':{latest:'1.0.0'},versions:{'1.0.0':{name,version:'1.0.0',dist:{tarball:url,integrity:'sha512-'+createHash('sha512').update(bytes).digest('base64')}}}});
   routes.set(path,{type:'application/octet-stream',bytes});routes.set('/'+name,{type:'application/json',bytes:manifest});
   if(name==='cached-fixture'){
    // Exactly the full-manifest representation written by npm view seed production.
    for(const [cacheUrl,body,accept,type] of [[registry+'/'+name,manifest,'application/json','application/json'],[url,bytes,undefined,'application/octet-stream']]){
     await cacache.put(join(cache,'_cacache'),'make-fetch-happen:request-cache:'+cacheUrl,body,{metadata:{time:Date.now()-86400000,url:cacheUrl,reqHeaders:accept?{accept}:{},resHeaders:{'content-type':type,'cache-control':'max-age=0'}}});
    }
   }
  }
  mkdirSync(consumer);writeFileSync(join(consumer,'package.json'),JSON.stringify({name:'consumer',version:'1.0.0',dependencies:{'cached-fixture':'1.0.0','missing-fixture':'1.0.0'},scripts:{postinstall:`node -e "require('fs').writeFileSync('lifecycle-ran','yes')"`}}));
  expect(existsSync(join(consumer,'node_modules'))).toBe(false);
  await promisify(execFile)(process.execPath,[npm,'install','--no-audit','--no-fund'],{cwd:consumer,env:{...process.env,npm_config_cache:cache,npm_config_registry:registry,npm_config_prefer_offline:'true',npm_config_full_metadata:'true',npm_config_fetch_retries:'0'},timeout:15000});
  expect(requests.filter(path=>path.includes('cached-fixture'))).toEqual([]);
  expect(requests).toContain('/missing-fixture');expect(requests).toContain('/missing-fixture/-/fixture.tgz');
  expect(readFileSync(join(consumer,'lifecycle-ran'),'utf8')).toBe('yes');
  for(const name of ['cached-fixture','missing-fixture'])expect(createRequire(join(consumer,'package.json'))(name)).toBe(42);
 }finally{await new Promise(resolve=>server.close(resolve));rmSync(directory,{recursive:true,force:true});}
});
