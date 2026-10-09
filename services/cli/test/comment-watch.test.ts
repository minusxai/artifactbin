import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {runCli} from '../src/dispatch';
import {saveTestConnection} from './connection';
test('watch uses the changes API checkpoint and emits comment NDJSON before terminal access refusal',async()=>{
 const home=await mkdtemp(join(tmpdir(),'afbin-watch-'));const out:string[]=[];const seen:string[]=[];
 try{
 await saveTestConnection({server:'https://example.com',token:'mx_test'},home);
 const fetcher:typeof fetch=async(input)=>{const url=new URL(String(input));seen.push(url.pathname+url.search);
 if(!url.pathname.endsWith('/annotations/changes'))throw new Error('Unexpected request '+url.pathname);
 if(seen.length===1)return Response.json({events:[{type:'artifactbin.comment',event_id:'e1',artifact_id:'abc123',annotation_id:'ann1',comment_id:'c1',author:{kind:'human',label:'Human',user_id:'usr_one'},body:'Please fix',created_at:'2026-10-09T00:00:00Z'}],next_cursor:'checkpoint1',has_more:false});
 return Response.json({error:'not_found'},{status:404});};
 const code=await runCli(['watch','abc123','--comments','--json'],{home,cwd:home,interactive:false,fetch:fetcher,stdout:s=>out.push(s),stderr:()=>{}});
 assert.notEqual(code,0);assert.equal(seen.length,2,'watch should consume one page then stop on revoked access');
 assert.match(seen[1]!,/after=checkpoint1/);const events=out.join('').trim().split('\n').map(line=>JSON.parse(line));assert.ok(events.some(e=>e.event_id==='e1'&&e.body==='Please fix'));
 }finally{await rm(home,{recursive:true,force:true});}
});

