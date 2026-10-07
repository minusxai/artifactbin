import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm,stat,symlink,readdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {tmpdir} from 'node:os';
import {join,delimiter,win32} from 'node:path';
import {installKind,globalInstall,findAfbinOnPath,retireAfbin,type NpmRunner} from '../src/global-install';

/** A runner that records every npm invocation and answers from a script; it never spawns npm. */
function recorder(answer:(args:string[])=>{code?:number;stdout?:string;stderr?:string}){
 const calls:string[][]=[];
 const npm:NpmRunner=async args=>{calls.push(args);const a=answer(args);return {code:a.code??0,stdout:a.stdout??'',stderr:a.stderr??''};};
 return {calls,npm};
}
const STANDALONE=Buffer.alloc(2*1024*1024,0x41);STANDALONE.write('\x7fELF',0);
const forwarder=(bin:string)=>`#!/bin/sh\nexec "${bin}" "$@"\n`;
const BOOTSTRAP='#!/bin/sh\n# afbin transition bootstrap. The 0.3.x self-updater installs this file over the old executable.\nAFBIN_VERSION=0.4.5\n';
const NPM_WRAPPER='#!/usr/bin/env node\nimport("../lib/node_modules/@afbin/cli/dist/afbin.mjs");\n';

test('installKind is package only inside a node_modules/@afbin/cli tree',()=>{
 assert.equal(installKind('/x/node_modules/@afbin/cli/dist/afbin.mjs'),'package');
 assert.equal(installKind('C:\\Users\\me\\AppData\\Roaming\\npm\\node_modules\\@afbin\\cli\\dist\\afbin.mjs'),'package');
 assert.equal(installKind('/repo/services/cli/dist/afbin.mjs'),'dev');
 assert.equal(installKind('/repo/services/cli/src/main.ts'),'dev');
 assert.equal(installKind(''),'dev');
});

test('installKind resolves symlinks: an npx .bin link is a package, an npm link into a checkout is dev',async()=>{
 const root=await mkdtemp(join(tmpdir(),'afbin-kind-'));
 try{
  const pkg=join(root,'cache','node_modules','@afbin','cli','dist');await mkdir(pkg,{recursive:true});await writeFile(join(pkg,'afbin.mjs'),'');
  await mkdir(join(root,'cache','node_modules','.bin'));await symlink(join(pkg,'afbin.mjs'),join(root,'cache','node_modules','.bin','afbin'));
  assert.equal(installKind(join(root,'cache','node_modules','.bin','afbin')),'package');
  const checkout=join(root,'repo','services','cli');await mkdir(join(checkout,'dist'),{recursive:true});await writeFile(join(checkout,'dist','afbin.mjs'),'');
  await mkdir(join(root,'prefix','lib','node_modules','@afbin'),{recursive:true});await symlink(checkout,join(root,'prefix','lib','node_modules','@afbin','cli'));
  assert.equal(installKind(join(root,'prefix','lib','node_modules','@afbin','cli','dist','afbin.mjs')),'dev');
 }finally{await rm(root,{recursive:true,force:true});}
});

test('globalInstall runs npm install -g with the exact version and reads the global prefix',async()=>{
 const {calls,npm}=recorder(args=>args[0]==='prefix'?{stdout:'/usr/local\n'}:{});
 const env={PATH:['/usr/bin','/usr/local/bin/'].join(':')};
 const result=await globalInstall({version:'1.2.3',home:'/unused',env,platform:'linux',npm});
 assert.deepEqual(calls,[['prefix','-g'],['install','-g','--no-fund','--no-audit','@afbin/cli@1.2.3']]);
 assert.deepEqual(result,{status:'installed',version:'1.2.3',prefix:'/usr/local',bin:'/usr/local/bin/afbin',on_path:true,fallback:false});
});

