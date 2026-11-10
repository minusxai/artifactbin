/**
 * PAGE DATA OVER A GOVERNED MINUSX CONNECTION (combined mode; contract §3, §4.2, §8), end to end through real
 * handlers: the author publishes a page function declaring `secrets = {FIN: 'minusx'}` and binds FIN, server-side,
 * to `{connection_id, group_id}`; a viewer's `/fn` call runs in the real resolver runner, whose `caps.db('FIN')` makes
 * the app mint a delegation for THAT viewer under the PINNED group, call `POST /connection-sessions`, and hand the
 * runner's postgres.js the returned endpoint and credential.
 *
 * MinusX is a real HTTP server here that verifies every token with `jose` against the installation's public key
 * (signature, `typ`, `aud`, `iss`, `kid`, installation, purpose per endpoint, the body digest, a 60 s life, replay)
 * and stands in for §2's membership read with the app's own group rows. Its governed endpoint is a loopback
 * Postgres wire listener in front of a real PGlite: it admits only a session credential MinusX issued, for exactly
 * the user and connection it was issued for, and records every login.
 */
import {createHash,generateKeyPairSync,randomBytes,type KeyObject} from 'node:crypto';
import http from 'node:http';
import net from 'node:net';
import {Hono} from 'hono';
import {jwtVerify,type JWTPayload,type ProtectedHeaderParameters} from 'jose';
import {afterAll,beforeAll,describe,expect,it,vi} from 'vitest';
import {PGlite} from '@electric-sql/pglite';
import {createRunner} from '@artifactbin/runner/local';
import {DELEGATION_AUDIENCE,DELEGATION_ISSUER,DELEGATION_TYPE,type MinusxConnectionSession} from '@artifactbin/contracts';
import {mountRoutes} from '../server/api';
import {artifactState,getArtifactById} from '@/lib/artifacts';
import {createGroup} from '@/lib/groups';
import {getHtmlBackendVersion} from '@/lib/html-backends';
import {readPinnedBackendSecret} from '@/lib/html-backend-secrets';
import {createMinusxClient} from '@/lib/minusx';
import {createFunctionScheduler,functionSchedulesOf} from '@/lib/function-schedules';
import {localPageBackendCapability} from '@/lib/page-operations';
import {resolverPorts} from '@/lib/page-doors';
import {getDb,minusxSettings,setServices} from '@/lib/platform';
import {overrideConfig} from '@/lib/platform/config';
import {admitGroupMember,mintAccountToken,useAppHarness} from './harness';

const harness=useAppHarness();
const app=new Hono();
mountRoutes(app);

const INSTALLATION='installation_test',KID='delegation-key-1',CONNECTION='conn_finance';
const sha256=(bytes:Buffer|string)=>createHash('sha256').update(bytes).digest('hex');
const {publicKey,privateKey}=generateKeyPairSync('ed25519');
const PRIVATE_PEM=privateKey.export({type:'pkcs8',format:'pem'}) as string;

interface Seen {method:string;path:string;url:string;token:string;body:string;status?:number;claims?:JWTPayload&Record<string,unknown>;header?:ProtectedHeaderParameters}
interface Session {user:string;database:string}

/** The governed endpoint: a Postgres wire listener over a real PGlite that admits only a credential MinusX issued. */
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