import {watchComments,WatchResponseError} from '@artifactbin/utils/comment-watch';
import type {CommentChangeEvent} from '@artifactbin/contracts';
import {HttpClient} from '../src/http';
import {credentialRequest,readCredentials,saveCredentials,CredentialRefreshUnavailableError} from '@artifactbin/utils/node/credentials';
const event:CommentChangeEvent={type:'artifactbin.comment',event_id:'e1',artifact_id:'abc123',annotation_id:'ann1',comment_id:'c1',author:{kind:'human',label:'Human',user_id:'usr_one'},body:'Please fix',created_at:'2026-10-09T00:00:00Z'};
test('shared watcher drains pages immediately, checkpoints empty polls, retries without losing cursor and resumes exactly',async()=>{
 const controller=new AbortController(),seen:URL[]=[],checkpoints:string[]=[],delivered:string[]=[];let calls=0;
 for await(const value of watchComments({artifactId:'abc123',cursor:'opaque+/=',signal:controller.signal,retryDelayMs:0,onCheckpoint:cursor=>{checkpoints.push(cursor);},request:async(path,options)=>{
  seen.push(new URL(path,'https://example.com'));assert.equal(options.timeoutMs,70000);assert.equal(options.signal,controller.signal);
  calls++;
  if(calls===1)return {events:[event],next_cursor:'page-two',has_more:true};
  if(calls===2)return {events:[],next_cursor:'empty-checkpoint',has_more:false};
  if(calls===3)throw new WatchResponseError(503);
  controller.abort();return {events:[{...event,event_id:'must-not-emit'}],next_cursor:'late',has_more:false};
 }}))delivered.push(value.event_id);
 assert.deepEqual(delivered,['e1']);assert.deepEqual(checkpoints,['page-two','empty-checkpoint']);
 assert.equal(seen[0]!.searchParams.get('after'),'opaque+/=');assert.equal(seen[0]!.searchParams.get('wait'),'60');assert.equal(seen[1]!.searchParams.get('wait'),'0');
 assert.equal(seen[2]!.searchParams.get('after'),'empty-checkpoint');assert.equal(seen[3]!.searchParams.get('after'),'empty-checkpoint');
});
test('shared watcher bounds retries, stops terminal errors and cancels backoff promptly',async()=>{
 let calls=0;const retries:number[]=[];
 await assert.rejects(async()=>{for await(const _event of watchComments({artifactId:'abc123',retryDelayMs:0,maxRetries:2,onRetry:n=>retries.push(n),request:async()=>{calls++;throw new TypeError('offline');}}))assert.fail();},/offline/);
 assert.equal(calls,3);assert.deepEqual(retries,[1,2]);
 for(const status of [400,401,403,404]){
  calls=0;await assert.rejects(async()=>{for await(const _event of watchComments({artifactId:'abc123',request:async()=>{calls++;throw new WatchResponseError(status);}}))assert.fail();},new RegExp(String(status)));assert.equal(calls,1);
 }
 const controller=new AbortController();let retried!:()=>void;const retry=new Promise<void>(resolve=>{retried=resolve;});
 const waiting=(async()=>{for await(const _event of watchComments({artifactId:'abc123',signal:controller.signal,onRetry:()=>retried(),request:async()=>{throw new TypeError('offline');}}))assert.fail();})();
 await retry;controller.abort();await waiting;
});
test('watch cancellation aborts the waiting fetch and cleans foreground signal handlers with no late output',async()=>{
 const home=await mkdtemp(join(tmpdir(),'afbin-watch-cancel-'));const controller=new AbortController(),out:string[]=[];
 const intBefore=process.listenerCount('SIGINT'),termBefore=process.listenerCount('SIGTERM');let ready!:()=>void;const waiting=new Promise<void>(resolve=>{ready=resolve;});let requestSignal:AbortSignal|undefined;
 try{
  await saveTestConnection({server:'https://example.com',token:'mxmx_test_access'},home);
  const running=runCli(['watch','abc123','--comments','--json'],{home,cwd:home,interactive:false,signal:controller.signal,stdout:s=>out.push(s),stderr:()=>{},fetch:async(_input,init)=>{
   requestSignal=init?.signal??undefined;ready();return await new Promise<Response>((_resolve,reject)=>requestSignal!.addEventListener('abort',()=>reject(requestSignal!.reason),{once:true}));
  }});
  await waiting;controller.abort();assert.equal(await running,0);assert.equal(requestSignal?.aborted,true);assert.deepEqual(out,[]);
  assert.equal(process.listenerCount('SIGINT'),intBefore);assert.equal(process.listenerCount('SIGTERM'),termBefore);
 }finally{await rm(home,{recursive:true,force:true});}
});
test('watch refreshes expired access without browser login and emits no credentials or refusal on stdout',async()=>{
 const home=await mkdtemp(join(tmpdir(),'afbin-watch-refresh-')),out:string[]=[],err:string[]=[];let api=0,refresh=0,browser=0;
 try{
  await saveTestConnection({server:'https://example.com',token:'mxmx_test_expired',refreshToken:'mxmx_test_refresh',clientId:'mxmx_test_client'},home);
  const code=await runCli(['watch','abc123','--comments','--json'],{home,cwd:home,interactive:false,auth:{open:async()=>{browser++;}},stdout:s=>out.push(s),stderr:s=>err.push(s),fetch:async(input,init)=>{
   if(new URL(String(input)).pathname==='/oauth/token'){refresh++;return Response.json({access_token:'mxmx_test_new',refresh_token:'mxmx_test_rotated',expires_in:3600});}
   api++;if(api===1)return Response.json({error:'expired'},{status:401});
   assert.equal((init?.headers as Record<string,string>).Authorization,'Bearer mxmx_test_new');
   if(api===2)return Response.json({events:[event],next_cursor:'accepted',has_more:false});
   return Response.json({error:'not_found'},{status:404});
  }});
  assert.notEqual(code,0);assert.equal(refresh,1);assert.equal(browser,0);assert.equal(api,3);assert.deepEqual(out.map(s=>JSON.parse(s)),[event]);assert.doesNotMatch(out.join('')+err.join(''),/mxmx_test/);
 }finally{await rm(home,{recursive:true,force:true});}
});
test('HTTP credential helper accepts the long-poll timeout and cancels refresh without deleting the saved grant',async()=>{
 const root=await mkdtemp(join(tmpdir(),'afbin-watch-credentials-'));const connection={server:'https://example.com',token:'mxmx_test_expired',refreshToken:'mxmx_test_refresh',clientId:'mxmx_test_client'};
 try{
  await saveCredentials(connection,root);const controller=new AbortController();let started!:()=>void;const ready=new Promise<void>(resolve=>{started=resolve;});let refreshSignal:AbortSignal|undefined;
  const pending=credentialRequest(connection.server,root,'/api/artifacts/abc123/annotations/changes?wait=60',{timeoutMs:70000,signal:controller.signal,fetch:async(input,init)=>{
   assert.ok(init?.signal);if(new URL(String(input)).pathname.startsWith('/api/'))return Response.json({error:'expired'},{status:401});
   refreshSignal=init?.signal??undefined;started();return await new Promise<Response>((_resolve,reject)=>refreshSignal!.addEventListener('abort',()=>reject(refreshSignal!.reason),{once:true}));
  }});
  await ready;controller.abort();await assert.rejects(pending);assert.equal(refreshSignal?.aborted,true);assert.deepEqual(await readCredentials(connection.server,root),connection);
 }finally{await rm(root,{recursive:true,force:true});}
});
test('transient refresh failure retains saved grant and watcher retries the same checkpoint',async()=>{
 const home=await mkdtemp(join(tmpdir(),'afbin-watch-transient-'));let refresh=0,api=0;const paths:string[]=[],grant={server:'https://example.com',token:'mxmx_test_expired',refreshToken:'mxmx_test_refresh',clientId:'mxmx_test_client'};
 try{
  await saveTestConnection(grant,home);const client=new HttpClient({connection:grant,home,env:{},fetch:async(input)=>{
   const url=new URL(String(input));if(url.pathname==='/oauth/token'){refresh++;if(refresh===1)return Response.json({error:'temporary'},{status:503});return Response.json({access_token:'mxmx_test_new',refresh_token:'mxmx_test_rotated',expires_in:3600});}
   paths.push(url.search);api++;if(api<3)return Response.json({error:'expired'},{status:401});return Response.json({error:'not_found'},{status:404});
  }});
  await assert.rejects(async()=>{for await(const _event of watchComments({artifactId:'abc123',cursor:'resume',retryDelayMs:0,request:(path,opts)=>client.request(path,'GET',undefined,{},opts),onRetry:()=>{assert.equal(client.connection.token,grant.token);}}))assert.fail();},/not_found/);
  assert.equal(refresh,2);assert.equal(api,3);assert.ok(paths.every(path=>new URLSearchParams(path).get('after')==='resume'));
 }finally{await rm(home,{recursive:true,force:true});}
});

test('shared HTTP watcher retries unavailable refresh and credential helper uses a deadline exceeding wait60',async(t)=>{
 const root=await mkdtemp(join(tmpdir(),'afbin-watch-deadline-'));const connection={server:'https://example.com',token:'mxmx_test_access'};const deadlines:number[]=[];
 const original=AbortSignal.timeout;t.mock.method(AbortSignal,'timeout',(ms:number)=>{deadlines.push(ms);return original(ms);});
 try{
  await saveCredentials(connection,root);await credentialRequest(connection.server,root,'/api/artifacts/abc123/annotations/changes?wait=60',{timeoutMs:70000,fetch:async()=>Response.json({})});
  assert.deepEqual(deadlines,[70000]);
  const controller=new AbortController();let calls=0;
  for await(const _event of watchComments({artifactId:'abc123',signal:controller.signal,retryDelayMs:0,request:async()=>{
   calls++;if(calls===1)throw new CredentialRefreshUnavailableError('refresh_unavailable');controller.abort();return {events:[],next_cursor:'same',has_more:false};
  }}))assert.fail();
  assert.equal(calls,2);
 }finally{await rm(root,{recursive:true,force:true});}
});
