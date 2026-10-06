/** Real in-place npm update of the tested CLI in an isolated global prefix. CI native matrix proof. */
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {mkdtemp,mkdir,readFile,writeFile,rm} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname,join,resolve} from 'node:path';
const installed=resolve(process.argv[2]),pkg=resolve(dirname(installed),'..');
const original=JSON.parse(await readFile(join(pkg,'package.json'),'utf8')).version;
const root=await mkdtemp(join(tmpdir(),'afbin-auto-update-')),prefix=join(root,'npm');
const future='99.0.0',profile={username:'mxmx_test_auto_update',fixture:true};
const bundled=join(dirname(process.execPath),'node_modules','npm','bin','npm-cli.js');
const npmScript=process.env.npm_execpath??(process.platform==='win32'&&existsSync(bundled)?bundled:undefined);
const env={...process.env,HOME:join(root,'home'),USERPROFILE:join(root,'home'),ARTIFACTBIN_HOME:join(root,'state'),ARTIFACTBIN_SKILLS:'off',CLI__AUTO_UPDATE:'1',CLI__DISABLE_AUTO_UPDATES:'false',npm_config_prefix:prefix,npm_config_cache:resolve(pkg,'../../../cache'),npm_config_offline:'false'};
for(const name of ['CLI__VERSION_PIN','ARTIFACTBIN_GLOBAL','ARTIFACTBIN__REMOTE_SESSION','ARTIFACTBIN__REMOTE_PROOF','ARTIFACTBIN_REFRESH_TOKEN','ARTIFACTBIN_CLIENT_ID','ARTIFACTBIN_EXPIRES_AT'])delete env[name];
function child(file,args,childEnv=env,cwd=root,onStdout=()=>{}){
 return new Promise((accept,reject)=>{
  const processChild=spawn(file,args,{cwd,env:childEnv,stdio:['ignore','pipe','pipe'],windowsHide:true});let stdout='',stderr='';
  const timer=setTimeout(()=>processChild.kill('SIGKILL'),120000);
  processChild.stdout.on('data',chunk=>{stdout+=chunk;onStdout(stdout);});processChild.stderr.on('data',chunk=>stderr+=chunk);
  processChild.once('error',error=>{clearTimeout(timer);reject(error);});
  processChild.once('exit',(code,signal)=>{clearTimeout(timer);accept({code,signal,stdout,stderr});});
 });
}
const npm=(args,childEnv=env,cwd=root)=>npmScript?child(process.execPath,[npmScript,...args],childEnv,cwd):child('npm',args,childEnv,cwd);
const entry=join(prefix,...(process.platform==='win32'?[]:['lib']),'node_modules','@afbin','cli','dist','afbin.mjs');
let server;
try{
 await mkdir(env.HOME,{recursive:true});
 // Install the actual tested package into a global prefix, using its already populated native-consumer cache.
 const initial=await npm(['install','-g','--prefix',prefix,'--install-links','--offline','--no-audit','--no-fund',pkg]);
 assert.equal(initial.code,0,initial.stderr);
 const fixture=join(root,'release');await mkdir(fixture);
 await writeFile(join(fixture,'package.json'),JSON.stringify({name:'@afbin/cli',version:future,type:'module',bin:{afbin:'dist/afbin.mjs'}}));
 await mkdir(join(fixture,'dist'));
 await writeFile(join(fixture,'dist','afbin.mjs'),`#!/usr/bin/env node\nconsole.log('${future}');\n`);
 const packed=await npm(['pack','--json','--ignore-scripts'],env,fixture);assert.equal(packed.code,0,packed.stderr);
 const bytes=await readFile(join(fixture,JSON.parse(packed.stdout)[0].filename));
 let registryRequests=0,printedResult=false,checkOrdering=false;
 server=createServer((request,response)=>{
  const path=decodeURIComponent(new URL(request.url,'http://localhost').pathname);
  if(path==='/api/account/profile'){
   response.writeHead(200,{'Content-Type':'application/json','X-Artifactbin-CLI-Version':future,'X-Artifactbin-Protocol':'3'});response.end(JSON.stringify(profile));
  }else if(path==='/@afbin/cli'){
   registryRequests++;if(checkOrdering)assert.equal(printedResult,true,'command JSON must be printed before npm downloads');
   const address=`http://127.0.0.1:${server.address().port}`;
   response.writeHead(200,{'Content-Type':'application/json'});response.end(JSON.stringify({name:'@afbin/cli','dist-tags':{latest:future},versions:{[future]:{name:'@afbin/cli',version:future,bin:{afbin:'dist/afbin.mjs'},dist:{tarball:`${address}/package.tgz`,integrity:`sha512-${createHash('sha512').update(bytes).digest('base64')}`,shasum:createHash('sha1').update(bytes).digest('hex')}}}}));
  }else if(path==='/package.tgz'){response.writeHead(200,{'Content-Type':'application/octet-stream'});response.end(bytes);}
  else{response.writeHead(404);response.end();}
 });
 await new Promise(accept=>server.listen(0,'127.0.0.1',accept));
 const origin=`http://127.0.0.1:${server.address().port}`;
 Object.assign(env,{ARTIFACTBIN_URL:origin,ARTIFACTBIN_TOKEN:'mx_test_fixture',npm_config_registry:origin});
 const disabled=await child(process.execPath,[entry,'list','--type','profile','--json'],{...env,CLI__DISABLE_AUTO_UPDATES:'true'});
 assert.equal(disabled.code,0,disabled.stderr);assert.deepEqual(JSON.parse(disabled.stdout),profile);assert.equal(registryRequests,0);
 assert.equal(JSON.parse(await readFile(join(dirname(entry),'../package.json'),'utf8')).version,original);
 checkOrdering=true;
 const updated=await child(process.execPath,[entry,'list','--type','profile','--json'],env,root,stdout=>{try{printedResult=JSON.parse(stdout).fixture===true;}catch{}});
 assert.equal(updated.code,0,updated.stderr);assert.deepEqual(JSON.parse(updated.stdout),profile);assert.ok(registryRequests>0);assert.match(updated.stderr,/Updated afbin to 99\.0\.0/);
 assert.equal(JSON.parse(await readFile(join(dirname(entry),'../package.json'),'utf8')).version,future);
 const next=await child(process.execPath,[entry,'--version']);assert.equal(next.code,0,next.stderr);assert.equal(next.stdout.trim(),future);
 console.log(JSON.stringify({result:'PASS',platform:process.platform,node:process.version,checks:['tested global npm package','env opt-out','result before real npm download','real exact-version npm upgrade','next invocation updated']}));
}finally{
 if(server?.listening)await new Promise(accept=>server.close(accept));
 await rm(root,{recursive:true,force:true});
}