/** MinusX's control API: every request verified as MinusX must, then answered from `visible` (group → connection ids). */
async function minusx(key:KeyObject,gatewayPort:()=>number,sessions:Map<string,Session>){
 const seen:Seen[]=[],jtis=new Set<string>();
 const visible:Record<string,string[]>={};
 const PURPOSE:Record<string,string>={'/api/v1/connections':'catalog.read','/api/v1/catalog':'catalog.read','/api/v1/context':'context.read','/api/v1/connection-sessions':'database.connect'};
 const server=http.createServer(async(req,res)=>{
  const chunks:Buffer[]=[];for await(const chunk of req)chunks.push(chunk as Buffer);
  const body=Buffer.concat(chunks),url=new URL(req.url??'/','http://minusx');
  const entry:Seen={method:req.method??'',path:url.pathname,url:req.url??'',token:/^Bearer (.+)$/.exec(req.headers.authorization??'')?.[1]??'',body:body.toString()};
  seen.push(entry);
  const reply=(status:number,value:unknown)=>{entry.status=status;res.writeHead(status,{'content-type':'application/json'});res.end(JSON.stringify(value));};
  const refuse=(status:number,code:string)=>reply(status,{error:{code,message:code}});
  const purpose=PURPOSE[url.pathname];
  if(!purpose)return refuse(404,'not_found');
  try{
   const verified=await jwtVerify(entry.token,key,{issuer:DELEGATION_ISSUER,audience:DELEGATION_AUDIENCE,algorithms:['EdDSA'],typ:DELEGATION_TYPE,clockTolerance:30});
   entry.claims=verified.payload as Seen['claims'];entry.header=verified.protectedHeader;
  }catch{return refuse(401,'unauthenticated');}
  const claims=entry.claims!;
  if(entry.header!.kid!==KID||claims.installation_id!==INSTALLATION||claims.purpose!==purpose||claims.request_sha256!==sha256(body)||(claims.exp??0)-(claims.iat??0)!==60||typeof claims.jti!=='string'||jtis.has(claims.jti))return refuse(401,'unauthenticated');
  jtis.add(claims.jti);
  // §2 resolve, stood in for: a DIRECT membership row in exactly the active group.
  const member=(await (await getDb()).query('SELECT 1 FROM group_members WHERE group_id=$1 AND user_id=$2',[claims.active_group_id,claims.sub])).rows.length>0;
  if(!member)return refuse(403,'forbidden');
  const connections=visible[claims.active_group_id as string]??[];
  if(url.pathname==='/api/v1/connections')return reply(200,{connections:connections.map(id=>({id,name:'Finance warehouse',protocol:'postgres',policy_revision:3}))});
  const connectionId=url.pathname==='/api/v1/connection-sessions'?(JSON.parse(body.toString()) as {connection_id:string}).connection_id:url.searchParams.get('connection_id')??'';
  if(!connections.includes(connectionId))return refuse(403,'forbidden');
  if(url.pathname==='/api/v1/catalog')return reply(200,{connection_id:connectionId,policy_revision:3,default_schema:'public',schemas:[{name:'_views',tables:[{name:'monthly_revenue',kind:'model',columns:[{name:'month',type:'text'},{name:'net',type:'numeric'}],version:3}]}]});
  if(url.pathname==='/api/v1/context')return reply(200,{group_id:claims.active_group_id,revision:1,docs:[{title:'Revenue',body:'Net of tax.'}],metrics:[],models:[{id:'monthly_revenue',name:'monthly_revenue',version:3,description:'Monthly net revenue'}]});
  const password=randomBytes(18).toString('base64url');
  sessions.set(password,{user:claims.sub!,database:connectionId});
  const session:MinusxConnectionSession={protocol:'postgres',host:'127.0.0.1',port:gatewayPort(),user:claims.sub!,password,database:connectionId,expires_at:new Date(Date.now()+15*60_000).toISOString(),policy_revision:3};
  return reply(200,session);
 });
 await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
 return {seen,visible,url:`http://127.0.0.1:${(server.address() as net.AddressInfo).port}`,close:()=>new Promise<void>(resolve=>server.close(()=>resolve()))};
}

const SOURCE=`export const secrets={FIN:'minusx'};
export default {
 async revenue(_input,_principal,caps){const db=await caps.db('FIN');try{return (await db.query('select month, net from revenue order by month')).rows;}finally{await db.end();}},
 async probe(_input,_principal,caps){try{const db=await caps.db('FIN');await db.end();return 'connected';}catch(e){return {code:e.code};}},
 async forged(input,_principal,caps){try{const db=await caps.db('FIN',{subject:input.as,user:input.as,group_id:input.group,principal:{subject:input.as}});try{return (await db.query('select count(*)::int as n from revenue')).rows;}finally{await db.end();}}catch(e){return {code:e.code};}},
};`;
const HTML='<html><head><link rel="af-resolver" data-af-name="data" href="./data.ts"></head><body>Finance revenue</body></html>';
const headers=(token?:string)=>({'content-type':'application/json',...(token?{authorization:`Bearer ${token}`}:{})});

