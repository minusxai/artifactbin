/**
 * CONNECT AS THE VIEWER (contracts viewer-connections), end to end through real handlers: the author publishes a page
 * function declaring `secrets = {FIN: 'viewer'}` and binds FIN, server-side, to `{service, params}`; a viewer's `/fn`
 * call runs in the real resolver runner, whose `caps.db('FIN')` makes the app ask the identity module for a viewer
 * token for THAT viewer at the service's audience, call the service's session endpoint with the bound params, and hand
 * the runner's postgres.js the returned endpoint and credential.
 *
 * The data service is a real HTTP server here that verifies every bearer as introspection does (the identity
 * module's viewer-token check: signature, audience, 60 s life) and decides with the app's own group rows: a session
 * for a direct member of `params.group`, 403 for anyone else, 422 for an unknown `params.book`. Its endpoint is a
 * loopback Postgres wire listener in front of a real PGlite that admits only a session credential it issued, for
 * exactly the user and book it was issued for, and records every login.
 */
// harness-exempt: reset the PGlite built here is the stand-in warehouse behind the service's endpoint, never the app database
import {randomBytes} from 'node:crypto';
import net from 'node:net';
import {Hono} from 'hono';
import {afterAll,beforeAll,describe,expect,it,vi} from 'vitest';
import {PGlite} from '@electric-sql/pglite';
import {withHttpServer} from '@artifactbin/test-support/net';
import {createRunner} from '@artifactbin/runner/local';
import {createDatabaseTunnels} from '@artifactbin/runner/database-tunnel';
import {verifyViewerToken,viewerTokenKey,type ViewerClaims} from '@artifactbin/auth/identity/service-tokens';
import type {RunnerJson,ViewerSession} from '@artifactbin/contracts';
import {mountRoutes} from '../server/api';
import {artifactState,getArtifactById} from '@/lib/artifacts';
import {createGroup} from '@/lib/groups';
import {getHtmlBackendVersion} from '@/lib/html-backends';
import {readPinnedBackendSecret} from '@/lib/html-backend-secrets';
import {viewerConnection,ViewerRefusal} from '@/lib/data-services';
import {createFunctionScheduler,functionSchedulesOf} from '@/lib/function-schedules';
import {localPageBackendCapability} from '@/lib/page-operations';
import {resolverPorts} from '@/lib/page-doors';
import {AUTH_SECRET,getDb,serviceAudiences,setServices} from '@/lib/platform';
import {overrideConfig} from '@/lib/platform/config';
import {admitGroupMember,mintAccountToken,useAppHarness} from './harness';

const harness=useAppHarness();
const app=new Hono();
mountRoutes(app);

const BOOK='finance';
interface Seen {path:string;url:string;token:string;body:string;status?:number;claims?:ViewerClaims|null}
interface Session {user:string;database:string}
/** The TLS mode the fake service names in each session. */
const sessionTls:{mode:string|undefined}={mode:'disable'};
/** What the service answers when it is "down" (status) or normal (null); `denied`: users it refuses whatever their groups. */
const outage:{status:number|null}={status:null};
const denied=new Set<string>();

