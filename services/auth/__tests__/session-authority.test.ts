import {describe,it,expect} from 'vitest';
import {EVENTS_PUBLISH_MAX_BATCH,EVENTS_PUBLISH_PATH,HUMAN_SESSION_LIVE_PATH,IDENTITY_PATHS,SERVICE_AUTH_HEADER,type EventsService,type TokenReader,type TokenRecord} from '@artifactbin/contracts';
import {humanSessionClient} from '@artifactbin/utils';
import {createAuthHost} from '../src/parts';

describe('split human session authority',()=>{
 const secret='test-service-secret';
 const host=(live=async(s:string,u:string)=>s==='session'&&u==='user')=>createAuthHost({env:{INTERNAL__SERVICE_SECRET:secret},cookieSecret:'test',tokens:{byToken:async()=>null},sessions:{resolve:async()=>null,live},upstream:async()=>new Response('app')});
 it('admits only authenticated bounded POSTs and follows owner liveness',async()=>{
  let active=true;const app=host(async(s,u)=>active&&s==='session'&&u==='user');
  const call=(body:unknown,key=secret)=>app.request(HUMAN_SESSION_LIVE_PATH,{method:'POST',headers:{[SERVICE_AUTH_HEADER]:key,'content-type':'application/json'},body:JSON.stringify(body)});
  expect((await call({sessionId:'session',userId:'user'},'wrong')).status).toBe(401);
  expect((await call({sessionId:'session',userId:'user'})).headers.get('cache-control')).toBe('no-store');
  expect(await(await call({sessionId:'session',userId:'user'})).json()).toEqual({live:true});
  expect(await(await call({sessionId:'session',userId:'other'})).json()).toEqual({live:false});
  active=false;expect(await(await call({sessionId:'session',userId:'user'})).json()).toEqual({live:false});
  expect((await call({sessionId:'x'.repeat(9000),userId:'user'})).status).toBe(413);
  expect((await call(null)).status).toBe(400);
  expect((await app.request(HUMAN_SESSION_LIVE_PATH)).status).toBe(405);
 });
 it('client sends identifiers in body, fails closed on unavailable or malformed authority',async()=>{
  const app=host();let seen:Request|undefined;
  const client=humanSessionClient('http://authority',{serviceSecret:secret,fetch:async request=>{seen=request;return app.fetch(request);}});
  expect(await client.live('session','user')).toBe(true);expect(seen!.url).toBe(`http://authority${HUMAN_SESSION_LIVE_PATH}`);
  expect(seen!.headers.get(SERVICE_AUTH_HEADER)).toBe(secret);
  for(const response of [Response.json({live:'true'}),new Response('',{status:503})]){
   expect(await humanSessionClient('http://authority',{serviceSecret:secret,fetch:async()=>response}).live('session','user')).toBe(false);
  }
  expect(await humanSessionClient('http://authority',{serviceSecret:secret,fetch:async()=>{throw Error('down');}}).live('session','user')).toBe(false);
  expect(()=>humanSessionClient('http://authority',{serviceSecret:''})).toThrow();
 });
});

describe('identity endpoints (contracts IDENTITY_PATHS)',()=>{
 const secret='test-service-secret',origin='http://app.test';
 const records:Record<string,TokenRecord>={
  mx_live:{id:'tok_live',userId:'usr_1',audience:`${origin}/api`,scope:'artifacts minusx'},
  mx_plain:{id:'tok_plain',userId:'usr_1'},
  mx_elsewhere:{id:'tok_elsewhere',userId:'usr_1',audience:'http://other.test/api',scope:'artifacts minusx'},
  mx_refused:{id:'tok_refused',userId:'usr_refused'},
 };
 const byId=new Map(Object.values(records).map(record=>[record.id,record]));
 const relayed:Array<{path:string;body:unknown;secret:string|null}>=[];
 const host=(tokens:TokenReader={byToken:async presented=>records[presented]??null,byId:async id=>byId.get(id)??null})=>createAuthHost({env:{INTERNAL__SERVICE_SECRET:secret,APP__PUBLIC_BASE_URL:origin},cookieSecret:'test',tokens,
  admitIdentity:async identity=>identity.userId!=='usr_refused',sessions:{resolve:async()=>null},
  upstream:async request=>{const body=await request.json();relayed.push({path:new URL(request.url).pathname,body,secret:request.headers.get(SERVICE_AUTH_HEADER)});
   return Response.json(new URL(request.url).pathname===IDENTITY_PATHS.groups?{groups:[]}:{active:true,session_live:null,token_active:null,group:null});}});
 const call=(app:ReturnType<typeof host>,path:string,body:unknown,key=secret)=>app.request(origin+path,{method:'POST',headers:{[SERVICE_AUTH_HEADER]:key,'content-type':'application/json'},body:JSON.stringify(body)});
 it('refuses every identity call without the service secret, before relaying anything',async()=>{
  const app=host();relayed.length=0;
  for(const path of Object.values(IDENTITY_PATHS)){
   expect((await call(app,path,{user_id:'usr_1',token:'mx_live'},'wrong')).status,path).toBe(401);
   expect((await app.request(origin+path,{method:'POST',body:'{}'})).status,path).toBe(401);
   expect((await app.request(origin+path)).status,path).toBe(405);
  }
  expect(relayed).toEqual([]);
 });
 it('introspects through the bearer read: user, token id and scopes, or inactive',async()=>{
  const app=host();
  expect(await(await call(app,IDENTITY_PATHS.introspect,{token:'mx_live'})).json()).toEqual({active:true,user_id:'usr_1',token_id:'tok_live',scopes:['artifacts','minusx']});
  expect(await(await call(app,IDENTITY_PATHS.introspect,{token:'mx_plain'})).json()).toEqual({active:true,user_id:'usr_1',token_id:'tok_plain',scopes:[]});
  for(const token of ['mx_unknown','mx_elsewhere','mx_refused'])expect(await(await call(app,IDENTITY_PATHS.introspect,{token})).json(),token).toEqual({active:false});
  expect((await call(app,IDENTITY_PATHS.introspect,{})).status).toBe(400);
  expect((await call(host({byToken:async()=>{throw Error('down');}}),IDENTITY_PATHS.introspect,{token:'mx_live'})).status).toBe(503);
 });
 it('relays resolve to the application and adds token_active from the same bearer read, by id',async()=>{
  const app=host();relayed.length=0;
  expect(await(await call(app,IDENTITY_PATHS.resolve,{user_id:'usr_1',group_id:'grp_1'})).json()).toMatchObject({active:true,token_active:null});
  expect(relayed.at(-1)).toEqual({path:IDENTITY_PATHS.resolve,body:{user_id:'usr_1',group_id:'grp_1'},secret});
  expect(await(await call(app,IDENTITY_PATHS.resolve,{user_id:'usr_1',token_id:'tok_live'})).json()).toMatchObject({token_active:true});
  // The application never sees the token id; the auth host answers it.
  expect(relayed.at(-1)?.body).toEqual({user_id:'usr_1'});
  for(const id of ['tok_gone','tok_elsewhere','tok_refused'])expect((await(await call(app,IDENTITY_PATHS.resolve,{token_id:id})).json()).token_active,id).toBe(false);
  expect((await(await call(host({byToken:async()=>null}),IDENTITY_PATHS.resolve,{token_id:'tok_live'})).json()).token_active).toBe(false);
  expect((await call(app,IDENTITY_PATHS.resolve,{token_id:7})).status).toBe(400);
  expect(await(await call(app,IDENTITY_PATHS.groups,{user_id:'usr_1'})).json()).toEqual({groups:[]});
  expect(relayed.at(-1)).toEqual({path:IDENTITY_PATHS.groups,body:{user_id:'usr_1'},secret});
 });
});

