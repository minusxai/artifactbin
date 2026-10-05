import {it,expect,afterEach} from 'vitest';
import {useAppHarness,request,agentCookie} from './harness';
import {createUser,claimToken,mintToken} from '@/lib/accounts';
import {getDb} from '@/lib/platform';
import {remoteAgents} from '@/lib/remote/agents';
import {setHostedRemoteAgent} from '@/lib/remote/hosted-interface';
import {readCommentContext} from '@/lib/remote/comment-context';
import {externalHostedComments,clearExternalHostedComments} from '@/lib/remote/hosted-comments';
import {POST as callback} from '@/app/api/remote/hosted/operations/route';
import {POST as publish} from '@/app/api/artifacts/route';
import {POST as comment} from '@/app/api/my/artifacts/[id]/annotations/route';
import {serve,hostedAgentClient,hostedAgentSessionId,hostedAgentCallbackKey,hostedAgentDeliveryKey,hostedAgentDeliveryTransport,hostedAgentTransport,signActor,verifyActor} from '@artifactbin/utils';
import {ACTOR_HEADER,type HostedAgentComment} from '@artifactbin/contracts';
useAppHarness();
afterEach(()=>{setHostedRemoteAgent(undefined);clearExternalHostedComments();});
const secret='fixture-only-hosted-comment-secret-000000000';
async function fixture(){
 const token=await mintToken('external-comments'),user=await createUser({email:'mxmx_test_external-comments@example.com'});await claimToken(user.id,token.token);
 const cookie=await agentCookie([token.id]);
 const made=await publish(request('/api/artifacts',{method:'POST',token:token.token,json:{markup:'<p>Remote comments</p>'}}));expect(made.status).toBe(201);const doc=await made.json();
 const id=hostedAgentSessionId(user.id),session={id,name:'artifactbin',harness:'native',cwd:'Agent',machine:'Remote',cols:100,rows:30,online:true,exitCode:null,controller:'web' as const,createdAt:new Date().toISOString(),managed:true,activity:'listening' as const};
 // This HTTP service stores acceptance independently; it never reads the app DB.
 const accepted=new Map<string,HostedAgentComment>(),attempts:string[]=[];let loseResponse=true;
 const service=serve({fetch:async req=>{
  const path=new URL(req.url).pathname,key=path.endsWith('/comment')?hostedAgentDeliveryKey(secret):secret;
  // Model the public proxy replacing the ordinary browser actor signature.
  const proxyHeaders=new Headers(req.headers);proxyHeaders.delete(ACTOR_HEADER);proxyHeaders.set(ACTOR_HEADER,signActor({userId:'browser',credential:'session'},secret));
  const actor=verifyActor(proxyHeaders.get(path.endsWith('/comment')?'x-artifactbin-hosted-delivery':'x-artifactbin-hosted-actor'),key);if(!actor?.userId)return Response.json({error:'unauthorized'},{status:401});
  if(path.endsWith('/ensure'))return Response.json(session);
  if(path.endsWith('/stop'))return Response.json({ok:true});
  const work=await req.json() as HostedAgentComment;expect(work.sessionId).toBe(hostedAgentSessionId(actor.userId));attempts.push(work.requestId);accepted.set(work.requestId,work);
  if(loseResponse){loseResponse=false;return Response.json({error:'lost_response'},{status:503});}
  return Response.json({accepted:true});
 }},0);
 const agent=hostedAgentClient(service.url,hostedAgentTransport(service.url,secret),hostedAgentDeliveryTransport(service.url,secret));
 const tick=externalHostedComments(agent,secret,{publicBaseUrl:'https://app.fixture'});setHostedRemoteAgent(agent);
 await remoteAgents.list(user.id);
 const root=await comment(request(`/api/my/artifacts/${doc.id}/annotations`,{method:'POST',cookie,json:{path:'0',edit_id:doc.edit_id,quote:'Remote comments',body:`[@artifactbin](/chat?session=${id}) fix this`}}),{params:Promise.resolve({id:doc.id})});expect(root.status).toBe(201);const thread=await root.json();
 const work=thread.remote_work[0];
 const call=(operation:string,input:unknown={},overrides:Record<string,unknown>={},owner=user.id,key=hostedAgentCallbackKey(secret))=>callback(request('/api/remote/hosted/operations',{method:'POST',headers:{[ACTOR_HEADER]:signActor({userId:'proxy-browser',credential:'session'},secret),'x-artifactbin-hosted-callback':signActor({userId:owner,credential:'session'},key)},json:{requestId:work.id,sessionId:id,operation,input,...overrides}}));
 return {user,doc,thread,work,tick,call,accepted,attempts,service};
}
it('persists independent-service delivery, retries ambiguous acceptance with the same ID, and completes actual comment receipts',async()=>{
 const f=await fixture();try{
  await f.tick();expect(f.accepted.size).toBe(1);
  const originalContext=f.accepted.get(f.work.id)?.commentContext;
  expect(originalContext).toMatchObject({artifactId:f.doc.id,threadId:f.thread.id,commentId:f.thread.id,quote:'Remote comments',thread:[{id:f.thread.id,body:expect.stringContaining('fix this')}]});
  await (await getDb()).query("INSERT INTO annotations(id,artifact_id,root_id,body,author_kind,author_user_id) VALUES('after-delivery',$1,$2,'later background','human',$3)",[f.doc.id,f.thread.id,f.user.id]);expect((await remoteAgents.work(await getDb(),f.doc.id,f.thread.id))[0].phase).toBe('dispatching');
  // Recreate the URL adapter/outbox; the committed queue, not memory, drives retry.
  const client=hostedAgentClient(f.service.url,hostedAgentTransport(f.service.url,secret),hostedAgentDeliveryTransport(f.service.url,secret));
  await externalHostedComments(client,secret)();expect(f.attempts).toEqual([f.work.id,f.work.id]);expect(f.accepted.size).toBe(1);
  expect(f.accepted.get(f.work.id)?.commentContext).toEqual(originalContext);
  expect(f.accepted.get(f.work.id)).toMatchObject({sessionId:hostedAgentSessionId(f.user.id),artifactId:f.doc.id,threadId:f.thread.id,callbackUrl:'http://localhost:3030/api/remote/hosted/operations'});
  const read=await f.call('read',{id:'unrelated'});expect(read.status).toBe(200);
  const ack=await f.call('reply',{body:'Working',phase:'acknowledged'});expect(ack.status).toBe(200);
  expect((await f.call('reply',{body:'Working',phase:'acknowledged'})).status).toBe(200);
  expect((await f.call('reply',{body:'Done',phase:'completed'})).status).toBe(200);
  expect((await remoteAgents.work(await getDb(),f.doc.id,f.thread.id))[0].phase).toBe('completed');
  const again=await f.call('reply',{body:'Reconstructed completion',phase:'completed'});expect(again.status).toBe(200);expect(await again.json()).toMatchObject({alreadyDelivered:true});
  const delivered=await (await getDb()).query<{count:number}>("SELECT count(*)::int AS count FROM annotations WHERE root_id=$1 AND author_kind='agent'",[f.thread.id]);expect(delivered.rows[0]?.count).toBe(2);
  expect((await f.call('reply',{body:'Actually failed',phase:'failed'})).status).toBe(409);
  expect((await remoteAgents.work(await getDb(),f.doc.id,f.thread.id))[0].phase).toBe('completed');
 }finally{await f.service.close();}
});
it('denies browser signatures, another owner/session/work, unacknowledged completion and resolution over a later comment',async()=>{
 const f=await fixture();try{
  await f.tick();
  expect((await f.call('read',{}, {},f.user.id,secret)).status).toBe(401);
  expect((await callback(request('/api/remote/hosted/operations',{method:'POST',actor:{userId:f.user.id,credential:'session'},json:{requestId:f.work.id,sessionId:hostedAgentSessionId(f.user.id),operation:'read',input:{}}}))).status).toBe(401);
  expect((await f.call('read',{}, {},'different-owner')).status).toBe(404);
  expect((await f.call('read',{}, {sessionId:hostedAgentSessionId('different-owner')})).status).toBe(404);
  expect((await f.call('read',{}, {requestId:'different-work'})).status).toBe(404);
  expect((await f.call('reply',{body:'Done',phase:'completed'})).status).toBe(409);
  expect((await f.call('reply',{body:'Working',phase:'acknowledged'})).status).toBe(200);
  await (await getDb()).query("INSERT INTO annotations(id,artifact_id,root_id,body,author_kind,author_user_id) VALUES('later',$1,$2,'new request','human',$3)",[f.doc.id,f.thread.id,f.user.id]);
  expect((await f.call('reply',{body:'Done',phase:'completed',resolve:true})).status).toBe(409);
  expect((await remoteAgents.work(await getDb(),f.doc.id,f.thread.id))[0].phase).toBe('acknowledged');
 }finally{await f.service.close();}
});

