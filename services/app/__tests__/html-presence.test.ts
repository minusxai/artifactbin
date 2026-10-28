import {artifactChannel} from '@artifactbin/contracts';
import {sseStream} from './sse';
import {beforeEach,expect,it} from 'vitest';
import {POST} from '@/app/api/artifacts/[id]/presence/route';
import {GET} from '@/app/a/[id]/events/route';
import {request,useAppHarness} from './harness';
import {createUser} from '@/lib/accounts';
import {runWithRequest} from '@/lib/platform';
const harness=useAppHarness();let owner:Awaited<ReturnType<typeof createUser>>;
beforeEach(async()=>{owner=await createUser({email:'mxmx_test_presence@example.com'});await(await harness.db()).query("INSERT INTO artifacts(id,token_id,user_id,format,visibility,version) VALUES ('prespublic','tok_presence',$1,'html','public',1),('presprivate','tok_presence',$1,'html','private',1),('presMixed','tok_presence',$1,'html','public',1)",[owner.id]);});
const params=(id:string)=>({params:Promise.resolve({id})});
const session='00000000-0000-4000-8000-000000000001';
const actor=()=>({credential:'session' as const,userId:owner.id,email:owner.email,emailVerified:true});
const publish=(id:string,body:unknown,options:Parameters<typeof request>[1]={})=>{const req=request(`/api/artifacts/${id}/presence`,{method:'POST',origin:'same',json:body,...options});return runWithRequest(req,()=>POST(req,params(id)));};
it('enforces the original read ACL, source revision and exact platform origin before ephemeral publication',async()=>{
 expect((await publish('presprivate',{session,revision:'1'})).status).toBe(404);
 expect((await publish('prespublic',{session,revision:'2'})).status).toBe(400);
 expect((await publish('prespublic',{session,revision:'1'},{origin:'https://elsewhere.example'})).status).toBe(403);
 expect((await publish('presprivate',{session,revision:'1'},{actor:actor()})).status).toBe(200);
 const anonymous=request('/a/presprivate/events?anonymous=1',{actor:actor()});expect((await runWithRequest(anonymous,()=>GET(anonymous,params('presprivate')))).status).toBe(404);
 const req=request('/a/presprivate/events');expect((await runWithRequest(req,()=>GET(req,params('presprivate')))).status).toBe(404);
});
it('assigns distinct public identities per window without broadcasting session secrets or page-controlled names',async()=>{
 const a=await(await publish('prespublic',{session,revision:'1',label:'Spoofed',cursor:{nodeId:'p',x:.4,y:.5}},{actor:actor()})).json();
 const b=await(await publish('prespublic',{session:session.replace(/1$/,'2'),revision:'1'},{actor:actor()})).json();
 const again=await(await publish('prespublic',{session,revision:'1'},{actor:actor()})).json();
 expect(a.id).toMatch(/^[a-f0-9]{64}$/);expect(a.id).not.toBe(b.id);expect(again.id).toBe(a.id);expect(JSON.stringify(a)).not.toContain(session);
 const guest=await(await publish('prespublic',{session,revision:'1'})).json();expect(guest.id).not.toBe(a.id);
});
it('fans a native cursor out to simultaneous mixed-case page readers on their existing document streams',async()=>{
 const connections=await Promise.all([0,1,2].map(async()=>{const abort=new AbortController();const req=new Request(request('/a/presMixed/events'),{signal:abort.signal});const response=await runWithRequest(req,()=>GET(req,params('presMixed')));expect(response.status).toBe(200);return {abort,reader:response.body!.getReader()};}));
 const readPresence=async(reader:ReadableStreamDefaultReader<Uint8Array>)=>{while(true){const chunk=await reader.read();if(chunk.done)throw new Error('Stream closed before presence');const text=new TextDecoder().decode(chunk.value);if(text.includes('event: presence'))return text;}};
 try{
  await Promise.all(connections.map(({reader})=>readPresence(reader)));
  await publish('presMixed',{session,revision:'1',cursor:{nodeId:'p',x:.4,y:.5},visible:true});
  const received=await Promise.race([Promise.all(connections.map(({reader})=>readPresence(reader))),new Promise<never>((_resolve,reject)=>setTimeout(()=>reject(new Error('Presence fanout timed out')),2000))]);
  for(const text of received){expect(text).toContain('"nodeId":"p"');expect(text).not.toContain(session);}
 }finally{for(const {abort} of connections)abort.abort();await Promise.all(connections.map(({reader})=>reader.cancel()));}
});