/** The service's endpoint: a Postgres wire listener over a real PGlite that admits only a credential the service issued. */
async function gateway(sessions:Map<string,Session>){
 const db=new PGlite();
 await db.exec("create table revenue(month text, net numeric(10,2)); insert into revenue values ('2026-10', 100.5), ('2026-11', 200)");
 const logins:{user:string;database:string;password:string;admitted:boolean}[]=[];
 let chain:Promise<unknown>=Promise.resolve();
 const serial=(work:()=>Promise<Uint8Array>)=>{const next=chain.then(work,work);chain=next.catch(()=>{});return next;};
 const failure=(code:string,message:string)=>{const fields=Buffer.from(`SFATAL\0C${code}\0M${message}\0\0`);const head=Buffer.alloc(5);head[0]=0x45;head.writeInt32BE(4+fields.length,1);return Buffer.concat([head,fields]);};
 const server=net.createServer(socket=>{
  socket.on('error',()=>{});
  let buffered=Buffer.alloc(0),stage:'startup'|'password'|'open'='startup',startup=Buffer.alloc(0),params:Record<string,string>={};
  let queue=Promise.resolve();
  socket.on('data',chunk=>{queue=queue.then(async()=>{
   buffered=Buffer.concat([buffered,chunk]);
   for(;;){
    if(stage==='startup'){
     if(buffered.length<8||buffered.length<buffered.readInt32BE(0))return;
     const length=buffered.readInt32BE(0);startup=buffered.subarray(0,length);buffered=buffered.subarray(length);
     const parts=startup.subarray(8).toString().split('\0');params={};
     for(let i=0;i+1<parts.length;i+=2)if(parts[i])params[parts[i]!]=parts[i+1]!;
     stage='password';socket.write(Buffer.from([0x52,0,0,0,8,0,0,0,3]));continue;
    }
    if(buffered.length<5||buffered.length<1+buffered.readInt32BE(1))return;
    const length=1+buffered.readInt32BE(1),message=buffered.subarray(0,length);buffered=buffered.subarray(length);
    if(stage==='password'){
     const password=message.subarray(5,length-1).toString(),issued=sessions.get(password);
     const admitted=!!issued&&issued.user===params.user&&issued.database===params.database;
     logins.push({user:params.user??'',database:params.database??'',password,admitted});
     if(!admitted){socket.end(failure('28P01',`password authentication failed for user "${params.user}"`));return;}
     stage='open';socket.write(Buffer.from(await serial(()=>db.execProtocolRaw(new Uint8Array(startup)))));continue;
    }
    socket.write(Buffer.from(await serial(()=>db.execProtocolRaw(new Uint8Array(message)))));
   }
  });});
 });
 await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
 return {port:(server.address() as net.AddressInfo).port,logins,async close(){server.close();await db.close();}};
}

/** The data service's session endpoint: the bearer verified as introspection does, then the app's own group rows decide. */
async function dataService(gatewayPort:()=>number,sessions:Map<string,Session>){
 const seen:Seen[]=[];
 const books=new Set([BOOK]);
 const server=await withHttpServer(async(req,res)=>{
  const chunks:Buffer[]=[];for await(const chunk of req)chunks.push(chunk as Buffer);
  const body=Buffer.concat(chunks),url=new URL(req.url??'/','http://service');
  const entry:Seen={path:url.pathname,url:req.url??'',token:/^Bearer (.+)$/.exec(req.headers.authorization??'')?.[1]??'',body:body.toString()};
  seen.push(entry);
  const reply=(status:number,value:unknown)=>{entry.status=status;res.writeHead(status,{'content-type':'application/json'});res.end(JSON.stringify(value));};
  if(url.pathname!=='/sessions'||req.method!=='POST')return reply(404,{error:'not_found'});
  if(outage.status)return reply(outage.status,{error:'down'});
  entry.claims=verifyViewerToken(viewerTokenKey(AUTH_SECRET),serviceAudiences(),entry.token);
  if(!entry.claims||entry.claims.aud!==server.base)return reply(401,{error:'unauthenticated'});
  const params=JSON.parse(body.toString()||'{}') as {book?:string;group?:string};
  if(!params.book||!books.has(params.book))return reply(422,{error:'unknown_book'});
  const member=(await (await getDb()).query('SELECT 1 FROM group_members WHERE group_id=$1 AND user_id=$2',[params.group??'',entry.claims.sub])).rows.length>0;
  if(!member||denied.has(entry.claims.sub))return reply(403,{error:'forbidden'});
  const password=randomBytes(18).toString('base64url');
  sessions.set(password,{user:entry.claims.sub,database:params.book});
  const session:ViewerSession={protocol:'postgres',host:'127.0.0.1',port:gatewayPort(),user:entry.claims.sub,password,database:params.book,tls:sessionTls.mode as ViewerSession['tls'],expires_at:new Date(Date.now()+15*60_000).toISOString()};
  return reply(201,sessionTls.mode===undefined?{...session,tls:undefined}:session);
 });
 return {seen,url:server.base,close:()=>server.close()};
}

