import {test,describe} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm,stat} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {runCli} from '../src/dispatch';
import {loadConnection,saveConnection} from '../src/config';
import {browserAuthenticate,deviceAuthenticate} from '../src/browser-auth';
import {CliError} from '../src/commands';
import {createHash} from 'node:crypto';
import {loopbackAuthenticate} from '../src/loopback-auth';


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

describe('browser device approval', () => {
  test('interrupted pairing resumes and persists credentials without a validation GET', async () => {
    const home = await mkdtemp(join(tmpdir(), 'afbin-pair-'));
    const calls: string[] = [];
    let approved = false;
    const request: typeof fetch = async (input) => {
      const path = new URL(String(input)).pathname;
      calls.push(path);
      if (path === '/oauth/device') return Response.json({device_code:'d'.repeat(43),user_code:'1234-5678-ABCD-EF12', verification_uri_complete:'https://example.com/oauth/device?user_code=1234-5678-ABCD-EF12',expires_in:300,interval:5});
      if (path === '/oauth/device/token') return approved
        ? Response.json({access_token:'mx_access', refresh_token:'mxr_refresh', client_id:'afbin_client',expires_in:21600})
        : Response.json({error:'authorization_pending'}, {status:400});
      throw new Error(`Unexpected request ${path}`);
    };
    try {
      await assert.rejects(browserAuthenticate('https://example.com', {home, fetch:request, interactive:false,noBrowser:true,notify:()=>{},sleep:async()=>{throw new Error('interrupted');}}), /interrupted/);
      assert.equal((await stat(join(home,'.artifactbin'))).mode & 0o777, 0o700);
      approved = true;
      const connection = await browserAuthenticate('https://example.com', {home, fetch:request, interactive:false,noBrowser:true,notify:()=>{}});
      assert.equal(connection.token,'mx_access');
      assert.deepEqual(await loadConnection(undefined,home,{}),connection);
      assert.equal(calls.filter(x=>x==='/oauth/device').length,1);
      assert.ok(calls.every(x=>x.startsWith('/oauth/')));
    } finally {await rm(home,{recursive:true,force:true});}
  });

  test('interactive flow opens the browser and bounded polling never implies approval', async () => {
    const home = await mkdtemp(join(tmpdir(),'afbin-pair-'));
    let now = 1000;
    let opened = 0;
    const request: typeof fetch = async input => String(input).endsWith('/oauth/device')
      ? Response.json({device_code:'d'.repeat(43), user_code:'code', verification_uri_complete:'https://example.com/oauth/device?user_code=code', expires_in:10, interval:5})
      : Response.json({error:'authorization_pending'}, {status:400});
    try {
      await assert.rejects(deviceAuthenticate('https://example.com',{home,fetch:request,interactive:true,now:()=>now,sleep:async ms=>{now+=ms;},open:async()=>{opened++;},notify:()=>{}}),(error:unknown)=>error instanceof CliError&&error.code==='approval_expired');
      assert.equal(opened,1);
      assert.equal(now,11000);
      assert.equal(await loadConnection(undefined,home,{}),null);
    } finally {await rm(home,{recursive:true,force:true});}
  });

  test('device denial has a stable error code and leaves no credentials',async()=>{
   const home=await mkdtemp(join(tmpdir(),'afbin-denied-'));
   try{
    await assert.rejects(deviceAuthenticate('https://example.com',{home,interactive:false,noBrowser:true,notify:()=>{},fetch:async input=>String(input).endsWith('/oauth/device')
     ?Response.json({device_code:'d'.repeat(43),user_code:'code',verification_uri_complete:'https://example.com/oauth/device?user_code=code',expires_in:300,interval:5})
     :Response.json({error:'access_denied'},{status:400})}),error=>error instanceof CliError&&error.code==='access_denied');
    assert.equal(await loadConnection(undefined,home,{}),null);
   }finally{await rm(home,{recursive:true,force:true});}
  });
});

describe('browser loopback approval', () => {
  test('browser loopback checks state and PKCE before saving credentials',async()=>{
   const home=await mkdtemp(join(tmpdir(),'afbin-loopback-'));let challenge='';let callback='';let exchanges=0;
   try{
    const connection=await loopbackAuthenticate('https://example.com',{home,notify:()=>{},open:async raw=>{
     const url=new URL(raw);challenge=url.searchParams.get('code_challenge')!;callback=url.searchParams.get('redirect_uri')!;
     assert.equal(new URL(callback).hostname,'127.0.0.1');
     const wrong=await fetch(callback+'?code=wrong&state=wrong');assert.equal(wrong.status,400);assert.equal(await loadConnection(undefined,home,{}),null);
     const accepted=await fetch(callback+'?code=approved&state='+url.searchParams.get('state'));assert.equal(accepted.status,200);
    },fetch:async(input,init)=>{
     const body=JSON.parse(String(init?.body));
     if(String(input).endsWith('/oauth/register'))return Response.json({client_id:'afbin_client'},{status:201});
     exchanges++;assert.equal(body.code,'approved');assert.equal(body.redirect_uri,callback);assert.equal(createHash('sha256').update(body.code_verifier).digest('base64url'),challenge);assert.equal(body.resource,'https://example.com/api');
     return Response.json({access_token:'access',refresh_token:'refresh',expires_in:3600});
    }});
    assert.equal(exchanges,1);assert.equal(connection.token,'access');assert.deepEqual(await loadConnection(undefined,home,{}),connection);
   }finally{await rm(home,{recursive:true,force:true});}
  });
});