it('rebinds presence to a published source revision without closing document updates, then closes on lost access',async()=>{
 const abort=new AbortController(),req=new Request(request('/a/presMixed/events'),{signal:abort.signal});
 const response=await runWithRequest(req,()=>GET(req,params('presMixed'))),stream=sseStream(response.body!);
 const db=await harness.db();
 try{
  expect((await stream.named('message'))[0]?.data.version).toBe(1);
  await db.query("UPDATE artifacts SET version=2 WHERE id='presMixed'");
  await db.query("SELECT pg_notify($1,'')",[artifactChannel('presMixed')]);
  expect((await stream.named('message'))[0]?.data.version).toBe(2);
  await stream.named('presence');
  expect((await publish('presMixed',{session,revision:'2',cursor:{nodeId:'p',x:.4,y:.5},visible:true})).status).toBe(200);
  const deadline=Date.now()+2000;let present=false;
  while(Date.now()<deadline&&!present)present=JSON.stringify(await stream.named('presence',1,deadline-Date.now())).includes('"nodeId":"p"');
  expect(present).toBe(true);
  await db.query("UPDATE artifacts SET visibility='private' WHERE id='presMixed'");
  await db.query("SELECT pg_notify($1,'')",[artifactChannel('presMixed')]);
  expect(await stream.named('message',1,200)).toEqual([]);
 }finally{abort.abort();stream.close();}
});

/** Harness-exempt: the addressed public origin and internal transport URL are the subject. */
const proxiedPresence=(headers:Record<string,string>)=>new Request('http://internal.test:3000/api/artifacts/prespublic/presence',{
 method:'POST',headers:{'content-type':'application/json',host:'internal.test:3000','x-forwarded-host':'app.example.test','x-forwarded-proto':'https',...headers},body:JSON.stringify({session,revision:'1',visible:true}),
});
it.each([
 ['a trusted HTTPS proxy', {origin:'https://app.example.test'},200],
 ['a normal same-origin browser behind the proxy', {origin:'https://app.example.test','sec-fetch-site':'same-origin'},200],
 ['missing Origin under the existing policy', {},200],
 ['an unrelated origin', {origin:'https://foreign.example.test'},403],
 ['a same-site sibling origin', {origin:'https://pages.example.test','sec-fetch-site':'same-site'},403],
 ['a different scheme', {origin:'http://app.example.test'},403],
 ['a different port', {origin:'https://app.example.test:8443'},403],
 ['a malformed Origin', {origin:'not an origin'},403],
 ['an opaque Origin', {origin:'null'},403],
 ['a foreign Origin cannot be repaired by same-origin fetch metadata', {origin:'https://foreign.example.test','sec-fetch-site':'same-origin'},403],
 ['a mismatched forwarded host', {origin:'https://app.example.test','x-forwarded-host':'foreign.example.test'},403],
 ['an appended spoofed host does not replace the proxy first host', {origin:'https://foreign.example.test','x-forwarded-host':'app.example.test, foreign.example.test'},403],
 ['malformed forwarded origin fails closed', {origin:'https://app.example.test','x-forwarded-proto':':'},403],
] satisfies Array<[string,Record<string,string>,number]>)('presence origin boundary admits or refuses %s',async(_name,headers,status)=>{
 const req=proxiedPresence(headers);const response=await runWithRequest(req,()=>POST(req,params('prespublic')));
 expect(response.status).toBe(status);if(status===200)expect(await response.json()).toMatchObject({id:expect.stringMatching(/^[a-f0-9]{64}$/)});
 else expect(await response.text()).toBe('forbidden');
});
