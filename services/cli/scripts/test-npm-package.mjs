/** Native acceptance of the SAME npm tarball on each consumer OS. CI only. */
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,readdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve,dirname} from 'node:path';
import {execFileSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {extractValidatedNpmSeed,mergeNpmDependencyCache} from './npm-dependency-cache.mjs';
import {installNpmConsumer} from './npm-consumer-install.mjs';
import {npmConsumerArgs,npmInstallPhaseTimings} from './npm-consumer-args.mjs';
import {runAcceptanceProcesses} from './acceptance-processes.mjs';
import {cleanupFailedNativeConsumer} from './native-consumer-lifecycle.mjs';
const ci=process.argv[2]==='--ci';
const installOnly=process.argv.includes('--install-only');
const dependencyCacheIndex=process.argv.indexOf('--dependency-cache');
const dependencyCache=dependencyCacheIndex===-1?null:process.argv[dependencyCacheIndex+1];
if(dependencyCacheIndex!==-1&&(!ci||!dependencyCache||dependencyCache.startsWith('--')))throw Error('--dependency-cache needs a CI download-cache path.');
const dependencySeedIndex=process.argv.indexOf('--dependency-seed');
const dependencySeed=dependencySeedIndex===-1?null:process.argv[dependencySeedIndex+1];
if(dependencySeedIndex!==-1&&(!ci||!dependencySeed||dependencySeed.startsWith('--')||dependencyCache))throw Error('--dependency-seed needs one CI archive and cannot be combined with --dependency-cache.');
if(installOnly&&!ci)throw new Error('--install-only requires the CI candidate.');
const repository=resolve(dirname(fileURLToPath(import.meta.url)),'../../..');
const candidates=ci?(await readdir(join(repository,'npm-candidate'))).filter(file=>file.endsWith('.tgz')):[];
if(ci&&candidates.length!==1)throw new Error('Expected exactly one universal npm candidate.');
const tarball=ci?join(repository,'npm-candidate',candidates[0]):resolve(process.argv[2]);
const proof=ci?join(process.env.RUNNER_TEMP??tmpdir(),'npm-proof'):process.argv[3];
const root=await mkdtemp(join(tmpdir(),'afbin npm é '));
const npm=process.env.npm_execpath;
if(!npm)throw new Error('Run through npm run test:npm-package -w services/cli -- <tarball>');
const env={...process.env,HOME:join(root,'home'),USERPROFILE:join(root,'home'),ARTIFACTBIN_SKILLS:'off',npm_config_cache:join(root,'cache'),ARTIFACTBIN_HOME:join(root,'home'),PLAYWRIGHT_BROWSERS_PATH:join(root,'chromium'),CLI__AUTO_UPDATE:'0',ARTIFACTBIN_URL:'http://127.0.0.1:1'};
const run=args=>{const start=performance.now();try{return execFileSync(process.execPath,[npm,...args],{cwd:root,env,encoding:'utf8',timeout:300000});}finally{console.log(`Native timing: ${args.includes('--offline')?'offline':'online'} npm exec ${((performance.now()-start)/1000).toFixed(1)}s`);}};
// The absent-Node proof is independent of this cold install: different homes and npm caches.
// Unix Node22 entries validate the official Node24 bootstrap here; Windows owns a dedicated proof.
const bootstrap=process.platform!=='win32'&&process.argv.includes('--parallel-bootstrap')&&process.versions.node.startsWith('22.')
 ?runAcceptanceProcesses([{label:'absent-Node Unix bootstrap',command:process.execPath,args:['services/cli/scripts/test-node-bootstrap.mjs'],cwd:repository,env:process.env}])
 :Promise.resolve();
// Attach a handler immediately while the install and native checks are running.
bootstrap.catch(()=>{});
let nativeLoaded=false;
try{
 await writeFile(join(root,'package.json'),'{}\n');
 let seeded=dependencyCache?await mergeNpmDependencyCache(dependencyCache,env.npm_config_cache):false;
 if(dependencySeed){
  const lockText=await readFile(join(repository,'services/cli/npm-shrinkwrap.json'),'utf8');
  const result=await extractValidatedNpmSeed(dependencySeed,env.npm_config_cache,lockText,{os:process.platform,cpu:process.arch});
  seeded=true;console.log('Npm seed phases (ms): '+JSON.stringify(result.phases));
 }
 if(dependencyCache&&!seeded)throw Error('Expected verified npm download seed before offline consumer install');
 const {output:installOutput}=await installNpmConsumer({npm,tarball,cwd:root,env,seeded});
 console.log('Npm install phases (ms): '+JSON.stringify(await npmInstallPhaseTimings(join(env.npm_config_cache,'_logs'))));
 assert.doesNotMatch(installOutput,/Rebuilding because|gyp info|gyp ERR/,'Supported native consumers must use prebuilt dependencies, without a compiler fallback');
 const cli=join(root,'node_modules/@afbin/cli');
 assert.ok(await readFile(join(cli,'npm-shrinkwrap.json'),'utf8'));
 await assert.rejects(readdir(join(cli,'dist/runtime/node_modules')));
 await assert.rejects(readdir(env.PLAYWRIGHT_BROWSERS_PATH));
 if(!installOnly){
 await writeFile(join(root,'rows.csv'),'amount\n10\n20\n');
 // Unix Node22 lanes prove standalone npx; Windows has its Restricted standard-user proof.
 // Node24 native lanes execute the freshly installed candidate without staging a second copy.
 const args=npmConsumerArgs(tarball,process.platform,Number(process.versions.node.split('.')[0]));
 const online=JSON.parse(run(args));assert.ok(JSON.stringify(online).includes('10'));
 const offline=JSON.parse(run(['exec','--offline',...args.slice(1)]));assert.deepEqual(offline,online);
 if(!args.includes('--package'))await assert.rejects(readdir(join(env.npm_config_cache,'_npx')),error=>error.code==='ENOENT','Installed native execution must not duplicate the candidate install');
 const require=createRequire(join(cli,'package.json'));
 nativeLoaded=true;
 const sharp=require('sharp');const image=await sharp({create:{width:2,height:2,channels:3,background:'red'}}).png().toBuffer();assert.equal((await sharp(image).metadata()).width,2);
 const ptyRoot=dirname(require.resolve('node-pty/package.json'));
 assert.ok(await readFile(join(ptyRoot,'prebuilds',`${process.platform}-${process.arch}`,process.platform==='win32'?'conpty.node':'pty.node')),'The installed terminal dependency must contain this platform prebuild');
 const pty=require('node-pty');
 await new Promise((resolvePromise,reject)=>{
   const terminal=pty.spawn(process.platform==='win32'?'cmd.exe':'/bin/sh',process.platform==='win32'?['/d','/c','echo npm-native-ok']:['-c','printf npm-native-ok'],{cwd:root,env:process.env,cols:80,rows:24});
   let output='';const timer=setTimeout(()=>{terminal.kill();reject(Error('PTY shutdown timed out'));},15000);
   terminal.onData(chunk=>output+=chunk);terminal.onExit(()=>{terminal.kill();clearTimeout(timer);try{assert.match(output,/npm-native-ok/);resolvePromise();}catch(error){reject(error);}});
 });
 }
 await bootstrap;
 if(proof)await (await import('node:fs/promises')).mkdir(resolve(proof),{recursive:true});
 console.log(JSON.stringify({status:'passed',platform:process.platform,arch:process.arch,node:process.version,tarball,checks:installOnly?['consumer-lock','no-build-machine-native-files','no-install-chromium']:['consumer-lock','no-build-machine-native-files','no-install-chromium','npm-exec','warmed-offline-exec','sharp','prebuilt-pty-no-compiler','node-pty-shutdown']}));
 if(proof)await writeFile(join(resolve(proof),'installed-path.txt'),join(cli,'dist/afbin.mjs'));
 // CI browser conformance consumes this install, so keep it when requested.
 if(!proof)await rm(root,{recursive:true,force:true});
}catch(error){await bootstrap.catch(()=>{});await cleanupFailedNativeConsumer(root,{platform:process.platform,nativeLoaded});throw error;}
