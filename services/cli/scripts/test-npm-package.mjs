/** Native acceptance of the SAME npm tarball on each consumer OS. CI only. */
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,readdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve,dirname} from 'node:path';
import {execFileSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
const ci=process.argv[2]==='--ci';
const repository=resolve(dirname(fileURLToPath(import.meta.url)),'../../..');
const candidates=ci?(await readdir(join(repository,'npm-candidate'))).filter(file=>file.endsWith('.tgz')):[];
if(ci&&candidates.length!==1)throw new Error('Expected exactly one universal npm candidate.');
const tarball=ci?join(repository,'npm-candidate',candidates[0]):resolve(process.argv[2]);
const proof=ci?join(process.env.RUNNER_TEMP??tmpdir(),'npm-proof'):process.argv[3];
const root=await mkdtemp(join(tmpdir(),'afbin npm é '));
const npm=process.env.npm_execpath;
if(!npm)throw new Error('Run through npm run test:npm-package -w services/cli -- <tarball>');
const env={...process.env,HOME:join(root,'home'),USERPROFILE:join(root,'home'),ARTIFACTBIN_SKILLS:'off',npm_config_cache:join(root,'cache'),ARTIFACTBIN_HOME:join(root,'home'),PLAYWRIGHT_BROWSERS_PATH:join(root,'chromium'),CLI__AUTO_UPDATE:'0',ARTIFACTBIN_URL:'http://127.0.0.1:1'};
const run=args=>execFileSync(process.execPath,[npm,...args],{cwd:root,env,encoding:'utf8',timeout:300000});
try{
 await writeFile(join(root,'package.json'),'{}\n');
 const installed=run(['install','--foreground-scripts','--no-audit','--no-fund',tarball]);
 assert.doesNotMatch(installed,/Rebuilding because|gyp info|gyp ERR/,'Supported native consumers must use prebuilt dependencies, without a compiler fallback');
 const cli=join(root,'node_modules/@artifactbin/cli');
 assert.ok(await readFile(join(cli,'npm-shrinkwrap.json'),'utf8'));
 await assert.rejects(readdir(join(cli,'dist/runtime/node_modules')));
 await assert.rejects(readdir(env.PLAYWRIGHT_BROWSERS_PATH));
 await writeFile(join(root,'rows.csv'),'amount\n10\n20\n');
 const args=['exec','--yes','--package',tarball,'--','afbin','query','rows.csv','--json'];
 const online=JSON.parse(run(args));assert.ok(JSON.stringify(online).includes('10'));
 const offline=JSON.parse(run(['exec','--offline',...args.slice(1)]));assert.deepEqual(offline,online);
 const require=createRequire(join(cli,'package.json'));
 const sharp=require('sharp');const image=await sharp({create:{width:2,height:2,channels:3,background:'red'}}).png().toBuffer();assert.equal((await sharp(image).metadata()).width,2);
 const ptyRoot=dirname(require.resolve('node-pty/package.json'));
 assert.ok(await readFile(join(ptyRoot,'prebuilds',`${process.platform}-${process.arch}`,process.platform==='win32'?'conpty.node':'pty.node')),'The installed terminal dependency must contain this platform prebuild');
 const pty=require('node-pty');
 await new Promise((resolvePromise,reject)=>{
   const terminal=pty.spawn(process.platform==='win32'?'cmd.exe':'/bin/sh',process.platform==='win32'?['/d','/c','echo npm-native-ok']:['-c','printf npm-native-ok'],{cwd:root,env:process.env,cols:80,rows:24});
   let output='';const timer=setTimeout(()=>{terminal.kill();reject(Error('PTY shutdown timed out'));},15000);
   terminal.onData(chunk=>output+=chunk);terminal.onExit(()=>{terminal.kill();clearTimeout(timer);try{assert.match(output,/npm-native-ok/);resolvePromise();}catch(error){reject(error);}});
 });
 if(proof)await (await import('node:fs/promises')).mkdir(resolve(proof),{recursive:true});
 console.log(JSON.stringify({status:'passed',platform:process.platform,arch:process.arch,node:process.version,tarball,checks:['consumer-lock','no-build-machine-native-files','no-install-chromium','npm-exec','warmed-offline-exec','sharp','prebuilt-pty-no-compiler','node-pty-shutdown']}));
 if(proof)await writeFile(join(resolve(proof),'installed-path.txt'),join(cli,'dist/afbin.mjs'));
 // CI browser conformance consumes this install, so keep it when requested.
 if(!proof)await rm(root,{recursive:true,force:true});
}catch(error){await rm(root,{recursive:true,force:true});throw error;}