const SOURCE=`export const secrets={FIN:'viewer'};
export default {
 async revenue(_input,_principal,caps){const db=await caps.db('FIN');try{return (await db.query('select month, net from revenue order by month')).rows;}finally{await db.end();}},
 async probe(_input,_principal,caps){try{const db=await caps.db('FIN');await db.end();return 'connected';}catch(e){return {code:e.code};}},
 async forged(input,_principal,caps){try{const db=await caps.db('FIN',{subject:input.as,user:input.as,group:input.group,params:{group:input.group},principal:{subject:input.as}});try{return (await db.query('select count(*)::int as n from revenue')).rows;}finally{await db.end();}}catch(e){return {code:e.code};}},
};`;
const HTML='<html><head><link rel="af-resolver" data-af-name="data" href="./data.ts"></head><body>Finance revenue</body></html>';
const headers=(token?:string)=>({'content-type':'application/json',...(token?{authorization:`Bearer ${token}`}:{})});

const sessions=new Map<string,Session>();
let gate:Awaited<ReturnType<typeof gateway>>,service:Awaited<ReturnType<typeof dataService>>,runner:Awaited<ReturnType<typeof createRunner>>;
const configured=()=>({IDENTITY__SERVICE_AUDIENCES:JSON.stringify([{id:'ledger-id',origin:service.url}]),DATA_SERVICES__TRUSTED:JSON.stringify([{id:'ledger',session_url:`${service.url}/sessions`,audience:'ledger-id'}])});
const logged:string[]=[];
beforeAll(async()=>{
 gate=await gateway(sessions);
 service=await dataService(()=>gate.port,sessions);
 overrideConfig({},configured());
 runner=await createRunner({db:await harness.db(),database:{allowLoopback:true},capabilities:(context,operation,args)=>localPageBackendCapability(context.request,operation,args,context.signal,resolverPorts)});
 setServices({runner});
 for(const level of ['log','info','warn','error','debug'] as const){const original=console[level].bind(console);vi.spyOn(console,level).mockImplementation((...args:unknown[])=>{logged.push(args.map(a=>a instanceof Error?`${a.message} ${a.stack}`:typeof a==='string'?a:JSON.stringify(a)).join(' '));original(...args);});}
},60_000);
afterAll(async()=>{vi.restoreAllMocks();await runner?.close();await service?.close();await gate?.close();});

async function publishPage(owner:{token:string},source=SOURCE){
 const created=await app.request('/api/artifacts',{method:'POST',headers:headers(owner.token),body:JSON.stringify({visibility:'unlisted',html:HTML,resolverSources:{data:source}})});
 const body=await created.json() as {id:string;error?:string;details?:string[]};
 return {status:created.status,body};
}
async function resolverOf(owner:{token:string},id:string){
 const listed=await (await app.request(`/api/my/artifacts/${id}/resolvers`,{headers:headers(owner.token)})).json() as {data_services:string[];resolvers:{backendId:string;version:string;secrets:Record<string,string>}[]};
 return {...listed.resolvers[0]!,data_services:listed.data_services};
}
const bind=async(owner:{token:string},id:string,binding:unknown)=>{
 const resolver=await resolverOf(owner,id);
 const response=await app.request(`/api/my/resolvers/${resolver.backendId}/${resolver.version}/secrets`,{method:'PUT',headers:headers(owner.token),body:JSON.stringify({name:'FIN',binding})});
 return {status:response.status,body:await response.json() as Record<string,unknown>,resolver};
};
const fn=async(id:string,name:string,token?:string,input:unknown={})=>{
 const response=await app.request(`/api/artifacts/${id}/fn/${name}`,{method:'POST',headers:headers(token),body:JSON.stringify(input)});
 const text=await response.text();
 return {status:response.status,text,body:JSON.parse(text) as unknown};
};
const calls=()=>service.seen.filter(entry=>entry.path==='/sessions');
const binding=(group:string)=>({service:'ledger',params:{book:BOOK,group}});

