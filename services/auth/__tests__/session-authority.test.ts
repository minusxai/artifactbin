import {createHash} from 'node:crypto';
import {serviceAuthHost} from './helpers';
import {describe,it,expect} from 'vitest';
import {HUMAN_SESSION_LIVE_PATH} from '@artifactbin/contracts/actor';
import {IDENTITY_CALL_PATH} from '@artifactbin/contracts/identity-module';
import {IDENTITY_INTROSPECT_PATH} from '@artifactbin/contracts/identity-service';
import {SERVICE_AUTH_HEADER} from '@artifactbin/contracts/routes';
import type {ServiceAudience} from '@artifactbin/contracts/service-audiences';
import type {TokenReader, TokenRecord} from '@artifactbin/contracts/identity';
import {serviceTokenKey,signServiceToken} from '../src/identity/service-tokens';
import {humanSessionClient} from '@artifactbin/utils';
import {createAuthHost} from '../src/parts';

describe('split human session authority',()=>{
 const secret='test-service-secret';
 const host=(live=async(s:string,u:string)=>s==='session'&&u==='user')=>serviceAuthHost({env:{INTERNAL__SERVICE_SECRET:secret},sessions:{resolve:async()=>null,live},upstream:async()=>new Response('app')});
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

describe('identity introspection (contracts IDENTITY_INTROSPECT_PATH)',()=>{
 const secret='test-service-secret',origin='http://app.test',warehouseSecret='warehouse-introspection-secret';
 const sha256=(value:string)=>createHash('sha256').update(value).digest('hex');
 const WAREHOUSE:ServiceAudience={id:'warehouse',origin:'http://warehouse.test',introspectionSecretSha256:sha256(warehouseSecret)},CRM:ServiceAudience={id:'crm',origin:'http://crm.test',introspectionSecretSha256:null};
 const AUDIENCES=JSON.stringify([{id:WAREHOUSE.id,origin:WAREHOUSE.origin,introspection_secret_sha256:WAREHOUSE.introspectionSecretSha256},{id:CRM.id,origin:CRM.origin}]);
 const records:Record<string,TokenRecord>={
  mx_live:{id:'tok_live',userId:'usr_1',audience:`${origin}/api`,scope:'artifacts',expiresAt:'2030-01-01T00:00:00.000Z'},
  mx_plain:{id:'tok_plain',userId:'usr_1'},
  mx_elsewhere:{id:'tok_elsewhere',userId:'usr_1',audience:'http://other.test/api',scope:'artifacts'},
  mx_refused:{id:'tok_refused',userId:'usr_refused'},
  mx_warehouse:{id:'tok_warehouse',userId:'usr_1',audience:WAREHOUSE.origin},
  mx_crm:{id:'tok_crm',userId:'usr_1',audience:CRM.origin},
 };
 const relayed:string[]=[];
 /** The parents the fake views hold (`kind:id` → owner) and the ones no longer live. */
 const parents:Record<string,string>={'token:tok_plain':'usr_1','session:ses_1':'usr_1','token:tok_refused':'usr_refused'},dead=new Set<string>();
 const key=serviceTokenKey('test');
 const host=(tokens:TokenReader={byToken:async presented=>records[presented]??null},audiences=AUDIENCES)=>createAuthHost({env:{INTERNAL__SERVICE_SECRET:secret,APP__PUBLIC_BASE_URL:origin,IDENTITY__SERVICE_AUDIENCES:audiences},cookieSecret:'test',tokens,
  // The one active rule, read where every reader reads it (the identity `users` view), not a host-supplied callback.
  identityDb:{query:async<T>(sql:string,params?:unknown[])=>{
   // An exchanged token's parent, read where a service re-checks it: the `tokens` and `sessions` views' `live`.
   if(/FROM identity\.tokens WHERE id=\$1 AND user_id=\$2$/.test(sql)||/FROM identity\.sessions WHERE id=\$1 AND "userId"=\$2$/.test(sql))
    return {rows:(parents[`${sql.includes('sessions')?'session':'token'}:${params?.[0]}`]===params?.[1]?[{live:!dead.has(String(params?.[0]))}]:[]) as T[]};
   if(!/FROM identity\.users WHERE id=\$1/.test(sql))throw Error(`unexpected ${sql}`);return {rows:[{active:params?.[0]!=='usr_refused'}] as T[]};}},
  sessions:{resolve:async()=>null},
  upstream:async request=>{relayed.push(new URL(request.url).pathname);return Response.json({error:'not_found'},{status:404});}});
 const call=(app:ReturnType<typeof host>,path:string,body:unknown,auth=secret)=>app.request(origin+path,{method:'POST',headers:{[SERVICE_AUTH_HEADER]:auth,'content-type':'application/json'},body:JSON.stringify(body)});
 const introspect=async(app:ReturnType<typeof host>,token:string,auth=secret)=>(await call(app,IDENTITY_INTROSPECT_PATH,{token},auth)).json();
 const exchanged=(parent:{kind:'token'|'session';id:string}={kind:'session',id:'ses_1'},service=WAREHOUSE,userId='usr_1',at=Date.now())=>signServiceToken(key,service,{userId,parent},at).token;
 // The installation's own secret works only inside: a request through a front (which sets X-Forwarded-For) meets the
 // identity calls and session liveness as an unknown path. A configured service's own secret, and introspection, are
 // the same behind a front as inside.
 it('refuses the installation secret on the identity calls and session liveness from behind a front, as an unknown path',async()=>{
  const app=host();
  const ask=async(path:string,body:unknown,auth:string,via?:string)=>{
   const response=await app.request(origin+path,{method:'POST',headers:{[SERVICE_AUTH_HEADER]:auth,'content-type':'application/json',...(via===undefined?{}:{'x-forwarded-for':via})},body:JSON.stringify(body)});
   return {status:response.status,body:await response.text()};
  };
  const unknown=await ask('/api/internal/identity/no-such-route',{},secret,'203.0.113.9');
  expect(unknown.status).toBe(404);
  const calls:Array<[string,unknown,{status:number}]>=[[IDENTITY_CALL_PATH,{method:'findToken',input:{hash:'x'}},{status:503}],[HUMAN_SESSION_LIVE_PATH,{sessionId:'s',userId:'u'},{status:200}]];
  for(const [path,body,inside] of calls){
   for(const via of ['203.0.113.9','10.0.0.2, 203.0.113.9',''])expect(await ask(path,body,secret,via),`${path} via ${JSON.stringify(via)}`).toEqual(unknown);
   expect(await ask(path,body,'wrong','203.0.113.9'),`${path}: a wrong secret learns nothing more`).toEqual(unknown);
   expect(await ask(path,body,secret),`${path} inside`).toMatchObject(inside);
  }
  for(const [token,auth] of [['mx_live',secret],['mx_warehouse',warehouseSecret]]){
   expect(JSON.parse((await ask(IDENTITY_INTROSPECT_PATH,{token},auth,'203.0.113.9')).body),`${token} introspected behind a front`).toMatchObject({active:true});
  }
 });
 it('refuses introspection without the service secret or a configured service\'s own, before reading anything',async()=>{
  const app=host();relayed.length=0;
  expect((await call(app,IDENTITY_INTROSPECT_PATH,{token:'mx_live'},'wrong')).status).toBe(401);
  expect((await call(app,IDENTITY_INTROSPECT_PATH,{token:'mx_live'},sha256(warehouseSecret))).status).toBe(401);
  expect((await app.request(origin+IDENTITY_INTROSPECT_PATH,{method:'POST',body:'{}'})).status).toBe(401);
  expect((await app.request(origin+IDENTITY_INTROSPECT_PATH)).status).toBe(405);
  // A service's secret opens introspection only: never the identity module's calls.
  expect((await call(app,'/api/internal/identity/call',{method:'findToken',input:{hash:'x'}},warehouseSecret)).status).toBe(401);
  expect(relayed).toEqual([]);
 });
 it('with the installation\'s secret: user, token id, scopes, audience and expiry of an access token for this API or a configured service, or inactive',async()=>{
  const app=host();
  expect(await introspect(app,'mx_live')).toEqual({active:true,principal_kind:'user',user_id:'usr_1',token_id:'tok_live',scopes:['artifacts'],audience:`${origin}/api`,expires_at:'2030-01-01T00:00:00.000Z',parent:null,group_id:null,group_role:null,issued_by:null});
  expect(await introspect(app,'mx_plain')).toEqual({active:true,principal_kind:'user',user_id:'usr_1',token_id:'tok_plain',scopes:[],audience:null,expires_at:null,parent:null,group_id:null,group_role:null,issued_by:null});
  expect(await introspect(app,'mx_warehouse')).toEqual({active:true,principal_kind:'user',user_id:'usr_1',token_id:'tok_warehouse',scopes:[],audience:WAREHOUSE.origin,expires_at:null,parent:null,group_id:null,group_role:null,issued_by:null});
  for(const token of ['mx_unknown','mx_elsewhere','mx_refused'])expect(await introspect(app,token),token).toEqual({active:false});
  // A service no longer configured: its tokens are nobody's.
  expect(await introspect(host(undefined,'[]'),'mx_warehouse')).toEqual({active:false});
  expect((await call(app,IDENTITY_INTROSPECT_PATH,{})).status).toBe(400);
  expect((await call(host({byToken:async()=>{throw Error('down');}}),IDENTITY_INTROSPECT_PATH,{token:'mx_live'})).status).toBe(503);
 });
 it('every active answer names its principal: a person, user_id never null, no group; the inactive answer carries nothing more',async()=>{
  const app=host();dead.clear();
  for(const [token,auth] of [['mx_live',secret],['mx_plain',secret],['mx_warehouse',warehouseSecret],[exchanged(),warehouseSecret],[exchanged({kind:'token',id:'tok_plain'}),secret]] as const){
   const body=await introspect(app,token,auth);
   expect(body,token).toMatchObject({active:true,principal_kind:'user',user_id:'usr_1',group_id:null,group_role:null,issued_by:null});
   expect(Object.keys(body).sort(),token).toEqual(['active','audience','expires_at','group_id','group_role','issued_by','parent','principal_kind','scopes','token_id','user_id']);
  }
  for(const token of ['mx_unknown','mx_refused'])expect(await introspect(app,token),token).toEqual({active:false});
 });
 it('with a service\'s own secret: only tokens bound to that service\'s origin, every other one inactive',async()=>{
  const app=host();
  expect(await introspect(app,'mx_warehouse',warehouseSecret)).toMatchObject({active:true,user_id:'usr_1',audience:WAREHOUSE.origin});
  for(const token of ['mx_live','mx_plain','mx_crm'])expect(await introspect(app,token,warehouseSecret),token).toEqual({active:false});
  expect(await introspect(app,exchanged(),warehouseSecret)).toMatchObject({active:true,audience:WAREHOUSE.origin});
  expect(await introspect(app,exchanged(undefined,CRM),warehouseSecret)).toEqual({active:false});
 });
 it('an exchanged token: the person, the audience and the parent credential, answered only while that parent is live',async()=>{
  const app=host(),now=Date.now();dead.clear();
  expect(await introspect(app,exchanged({kind:'session',id:'ses_1'}),warehouseSecret)).toEqual({active:true,principal_kind:'user',user_id:'usr_1',token_id:expect.stringMatching(/^vtk_/),scopes:[],
   audience:WAREHOUSE.origin,expires_at:new Date((Math.floor(now/1000)+300)*1000).toISOString(),parent:{kind:'session',id:'ses_1'},group_id:null,group_role:null,issued_by:null});
  expect(await introspect(app,exchanged({kind:'token',id:'tok_plain'}))).toMatchObject({active:true,parent:{kind:'token',id:'tok_plain'}});
  // Another service's secret, another user's parent, an unknown parent, an inactive account: inactive.
  expect(await introspect(app,exchanged({kind:'session',id:'ses_1'},CRM),warehouseSecret)).toEqual({active:false});
  expect(await introspect(app,exchanged({kind:'session',id:'ses_1'},WAREHOUSE,'usr_2'))).toEqual({active:false});
  expect(await introspect(app,exchanged({kind:'token',id:'tok_unknown'}))).toEqual({active:false});
  expect(await introspect(app,exchanged({kind:'session',id:'tok_plain'}))).toEqual({active:false});
  expect(await introspect(app,exchanged({kind:'token',id:'tok_refused'},WAREHOUSE,'usr_refused'))).toEqual({active:false});
  // Its life is five minutes; past it, refused.
  expect(await introspect(app,exchanged({kind:'token',id:'tok_plain'},WAREHOUSE,'usr_1',now-120_000))).toMatchObject({active:true});
  expect(await introspect(app,exchanged({kind:'token',id:'tok_plain'},WAREHOUSE,'usr_1',now-301_000))).toEqual({active:false});
  // The parent ends (revoked, signed out): so does every token exchanged for it, on the next check.
  const bySession=exchanged({kind:'session',id:'ses_1'}),byToken=exchanged({kind:'token',id:'tok_plain'});
  dead.add('ses_1');dead.add('tok_plain');
  expect(await introspect(app,bySession)).toEqual({active:false});
  expect(await introspect(app,byToken)).toEqual({active:false});
  dead.clear();
 });
 it('an exchanged token is refused signed under another key, altered, or for an audience no longer configured',async()=>{
  const app=host();dead.clear();
  expect(await introspect(app,signServiceToken(serviceTokenKey('another host'),WAREHOUSE,{userId:'usr_1',parent:{kind:'session',id:'ses_1'}}).token)).toEqual({active:false});
  // Another user's id in the claims, the signature kept: not that user's token.
  const [body,mac]=exchanged().slice(4).split('.');
  const claims=JSON.parse(Buffer.from(body!,'base64url').toString());
  const altered=`vwt_${Buffer.from(JSON.stringify({...claims,sub:'usr_2'})).toString('base64url')}.${mac}`;
  expect(await introspect(app,altered)).toEqual({active:false});
  const longer=`vwt_${Buffer.from(JSON.stringify({...claims,exp:claims.exp+3600})).toString('base64url')}.${mac}`;
  expect(await introspect(app,longer)).toEqual({active:false});
  expect(await introspect(host(undefined,JSON.stringify([{id:CRM.id,origin:CRM.origin}])),exchanged())).toEqual({active:false});
 });
 it('serves no other identity route: account, session, token and group facts are the shared identity views',async()=>{
  const app=host();relayed.length=0;
  for(const path of ['/api/internal/identity/resolve','/api/internal/identity/groups','/api/internal/events/publish']){
   expect((await call(app,path,{user_id:'usr_1'})).status,path).toBe(404);
  }
 });
});

describe('the identity tables\' one-time move (identityMoveStatements)',()=>{
 it('moves every identity table, hands it and the read schema to the identity role, and drops the former views',async()=>{
  const {identityMoveStatements}=await import('../src/identity-store');
  const statements=identityMoveStatements({auth:'afbin_auth',app:'afbin_app',read:'identity',owner:'afbin_auth_role'});
  for(const table of ['users','tokens','handle_reservations','groups','group_members','group_invitations','group_hierarchy','group_mail_outbox']){
   expect(statements).toContain(`ALTER TABLE IF EXISTS afbin_app.${table} SET SCHEMA afbin_auth`);
   expect(statements).toContain(`ALTER TABLE IF EXISTS afbin_auth.${table} OWNER TO afbin_auth_role`);
  }
  expect(statements).toContain('ALTER SCHEMA identity OWNER TO afbin_auth_role');
  expect(statements.at(-1)).toBe('DROP VIEW IF EXISTS identity.groups, identity.memberships, identity.hierarchy, identity.users, identity.sessions, identity.tokens CASCADE');
  expect(()=>identityMoveStatements({auth:'a',app:'b; drop',read:'identity',owner:'x'})).toThrow(/plain/);
 });
});