test('globalInstall retries into the private user prefix on EACCES and prints a PATH line when it is not on PATH',async()=>{
 const root=await mkdtemp(join(tmpdir(),'afbin-global-'));
 try{
  const state=join(root,'state');
  const {calls,npm}=recorder(args=>args.includes('--prefix')?{}:{code:243,stderr:'npm error code EACCES\nnpm error syscall mkdir\nnpm error path /usr/lib/node_modules/@afbin\n'});
  const result=await globalInstall({version:'1.2.3',home:root,env:{PATH:'/usr/bin:/bin',ARTIFACTBIN_HOME:state},platform:'linux',npm});
  const prefix=join(state,'npm');
  assert.deepEqual(calls,[['prefix','-g'],['install','-g','--no-fund','--no-audit','@afbin/cli@1.2.3'],['install','-g','--prefix',prefix,'--no-fund','--no-audit','@afbin/cli@1.2.3']]);
  assert.equal(result.status,'installed');assert.equal(result.fallback,true);assert.equal(result.prefix,prefix);
  assert.equal(result.bin,join(prefix,'bin','afbin'));assert.equal(result.on_path,false);
  assert.equal(result.path_line,`export PATH="${join(prefix,'bin')}:$PATH"`);
  assert.ok((await stat(prefix)).isDirectory(),'the fallback prefix exists before npm writes into it');
  const home=join(root,'home');
  const second=await globalInstall({version:'1.2.3',home,env:{PATH:`${join(home,'.artifactbin','npm','bin')}:/bin`},platform:'linux',npm});
  assert.equal(second.prefix,join(home,'.artifactbin','npm'));assert.equal(second.on_path,true);assert.equal(second.path_line,undefined);
 }finally{await rm(root,{recursive:true,force:true});}
});

test('globalInstall reports a non-permission failure without retrying',async()=>{
 const {calls,npm}=recorder(()=>({code:1,stderr:'npm error code E404\nnpm error 404 Not Found - GET https://registry.npmjs.org/@afbin%2fcli/-/cli-9.9.9.tgz\n'}));
 const result=await globalInstall({version:'9.9.9',home:'/unused',env:{PATH:'/bin'},platform:'linux',npm});
 assert.deepEqual(calls,[['prefix','-g'],['install','-g','--no-fund','--no-audit','@afbin/cli@9.9.9']]);assert.equal(result.status,'failed');assert.equal(result.fallback,false);
 assert.match(result.reason??'',/E404/);
});

test('globalInstall on win32 names afbin.cmd in the prefix, compares PATH case-insensitively and retries on EPERM',async()=>{
 const {npm}=recorder(args=>args[0]==='prefix'?{stdout:'C:\\Users\\me\\AppData\\Roaming\\npm\r\n'}:{});
 const result=await globalInstall({version:'1.2.3',home:'C:\\Users\\me',env:{PATH:'C:\\Windows;c:\\users\\me\\appdata\\roaming\\npm\\'},platform:'win32',npm});
 assert.equal(result.bin,'C:\\Users\\me\\AppData\\Roaming\\npm\\afbin.cmd');assert.equal(result.on_path,true);
 const root=await mkdtemp(join(tmpdir(),'afbin-win-global-'));
 try{
  const failing=recorder(args=>args.includes('--prefix')?{}:{code:1,stderr:'npm error code EPERM\n'});
  const fallback=await globalInstall({version:'1.2.3',home:root,env:{Path:'C:\\Windows'},platform:'win32',npm:failing.npm});
  assert.equal(failing.calls.length,3);assert.deepEqual(failing.calls[0],['prefix','-g']);assert.equal(fallback.fallback,true);assert.match(fallback.bin,/afbin\.cmd$/);assert.equal(fallback.on_path,false);assert.ok(fallback.path_line);
 }finally{await rm(root,{recursive:true,force:true});}
});

test('findAfbinOnPath classifies standalone, forwarder, bootstrap and npm commands and ignores symlinks and directories',async()=>{
 const root=await mkdtemp(join(tmpdir(),'afbin-find-'));
 try{
  const dir=(name:string)=>join(root,name);
  for(const name of ['standalone','forwarder','bootstrap','npm','small','link','folder'])await mkdir(dir(name));
  await writeFile(join(dir('standalone'),'afbin'),STANDALONE,{mode:0o755});
  await writeFile(join(dir('forwarder'),'afbin'),forwarder('/opt/npm/bin/afbin'),{mode:0o755});
  await writeFile(join(dir('bootstrap'),'afbin'),BOOTSTRAP,{mode:0o755});
  await writeFile(join(dir('npm'),'afbin'),NPM_WRAPPER,{mode:0o755});
  await writeFile(join(dir('small'),'afbin'),Buffer.alloc(1024,0x41),{mode:0o755});
  await symlink(join(dir('standalone'),'afbin'),join(dir('link'),'afbin'));
  await mkdir(join(dir('folder'),'afbin'));
  const PATH=['link','folder','standalone','forwarder','standalone','bootstrap','npm','small','missing'].map(dir).join(delimiter);
  assert.deepEqual(await findAfbinOnPath({PATH},'linux'),[
   {path:join(dir('standalone'),'afbin'),kind:'standalone'},
   {path:join(dir('forwarder'),'afbin'),kind:'forwarder'},
   {path:join(dir('bootstrap'),'afbin'),kind:'forwarder'},
   {path:join(dir('npm'),'afbin'),kind:'npm'},
   {path:join(dir('small'),'afbin'),kind:'npm'},
  ]);
  assert.equal((await readFile(join(dir('standalone'),'afbin'))).length,STANDALONE.length,'never executed or changed');
 }finally{await rm(root,{recursive:true,force:true});}
});