describe('a page bound to the ledger service, read by its viewers',()=>{
 const world=harness.shared(async()=>{
  const alice=await mintAccountToken('vc_alice'),bob=await mintAccountToken('vc_bob'),carol=await mintAccountToken('vc_carol'),dave=await mintAccountToken('vc_dave');
  const finance=await createGroup(alice.userId!,{handle:'vc_finance',name:'Finance'});
  await admitGroupMember(alice.userId!,finance.id,bob.userId!,'viewer');
  const page=await publishPage(alice);
  expect(page.status,JSON.stringify(page.body)).toBe(201);
  const listed=await resolverOf(alice,page.body.id);
  expect(listed.secrets).toEqual({FIN:'viewer'});
  expect(listed.data_services).toEqual(['ledger']);
  const bound=await bind(alice,page.body.id,binding(finance.id));
  expect(bound.status,JSON.stringify(bound.body)).toBe(200);
  return {alice,bob,carol,dave,finance,page:page.body.id,resolver:bound.resolver};
 });

 it('Bob (a Finance member): one session call with a viewer token for Bob at the service, and the runner logs in with the returned credential',async()=>{
  const {bob,alice,finance,page,resolver}=world();
  const before=calls().length,loginsBefore=gate.logins.length;
  const answer=await fn(page,'revenue',bob.token);
  expect(answer.status,answer.text).toBe(200);
  expect(answer.body).toEqual([{month:'2026-10',net:'100.50'},{month:'2026-11',net:'200.00'}]);
  const made=calls().slice(before);
  expect(made).toHaveLength(1);
  const call=made[0]!;
  expect(call.status).toBe(201);
  expect(call.claims).toMatchObject({sub:bob.userId,aud:service.url,svc:'ledger-id',act:{artifact_id:page,function:'revenue'}});
  expect(call.claims!.exp-call.claims!.iat).toBe(60);
  expect(Math.abs(call.claims!.iat-Date.now()/1000)).toBeLessThan(30);
  expect(JSON.parse(call.body)).toEqual({book:BOOK,group:finance.id});
  // The runner connected as Bob to the service's endpoint with the credential the service issued for this session.
  const logins=gate.logins.slice(loginsBefore);
  expect(logins).toEqual([{user:bob.userId,database:BOOK,password:expect.any(String),admitted:true}]);
  // Nothing stored holds a login: FIN's stored value is the author's binding alone.
  const backend=(await getHtmlBackendVersion(resolver.backendId,resolver.version))!;
  expect(JSON.parse(await readPinnedBackendSecret(backend,'FIN'))).toEqual(binding(finance.id));
  expect(made.some(entry=>entry.claims?.sub===alice.userId)).toBe(false);
 },45_000);

 it('Carol (not a member): the service refuses, the data call is a data-access error, the page still renders, and nothing runs as the owner',async()=>{
  const {carol,alice,page}=world();
  const before=service.seen.length,loginsBefore=gate.logins.length;
  expect((await fn(page,'probe',carol.token)).body).toEqual({code:'data_access_denied'});
  const uncaught=await fn(page,'revenue',carol.token);
  expect(uncaught.status).toBe(500);
  expect(uncaught.body).toMatchObject({error:'backend_failed',message:'data_access_denied: FIN'});
  const seen=service.seen.slice(before);
  expect(seen.length).toBe(2);
  for(const entry of seen)expect(entry).toMatchObject({path:'/sessions',status:403,claims:expect.objectContaining({sub:carol.userId})});
  // The author was asked as herself once, to bind (no function); no run ever asked as her.
  expect(service.seen.some(entry=>entry.claims?.sub===alice.userId&&entry.claims.act.function!==null)).toBe(false);
  expect(gate.logins.length).toBe(loginsBefore);
  const read=await app.request(`/api/artifacts/${page}`,{headers:headers(carol.token)});
  expect(read.status).toBe(200);
  expect(await read.text()).toContain('Finance revenue');
 },45_000);

 it('an anonymous reader of the unlisted page gets the data-access error and the service is never asked',async()=>{
  const {page}=world();
  const before=service.seen.length;
  expect((await fn(page,'probe')).body).toEqual({code:'data_access_denied'});
  expect(service.seen.length).toBe(before);
 },45_000);

 it('neither the request body nor resolver code can change the user or the params sent to the service',async()=>{
  const {bob,carol,alice,finance,page}=world();
  const before=calls().length;
  const forged={as:alice.userId,group:'grp_other',subject:alice.userId,user_id:alice.userId,group_id:'grp_other',principal:{tenant:page,subject:alice.userId,role:'owner'}};
  expect((await fn(page,'forged',carol.token,forged)).body).toEqual({code:'data_access_denied'});
  expect((await fn(page,'forged',bob.token,{...forged,as:carol.userId})).body).toEqual([{n:2}]);
  const sent=calls().slice(before).map(entry=>[entry.claims?.sub,(JSON.parse(entry.body) as {group:string}).group,entry.status]);
  expect(sent).toEqual([[carol.userId,finance.id,403],[bob.userId,finance.id,201]]);
 },45_000);

 it('a service that is down or answers garbage is data_unavailable, never someone else\'s data',async()=>{
  const {bob,page}=world();
  outage.status=503;
  try{expect((await fn(page,'probe',bob.token)).body).toEqual({code:'data_unavailable'});}finally{outage.status=null;}
  sessionTls.mode='prefer';
  try{expect((await fn(page,'probe',bob.token)).body).toEqual({code:'data_unavailable'});}finally{sessionTls.mode='disable';}
 },45_000);

 it('binding asks the service as the author: refused for what the author may not read, rejected params, a bad shape and an unknown service',async()=>{
  const {alice,dave,finance,page}=world();
  const daves=await publishPage(dave);
  expect(daves.status).toBe(201);
  const before=calls().length;
  expect(await bind(dave,daves.body.id,binding(finance.id))).toMatchObject({status:403,body:{error:'binding_forbidden'}});
  expect(calls().slice(before).map(entry=>[entry.claims?.sub,entry.claims?.act.artifact_id,entry.status])).toEqual([[dave.userId,daves.body.id,403]]);
  expect(await bind(alice,page,{service:'ledger',params:{book:'hidden',group:finance.id}})).toMatchObject({status:422,body:{error:'binding_rejected'}});
  expect(await bind(alice,page,{...binding(finance.id),user:'x'})).toMatchObject({status:400,body:{error:'invalid_binding'}});
  expect(await bind(alice,page,{service:'ledger',params:{blob:'x'.repeat(5000)}})).toMatchObject({status:400,body:{error:'invalid_binding'}});
  expect(await bind(alice,page,{service:'elsewhere',params:{}})).toMatchObject({status:400,body:{error:'data_service_not_configured'}});
  outage.status=500;
  try{expect(await bind(alice,page,binding(finance.id))).toMatchObject({status:503,body:{error:'data_service_unavailable'}});}finally{outage.status=null;}
 },45_000);

 it('republishing validates the stored binding again for the author',async()=>{
  const {alice,page}=world();
  const head=(await getArtifactById(page))!;
  const replace=(source:string)=>app.request(`/api/artifacts/${page}`,{method:'PUT',headers:headers(alice.token),body:JSON.stringify({html:HTML,resolverSources:{data:source},expectedVersion:head.version,expectedState:artifactState(head)})});
  // The service stops granting Alice (her access there was revoked): her next publish cannot keep the binding.
  denied.add(alice.userId!);
  try{
   const refused=await replace(SOURCE+'\n// v2');
   expect(refused.status).toBe(403);
   expect(await refused.json()).toMatchObject({error:'binding_forbidden'});
  }finally{denied.delete(alice.userId!);}
 },45_000);

 it('a viewer token is refused at this server\'s own API, and reaches no response, URL, log line or stored row',async()=>{
  const {bob,carol,page}=world();
  const texts=[(await fn(page,'revenue',bob.token)).text,(await fn(page,'revenue',carol.token)).text,(await fn(page,'probe',carol.token)).text,
   await (await app.request(`/api/artifacts/${page}`,{headers:headers(bob.token)})).text(),await (await app.request('/api/server')).text()];
  const tokens=service.seen.map(entry=>entry.token).filter(Boolean);
  expect(tokens.length).toBeGreaterThan(5);
  // As a bearer here it is no credential at all: the account read answers as for nobody.
  const asViewer=await app.request('/api/account/profile',{headers:headers(tokens.at(-1))});
  expect(asViewer.status).toBe(401);
  const db=await getDb();
  const tables=(await db.query<{name:string}>("SELECT format('%I.%I',table_schema,table_name) AS name FROM information_schema.tables WHERE table_type='BASE TABLE' AND table_schema NOT IN ('pg_catalog','information_schema')")).rows;
  const stored:string[]=[];
  for(const {name} of tables)stored.push(...(await db.query<{row:string}>(`SELECT t::text AS row FROM ${name} t`)).rows.map(r=>r.row));
  for(const token of tokens){
   const signature=token.split('.')[1]!;
   for(const text of [...texts,...service.seen.map(entry=>entry.url),...logged,...stored])expect(text.includes(signature)).toBe(false);
  }
 },45_000);
});