const sessions=new Map<string,Session>();
let gate:Awaited<ReturnType<typeof gateway>>,control:Awaited<ReturnType<typeof minusx>>,runner:Awaited<ReturnType<typeof createRunner>>;
const logged:string[]=[];
beforeAll(async()=>{
 gate=await gateway(sessions);
 control=await minusx(publicKey,()=>gate.port,sessions);
 overrideConfig({},{MINUSX__BASE_URL:control.url,INSTALLATION__ID:INSTALLATION,MINUSX__DELEGATION_PRIVATE_KEY:PRIVATE_PEM,MINUSX__DELEGATION_KEY_ID:KID});
 runner=await createRunner({db:await harness.db(),database:{allowLoopback:true},capabilities:(context,operation,args)=>localPageBackendCapability(context.request,operation,args,context.signal,resolverPorts)});
 setServices({runner});
 for(const level of ['log','info','warn','error','debug'] as const){const original=console[level].bind(console);vi.spyOn(console,level).mockImplementation((...args:unknown[])=>{logged.push(args.map(a=>a instanceof Error?`${a.message} ${a.stack}`:typeof a==='string'?a:JSON.stringify(a)).join(' '));original(...args);});}
},60_000);
afterAll(async()=>{vi.restoreAllMocks();await runner?.close();await control?.close();await gate?.close();});

