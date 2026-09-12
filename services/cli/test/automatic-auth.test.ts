import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,stat} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {runCli} from '../src/dispatch';
import {loadConnection,saveConnection} from '../src/config';
import {browserAuthenticate,deviceAuthenticate} from '../src/browser-auth';

const origin='https://example.com';
const pairing=()=>Response.json({device_code:'d'.repeat(43),user_code:'ABCD',verification_uri_complete:origin+'/oauth/device?user_code=ABCD',expires_in:10,interval:5});
const credentials=()=>Response.json({access_token:'new_access',refresh_token:'new_refresh',client_id:'client',expires_in:3600});

test('agent first operation opens browser, waits for approval and continues without a setup command',async()=>{
 const home=await mkdtemp(join(tmpdir(),'afbin-auto-auth-'));let opened=0;let now=0;let polls=0;const output:string[]=[];
 try{
  const code=await runCli(['list','--server',origin,'--json'],{
   home,cwd:home,env:{},interactive:false,stdout:s=>output.push(s),stderr:()=>{},
   auth:{open:async url=>{assert.equal(new URL(url).origin,origin);opened++;},now:()=>now,sleep:async ms=>{now+=ms;}},
   fetch:async(input,init)=>{
    const path=new URL(String(input)).pathname;
    if(path==='/oauth/device')return pairing();
    if(path==='/oauth/device/token')return ++polls===1?Response.json({error:'authorization_pending'},{status:400}):credentials();
    assert.equal(path,'/api/artifacts');assert.equal(new Headers(init?.headers).get('Authorization'),'Bearer new_access');
    return Response.json({artifacts:[]});
   },
  });
  assert.equal(code,0);assert.equal(opened,1);assert.equal(polls,2);assert.equal(now,5000);
  assert.deepEqual(output.map(s=>JSON.parse(s)),[{artifacts:[]}]);
  assert.equal((await loadConnection(origin,home,{}))?.token,'new_access');
 }finally{await rm(home,{recursive:true,force:true});}
});

test('an agent operation resumes after rejected refresh and browser approval',async()=>{
 const home=await mkdtemp(join(tmpdir(),'afbin-auto-reauth-'));let opened=0;let reads=0;
 try{
  await saveConnection({server:origin,token:'old_access',refreshToken:'old_refresh',clientId:'client'},home);
  const code=await runCli(['list','--server',origin,'--json'],{
   home,cwd:home,env:{},interactive:false,stdout:()=>{},stderr:()=>{},auth:{open:async()=>{opened++;}},
   fetch:async input=>{
    const path=new URL(String(input)).pathname;
    if(path==='/api/artifacts')return ++reads===1?Response.json({error:'unauthorized'},{status:401}):Response.json({artifacts:[]});
    if(path==='/oauth/token')return Response.json({error:'invalid_grant'},{status:400});
    if(path==='/oauth/device')return pairing();
    assert.equal(path,'/oauth/device/token');return credentials();
   },
  });
  assert.equal(code,0);assert.equal(opened,1);assert.equal(reads,2);
 }finally{await rm(home,{recursive:true,force:true});}
});

test('no-browser still waits without a TTY; approval is never implied by defaults',async()=>{
 const home=await mkdtemp(join(tmpdir(),'afbin-no-browser-'));let now=0;
 try{
  await assert.rejects(deviceAuthenticate(origin,{home,interactive:false,noBrowser:true,now:()=>now,sleep:async ms=>{now+=ms;},notify:()=>{},open:async()=>assert.fail('browser suppressed'),fetch:async input=>String(input).endsWith('/oauth/device')?pairing():Response.json({error:'authorization_pending'},{status:400})}),error=>(error as {code:string}).code==='approval_expired');
  assert.equal(now,10000);assert.equal(await loadConnection(origin,home,{}),null);
 }finally{await rm(home,{recursive:true,force:true});}
});

test('an unattended agent fails fast with approval_required and keeps the pairing for a retry',async()=>{
 const home=await mkdtemp(join(tmpdir(),'afbin-fastfail-'));let now=0;let approved=false;
 const bigPairing=()=>Response.json({device_code:'d'.repeat(43),user_code:'ABCD',verification_uri_complete:origin+'/oauth/device?user_code=ABCD',expires_in:300,interval:5});
 const opts=()=>({home,interactive:false,noBrowser:true,now:()=>now,sleep:async(ms:number)=>{now+=ms;},notify:()=>{},open:async()=>assert.fail('browser suppressed'),
  fetch:(async(input:unknown)=>{const u=String(input);
   if(u.endsWith('/oauth/device'))return bigPairing();
   if(u.endsWith('/oauth/device/token'))return approved?credentials():Response.json({error:'authorization_pending'},{status:400});
   return Response.json({},{status:404});}) as unknown as typeof fetch});
 try{
  // No approver: give up at the ~45s bound with an actionable error, not the full 300s window.
  await assert.rejects(deviceAuthenticate(origin,opts()),error=>(error as {code:string}).code==='approval_required');
  assert.equal(now,45000);
  assert.equal(await loadConnection(origin,home,{}),null);
  // The pairing was kept: a retry (approved out of band) reuses it and completes.
  approved=true;
  const conn=await deviceAuthenticate(origin,opts());
  assert.equal(conn.token,'new_access');
 }finally{await rm(home,{recursive:true,force:true});}
});

test('local work and dry-run do not bootstrap auth or create credentials',async()=>{
 const home=await mkdtemp(join(tmpdir(),'afbin-no-bootstrap-'));
 try{
  for(const args of [['status'],['help'],['push','--dry-run']]){
   const code=await runCli([...args,'--json'],{home,cwd:home,env:{},interactive:false,stdout:()=>{},stderr:()=>{},auth:{open:async()=>assert.fail('unexpected browser')},fetch:async()=>assert.fail('unexpected network')});
   assert.equal(code,0,args.join(' '));
  }
  // The private state directory may hold the local store; it must hold no credentials.
  await assert.rejects(stat(join(home,'.artifactbin','.env')),{code:'ENOENT'});
  await assert.rejects(stat(join(home,'.artifactbin','servers')),{code:'ENOENT'});
 }finally{await rm(home,{recursive:true,force:true});}
});

test('concurrent agent authentication shares one browser approval and saved credentials',async()=>{
 const home=await mkdtemp(join(tmpdir(),'afbin-coalesced-auth-'));let opened=0;let started=0;
 try{
  const options={home,interactive:false,notify:()=>{},open:async()=>{opened++;await new Promise(resolve=>setTimeout(resolve,25));},fetch:async(input:unknown)=>{
   if(String(input).endsWith('/oauth/device')){started++;return pairing();}
   return credentials();
  }};
  const results=await Promise.all([browserAuthenticate(origin,options),browserAuthenticate(origin,options)]);
  assert.equal(opened,1);assert.equal(started,1);assert.equal(results[0].token,results[1].token);
 }finally{await rm(home,{recursive:true,force:true});}
});
