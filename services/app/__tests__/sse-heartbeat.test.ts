import {afterEach,expect,it,vi} from 'vitest';
import {GET as documentEvents} from '@/app/a/[id]/events/route';
import {GET as peopleEvents} from '@/app/api/my/people/events/route';
import {request,useAppHarness} from './harness';
import {createUser} from '@/lib/accounts';
import {runWithRequest} from '@/lib/platform';
import {LIVE_KEEPALIVE_EVENT} from '@/lib/http';
const harness=useAppHarness();
afterEach(()=>{vi.useRealTimers();});
/** Every long-lived stream the app serves speaks within 25s, under the 60s idle timeout of the proxies in front of it. */
const heartbeatWithin=async(response:Response,ms:number)=>{
 const reader=response.body!.getReader(),decoder=new TextDecoder();let text='';
 // One read stays outstanding across drains, so a chunk is never dropped with an abandoned read.
 let pending:Promise<ReadableStreamReadResult<Uint8Array>>|undefined;
 const drain=async()=>{const deadline=Date.now()+500;while(Date.now()<deadline){pending??=reader.read();const chunk=await Promise.race([pending,new Promise<null>(r=>setTimeout(()=>r(null),50))]);if(!chunk)continue;pending=undefined;if(chunk.done)return;text+=decoder.decode(chunk.value);}};
 try{await drain();const before=text.length;vi.advanceTimersByTime(ms);await drain();return text.slice(before).includes(`event: ${LIVE_KEEPALIVE_EVENT}\n`);}
 finally{await reader.cancel().catch(()=>{});}
};
it.each([
 ['/a/<id>/events', async(actor:{credential:'session';userId:string;email:string;emailVerified:true})=>{const req=request('/a/beatdoc/events',{actor});return runWithRequest(req,()=>documentEvents(req,{params:Promise.resolve({id:'beatdoc'})}));}],
 ['/api/my/people/events', async(actor:{credential:'session';userId:string;email:string;emailVerified:true})=>{const req=request('/api/my/people/events',{actor});return runWithRequest(req,()=>peopleEvents(req));}],
])('%s sends a heartbeat frame within 25 seconds of silence',async(_name,open)=>{
 const owner=await createUser({email:'mxmx_test_heartbeat@example.com'});
 await(await harness.db()).query("INSERT INTO artifacts(id,token_id,user_id,format,visibility,version) VALUES ('beatdoc','tok_beat',$1,'html','public',1) ON CONFLICT DO NOTHING",[owner.id]);
 vi.useFakeTimers({toFake:['setInterval','clearInterval']});
 const response=await open({credential:'session',userId:owner.id,email:owner.email,emailVerified:true});
 expect(response.status).toBe(200);
 expect(await heartbeatWithin(response,25_000)).toBe(true);
});
