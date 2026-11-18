import {afterEach,expect,it,vi} from 'vitest';
import {GET as documentEvents} from '@/app/a/[id]/events/route';
import {GET as peopleEvents} from '@/app/api/my/people/events/route';
import {request,useAppHarness,params} from './harness';
import { createUser } from '@/lib/accounts';
import {runWithRequest} from '@/lib/platform';
import {LIVE_KEEPALIVE_EVENT} from '@/lib/http';
const harness=useAppHarness();
afterEach(()=>{vi.useRealTimers();});
/** Every long-lived stream the app serves speaks within 25s, under the 60s idle timeout of the proxies in front of it. */
const heartbeatWithin=async(response:Response,ms:number)=>{
 const reader=response.body!.getReader(),decoder=new TextDecoder(),keepalive=`event: ${LIVE_KEEPALIVE_EVENT}\n`;
 try{
  // The stream's opening chunk first: it is no heartbeat, and only an interval (faked) can send one.
  const opening=await reader.read();
  if(opening.done||decoder.decode(opening.value).includes(keepalive))return false;
  vi.advanceTimersByTime(ms);
  // Then the chunks the elapsed interval wrote, until the heartbeat: one that never comes fails at the test's timeout.
  for(let text='';!text.includes(keepalive);){const chunk=await reader.read();if(chunk.done)return false;text+=decoder.decode(chunk.value);}
  return true;
 }
 finally{await reader.cancel().catch(()=>{});}
};
it.each([
 ['/a/<id>/events', async(actor:{credential:'session';userId:string;email:string;emailVerified:true})=>{const req=request('/a/beatdoc/events',{actor});return runWithRequest(req,()=>documentEvents(req,params('beatdoc')));}],
 ['/api/my/people/events', async(actor:{credential:'session';userId:string;email:string;emailVerified:true})=>{const req=request('/api/my/people/events',{actor});return runWithRequest(req,()=>peopleEvents(req));}],
])('%s sends a heartbeat frame within 25 seconds of silence',async(_name,open)=>{
 const owner=await createUser({email:'mxmx_test_heartbeat@example.com'});
 await(await harness.db()).query("INSERT INTO artifacts(id,token_id,user_id,format,visibility,version) VALUES ('beatdoc','tok_beat',$1,'html','public',1) ON CONFLICT DO NOTHING",[owner.id]);
 vi.useFakeTimers({toFake:['setInterval','clearInterval']});
 const response=await open({credential:'session',userId:owner.id,email:owner.email,emailVerified:true});
 expect(response.status).toBe(200);
 expect(await heartbeatWithin(response,25_000)).toBe(true);
});