test('findAfbinOnPath on win32 looks for afbin.exe and afbin.cmd',async()=>{
 const root=await mkdtemp(join(tmpdir(),'afbin-find-win-'));
 try{
  await writeFile(join(root,'afbin.exe'),STANDALONE);await writeFile(join(root,'afbin.cmd'),'@ECHO off\r\nnode "%~dp0\\node_modules\\@afbin\\cli\\dist\\afbin.mjs" %*\r\n');
  assert.deepEqual(await findAfbinOnPath({Path:`C:\\Windows;${root}`},'win32'),[{path:join(root,'afbin.exe'),kind:'standalone'},{path:join(root,'afbin.cmd'),kind:'npm'}]);
 }finally{await rm(root,{recursive:true,force:true});}
});

test('retireAfbin backs up a standalone, then removes it when the npm command is on PATH or forwards to it when not',async()=>{
 const root=await mkdtemp(join(tmpdir(),'afbin-retire-'));
 try{
  const home=join(root,'home'),bin=join(root,'npm','bin','afbin');await mkdir(join(root,'old'),{recursive:true});
  const old=join(root,'old','afbin');const hash=createHash('sha256').update(STANDALONE).digest('hex').slice(0,12);
  const backup=join(home,'.artifactbin','backups','standalone',`afbin-${hash}`);
  await writeFile(old,STANDALONE,{mode:0o755});
  assert.deepEqual(await retireAfbin([{path:old,kind:'standalone'}],{bin,on_path:true},home,{env:{}}),[{path:old,backup,status:'removed'}]);
  await assert.rejects(stat(old),{code:'ENOENT'});
  assert.deepEqual(await readFile(backup),STANDALONE);
  await writeFile(old,STANDALONE,{mode:0o755});
  assert.deepEqual(await retireAfbin([{path:old,kind:'standalone'}],{bin,on_path:false},home,{env:{}}),[{path:old,backup,status:'forwarded'}]);
  assert.equal(await readFile(old,'utf8'),forwarder(bin));
  assert.equal((await stat(old)).mode&0o777,0o755);
  assert.deepEqual((await readdir(join(root,'old'))),['afbin'],'the replacement leaves no temporary file behind');
 }finally{await rm(root,{recursive:true,force:true});}
});

test('retireAfbin rewrites or removes a forwarder by the same rule, skips npm commands and never follows symlinks',async()=>{
 const root=await mkdtemp(join(tmpdir(),'afbin-retire-fwd-'));
 try{
  const home=join(root,'home'),bin=join(root,'npm','bin','afbin'),old=join(root,'afbin'),npmBin=join(root,'npm-afbin');
  await writeFile(old,BOOTSTRAP,{mode:0o755});await writeFile(npmBin,NPM_WRAPPER,{mode:0o755});
  assert.deepEqual(await retireAfbin([{path:old,kind:'forwarder'},{path:npmBin,kind:'npm'}],{bin,on_path:false},home,{env:{}}),[{path:old,status:'forwarded'}]);
  assert.equal(await readFile(old,'utf8'),forwarder(bin));
  assert.equal(await readFile(npmBin,'utf8'),NPM_WRAPPER);
  assert.deepEqual(await retireAfbin([{path:old,kind:'forwarder'}],{bin,on_path:true},home,{env:{}}),[{path:old,status:'removed'}]);
  await assert.rejects(stat(old),{code:'ENOENT'});
  const target=join(root,'target');await writeFile(target,STANDALONE);await symlink(target,old);
  const [result]=await retireAfbin([{path:old,kind:'standalone'}],{bin,on_path:true},home,{env:{}});
  assert.equal(result?.status,'kept');assert.deepEqual(await readFile(target),STANDALONE);
  await assert.rejects(stat(join(home,'.artifactbin','backups')),{code:'ENOENT'});
 }finally{await rm(root,{recursive:true,force:true});}
});