describe('the TLS mode a session names',()=>{
 const member=harness.shared(async()=>{
  const owner=await mintAccountToken('vc_tls_owner');
  const group=await createGroup(owner.userId!,{handle:'vc_tls_group',name:'TLS'});
  return {owner,group};
 });
 const connect=async()=>{const {owner,group}=member();return viewerConnection({subject:owner.userId!,binding:binding(group.id),pageId:'pg_tls'});};
 afterAll(()=>{sessionTls.mode='disable';});
 it('is honoured as named: verify-full stays verify-full even for a loopback gateway, disable stays disable',async()=>{
  sessionTls.mode='verify-full';
  expect(await connect()).toMatchObject({host:'127.0.0.1',tls:'verify-full'});
  sessionTls.mode='disable';
  expect(await connect()).toMatchObject({host:'127.0.0.1',tls:'disable'});
 });
 it("the runner's tunnel reaches the gateway the session names by the rule every resolver database meets",async()=>{
  // What a viewer run hands the runner is the session's endpoint and TLS mode, unchanged.
  const grant=async(mode:'disable'|'verify-full',allowLoopback:boolean,host?:string)=>{
   sessionTls.mode=mode;
   const value={...await connect(),...(host?{host}:{})};
   return createDatabaseTunnels({allowLoopback}).forRun({owner:'o',page:'p'},()=>{}).grant(value as unknown as RunnerJson);
  };
  // Development and tests (RUNNER__DATABASE_LOOPBACK=true): a loopback gateway, plaintext as the session says.
  expect(await grant('disable',true)).toMatchObject({host:'127.0.0.1',tls:'disable',grant:expect.any(String)});
  // Production: plaintext and loopback are refused; a gateway on a public name over TLS is admitted.
  await expect(grant('disable',false)).rejects.toThrow('tls_required');
  await expect(grant('verify-full',false)).rejects.toThrow('forbidden_address');
  expect(await grant('verify-full',false,'gateway.example.com')).toMatchObject({host:'gateway.example.com',tls:'verify-full'});
  // An endpoint on a private address is refused like any private database: the service must name a public one.
  await expect(grant('verify-full',false,'10.0.0.7')).rejects.toThrow('forbidden_address');
 });
 it('a session without a known TLS mode is unusable: data_unavailable, never a guessed mode',async()=>{
  for(const mode of [undefined,'require','prefer']){
   sessionTls.mode=mode;
   await expect(connect()).rejects.toEqual(new ViewerRefusal('data_unavailable'));
  }
 });
});

