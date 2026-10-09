import {afterEach,expect,it,vi} from 'vitest';
import {createUser} from '@/lib/accounts';
import {requestOrSessionActor,sessionActor} from '@/lib/accounts/viewer';
import {PATCH as profilePatch} from '@/app/api/account/profile/route';
import {attachActor} from '@artifactbin/utils';
import {BROWSER_SESSION_HEADER} from '@artifactbin/contracts';
import {getDb} from '@/lib/platform/db';
import {mintAccountToken,useAppHarness,request} from './harness';
import {POST as publish} from '@/app/api/artifacts/route';
import {POST as comment} from '@/app/api/artifacts/[id]/annotations/route';
import {runOperation} from '@/lib/operations/http';
import {setHostedRemoteAgent} from '@/lib/remote/hosted-interface';
import type {HostedRemoteAgent} from '@artifactbin/contracts';
useAppHarness();
afterEach(()=>setHostedRemoteAgent(undefined));
async function ownedThread(scoped=true){
 const user=await createUser({email:'mxmx_test_request_scope@example.com'}),token=await mintAccountToken('run:agent:current',user.id);
 const made=await publish(request('/api/artifacts',{method:'POST',token:token.token,json:{markup:'<p id="scope-target">Target</p>'}}));expect(made.status).toBe(201);const doc=await made.json();
 const posted=await comment(request(`/api/artifacts/${doc.id}/annotations`,{method:'POST',token:token.token,json:{node_id:'scope-target',body:'Original request'}}),{params:Promise.resolve({id:doc.id})});expect(posted.status).toBe(201);const thread=await posted.json();
 if(scoped)await (await getDb()).query('UPDATE tokens SET request_authority=true WHERE id=$1',[token.id]);
 return {user,token,doc,thread,actor:{userId:user.id,tokenId:token.id}};
}
const operationRequest=(key?:string)=>new Request('http://localhost/api/artifacts/doc/annotations/thread',{method:'POST',headers:key?{'Idempotency-Key':key}:{}});
it('ordinary authenticated agent can reply to its actual owned thread',async()=>{
 const {actor,doc,thread}=await ownedThread(false);
 const response=await runOperation('annotate',operationRequest(),actor,{id:doc.id,annotation_id:thread.id,reply:'Ordinary reply'});expect(response.status).toBe(200);expect((await response.json()).thread.at(-1).body).toBe('Ordinary reply');
});
it.each(['cancelled','wrong_target'])('refuses %s default request before admitting a receipt or writing its actual thread',async reason=>{
 const {user,token,actor,doc,thread}=await ownedThread();const hook=vi.fn(async()=>({kind:'denied' as const,code:`agent_request_${reason}`,message:'Request refused.'}));
 setHostedRemoteAgent({authorizeOperation:hook} as unknown as HostedRemoteAgent);
 const response=await runOperation('annotate',operationRequest('rejected-thread-effect'),actor,{id:doc.id,annotation_id:thread.id,reply:'Late cancelled answer'});
 expect(response.status).toBe(403);expect(await response.json()).toMatchObject({error:`agent_request_${reason}`,admission_refused:true});expect(hook).toHaveBeenCalledWith(user.id,token.id,'annotate',expect.objectContaining({annotation_id:thread.id}),expect.objectContaining({name:'run:agent:current'}));
 const db=await getDb();expect((await db.query('SELECT id FROM annotations WHERE root_id=$1',[thread.id])).rows).toHaveLength(0);expect((await db.query("SELECT operation_key FROM mutation_receipts WHERE operation_key='rejected-thread-effect'")).rows).toHaveLength(0);
});
it('defers default plain replies to the single hosted outbox without writing an annotation or claiming a receipt',async()=>{
 const {actor,doc,thread}=await ownedThread();setHostedRemoteAgent({authorizeOperation:async()=>({kind:'deferred',body:{id:thread.id,deferred:true}})} as unknown as HostedRemoteAgent);
 const response=await runOperation('annotate',operationRequest('deferred-reply'),actor,{id:doc.id,annotation_id:thread.id,reply:'Done'});
 expect(response.status).toBe(202);expect(await response.json()).toMatchObject({deferred:true});const db=await getDb();expect((await db.query('SELECT id FROM annotations WHERE root_id=$1',[thread.id])).rows).toHaveLength(0);expect((await db.query("SELECT operation_key FROM mutation_receipts WHERE operation_key='deferred-reply'")).rows).toHaveLength(0);
});