async function publishPage(owner:{token:string},source=SOURCE){
 const created=await app.request('/api/artifacts',{method:'POST',headers:headers(owner.token),body:JSON.stringify({visibility:'unlisted',html:HTML,resolverSources:{data:source}})});
 const body=await created.json() as {id:string;error?:string;details?:string[]};
 return {status:created.status,body};
}
async function resolverOf(owner:{token:string},id:string){
 const {resolvers}=await (await app.request(`/api/my/artifacts/${id}/resolvers`,{headers:headers(owner.token)})).json() as {resolvers:{backendId:string;version:string;secrets:Record<string,string>}[]};
 return resolvers[0]!;
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
const sessionCalls=()=>control.seen.filter(entry=>entry.path==='/api/v1/connection-sessions');

describe('a page pinned to Finance, read by its viewers',()=>{
 const world=harness.shared(async()=>{
  const alice=await mintAccountToken('mx_alice'),bob=await mintAccountToken('mx_bob'),carol=await mintAccountToken('mx_carol'),dave=await mintAccountToken('mx_dave');
  const finance=await createGroup(alice.userId!,{handle:'mx_finance',name:'Finance'});
  await admitGroupMember(alice.userId!,finance.id,bob.userId!,'viewer');
  control.visible[finance.id]=[CONNECTION];
  const page=await publishPage(alice);
  expect(page.status,JSON.stringify(page.body)).toBe(201);
  expect((await resolverOf(alice,page.body.id)).secrets).toEqual({FIN:'minusx'});
  const bound=await bind(alice,page.body.id,{connection_id:CONNECTION,group_id:finance.id});
  expect(bound.status,JSON.stringify(bound.body)).toBe(200);
  return {alice,bob,carol,dave,finance,page:page.body.id,resolver:bound.resolver};
 });

 it('Bob (a Finance member): one connection-sessions call, a delegation for Bob under Finance, and the runner logs in with the returned credential',async()=>{
  const {bob,alice,finance,page,resolver}=world();
  const before=sessionCalls().length,loginsBefore=gate.logins.length;
  const answer=await fn(page,'revenue',bob.token);
  expect(answer.status,answer.text).toBe(200);
  expect(answer.body).toEqual([{month:'2026-10',net:'100.50'},{month:'2026-11',net:'200.00'}]);
  const calls=sessionCalls().slice(before);
  expect(calls).toHaveLength(1);
  const call=calls[0]!;
  expect(call.status).toBe(200);
  expect(call.header).toMatchObject({alg:'EdDSA',typ:DELEGATION_TYPE,kid:KID});
  expect(call.claims).toMatchObject({iss:DELEGATION_ISSUER,aud:DELEGATION_AUDIENCE,sub:bob.userId,act:{sub:DELEGATION_ISSUER},installation_id:INSTALLATION,active_group_id:finance.id,purpose:'database.connect',page_id:page});
  expect(call.body).toBe(JSON.stringify({connection_id:CONNECTION}));
  expect(call.claims!.request_sha256).toBe(sha256(call.body));
  expect(call.claims!.exp!-call.claims!.iat!).toBe(60);
  expect(Math.abs(call.claims!.iat!-Date.now()/1000)).toBeLessThan(30);
  // The runner connected as Bob to the governed endpoint with the credential MinusX issued for this session.
  const logins=gate.logins.slice(loginsBefore);
  expect(logins).toEqual([{user:bob.userId,database:CONNECTION,password:expect.any(String),admitted:true}]);
  expect(sessions.get(logins[0]!.password)).toEqual({user:bob.userId,database:CONNECTION});
  // Nothing stored holds a login: FIN's stored value is the author's binding alone.
  const backend=(await getHtmlBackendVersion(resolver.backendId,resolver.version))!;
  expect(JSON.parse(await readPinnedBackendSecret(backend,'FIN'))).toEqual({connection_id:CONNECTION,group_id:finance.id});
  expect(calls.some(entry=>entry.claims?.sub===alice.userId)).toBe(false);
 },45_000);

 it('Carol (not a member): MinusX refuses, the data call is a data-access error, the page still renders, and nothing runs as the owner',async()=>{
  const {carol,alice,page}=world();
  const before=control.seen.length,loginsBefore=gate.logins.length;
  expect((await fn(page,'probe',carol.token)).body).toEqual({code:'data_access_denied'});
  const uncaught=await fn(page,'revenue',carol.token);
  expect(uncaught.status).toBe(500);
  expect(uncaught.body).toMatchObject({error:'backend_failed',message:'data_access_denied: FIN'});
  const calls=control.seen.slice(before);
  expect(calls.length).toBe(2);
  for(const entry of calls)expect(entry).toMatchObject({path:'/api/v1/connection-sessions',status:403,claims:expect.objectContaining({sub:carol.userId})});
  expect(control.seen.some(entry=>entry.path==='/api/v1/connection-sessions'&&entry.claims?.sub===alice.userId)).toBe(false);
  expect(gate.logins.length).toBe(loginsBefore);
  const read=await app.request(`/api/artifacts/${page}`,{headers:headers(carol.token)});
  expect(read.status).toBe(200);
  expect(await read.text()).toContain('Finance revenue');
 },45_000);

 it('an anonymous reader of the unlisted page gets the data-access error and MinusX is never asked',async()=>{
  const {page}=world();
  const before=control.seen.length;
  expect((await fn(page,'probe')).body).toEqual({code:'data_access_denied'});
  expect(control.seen.length).toBe(before);
 },45_000);

 it('neither the request body nor resolver code can change the user or the group sent to MinusX',async()=>{
  const {bob,carol,alice,finance,page}=world();
  const before=sessionCalls().length;
  const forged={as:alice.userId,group:'grp_other',subject:alice.userId,user_id:alice.userId,group_id:'grp_other',principal:{tenant:page,subject:alice.userId,role:'owner'}};
  expect((await fn(page,'forged',carol.token,forged)).body).toEqual({code:'data_access_denied'});
  expect((await fn(page,'forged',bob.token,{...forged,as:carol.userId})).body).toEqual([{n:2}]);
  const sent=sessionCalls().slice(before).map(entry=>[entry.claims?.sub,entry.claims?.active_group_id,entry.status]);
  expect(sent).toEqual([[carol.userId,finance.id,403],[bob.userId,finance.id,200]]);
 },45_000);

 it('the catalog and context reads carry their own purposes under the caller\'s one group',async()=>{
  const {bob,finance}=world();
  const client=createMinusxClient(minusxSettings()!);
  expect((await client.catalog({userId:bob.userId!,groupId:finance.id},CONNECTION)).schemas[0]!.tables[0]!.name).toBe('monthly_revenue');
  expect((await client.context({userId:bob.userId!,groupId:finance.id},CONNECTION)).models[0]!.version).toBe(3);
  expect(control.seen.slice(-2).map(entry=>[entry.path,entry.claims?.purpose,entry.claims?.request_sha256,entry.status])).toEqual([['/api/v1/catalog','catalog.read',sha256(''),200],['/api/v1/context','context.read',sha256(''),200]]);
 });

 it('an author who is not a direct member of the group cannot pin a page to it, nor pin a connection the group cannot see',async()=>{
  const {alice,dave,finance,page}=world();
  const daves=await publishPage(dave);
  expect(daves.status).toBe(201);
  const before=control.seen.length;
  expect(await bind(dave,daves.body.id,{connection_id:CONNECTION,group_id:finance.id})).toMatchObject({status:403,body:{error:'not_group_member'}});
  expect(control.seen.length).toBe(before);
  expect(await bind(alice,page,{connection_id:'conn_hidden',group_id:finance.id})).toMatchObject({status:403,body:{error:'connection_not_visible'}});
  expect(control.seen.at(-1)).toMatchObject({path:'/api/v1/connections',status:200,claims:expect.objectContaining({sub:alice.userId,active_group_id:finance.id,purpose:'catalog.read'})});
  expect(await bind(alice,page,{connection_id:CONNECTION,group_id:finance.id,user:'x'})).toMatchObject({status:400,body:{error:'invalid_binding'}});
 },45_000);

 it('republishing validates the stored binding again for the author',async()=>{
  const {alice,finance,page}=world();
  const head=(await getArtifactById(page))!;
  const replace=(source:string)=>app.request(`/api/artifacts/${page}`,{method:'PUT',headers:headers(alice.token),body:JSON.stringify({html:HTML,resolverSources:{data:source},expectedVersion:head.version,expectedState:artifactState(head)})});
  control.visible[finance.id]=[];
  try{
   const refused=await replace(SOURCE+'\n// v2');
   expect(refused.status).toBe(403);
   expect(await refused.json()).toMatchObject({error:'connection_not_visible'});
  }finally{control.visible[finance.id]=[CONNECTION];}
 },45_000);

 it('the delegation token reaches no response, URL, log line or stored row',async()=>{
  const {bob,carol,page}=world();
  const texts=[(await fn(page,'revenue',bob.token)).text,(await fn(page,'revenue',carol.token)).text,(await fn(page,'probe',carol.token)).text,
   await (await app.request(`/api/artifacts/${page}`,{headers:headers(bob.token)})).text(),await (await app.request('/api/server')).text()];
  const tokens=control.seen.map(entry=>entry.token).filter(Boolean);
  expect(tokens.length).toBeGreaterThan(5);
  const db=await getDb();
  const tables=(await db.query<{name:string}>("SELECT format('%I.%I',table_schema,table_name) AS name FROM information_schema.tables WHERE table_type='BASE TABLE' AND table_schema NOT IN ('pg_catalog','information_schema')")).rows;
  const stored:string[]=[];
  for(const {name} of tables)stored.push(...(await db.query<{row:string}>(`SELECT t::text AS row FROM ${name} t`)).rows.map(r=>r.row));
  for(const token of tokens){
   const signature=token.split('.')[2]!;
   for(const text of [...texts,...control.seen.map(entry=>entry.url),...logged,...stored])expect(text.includes(signature)).toBe(false);
  }
 },45_000);
});

const republishPage=async(who:{token:string},id:string,source:string)=>{
 const head=(await getArtifactById(id))!;
 const response=await app.request(`/api/artifacts/${id}`,{method:'PUT',headers:headers(who.token),body:JSON.stringify({html:HTML,resolverSources:{data:source},expectedVersion:head.version,expectedState:artifactState(head)})});
 return {status:response.status,body:await response.json() as Record<string,unknown>};
};

describe('a GROUP-owned page pinned to Finance',()=>{
 // Team owns the page. Alice edits Team and is a direct Finance member; Erin edits Team but is not in Finance; Bob and
 // Carol read Team's pages as viewers, and only Bob is in Finance.
 const world=harness.shared(async()=>{
  const alice=await mintAccountToken('gx_alice'),erin=await mintAccountToken('gx_erin'),bob=await mintAccountToken('gx_bob'),carol=await mintAccountToken('gx_carol');
  const finance=await createGroup(alice.userId!,{handle:'gx_finance',name:'Finance'});
  await admitGroupMember(alice.userId!,finance.id,bob.userId!,'viewer');
  const team=await createGroup(alice.userId!,{handle:'gx_team',name:'Team'});
  await admitGroupMember(alice.userId!,team.id,erin.userId!,'editor');
  for(const viewer of [bob,carol])await admitGroupMember(alice.userId!,team.id,viewer.userId!,'viewer');
  control.visible[finance.id]=[CONNECTION];
  const created=await app.request('/api/artifacts',{method:'POST',headers:headers(alice.token),body:JSON.stringify({visibility:'private',html:HTML,resolverSources:{data:SOURCE},destination:{type:'group',id:team.id}})});
  const page=await created.json() as {id:string};
  expect(created.status,JSON.stringify(page)).toBe(201);
  expect((await getArtifactById(page.id))!.group_id).toBe(team.id);
  return {alice,erin,bob,carol,finance,team,page:page.id};
 });

 it('an editor of the owning group who is not a direct member of the pinned group cannot bind it; one who is can',async()=>{
  const {alice,erin,finance,team,page}=world();
  const before=control.seen.length;
  expect(await bind(erin,page,{connection_id:CONNECTION,group_id:finance.id})).toMatchObject({status:403,body:{error:'not_group_member'}});
  expect(control.seen.length).toBe(before);
  const bound=await bind(alice,page,{connection_id:CONNECTION,group_id:finance.id});
  expect(bound.status,JSON.stringify(bound.body)).toBe(200);
  expect(bound.body).toEqual({names:['FIN']});
  // The page's other editor sees the binding is set, and what it pins (no credential is in it).
  const listed=await resolverOf(erin,page) as unknown as {set:string[];bindings:Record<string,unknown>;backendId:string;version:string};
  expect(listed.set).toEqual(['FIN']);
  expect(listed.bindings).toEqual({FIN:{connection_id:CONNECTION,group_id:finance.id,group_name:'Finance'}});
  // Stored against the owning group, not the person who bound it.
  const backend=(await getHtmlBackendVersion(listed.backendId,listed.version))!;
  expect(backend.ownerId).toBe(team.id);
 },45_000);

 it('each viewer reads as themselves: Bob (in Finance) gets rows under a delegation for Bob, Carol a data-access error',async()=>{
  const {alice,bob,carol,finance,page}=world();
  const before=sessionCalls().length;
  const rows=await fn(page,'revenue',bob.token);
  expect(rows.status,rows.text).toBe(200);
  expect(rows.body).toEqual([{month:'2026-10',net:'100.50'},{month:'2026-11',net:'200.00'}]);
  expect((await fn(page,'probe',carol.token)).body).toEqual({code:'data_access_denied'});
  const sent=sessionCalls().slice(before).map(entry=>[entry.claims?.sub,entry.claims?.active_group_id,entry.status]);
  expect(sent).toEqual([[bob.userId,finance.id,200],[carol.userId,finance.id,403]]);
  expect(control.seen.some(entry=>entry.claims?.sub===alice.userId&&entry.path==='/api/v1/connection-sessions')).toBe(false);
 },45_000);

 it('a republish validates the stored binding again for the editor who publishes it',async()=>{
  const {alice,erin,bob,page}=world();
  const refused=await republishPage(erin,page,SOURCE+'\n// erin');
  expect(refused.status).toBe(403);
  expect(refused.body).toMatchObject({error:'not_group_member'});
  const accepted=await republishPage(alice,page,SOURCE+'\n// alice');
  expect(accepted.status,JSON.stringify(accepted.body)).toBe(200);
  // The binding survives the republish (same owning group, same backend identity).
  expect((await fn(page,'revenue',bob.token)).status).toBe(200);
 },45_000);

 it('ordinary credentials stay personal: a group page may neither be created with nor republished to a secret that is not a governed binding',async()=>{
  const {alice,team,page}=world();
  const withKey=`export const secrets={FIN:'minusx',KEY:'api.example.com'};`+SOURCE.slice(SOURCE.indexOf('\n'));
  const created=await app.request('/api/artifacts',{method:'POST',headers:headers(alice.token),body:JSON.stringify({visibility:'private',html:HTML,resolverSources:{data:withKey},destination:{type:'group',id:team.id}})});
  expect(created.status).toBe(403);
  expect(await created.json()).toMatchObject({error:'backend_credentials_owner_required'});
  const republished=await republishPage(alice,page,withKey);
  expect(republished.status).toBe(403);
  expect(republished.body).toMatchObject({error:'backend_credentials_owner_required'});
 },45_000);
});

describe('a scheduled run never opens a governed connection',()=>{
 it('the run is refused data_access_denied, recorded on the schedule, and MinusX is never asked',async()=>{
  const owner=await mintAccountToken('sx_owner');
  const finance=await createGroup(owner.userId!,{handle:'sx_finance',name:'Finance'});
  control.visible[finance.id]=[CONNECTION];
  const scheduled=`export const secrets={FIN:'minusx'};export const schedule={pull:'every 15 minutes'};
export default {async pull(_input,_principal,caps){const db=await caps.db('FIN');try{return (await db.query('select count(*)::int as n from revenue')).rows;}finally{await db.end();}}};`;
  const page=await publishPage(owner,scheduled);
  expect(page.status,JSON.stringify(page.body)).toBe(201);
  expect((await bind(owner,page.body.id,{connection_id:CONNECTION,group_id:finance.id})).status).toBe(200);
  // The owner's own on-demand call of the same function reads the rows: the binding works.
  expect((await fn(page.body.id,'pull',owner.token)).body).toEqual([{n:2}]);
  const before=sessionCalls().length;
  const clock=Date.now()+60_000;
  await createFunctionScheduler({db:getDb,now:()=>clock,onError:error=>{throw error;}}).tick();
  const [state]=await functionSchedulesOf(page.body.id);
  expect(state).toMatchObject({name:'pull',lastStatus:'failed',failures:1});
  expect([state!.lastError,state!.lastMessage].join(' ')).toContain('data_access_denied');
  expect(sessionCalls().length).toBe(before);
 },45_000);
});

describe('GET /api/my/minusx/connections: a group\'s connections for the signed-in author',()=>{
 const list=(token:string|undefined,group?:string)=>app.request(`/api/my/minusx/connections${group===undefined?'':`?group_id=${encodeURIComponent(group)}`}`,{headers:headers(token)});
 it('lists what MinusX shows the author under that one group, asked with a delegation for the author',async()=>{
  const author=await mintAccountToken('cx_author'),outsider=await mintAccountToken('cx_outsider');
  const finance=await createGroup(author.userId!,{handle:'cx_finance',name:'Finance'});
  control.visible[finance.id]=[CONNECTION];
  const listed=await list(author.token,finance.id);
  expect(listed.status).toBe(200);
  expect(await listed.json()).toEqual({connections:[{id:CONNECTION,name:'Finance warehouse',protocol:'postgres'}]});
  expect(control.seen.at(-1)).toMatchObject({path:'/api/v1/connections',status:200,claims:expect.objectContaining({sub:author.userId,active_group_id:finance.id,purpose:'catalog.read'})});
  const before=control.seen.length;
  const refused=await list(outsider.token,finance.id);
  expect(refused.status).toBe(403);
  expect(await refused.json()).toEqual({error:'not_group_member'});
  expect(control.seen.length).toBe(before);
  expect((await list(author.token)).status).toBe(400);
  expect((await list(undefined,finance.id)).status).toBe(401);
 },45_000);
});

describe('GET /api/server in combined mode',()=>{
 it('advertises the installation and its MinusX control API',async()=>{
  const document=await (await app.request('/api/server')).json() as Record<string,unknown>;
  expect(document).toMatchObject({installation_id:INSTALLATION,minusx:{base_url:control.url}});
 });
});

describe('standalone (no MinusX settings)',()=>{
 beforeAll(()=>{overrideConfig({},{MINUSX__BASE_URL:undefined,INSTALLATION__ID:undefined,MINUSX__DELEGATION_PRIVATE_KEY:undefined,MINUSX__DELEGATION_KEY_ID:undefined});});
 afterAll(()=>{overrideConfig({},{MINUSX__BASE_URL:control.url,INSTALLATION__ID:INSTALLATION,MINUSX__DELEGATION_PRIVATE_KEY:PRIVATE_PEM,MINUSX__DELEGATION_KEY_ID:KID});});
 it('the connections route answers minusx_not_configured and asks nothing',async()=>{
  const author=await mintAccountToken('cx_standalone');
  const group=await createGroup(author.userId!,{handle:'cx_standalone_group',name:'Standalone'});
  const before=control.seen.length;
  const response=await app.request(`/api/my/minusx/connections?group_id=${group.id}`,{headers:headers(author.token)});
  expect(response.status).toBe(400);
  expect(await response.json()).toEqual({error:'minusx_not_configured'});
  expect(control.seen.length).toBe(before);
 });
 it('/api/server is the origin and aliases alone',async()=>{
  expect(Object.keys(await (await app.request('/api/server')).json() as object).sort()).toEqual(['aliases','origin']);
 });
 it('refuses a page declaring a governed connection, and publishes a direct database connection as before',async()=>{
  const owner=await mintAccountToken('mx_standalone');
  const governed=await publishPage(owner);
  expect(governed.status).toBe(400);
  expect(governed.body).toMatchObject({error:'minusx_not_configured'});
  const direct=await publishPage(owner,`export const secrets={DB:'postgres'};export default {async rows(_i,_p,caps){const db=await caps.db('DB');await db.end();return 1;}};`);
  expect(direct.status,JSON.stringify(direct.body)).toBe(201);
  expect((await resolverOf(owner,direct.body.id)).secrets).toEqual({DB:'postgres'});
 },45_000);
});