const republishPage=async(who:{token:string},id:string,source:string)=>{
 const head=(await getArtifactById(id))!;
 const response=await app.request(`/api/artifacts/${id}`,{method:'PUT',headers:headers(who.token),body:JSON.stringify({html:HTML,resolverSources:{data:source},expectedVersion:head.version,expectedState:artifactState(head)})});
 return {status:response.status,body:await response.json() as Record<string,unknown>};
};

describe('a GROUP-owned page bound to the ledger service',()=>{
 // Team owns the page. Alice edits Team and is a direct Finance member; Erin edits Team but is not in Finance; Bob and
 // Carol read Team's pages as viewers, and only Bob is in Finance.
 const world=harness.shared(async()=>{
  const alice=await mintAccountToken('gv_alice'),erin=await mintAccountToken('gv_erin'),bob=await mintAccountToken('gv_bob'),carol=await mintAccountToken('gv_carol');
  const finance=await createGroup(alice.userId!,{handle:'gv_finance',name:'Finance'});
  await admitGroupMember(alice.userId!,finance.id,bob.userId!,'viewer');
  const team=await createGroup(alice.userId!,{handle:'gv_team',name:'Team'});
  await admitGroupMember(alice.userId!,team.id,erin.userId!,'editor');
  for(const viewer of [bob,carol])await admitGroupMember(alice.userId!,team.id,viewer.userId!,'viewer');
  const created=await app.request('/api/artifacts',{method:'POST',headers:headers(alice.token),body:JSON.stringify({visibility:'private',html:HTML,resolverSources:{data:SOURCE},destination:{type:'group',id:team.id}})});
  const page=await created.json() as {id:string};
  expect(created.status,JSON.stringify(page)).toBe(201);
  expect((await getArtifactById(page.id))!.group_id).toBe(team.id);
  return {alice,erin,bob,carol,finance,team,page:page.id};
 });

 it('an editor of the owning group the service refuses cannot bind it; one it grants can',async()=>{
  const {alice,erin,finance,team,page}=world();
  expect(await bind(erin,page,binding(finance.id))).toMatchObject({status:403,body:{error:'binding_forbidden'}});
  const bound=await bind(alice,page,binding(finance.id));
  expect(bound.status,JSON.stringify(bound.body)).toBe(200);
  expect(bound.body).toEqual({names:['FIN']});
  // The page's other editor sees the binding is set, and what it binds (no credential is in it).
  const listed=await resolverOf(erin,page) as unknown as {set:string[];bindings:Record<string,unknown>;backendId:string;version:string};
  expect(listed.set).toEqual(['FIN']);
  expect(listed.bindings).toEqual({FIN:binding(finance.id)});
  // Stored against the owning group, not the person who bound it.
  const backend=(await getHtmlBackendVersion(listed.backendId,listed.version))!;
  expect(backend.ownerId).toBe(team.id);
 },45_000);

 it('each viewer reads as themselves: Bob (in Finance) gets rows under a token for Bob, Carol a data-access error',async()=>{
  const {alice,bob,carol,page}=world();
  const before=calls().length;
  const rows=await fn(page,'revenue',bob.token);
  expect(rows.status,rows.text).toBe(200);
  expect(rows.body).toEqual([{month:'2026-10',net:'100.50'},{month:'2026-11',net:'200.00'}]);
  expect((await fn(page,'probe',carol.token)).body).toEqual({code:'data_access_denied'});
  expect(calls().slice(before).map(entry=>[entry.claims?.sub,entry.status])).toEqual([[bob.userId,201],[carol.userId,403]]);
  expect(calls().some(entry=>entry.claims?.sub===alice.userId&&entry.claims.act.function!==null)).toBe(false);
 },45_000);

 it('a republish validates the stored binding again for the editor who publishes it',async()=>{
  const {alice,erin,bob,page}=world();
  const refused=await republishPage(erin,page,SOURCE+'\n// erin');
  expect(refused.status).toBe(403);
  expect(refused.body).toMatchObject({error:'binding_forbidden'});
  const accepted=await republishPage(alice,page,SOURCE+'\n// alice');
  expect(accepted.status,JSON.stringify(accepted.body)).toBe(200);
  // The binding survives the republish (same owning group, same backend identity).
  expect((await fn(page,'revenue',bob.token)).status).toBe(200);
 },45_000);

 it('ordinary credentials stay personal: a group page may neither be created with nor republished to a secret that is not a viewer binding',async()=>{
  const {alice,team,page}=world();
  const withKey=`export const secrets={FIN:'viewer',KEY:'api.example.com'};`+SOURCE.slice(SOURCE.indexOf('\n'));
  const created=await app.request('/api/artifacts',{method:'POST',headers:headers(alice.token),body:JSON.stringify({visibility:'private',html:HTML,resolverSources:{data:withKey},destination:{type:'group',id:team.id}})});
  expect(created.status).toBe(403);
  expect(await created.json()).toMatchObject({error:'backend_credentials_owner_required'});
  const republished=await republishPage(alice,page,withKey);
  expect(republished.status).toBe(403);
  expect(republished.body).toMatchObject({error:'backend_credentials_owner_required'});
 },45_000);
});