it('refuses default token escape through direct HTTP mutation before invoking its handler',async()=>{
 const {user,token}=await ownedThread();const hook=vi.fn(async()=>({kind:'denied' as const,code:'agent_request_scope',message:'Use scoped operations.'}));setHostedRemoteAgent({authorizeOperation:hook} as unknown as HostedRemoteAgent);
 const response=await profilePatch(request('/api/account/profile',{method:'PATCH',token:token.token,json:{name:'Escaped'}}));expect(response.status).toBe(403);expect(hook).toHaveBeenCalledWith(user.id,token.id,'http_request',{method:'PATCH',path:'/api/account/profile'},expect.objectContaining({name:'run:agent:current'}));
});
it('keeps browser token identity and refuses default browser mutations, without promoting it to a user session',async()=>{
 const {user,token}=await ownedThread();const hook=vi.fn(async()=>({kind:'denied' as const,code:'agent_browser_readonly',message:'Read-only browser.'}));setHostedRemoteAgent({authorizeOperation:hook} as unknown as HostedRemoteAgent);
 const browser=attachActor(new Request('http://localhost/api/my/artifacts',{method:'POST',headers:{[BROWSER_SESSION_HEADER]:'1'}}),{credential:'bearer',userId:user.id,tokenId:token.id});
 expect((await sessionActor(browser)).credential).toBe('none');expect(hook).toHaveBeenCalledWith(user.id,token.id,'browser_request',{method:'POST',path:'/api/my/artifacts'},expect.objectContaining({name:'run:agent:current'}));
 const direct=await requestOrSessionActor(request('/api/remote/sessions',{method:'POST',token:token.token,json:{type:'stop'}}));expect(direct.credential).toBe('none');
});

it('fails closed for an explicitly scoped credential when its authority adapter is unavailable',async()=>{
 const {actor,doc,thread,token}=await ownedThread();await (await getDb()).query('UPDATE tokens SET request_authority=true WHERE id=$1',[token.id]);
 setHostedRemoteAgent(undefined);const reply=await runOperation('annotate',operationRequest(),actor,{id:doc.id,annotation_id:thread.id,reply:'Unsupervised'});
 expect(reply.status).toBe(403);
});

it('keeps unmarked credentials independent of an unavailable hosted service',async()=>{
 const {actor,doc,thread}=await ownedThread(false);const hook=vi.fn(async()=>{throw Error('offline');});setHostedRemoteAgent({authorizeOperation:hook} as unknown as HostedRemoteAgent);
 expect((await runOperation('annotate',operationRequest(),actor,{id:doc.id,annotation_id:thread.id,reply:'Ordinary works'})).status).toBe(200);expect(hook).not.toHaveBeenCalled();
});
it('fails closed for unavailable authority and expired token without trusting caller metadata',async()=>{
 const {actor,token,doc,thread}=await ownedThread();setHostedRemoteAgent({authorizeOperation:async()=>{throw Error('offline');}} as unknown as HostedRemoteAgent);
 const input={id:doc.id,annotation_id:thread.id,reply:'Late',credential:{scoped:false}};
 expect((await runOperation('annotate',operationRequest(),actor,input)).status).toBe(403);
 await (await getDb()).query("UPDATE tokens SET expires_at=now()-interval '1 second' WHERE id=$1",[token.id]);setHostedRemoteAgent(undefined);
 expect((await runOperation('annotate',operationRequest(),actor,input)).status).toBe(403);
});

it('admits actual CLI creation and preserves an admitted write while refusing new effects after cancellation',async()=>{
 const {user,token,actor,doc,thread}=await ownedThread();let cancelled=false;const completed=vi.fn(async()=>{});
 const hook=vi.fn(async(_owner:string,_token:string,name:string)=>{
  if(cancelled)return {kind:'denied' as const,code:'agent_request_cancelled',message:'Cancelled'};
  if(name==='annotate')cancelled=true; // Admission succeeds; Stop may win before the accepted effect settles.
  return {kind:'allowed' as const};
 });setHostedRemoteAgent({authorizeOperation:hook,operationCompleted:completed} as unknown as HostedRemoteAgent);
 const made=await publish(request('/api/artifacts',{method:'POST',token:token.token,json:{markup:'<p id="created">Created</p>'}}));expect(made.status).toBe(201);
 const created=await made.json();expect(completed).toHaveBeenCalledWith(user.id,token.id,'create_artifact',expect.anything(),expect.objectContaining({id:created.id}),expect.objectContaining({scoped:true}));
 const admitted=await runOperation('annotate',operationRequest('admitted-effect-before-stop'),actor,{id:doc.id,annotation_id:thread.id,reply:'Accepted before Stop'});expect(admitted.status).toBe(200);
 const late=await runOperation('annotate',operationRequest('admitted-effect-before-stop'),actor,{id:doc.id,annotation_id:thread.id,reply:'Accepted before Stop'});expect(late.status).toBe(403);
 expect((await (await getDb()).query<{body:string}>('SELECT body FROM annotations WHERE root_id=$1',[thread.id])).rows.map(row=>row.body)).toEqual(['Accepted before Stop']);
});

it('marks only the server-owned scoped namespace on deployment initialization',async()=>{
 const {markRequestAuthority}=await import('@/lib/accounts/tokens');const user=await createUser({email:'mxmx_test_marker@example.com'});
 const scoped=await mintAccountToken('service-grant:one',user.id),native=await mintAccountToken('service-grantish:one',user.id);
 const db=await getDb();await markRequestAuthority('service-grant:',db);await markRequestAuthority('service-grant:',db);
 const records=(await db.query<{id:string;request_authority:boolean}>('SELECT id,request_authority FROM tokens WHERE id=ANY($1)',[[scoped.id,native.id]])).rows;
 expect(records.find(row=>row.id===scoped.id)?.request_authority).toBe(true);expect(records.find(row=>row.id===native.id)?.request_authority).toBe(false);
});
