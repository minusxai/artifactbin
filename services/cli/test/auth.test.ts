import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {runCli} from '../src/dispatch';
import {loadConnection,saveConnection} from '../src/config';

const origin='https://example.com';
const pairing=()=>Response.json({device_code:'d'.repeat(43),user_code:'ABCD',verification_uri_complete:origin+'/oauth/device?user_code=ABCD',expires_in:10,interval:5});
const credentials=()=>Response.json({access_token:'new_access',refresh_token:'new_refresh',client_id:'client',expires_in:3600});

test('afbin auth is a no-op on a valid saved token: one read, reports the account, no browser',async()=>{
 const home=await mkdtemp(join(tmpdir(),'afbin-auth-valid-'));let calls=0;const output:string[]=[];
 try{
  await saveConnection({server:origin,token:'saved_access'},home);
  const code=await runCli(['auth','--server',origin,'--json'],{
   home,cwd:home,env:{},interactive:false,stdout:s=>output.push(s),stderr:()=>{},
   auth:{open:async()=>assert.fail('a valid token must not open a browser')},
   fetch:async(input,init)=>{
    calls++;const url=new URL(String(input));assert.equal(url.pathname,'/api/artifacts');
    assert.equal(new Headers(init?.headers).get('Authorization'),'Bearer saved_access');
    return Response.json({artifacts:[]},{headers:{'X-Artifactbin-Account':'acct_1'}});
   },
  });
  assert.equal(code,0,output.join(''));assert.equal(calls,1);
  assert.deepEqual(JSON.parse(output.join('')),{authenticated:true,server:origin,account:'acct_1'});
 }finally{await rm(home,{recursive:true,force:true});}
});

test('afbin auth reports anonymous when the server names no account',async()=>{
 const home=await mkdtemp(join(tmpdir(),'afbin-auth-anon-'));const output:string[]=[];
 try{
  await saveConnection({server:origin,token:'saved_access'},home);
  const code=await runCli(['auth','--server',origin,'--json'],{home,cwd:home,env:{},interactive:false,stdout:s=>output.push(s),stderr:()=>{},fetch:async()=>Response.json({artifacts:[]})});
  assert.equal(code,0);assert.equal(JSON.parse(output.join('')).account,'anonymous');
 }finally{await rm(home,{recursive:true,force:true});}
});

test('afbin auth with no saved token runs the browser approval flow and saves the credential',async()=>{
 const home=await mkdtemp(join(tmpdir(),'afbin-auth-none-'));const output:string[]=[];const calls:string[]=[];
 try{
  const code=await runCli(['auth','--server',origin,'--no-browser','--json'],{
   home,cwd:home,env:{},interactive:false,stdout:s=>output.push(s),stderr:()=>{},
   fetch:async input=>{const path=new URL(String(input)).pathname;calls.push(path);return path==='/oauth/device'?pairing():credentials();},
  });
  assert.equal(code,0,output.join(''));
  assert.deepEqual(JSON.parse(output.join('')),{authenticated:true,server:origin});
  assert.deepEqual(calls,['/oauth/device','/oauth/device/token']);
  assert.equal((await loadConnection(origin,home,{}))?.token,'new_access');
 }finally{await rm(home,{recursive:true,force:true});}
});

test('afbin auth surfaces the structured denial error and relays the verification URL on stderr',async()=>{
 const home=await mkdtemp(join(tmpdir(),'afbin-auth-denied-'));const output:string[]=[];const diagnostics:string[]=[];
 try{
  const code=await runCli(['auth','--server',origin,'--no-browser','--json'],{
   home,cwd:home,env:{},interactive:false,stdout:s=>output.push(s),stderr:s=>diagnostics.push(s),
   fetch:async input=>new URL(String(input)).pathname==='/oauth/device'?pairing():Response.json({error:'access_denied'},{status:400}),
  });
  assert.equal(code,2);
  assert.equal(JSON.parse(output.join('')).error.code,'access_denied');
  // The verification URL and code reach a relaying caller through the existing notify channel.
  assert.match(diagnostics.join(''),/\/oauth\/device\?user_code=ABCD/);
  assert.match(diagnostics.join(''),/ABCD/);
 }finally{await rm(home,{recursive:true,force:true});}
});

test('afbin auth unattended surfaces approval_expired when the window closes',async()=>{
 const home=await mkdtemp(join(tmpdir(),'afbin-auth-expired-'));const output:string[]=[];let now=0;
 try{
  const code=await runCli(['auth','--server',origin,'--no-browser','--json'],{
   home,cwd:home,env:{},interactive:false,stdout:s=>output.push(s),stderr:()=>{},
   auth:{now:()=>now,sleep:async ms=>{now+=ms;}},
   fetch:async input=>new URL(String(input)).pathname==='/oauth/device'?pairing():Response.json({error:'authorization_pending'},{status:400}),
  });
  assert.equal(code,2);
  assert.equal(JSON.parse(output.join('')).error.code,'approval_expired');
  assert.equal(await loadConnection(origin,home,{}),null);
 }finally{await rm(home,{recursive:true,force:true});}
});

test('eager init installs the detected skill on a local command and is idempotent, offline',async()=>{
 const home=await mkdtemp(join(tmpdir(),'afbin-init-local-'));const bin=join(home,'bin');
 try{
  await mkdir(bin);await writeFile(join(bin,'pi'),'#!/bin/sh\nexit 1\n',{mode:0o755});
  const env={PATH:bin};const skill=join(home,'.pi','agent','skills','artifactbin','SKILL.md');
  const first:string[]=[];
  assert.equal(await runCli(['help'],{home,cwd:home,env,interactive:false,stdout:()=>{},stderr:s=>first.push(s),fetch:async()=>assert.fail('init must stay offline')}),0);
  assert.match(await readFile(skill,'utf8'),/name: artifactbin/);
  assert.match(first.join(''),/Skill installed:/);
  const second:string[]=[];
  assert.equal(await runCli(['help'],{home,cwd:home,env,interactive:false,stdout:()=>{},stderr:s=>second.push(s),fetch:async()=>assert.fail('init must stay offline')}),0);
  assert.equal(second.join(''),'','a current skill is not reinstalled');
  // afbin status reports each harness' skill directory and whether it is installed/current, offline.
  const st:string[]=[];
  assert.equal(await runCli(['status','--json'],{home,cwd:home,env,interactive:false,stdout:s=>st.push(s),stderr:()=>{},fetch:async()=>assert.fail('status is local')}),0);
  const skills=JSON.parse(st.join('')).skills as Array<{harness:string;path:string;installed:boolean;current:boolean}>;
  assert.equal(skills.length,4);
  const pi=skills.find(x=>x.harness==='pi')!;
  assert.equal(pi.path,join(home,'.pi','agent','skills','artifactbin'));
  assert.equal(pi.installed,true);assert.equal(pi.current,true);
  assert.equal(skills.find(x=>x.harness==='codex')!.installed,false);
 }finally{await rm(home,{recursive:true,force:true});}
});