describe('a scheduled run never opens a viewer connection',()=>{
 it('the run is refused data_access_denied, recorded on the schedule, and the service is never asked',async()=>{
  const owner=await mintAccountToken('sv_owner');
  const finance=await createGroup(owner.userId!,{handle:'sv_finance',name:'Finance'});
  const scheduled=`export const secrets={FIN:'viewer'};export const schedule={pull:'every 15 minutes'};
export default {async pull(_input,_principal,caps){const db=await caps.db('FIN');try{return (await db.query('select count(*)::int as n from revenue')).rows;}finally{await db.end();}}};`;
  const page=await publishPage(owner,scheduled);
  expect(page.status,JSON.stringify(page.body)).toBe(201);
  expect((await bind(owner,page.body.id,binding(finance.id))).status).toBe(200);
  // The owner's own on-demand call of the same function reads the rows: the binding works.
  expect((await fn(page.body.id,'pull',owner.token)).body).toEqual([{n:2}]);
  const before=calls().length;
  const clock=Date.now()+60_000;
  await createFunctionScheduler({db:getDb,now:()=>clock,onError:error=>{throw error;}}).tick();
  const [state]=await functionSchedulesOf(page.body.id);
  expect(state).toMatchObject({name:'pull',lastStatus:'failed',failures:1});
  expect([state!.lastError,state!.lastMessage].join(' ')).toContain('data_access_denied');
  expect(calls().length).toBe(before);
 },45_000);
});