test('retireAfbin keeps a locked executable and says how to finish',async()=>{
 const root=await mkdtemp(join(tmpdir(),'afbin-retire-locked-'));
 try{
  const home=join(root,'home'),old=join(root,'afbin.exe');await writeFile(old,STANDALONE);
  const unlink=async()=>{throw Object.assign(new Error('EPERM: operation not permitted'),{code:'EPERM'});};
  const [result]=await retireAfbin([{path:old,kind:'standalone'}],{bin:'C:\\npm\\afbin.cmd',on_path:true},home,{env:{},platform:'win32',unlink});
  assert.equal(result?.status,'kept');assert.equal(result?.reason,'Stop running afbin processes and rerun setup.');
  assert.ok(result?.backup);assert.deepEqual(await readFile(old),STANDALONE);
 }finally{await rm(root,{recursive:true,force:true});}
});


test('globalInstall reuses a complete exact-version npm installation without reinstalling',async()=>{
 const root=await mkdtemp(join(tmpdir(),'afbin-global-repeat-'));
 try{
  const pkg=join(root,'lib','node_modules','@afbin','cli');
  await mkdir(join(pkg,'dist'),{recursive:true});await mkdir(join(root,'bin'));
  await writeFile(join(pkg,'package.json'),JSON.stringify({name:'@afbin/cli',version:'1.2.3',bin:{afbin:'dist/afbin.mjs'}}));
  await writeFile(join(pkg,'dist','afbin.mjs'),'#!/usr/bin/env node\nconsole.log("fixture");\n',{mode:0o755});
  await symlink(join(pkg,'dist','afbin.mjs'),join(root,'bin','afbin'));
  const {calls,npm}=recorder(args=>args[0]==='prefix'?{stdout:root+'\n'}:{});
  const result=await globalInstall({version:'1.2.3',home:join(root,'home'),env:{PATH:join(root,'bin')},platform:'linux',npm});
  assert.deepEqual(calls,[['prefix','-g']],'an already installed exact version needs no npm install');
  assert.equal(result.status,'installed');assert.equal(result.on_path,true);
 }finally{await rm(root,{recursive:true,force:true});}
});

test('globalInstall reuses an exact-version private fallback before retrying a denied global prefix',async()=>{
 const root=await mkdtemp(join(tmpdir(),'afbin-global-fallback-repeat-'));
 try{
  const state=join(root,'state'),prefix=join(state,'npm'),pkg=join(prefix,'lib','node_modules','@afbin','cli');
  const entry=join(pkg,'dist','afbin.mjs'),bin=join(prefix,'bin','afbin');
  await mkdir(join(pkg,'dist'),{recursive:true});await mkdir(join(prefix,'bin'),{recursive:true});
  await writeFile(join(pkg,'package.json'),JSON.stringify({name:'@afbin/cli',version:'1.2.3',bin:{afbin:'dist/afbin.mjs'}}));
  await writeFile(entry,'#!/usr/bin/env node\n',{mode:0o755});await symlink(entry,bin);
  const {calls,npm}=recorder(args=>args[0]==='prefix'?{stdout:'/usr/local\n'}:{code:243,stderr:'npm error code EACCES\n'});
  const result=await globalInstall({version:'1.2.3',home:root,env:{PATH:join(prefix,'bin'),ARTIFACTBIN_HOME:state},platform:'linux',npm});
  assert.deepEqual(calls,[['prefix','-g']]);assert.equal(result.status,'installed');assert.equal(result.prefix,prefix);assert.equal(result.fallback,true);assert.equal(result.on_path,true);
 }finally{await rm(root,{recursive:true,force:true});}
});

