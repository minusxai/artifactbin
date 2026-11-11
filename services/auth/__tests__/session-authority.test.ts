import {createHash} from 'node:crypto';
import {describe,it,expect} from 'vitest';
import {HUMAN_SESSION_LIVE_PATH,IDENTITY_INTROSPECT_PATH,SERVICE_AUTH_HEADER,type ServiceAudience,type TokenReader,type TokenRecord} from '@artifactbin/contracts';
import {signViewerToken,viewerTokenKey} from '../src/identity/service-tokens';
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
 const key=viewerTokenKey('test');
 const host=(tokens:TokenReader={byToken:async presented=>records[presented]??null},audiences=AUDIENCES)=>createAuthHost({env:{INTERNAL__SERVICE_SECRET:secret,APP__PUBLIC_BASE_URL:origin,IDENTITY__SERVICE_AUDIENCES:audiences},cookieSecret:'test',tokens,
  // The one active rule, read where every reader reads it (the identity `users` view), not a host-supplied callback.
  identityDb:{query:async<T>(sql:string,params?:unknown[])=>{if(!/FROM identity\.users WHERE id=\$1/.test(sql))throw Error(`unexpected ${sql}`);return {rows:[{active:params?.[0]!=='usr_refused'}] as T[]};}},
  sessions:{resolve:async()=>null},
  upstream:async request=>{relayed.push(new URL(request.url).pathname);return Response.json({error:'not_found'},{status:404});}});
 const call=(app:ReturnType<typeof host>,path:string,body:unknown,auth=secret)=>app.request(origin+path,{method:'POST',headers:{[SERVICE_AUTH_HEADER]:auth,'content-type':'application/json'},body:JSON.stringify(body)});
 const introspect=async(app:ReturnType<typeof host>,token:string,auth=secret)=>(await call(app,IDENTITY_INTROSPECT_PATH,{token},auth)).json();
 const viewer=(service=WAREHOUSE,userId='usr_1',now=Date.now())=>signViewerToken(key,service,{userId,actor:{artifactId:'pg_1',function:'revenue'}},now).token;
 it('refuses introspection without the service secret or a configured service\'s own, before reading anything',async()=>{
  const app=host();relayed.length=0;
  expect((await call(app,IDENTITY_INTROSPECT_PATH,{token:'mx_live'},'wrong')).status).toBe(401);
  expect((await call(app,IDENTITY_INTROSPECT_PATH,{token:'mx_live'},sha256(warehouseSecret))).status).toBe(401);
  expect((await app.request(origin+IDENTITY_INTROSPECT_PATH,{method:'POST',body:'{}'})).status).toBe(401);
  expect((await app.request(origin+IDENTITY_INTROSPECT_PATH)).status).toBe(405);
  // A service's secret opens introspection only: never the identity module's calls.
  expect((await call(app,'/api/internal/identity/call',{method:'issueViewerToken',input:{userId:'usr_1',service:'warehouse'}},warehouseSecret)).status).toBe(401);
  expect(relayed).toEqual([]);
 });
 it('with the installation\'s secret: user, token id, scopes, audience and expiry of an access token for this API or a configured service, or inactive',async()=>{
  const app=host();
  expect(await introspect(app,'mx_live')).toEqual({active:true,user_id:'usr_1',token_id:'tok_live',scopes:['artifacts'],audience:`${origin}/api`,expires_at:'2030-01-01T00:00:00.000Z',actor:null});
  expect(await introspect(app,'mx_plain')).toEqual({active:true,user_id:'usr_1',token_id:'tok_plain',scopes:[],audience:null,expires_at:null,actor:null});
  expect(await introspect(app,'mx_warehouse')).toEqual({active:true,user_id:'usr_1',token_id:'tok_warehouse',scopes:[],audience:WAREHOUSE.origin,expires_at:null,actor:null});
  for(const token of ['mx_unknown','mx_elsewhere','mx_refused'])expect(await introspect(app,token),token).toEqual({active:false});
  // A service no longer configured: its tokens are nobody's.
  expect(await introspect(host(undefined,'[]'),'mx_warehouse')).toEqual({active:false});
  expect((await call(app,IDENTITY_INTROSPECT_PATH,{})).status).toBe(400);
  expect((await call(host({byToken:async()=>{throw Error('down');}}),IDENTITY_INTROSPECT_PATH,{token:'mx_live'})).status).toBe(503);
 });
 it('with a service\'s own secret: only tokens bound to that service\'s origin, every other one inactive',async()=>{
  const app=host();
  expect(await introspect(app,'mx_warehouse',warehouseSecret)).toMatchObject({active:true,user_id:'usr_1',audience:WAREHOUSE.origin});
  for(const token of ['mx_live','mx_plain','mx_crm'])expect(await introspect(app,token,warehouseSecret),token).toEqual({active:false});
  expect(await introspect(app,viewer(),warehouseSecret)).toMatchObject({active:true,audience:WAREHOUSE.origin});
  expect(await introspect(app,viewer(CRM),warehouseSecret)).toEqual({active:false});
 });
 it('a viewer token: the viewer, its audience and expiry, and the first-party actor with the page and function that asked',async()=>{
  const app=host(),now=Date.now();
  const answer=await introspect(app,viewer(WAREHOUSE,'usr_1',now)) as Record<string,unknown>;
  expect(answer).toEqual({active:true,user_id:'usr_1',token_id:expect.stringMatching(/^vtk_/),scopes:[],audience:WAREHOUSE.origin,
   expires_at:new Date((Math.floor(now/1000)+60)*1000).toISOString(),actor:{id:'artifactbin',artifact_id:'pg_1',function:'revenue'}});
 });
 it('a viewer token is refused once expired, for an inactive viewer, signed under another key, altered, or for an audience no longer configured',async()=>{
  const app=host();
  expect(await introspect(app,viewer(WAREHOUSE,'usr_1',Date.now()-61_000))).toEqual({active:false});
  expect(await introspect(app,viewer(WAREHOUSE,'usr_refused'))).toEqual({active:false});
  expect(await introspect(app,signViewerToken(viewerTokenKey('another host'),WAREHOUSE,{userId:'usr_1'}).token)).toEqual({active:false});
  // Another user's id in the claims, the signature kept: not that user's token.
  const [body,mac]=viewer().slice(4).split('.');
  const claims=JSON.parse(Buffer.from(body!,'base64url').toString());
  const altered=`vwt_${Buffer.from(JSON.stringify({...claims,sub:'usr_2'})).toString('base64url')}.${mac}`;
  expect(await introspect(app,altered)).toEqual({active:false});
  const longer=`vwt_${Buffer.from(JSON.stringify({...claims,exp:claims.exp+3600})).toString('base64url')}.${mac}`;
  expect(await introspect(app,longer)).toEqual({active:false});
  expect(await introspect(host(undefined,JSON.stringify([{id:CRM.id,origin:CRM.origin}])),viewer())).toEqual({active:false});
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