describe('no data service configured (the default)',()=>{
 beforeAll(()=>{overrideConfig({},{IDENTITY__SERVICE_AUDIENCES:undefined,DATA_SERVICES__TRUSTED:undefined});});
 afterAll(()=>{overrideConfig({},configured());});
 it('/api/server is the origin and aliases alone',async()=>{
  expect(Object.keys(await (await app.request('/api/server')).json() as object).sort()).toEqual(['aliases','origin']);
 });
 it('refuses a page declaring a viewer connection, and publishes a direct database connection as before',async()=>{
  const owner=await mintAccountToken('vc_standalone');
  const before=service.seen.length;
  const declared=await publishPage(owner);
  expect(declared.status).toBe(400);
  expect(declared.body).toMatchObject({error:'data_service_not_configured'});
  const direct=await publishPage(owner,`export const secrets={DB:'postgres'};export default {async rows(_i,_p,caps){const db=await caps.db('DB');await db.end();return 1;}};`);
  expect(direct.status,JSON.stringify(direct.body)).toBe(201);
  expect((await resolverOf(owner,direct.body.id)).secrets).toEqual({DB:'postgres'});
  expect((await resolverOf(owner,direct.body.id)).data_services).toEqual([]);
  expect(service.seen.length).toBe(before);
 },45_000);
});