it('refuses callback access after artifact permission is revoked and bounds authenticated request bodies',async()=>{
 const f=await fixture();try{
  await f.tick();
  const oversized=request('/api/remote/hosted/operations',{method:'POST',headers:{'x-artifactbin-hosted-callback':signActor({userId:f.user.id,credential:'session'},hostedAgentCallbackKey(secret))},body:'x'.repeat(65537)});
  expect((await callback(oversized)).status).toBe(413);
  const other=await createUser({email:'mxmx_test_other-external@example.com'});
  await (await getDb()).query("UPDATE artifacts SET user_id=$2,visibility='private' WHERE id=$1",[f.doc.id,other.id]);
  expect((await f.call('read')).status).toBe(404);
  expect((await f.call('reply',{body:'Working',phase:'acknowledged'})).status).toBe(404);
 }finally{await f.service.close();}
});

it('stops app-owned queued comments without dispatching them to a URL service',async()=>{
 const f=await fixture();try{
  await remoteAgents.stop(f.user.id,hostedAgentSessionId(f.user.id));await f.tick();
  expect(f.accepted.size).toBe(0);
  expect((await remoteAgents.work(await getDb(),f.doc.id,f.thread.id))[0].phase).toBe('unavailable');
 }finally{await f.service.close();}
});