test('globalInstall repairs stale, malformed or miswired npm installs',async()=>{
 const validManifest={name:'@afbin/cli',version:'1.2.3',bin:{afbin:'dist/afbin.mjs'}};
 const cases:Array<{name:string;manifest?:typeof validManifest;manifestText?:string;entry?:string;missingEntry?:boolean;link?:string|false}>=[
  {name:'wrong package name',manifest:{name:'someone-else',version:'1.2.3',bin:{afbin:'dist/afbin.mjs'}}},
  {name:'stale version',manifest:{name:'@afbin/cli',version:'1.1.9',bin:{afbin:'dist/afbin.mjs'}}},
  {name:'wrong bin mapping',manifest:{name:'@afbin/cli',version:'1.2.3',bin:{afbin:'dist/other.mjs'}}},
  {name:'malformed package JSON',manifestText:'{not valid JSON'},
  {name:'missing entry',manifest:validManifest,missingEntry:true},
  {name:'invalid entry shebang',manifest:validManifest,entry:'not an executable entry\n'},
  {name:'empty entry',manifest:{name:'@afbin/cli',version:'1.2.3',bin:{afbin:'dist/afbin.mjs'}},entry:''},
  {name:'wrong command link',manifest:{name:'@afbin/cli',version:'1.2.3',bin:{afbin:'dist/afbin.mjs'}},link:'wrong.mjs'},
  {name:'missing command link',manifest:{name:'@afbin/cli',version:'1.2.3',bin:{afbin:'dist/afbin.mjs'}},link:false},
 ];
 for(const scenario of cases){
  const root=await mkdtemp(join(tmpdir(),'afbin-global-repair-'));
  try{
   const pkg=join(root,'lib','node_modules','@afbin','cli'),entry=join(pkg,'dist','afbin.mjs'),bin=join(root,'bin','afbin');
   await mkdir(join(pkg,'dist'),{recursive:true});await mkdir(join(root,'bin'));
   await writeFile(join(pkg,'package.json'),scenario.manifestText??JSON.stringify(scenario.manifest));
   if(!scenario.missingEntry)await writeFile(entry,scenario.entry??'#!/usr/bin/env node\n',{mode:0o755});
   if(scenario.link!==false)await symlink(typeof scenario.link==='string'?join(pkg,'dist',scenario.link):entry,bin);
   const {calls,npm}=recorder(args=>args[0]==='prefix'?{stdout:root+'\n'}:{});
   const result=await globalInstall({version:'1.2.3',home:join(root,'home'),env:{PATH:join(root,'bin')},platform:'linux',npm});
   assert.deepEqual(calls,[['prefix','-g'],['install','-g','--no-fund','--no-audit','@afbin/cli@1.2.3']],scenario.name);
   assert.equal(result.status,'installed',scenario.name);
  }finally{await rm(root,{recursive:true,force:true});}
 }
});

test('globalInstall reuses only a Windows npm shim that targets the matching package entry',{skip:process.platform!=='win32'},async()=>{
 const root=await mkdtemp(join(tmpdir(),'afbin-global-win-repeat-'));
 try{
  const pkg=win32.join(root,'node_modules','@afbin','cli'),entry=win32.join(pkg,'dist','afbin.mjs'),bin=win32.join(root,'afbin.cmd');
  await mkdir(win32.join(pkg,'dist'),{recursive:true});
  await writeFile(win32.join(pkg,'package.json'),JSON.stringify({name:'@afbin/cli',version:'1.2.3',bin:{afbin:'dist/afbin.mjs'}}));
  await writeFile(entry,'#!/usr/bin/env node\n');
  await writeFile(bin,`@ECHO off\r\n"%_prog%" "%dp0%\\${win32.relative(root,entry)}" %*\r\n`);
  const {calls,npm}=recorder(args=>args[0]==='prefix'?{stdout:root+'\r\n'}:{});
  const result=await globalInstall({version:'1.2.3',home:win32.join(root,'home'),env:{Path:root},platform:'win32',npm});
  assert.deepEqual(calls,[['prefix','-g']]);assert.equal(result.status,'installed');assert.equal(result.on_path,true);
  await writeFile(bin,'@ECHO off\r\n"%_prog%" "%dp0%\\node_modules\\someone-else\\dist\\afbin.mjs" %*\r\n');calls.length=0;
  const repaired=await globalInstall({version:'1.2.3',home:win32.join(root,'home'),env:{Path:root},platform:'win32',npm});
  assert.deepEqual(calls,[['prefix','-g'],['install','-g','--no-fund','--no-audit','@afbin/cli@1.2.3']]);assert.equal(repaired.status,'installed');
  await writeFile(bin,`@ECHO off\r\nREM "%_prog%" "%dp0%\\${win32.relative(root,entry)}" %*\r\n`);calls.length=0;
  const comment=await globalInstall({version:'1.2.3',home:win32.join(root,'home'),env:{Path:root},platform:'win32',npm});
  assert.deepEqual(calls,[['prefix','-g'],['install','-g','--no-fund','--no-audit','@afbin/cli@1.2.3']]);assert.equal(comment.status,'installed');
 }finally{await rm(root,{recursive:true,force:true});}
});
