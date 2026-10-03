// Manual live-provider acceptance probe; not part of deterministic CI.
import {afterEach,expect,it} from 'vitest';
import {createUser,mintToken,claimToken} from '@/lib/accounts';
import {createAnnotationFor} from '@/lib/annotations';
import {remoteAgents} from '@/lib/remote/agents';
import {createHostedRemoteAgent} from '@/lib/remote/hosted';
import {setHostedRemoteAgent} from '@/lib/remote/hosted-interface';
import {hostedOperationTools} from '@/lib/remote/tools';
import {POST as operation} from '@/app/api/runner/operations/route';
import {createRunner} from '../../runner/src/local';
import {hostCapabilities} from '../../runner/src/capabilities';
import {useAppHarness,request} from './harness';
const harness=useAppHarness();
let close:(()=>Promise<void>)|undefined;
afterEach(async()=>{setHostedRemoteAgent(undefined);await close?.();});
it.skipIf(process.env.HOSTED_AGENT_LIVE_EVAL!=='1')('real hosted Pi creates, edits, remembers and answers a comment through app tools',async()=>{
 const db=await harness.db();
 const user=await createUser({email:'mxmx_test_hosted_live@example.com'}),token=await mintToken('live proof');await claimToken(user.id,token.token);
 const model='accounts/fireworks/models/deepseek-v4p1-flash';
 if(!process.env.FIREWORKS_API_KEY)throw Error('Live probe requires FIREWORKS_API_KEY');
 const runner=await createRunner({db,ceilings:{timeoutMs:120000},capabilities:hostCapabilities({
  artifactbin:async(ctx,op,args)=>{const r=await operation(request('/api/runner/operations',{method:'POST',actor:{userId:ctx.request.userId,credential:'session'},json:{operation:op.startsWith('artifactbin.')?op.slice(12):op,input:args,requestId:ctx.request.requestId}}));const result=await r.json();if(!r.ok)throw Error(JSON.stringify(result));return result;},
  ai:{baseUrl:'https://api.fireworks.ai/inference/v1',apiKey:process.env.FIREWORKS_API_KEY,models:[model],defaultModel:model},
 })});close=()=>runner.close();
 const hosted=await createHostedRemoteAgent({runner,secret:'live-hosted-proof-'.repeat(3),model,operationTools:hostedOperationTools()});setHostedRemoteAgent(hosted.agent);
 const [session]=await remoteAgents.list(user.id);expect(session.online).toBe(true);
 const settle=async(artifactId:string,previous=0)=>{const end=Date.now()+140000;while(Date.now()<end){await hosted.tick();const branches=await hosted.coordinator.branches(user.id,artifactId);if(branches.length>previous&&['completed','failed','interrupted','cancelled'].includes(branches[0].status)){expect(branches[0].status,JSON.stringify(branches[0].result)).toBe('completed');return branches[0];}await new Promise(r=>setTimeout(r,100));}throw Error('hosted_turn_timeout');};
 await remoteAgents.input(user.id,session.id,'Create a private report titled Hosted live proof. Include a heading and the sentence Our launch code is amber47. Tell me the artifact ID.\r');
 await settle('chat');
 const doc=(await db.query<{id:string;edit_id:string;source:string}>('SELECT id,edit_id,source FROM artifacts WHERE user_id=$1 AND title=$2',[user.id,'Hosted live proof'])).rows[0];expect(doc).toBeDefined();
 await remoteAgents.input(user.id,session.id,'Update that same report: add a paragraph Launch is Friday. Keep the original launch code.\r');
 await settle('chat',1);
 const head=await (await operation(request('/api/runner/operations',{method:'POST',actor:{userId:user.id,credential:'session'},json:{operation:'get_artifact',input:{id:doc.id}}}))).json();expect(head.markup).toContain('Friday');expect(head.markup).toContain('amber47');
 await remoteAgents.input(user.id,session.id,'What launch code did I ask you to put in the report? Answer from our conversation without tools.\r');
 const memory=await settle('chat',2);const transcript=memory.result as {messages:Array<{role:string;content:unknown}>};expect(JSON.stringify(transcript.messages.filter(m=>m.role==='assistant').at(-1)?.content)).toContain('amber47');
 const thread=await createAnnotationFor({tokenId:token.id,userId:user.id},doc.id,{bodyPath:'0',baseEditId:head.edit_id,body:`[@artifactbin](/chat?session=${session.id}) Read this report, then reply with its launch code and launch day. Do not edit it.`},{kind:'human',label:'Owner',transport:'browser'});
 if(!thread||!('id' in thread))throw Error('annotation_failed');
 await settle(doc.id);
 expect((await remoteAgents.work(db,doc.id,thread.id))[0].phase).toBe('completed');
 const replies=(await db.query<{body:string}>('SELECT body FROM annotations WHERE root_id=$1',[thread.id])).rows.map(r=>r.body).join('\n');expect(replies).toContain('amber47');expect(replies).toContain('Friday');
 const receipts=(await db.query<{receipt:unknown}>('SELECT receipt FROM runner_runs')).rows;
 console.log('HOSTED_LIVE_PROOF',JSON.stringify({turns:receipts.length,receipts:receipts.map(r=>r.receipt)}));
},600000);
