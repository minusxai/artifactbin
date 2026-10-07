import {it,expect} from 'vitest';
import {mkdtemp,mkdir,writeFile,readFile,cp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {createRequire} from 'node:module';
import {spawnSync,execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createServer} from 'node:http';
import {createHash} from 'node:crypto';
import {realpathSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {populateNpmSeed} from '../lib/npm-dependency-cache.mjs';
import {npmConsumerArgs,npmConsumerInstallArgs,npmInstallPhaseTimings} from '../../services/cli/scripts/npm-consumer-args.mjs';
const npmCli=process.env.npm_execpath??realpathSync(spawnSync('/bin/sh',['-c','command -v npm'],{encoding:'utf8'}).stdout.trim());
const pack=new URL('../../services/cli/scripts/pack-release.mjs',import.meta.url);
const transition=new URL('../../services/cli/scripts/transition-assets.mjs',import.meta.url);
const bootstrap=new URL('../../services/cli/transition/afbin',import.meta.url);
async function fixture(run){const root=await mkdtemp(join(tmpdir(),'afbin-pack-'));try{
 const cli=join(root,'services/cli');await mkdir(join(cli,'scripts'),{recursive:true});await mkdir(join(cli,'dist/runtime'),{recursive:true});
 await cp(pack,join(cli,'scripts/pack-release.mjs'));
 // The pack also builds the transition assets old 0.3.x installs download: the generator, the bootstrap pinned
 // to this fixture's version, the protocol constant and a minimal teaching bundle.
 await cp(transition,join(cli,'scripts/transition-assets.mjs'));
 await mkdir(join(cli,'transition'),{recursive:true});await mkdir(join(cli,'src/generated'),{recursive:true});await mkdir(join(root,'services/contracts/src'),{recursive:true});
 await writeFile(join(cli,'transition/afbin'),(await readFile(bootstrap,'utf8')).replace(/^AFBIN_VERSION=.*$/m,'AFBIN_VERSION=0.1.0'),{mode:0o755});
 await writeFile(join(root,'services/contracts/src/cli-auth.ts'),'export const CLI_PROTOCOL_VERSION = 3;\n');
 await writeFile(join(cli,'src/generated/teaching.json'),JSON.stringify({version:'0.1.0',protocol:3,files:{'SKILL.md':'---\nname: artifactbin\ndescription: fixture\n---\nfixture'}}));
 await writeFile(join(cli,'scripts/prepare-pty.mjs'),'// fixture postinstall\n');
 await writeFile(join(cli,'dist/afbin.mjs'),'#!/usr/bin/env node\nconsole.log("fixture-0.1.0");\n',{mode:0o755});
 await writeFile(join(cli,'package.json'),JSON.stringify({name:'@afbin/cli',version:'0.1.0',type:'module',bin:{afbin:'dist/afbin.mjs'},files:['dist','scripts/prepare-pty.mjs','npm-shrinkwrap.json'],scripts:{postinstall:'node scripts/prepare-pty.mjs'}}));
 await writeFile(join(cli,'npm-shrinkwrap.json'),JSON.stringify({name:'@afbin/cli',version:'0.1.0',lockfileVersion:3,requires:true,packages:{'':{name:'@afbin/cli',version:'0.1.0'}}}));
 await run(root,cli);
}finally{await rm(root,{recursive:true,force:true});}}
function packFixture(root,cli){return spawnSync(process.execPath,[join(cli,'scripts/pack-release.mjs'),join(root,'packed')],{cwd:root,env:{...process.env,npm_execpath:npmCli,npm_config_cache:join(root,'cache')},encoding:'utf8',timeout:30000});}
it('packs a standalone locked npm tarball that installs outside its checkout',()=>fixture(async(root,cli)=>{
 const result=packFixture(root,cli);expect(result.status,result.stderr).toBe(0);
 const file=join(root,'packed/afbin-cli-0.1.0.tgz');
 const manifest=JSON.parse(spawnSync('tar',['-xOf',file,'package/package.json'],{encoding:'utf8'}).stdout);expect(manifest.name).toBe('@afbin/cli');
 const lock=JSON.parse(spawnSync('tar',['-xOf',file,'package/npm-shrinkwrap.json'],{encoding:'utf8'}).stdout);expect(lock.packages[''].version).toBe('0.1.0');
 const consumer=join(root,'consumer');await mkdir(consumer);
 const installed=spawnSync(process.execPath,[npmCli,'install','--prefix',consumer,'--offline','--no-audit','--no-fund',file],{env:{...process.env,npm_execpath:npmCli,npm_config_cache:join(root,'cache')},encoding:'utf8'});expect(installed.status,installed.stderr).toBe(0);
 const launched=spawnSync(process.execPath,[join(consumer,'node_modules/@afbin/cli/dist/afbin.mjs')],{encoding:'utf8'});expect(launched.stdout.trim()).toBe('fixture-0.1.0');
 // Windows and second-runtime lanes execute the installed candidate; Unix Node22 retains standalone npx coverage.
 const environment={...process.env,npm_config_cache:join(root,'cache')};
 for(const platform of ['darwin','linux'])expect(npmConsumerArgs(file,platform)).toEqual(['exec','--yes','--package',file,'--','afbin','query','rows.csv','--json']);
 for(const platform of ['darwin','linux','win32'])expect(npmConsumerArgs(file,platform,24)).toEqual(['exec','--yes','--','afbin','query','rows.csv','--json']);
 for(const [platform,nodeMajor] of [['win32',22],['darwin',24],['linux',24]]){
 const online=npmConsumerArgs(file,platform,nodeMajor);
 for(const args of [online,['exec','--offline',...online.slice(1)]]){
  const execution=spawnSync(process.execPath,[npmCli,...args],{cwd:consumer,env:environment,encoding:'utf8'});
  expect(execution.status,execution.stderr).toBe(0);expect(execution.stdout.trim()).toBe('fixture-0.1.0');
 }
 await expect(readFile(join(root,'cache/_npx'),'utf8')).rejects.toMatchObject({code:'ENOENT'});
 }

}),30000);
it('refuses build-machine runtime dependencies instead of packing a platform-specific npm release',()=>fixture(async(root,cli)=>{
 await mkdir(join(cli,'dist/runtime/node_modules/sharp'),{recursive:true});
 const result=packFixture(root,cli);expect(result.status).not.toBe(0);expect(result.stderr).toContain('build-machine');
}),30000);

it('installs seeded consumers offline with foreground lifecycle scripts, while unseeded installs stay online',()=>{
 const seeded=npmConsumerInstallArgs('candidate.tgz',true);
 expect(seeded).toContain('--offline');
 expect(seeded).toContain('--foreground-scripts');
 expect(seeded).not.toContain('--ignore-scripts');
 expect(npmConsumerInstallArgs('candidate.tgz',false)).not.toContain('--offline');
});

it('reifies a locked dependency from npm-owned manifest and tarball seed with the registry unavailable and both lifecycle scripts enabled',()=>fixture(async(root,cli)=>{
 const dependency=join(root,'dependency');await mkdir(dependency);
 await writeFile(join(dependency,'package.json'),JSON.stringify({name:'mxmx-seed-fixture',version:'1.0.0',scripts:{postinstall:'node install.cjs'}}));
 await writeFile(join(dependency,'install.cjs'),"require('node:fs').writeFileSync('lifecycle-ran','dependency');");
 const packed=spawnSync(process.execPath,[npmCli,'pack','--ignore-scripts','--offline','--json'],{cwd:dependency,encoding:'utf8'});
 expect(packed.status,packed.stderr).toBe(0);
 const bytes=await readFile(join(dependency,JSON.parse(packed.stdout)[0].filename));
 const integrity='sha512-'+createHash('sha512').update(bytes).digest('base64');
 const server=createServer((request,response)=>{
  if(request.url==='/mxmx-seed-fixture'){
   response.writeHead(200,{'Content-Type':'application/json','Vary':'Accept'});response.end(JSON.stringify({name:'mxmx-seed-fixture','dist-tags':{latest:'1.0.0'},versions:{'1.0.0':{name:'mxmx-seed-fixture',version:'1.0.0',scripts:{postinstall:'node install.cjs'},dist:{tarball:url,integrity}}}}));
  }else{response.writeHead(200,{'Content-Type':'application/octet-stream'});response.end(bytes);}
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const url='http://127.0.0.1:'+server.address().port+'/mxmx-seed-fixture-1.0.0.tgz';
 const seed=join(root,'download-seed');
 try {
  await populateNpmSeed([{resolved:url,integrity,spec:'mxmx-seed-fixture@1.0.0'}],seed,args=>promisify(execFile)(process.execPath,[npmCli,...args,'--registry',new URL(url).origin]));
  const keys=spawnSync(process.execPath,[npmCli,'cache','ls','--cache',seed],{encoding:'utf8'});
  expect(keys.status,keys.stderr).toBe(0);
  expect(keys.stdout.trim().split('\n').every(key=>key.startsWith('make-fetch-happen:request-cache:'))).toBe(true);
 }
 finally {await new Promise(resolve=>server.close(resolve));}
 const manifest=JSON.parse(await readFile(join(cli,'package.json'),'utf8'));manifest.dependencies={'mxmx-seed-fixture':'1.0.0'};
 await writeFile(join(cli,'package.json'),JSON.stringify(manifest));
 await writeFile(join(cli,'scripts/prepare-pty.mjs'),"import{writeFileSync}from'node:fs';writeFileSync('lifecycle-ran','candidate');");
 const lock=JSON.parse(await readFile(join(cli,'npm-shrinkwrap.json'),'utf8'));
 lock.packages[''].dependencies=manifest.dependencies;
 lock.packages['node_modules/mxmx-seed-fixture']={version:'1.0.0',resolved:url,integrity:'sha512-'+createHash('sha512').update(bytes).digest('base64'),hasInstallScript:true};
 await writeFile(join(cli,'npm-shrinkwrap.json'),JSON.stringify(lock));
 const result=packFixture(root,cli);expect(result.status,result.stderr).toBe(0);
 const consumer=join(root,'fresh-consumer');await mkdir(consumer);await writeFile(join(consumer,'package.json'),'{}');
 const installed=spawnSync(process.execPath,[npmCli,...npmConsumerInstallArgs(join(root,'packed/afbin-cli-0.1.0.tgz'),true)],{cwd:consumer,env:{...process.env,npm_config_cache:seed,npm_config_registry:new URL(url).origin,npm_config_fetch_retries:'0'},encoding:'utf8',timeout:15000});
 expect(installed.status,installed.stdout+installed.stderr).toBe(0);
 const phases=await npmInstallPhaseTimings(join(seed,'_logs'));
 expect(phases.npm).toBeGreaterThan(0);expect(phases.reify).toBeGreaterThanOrEqual(0);
 expect(await readFile(join(consumer,'node_modules/@afbin/cli/lifecycle-ran'),'utf8')).toBe('candidate');
 const dependencyInstalled=dirname(createRequire(join(consumer,'node_modules/@afbin/cli/package.json')).resolve('mxmx-seed-fixture/package.json'));
 expect(await readFile(join(dependencyInstalled,'lifecycle-ran'),'utf8')).toBe('dependency');
}));

it('reports only numeric allowlisted npm phase timings without paths or credentials',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'afbin-timing-'));
 try {
  await writeFile(join(directory,'install-timing.json'),JSON.stringify({timers:{npm:137600,'reify:unpack':100000,'build:run:postinstall':2000,'reify:/secret-path':99,'token':999},metadata:{token:'secret'}}));
  expect(await npmInstallPhaseTimings(directory)).toEqual({npm:137600,'reify:unpack':100000,'build:run:postinstall':2000});
  await writeFile(join(directory,'latest-timing.json'),JSON.stringify({timers:{npm:500,'reify:unpack':400}}));
  expect(await npmInstallPhaseTimings(directory)).toEqual({npm:500,'reify:unpack':400});
  expect(await npmInstallPhaseTimings(join(directory,'absent'))).toEqual({});
  expect(npmConsumerInstallArgs('candidate.tgz',true)).toContain('--timing');
 }finally{await rm(directory,{recursive:true,force:true});}
});

it('retains bounded sanitized timings from the last two npm timing JSON files',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'afbin-live-npm-timing-'));
 try{
  await writeFile(join(directory,'2026-01-01T00_00_00_000Z-timing.json'),JSON.stringify({timers:{npm:1}}));
  await writeFile(join(directory,'2026-01-01T00_00_01_000Z-timing.json'),JSON.stringify({
   timers:{npm:390,'command:exec':380,'reify:unpack':120,'reify:/secret/path':90,token:50,idealTree:'40',build:null},
   metadata:{argv:['--registry','https://user:secret@example.test/?token=secret'],token:'secret'},
  }));
  await writeFile(join(directory,'2026-01-01T00_00_02_000Z-timing.json'),JSON.stringify({
   timers:{npm:400,'command:install':301,'command:exec':290,'build:run:postinstall':2,token:70},
   metadata:{argv:['https://user:secret@example.test'],token:'secret'},
  }));
  const timings=await npmInstallPhaseTimings(directory,{fileCount:2});
  expect(timings).toEqual({npm:400,'command:exec':290,'reify:unpack':120,'command:install':301,'build:run:postinstall':2});
  expect(JSON.stringify(timings)).not.toMatch(/secret|https?:\/\//);
  const cli=spawnSync(process.execPath,[fileURLToPath(new URL('../../services/cli/scripts/npm-consumer-args.mjs',import.meta.url)),'diagnostic-timings',directory],{encoding:'utf8'});
  expect(cli.status,cli.stderr).toBe(0);expect(JSON.parse(cli.stdout)).toEqual(timings);
  expect(await npmInstallPhaseTimings(join(directory,'absent'),{fileCount:2})).toEqual({});
 }finally{await rm(directory,{recursive:true,force:true});}
});