describe('MinusX job events (contracts EVENTS_PUBLISH_PATH)',()=>{
 const secret='test-service-secret',origin='http://app.test';
 const job=(id:string,verb='run_started')=>({id,at:'2026-11-11T00:00:00.000Z',source:'minusx',subject_kind:'service',subject_id:'minusx',verb,object_kind:'job',object_id:'sch_1',payload:{schedule_id:'sch_1',occurrence_id:'occ_1',group_id:'grp_finance'}});
 const host=(events?:EventsService)=>createAuthHost({env:{INTERNAL__SERVICE_SECRET:secret,APP__PUBLIC_BASE_URL:origin},cookieSecret:'test',tokens:{byToken:async()=>null},sessions:{resolve:async()=>null},
  ...(events?{events}:{}),upstream:async()=>new Response('the application must not be reached',{status:500})});
 const post=(app:ReturnType<typeof host>,body:unknown,key=secret)=>app.request(origin+EVENTS_PUBLISH_PATH,{method:'POST',headers:{[SERVICE_AUTH_HEADER]:key,'content-type':'application/json'},body:typeof body==='string'?body:JSON.stringify(body)});
 it('stores a batch of job events durably, answering only once stored',async()=>{
  const stored:unknown[]=[];
  const app=host({emit:async()=>{throw Error('emit is best effort; a publish never uses it');},publish:async batch=>{stored.push(...batch);}});
  const response=await post(app,[job('e1'),job('e2','run_succeeded')]);
  expect(response.status).toBe(200);
  expect(response.headers.get('cache-control')).toBe('no-store');
  expect(await response.json()).toEqual({accepted:2});
  expect(stored).toEqual([job('e1'),job('e2','run_succeeded')]);
 });
 it('refuses without the secret, and anything but a POST of MinusX job envelopes, storing nothing',async()=>{
  const stored:unknown[]=[];
  const app=host({emit:async()=>{},publish:async batch=>{stored.push(...batch);}});
  expect((await post(app,[job('e1')],'wrong')).status).toBe(401);
  expect((await app.request(origin+EVENTS_PUBLISH_PATH,{method:'POST',body:JSON.stringify([job('e1')])})).status).toBe(401);
  expect((await app.request(origin+EVENTS_PUBLISH_PATH)).status).toBe(405);
  for(const bad of [
   {...job('a'),source:'app'},{...job('b'),object_kind:'artifact',verb:'annotated'},{...job('c'),verb:'run_exploded'},
   {...job('d'),payload:{schedule_id:'sch_1',occurrence_id:'occ_1'}},{...job('e'),at:'not a time'},{...job('f'),subject_kind:'user'},
  ])expect((await post(app,[job('ok'),bad])).status,JSON.stringify(bad)).toBe(400);
  expect((await post(app,{events:[job('g')]})).status).toBe(400);
  expect((await post(app,'not json')).status).toBe(400);
  expect((await post(app,Array.from({length:EVENTS_PUBLISH_MAX_BATCH+1},(_,i)=>job(`n${i}`)))).status).toBe(400);
  expect((await post(app,'x'.repeat((1<<20)+1))).status).toBe(413);
  expect(stored).toEqual([]);
 });
 it('answers 503 when nothing stores it, so the publisher keeps the batch',async()=>{
  expect((await post(host(),[job('e1')])).status).toBe(503);
  expect((await post(host({emit:async()=>{}}),[job('e1')])).status).toBe(503);
  expect((await post(host({emit:async()=>{},publish:async()=>{throw Error('database down');}}),[job('e1')])).status).toBe(503);
 });
});