it('delivers a failure before acknowledgment exactly once and preserves its terminal phase',async()=>{
 const f=await fixture();try{
  const response=await f.call('reply',{body:'Execution timed out. Please mention again to retry.',phase:'failed'});
  expect(response.status).toBe(200);
  expect((await f.call('reply',{body:'Execution timed out. Please mention again to retry.',phase:'failed'})).status).toBe(200);
  const reconstructed=await f.call('reply',{body:'A reconstructed timeout delivery',phase:'failed'});expect(reconstructed.status).toBe(200);expect(await reconstructed.json()).toMatchObject({alreadyDelivered:true});
  const db=await getDb();expect((await remoteAgents.work(db,f.doc.id,f.thread.id))[0].phase).toBe('failed');
  const replies=await db.query<{count:number}>('SELECT count(*)::int AS count FROM annotations WHERE root_id=$1',[f.thread.id]);expect(replies.rows[0]?.count).toBe(1);
  expect((await f.call('reply',{body:'Working',phase:'acknowledged'})).status).toBe(409);
  expect((await f.call('reply',{body:'Done instead',phase:'completed'})).status).toBe(409);
 }finally{await f.service.close();}
});

it('bounds selected context in JSON bytes and includes recent whole messages through the trigger',async()=>{
 const f=await fixture();try{
  const db=await getDb();await db.query('UPDATE annotations SET quote=$2 WHERE id=$1',[f.thread.id,'😀\n'.repeat(10000)]);
  for(let i=0;i<8;i++)await db.query("INSERT INTO annotations(id,artifact_id,root_id,body,author_kind,author_user_id) VALUES($1,$2,$3,$4,'human',$5)",[`context-${i}`,f.doc.id,f.thread.id,`message-${i}:`+'z'.repeat(8000),f.user.id]);
  const context=await readCommentContext(db,f.doc,'context-thread-does-not-exist','context-5');
  expect(context).toMatchObject({thread:[]});
  const selected=await readCommentContext(db,f.doc,f.thread.id,'context-5') as {quote:string;thread:Array<{id:string;body:string}>;truncated:boolean};
  expect(Buffer.byteLength(JSON.stringify(selected))).toBeLessThanOrEqual(65536);
  expect(selected.quote).toMatch(/^😀\n/);expect(selected.truncated).toBe(true);
  expect(selected.thread.at(-1)?.id).toBe('context-5');
  expect(selected.thread.every(message=>message.body.length===8010)).toBe(true);
  expect(selected.thread.some(message=>message.id==='context-6')).toBe(false);
 }finally{await f.service.close();}
});
it('a failed earlier request does not prevent a later completed request resolving the thread',async()=>{
 const f=await fixture();try{
  expect((await f.call('reply',{body:'Execution failed',phase:'failed'})).status).toBe(200);
  const db=await getDb(),sessionId=hostedAgentSessionId(f.user.id);
  await db.query("INSERT INTO annotations(id,artifact_id,root_id,body,author_kind,author_user_id) VALUES('retry-human',$1,$2,'retry','human',$3)",[f.doc.id,f.thread.id,f.user.id]);
  await db.transaction(tx=>remoteAgents.enqueue(tx,f.user.id,f.doc.id,f.thread.id,{id:'retry-human',body:`[@artifactbin](/chat?session=${sessionId}) retry`,author:{kind:'human',label:'Owner'}}));
  await db.query("UPDATE remote_work SET phase='acknowledged' WHERE comment_id='retry-human'");
  const next=(await remoteAgents.work(db,f.doc.id,f.thread.id)).at(-1)!;
  const completed=await f.call('reply',{body:'Done',phase:'completed',resolve:true},{requestId:next.id});
  expect(completed.status).toBe(200);
 }finally{await f.service.close();}
});