describe('which origin the approval uses', () => {
  for(const saved of [false,true])for(const explicit of [false,true]){
   test(`auth uses the selected origin without credentials (saved=${saved}, flag=${explicit})`,async()=>{
    const home=await mkdtemp(join(tmpdir(),'afbin-origin-'));
    const selected=explicit?'http://localhost:7244':'http://localhost:7242';
    const calls:string[]=[];const output:string[]=[];
    try{
     if(saved)await saveConnection({server:'https://artifactbin.dev',token:'mx_saved'},home);
     const code=await runCli(['auth','--no-browser','--json',...(explicit?['--server',selected]:[])],{
      home,cwd:home,env:{ARTIFACTBIN_URL:'http://localhost:7242'},interactive:false,stdout:s=>output.push(s),stderr:()=>{},
      fetch:async input=>{
       const url=new URL(String(input));calls.push(url.origin);
       return url.pathname==='/oauth/device'
        ?Response.json({device_code:'d'.repeat(43),user_code:'ABCD-EFGH',verification_uri_complete:selected+'/oauth/device?user_code=ABCD-EFGH',expires_in:300,interval:5})
        :Response.json({access_token:'access',refresh_token:'refresh',client_id:'client',expires_in:3600});
      },
     });
     assert.equal(code,0);
     assert.deepEqual(calls,[selected,selected]);
     assert.equal(JSON.parse(output.join('')).server,selected);
    }finally{await rm(home,{recursive:true,force:true});}
   });
  }
});

describe('a rejected token mid-command', () => {
  /** `remote` rides the shared client, so a rejected token starts browser sign-in and the command resumes with the new one. */
  test('a rejected token on afbin remote starts sign-in immediately and resumes the session with the approved credential',async()=>{
   const root=await mkdtemp(join(tmpdir(),'afbin-remote-auth-'));
   try{
    await saveConnection({server:'https://example.com',token:'stale'},root);
    const calls:string[]=[];const out:string[]=[];const err:string[]=[];
    const view={session:{id:'rs_1',name:'pi',harness:'pi',cwd:'/w',machine:'m',cols:80,rows:24,online:false,exitCode:0,controller:'local',createdAt:'2026-09-11T00:00:00Z'},generation:'g1',seq:0,frames:[],snapshot:''};
    const code=await runCli(['remote','--session','rs_1','--no-browser','--server','https://example.com'],{cwd:root,home:root,env:{},interactive:false,stdout:s=>out.push(s),stderr:s=>err.push(s),fetch:async(input,init)=>{
     const request=new Request(input,init);const path=new URL(request.url).pathname;const token=request.headers.get('Authorization');
     calls.push(`${request.method} ${path} ${token??''}`.trim());
     if(path==='/oauth/device')return Response.json({device_code:'d'.repeat(43),user_code:'ABCD',verification_uri_complete:'https://example.com/oauth/device?code=ABCD',expires_in:300,interval:5});
     if(path==='/oauth/device/token')return Response.json({access_token:'mx_fresh',refresh_token:'mxr_fresh',client_id:'afbin_client',expires_in:3600});
     if(path==='/api/remote/sessions/rs_1')return token==='Bearer mx_fresh'?Response.json(view):Response.json({error:'unauthorized'},{status:401});
     return Response.json({error:'not_found'},{status:404});
    }});
    assert.equal(code,0,out.join('')+err.join(''));
    const refused=calls.indexOf('GET /api/remote/sessions/rs_1 Bearer stale');
    const signIn=calls.findIndex(call=>call.startsWith('POST /oauth/device'));
    const resumed=calls.indexOf('GET /api/remote/sessions/rs_1 Bearer mx_fresh');
    assert.ok(refused>=0&&signIn>refused&&resumed>signIn,`refuse, sign in, resume:\n${calls.join('\n')}`);
    assert.doesNotMatch(err.join(''),/at .*\.ts:\d+/);
   }finally{await rm(root,{recursive:true,force:true});}
  });
});
