import {afterEach,expect,it} from 'vitest';
import {createUser} from '@/lib/accounts';
import {mintAccountToken,useAppHarness} from './harness';
import {runOperation} from '@/lib/operations/http';
import {setHostedRemoteAgent} from '@/lib/remote/hosted-interface';
import type {HostedRemoteAgent} from '@artifactbin/contracts';

useAppHarness();
afterEach(()=>setHostedRemoteAgent(undefined));
it('refuses a revoked default request before admitting a mutation or writing its old thread',async()=>{
 const user=await createUser({email:'mxmx_test_cancel_scope@example.com'});
 const token=await mintAccountToken('run:agent:cancelled',user.id);
 const actor={userId:user.id,tokenId:token.id};
 setHostedRemoteAgent({authorizeOperation:async()=>({kind:'denied',code:'agent_request_cancelled',message:'This request was cancelled.'})} as unknown as HostedRemoteAgent);
 const response=await runOperation('annotate',new Request('http://localhost/api/annotations',{method:'POST',headers:{'Idempotency-Key':'cancelled-thread-effect'}}),actor,{id:'old-artifact',annotation_id:'old-thread',reply:'Late cancelled answer'});
 expect(response.status).toBe(403);
 expect(await response.json()).toMatchObject({error:'agent_request_cancelled'});
});
it('defers default plain replies to the single hosted outbox without writing an annotation',async()=>{
 const user=await createUser({email:'mxmx_test_reply_scope@example.com'});
 const token=await mintAccountToken('run:agent:current',user.id);
 setHostedRemoteAgent({authorizeOperation:async()=>({kind:'deferred',body:{id:'assigned-thread',deferred:true}})} as unknown as HostedRemoteAgent);
 const response=await runOperation('annotate',new Request('http://localhost/api/annotations',{method:'POST'}),{userId:user.id,tokenId:token.id},{id:'current-artifact',annotation_id:'assigned-thread',reply:'Done'});
 expect(response.status).toBe(202);
 expect(await response.json()).toMatchObject({deferred:true});
});
