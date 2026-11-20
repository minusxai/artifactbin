/**
 * A CONFIGURED SERVICE SIGNS AN AGENT IN AS A GROUP WITH NOBODY PRESENT (contracts service-audiences
 * `GROUP_SIGN_IN_PATH`), end to end on the composed host: a group Admin (direct, or of an ancestor) approves a service
 * that opted in (`group_sign_ins`) at member or editor level; that service, presenting its own secret and the
 * approval's id, receives an ordinary access token acting as the group at that level, with no refresh token, live only
 * while the approval is. Nothing else lets a service sign in as a group.
 */
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {beforeEach,expect,it,onTestFinished} from 'vitest';
import {GROUP_SIGN_IN_GRANTS_PATH, GROUP_SIGN_IN_PATH, parseServiceAudiences, type GroupSignIn} from '@artifactbin/contracts/service-audiences';
import {IDENTITY_INTROSPECT_PATH} from '@artifactbin/contracts/identity-service';
import {SERVICE_AUTH_HEADER} from '@artifactbin/contracts/routes';
import type {Queryable} from '@artifactbin/contracts/db';
import {createBearerReader} from '@artifactbin/auth';
import {liveGroupSignIn} from '@/lib/accounts';
import {createAuthComposedHost} from '@/test/helpers/auth-host';
import {AUTH_SECRET,getDb,syncIdentitySettings} from '@/lib/platform';
import {overrideConfig} from '@/lib/platform/config';
import {createGroup,deleteGroup,setGroupMember} from '@/lib/groups';
import {admitGroupMember,useAppHarness} from './harness';
import {tempDir} from '@artifactbin/test-support/temp-dir';
import {delegatedService,otpSignIn,serviceAudiences} from '../../auth/__tests__/helpers';
useAppHarness();
const SECRET='service-group-test-secret',origin='http://localhost:3000';
const WAREHOUSE_SECRET='warehouse-group-secret',LEDGER_SECRET='ledger-group-secret',CRM_SECRET='crm-group-secret';
// Warehouse and CRM opted in to group sign-ins; Ledger has its own secret and nothing else.
const AUDIENCES=serviceAudiences({...delegatedService('warehouse','http://warehouse.localhost:7444',WAREHOUSE_SECRET),group_sign_ins:true},
 delegatedService('ledger','http://ledger.localhost:7445',LEDGER_SECRET),{...delegatedService('crm','http://crm.localhost:7446',CRM_SECRET),group_sign_ins:true});
let directory='';
beforeEach(async()=>{overrideConfig({internalServiceSecret:SECRET,publicBaseUrl:origin},{IDENTITY__SERVICE_AUDIENCES:AUDIENCES});await syncIdentitySettings(await getDb());directory=await tempDir('service-group-',onTestFinished);});

const sql=async<T=Record<string,unknown>>(text:string,params:unknown[]=[])=>(await (await getDb()).query<T>(text,params)).rows;
const otpOf=async(email:string)=>(await readFile(join(directory,'outbox.jsonl'),'utf8')).trim().split('\n').map(line=>JSON.parse(line)).filter(message=>message.to===email).at(-1).otp as string;

async function composed(audiences=AUDIENCES){
 const application=await createAuthComposedHost({APP__PUBLIC_BASE_URL:origin,AUTH__SECRET:AUTH_SECRET,INTERNAL__SERVICE_SECRET:SECRET,IDENTITY__SERVICE_AUDIENCES:audiences,EMAIL__DEV_OUTBOX_PATH:join(directory,'outbox.jsonl')});
 const fetch=(request:Request)=>application.fetch(request);
 const send=async(method:string,path:string,headers:Record<string,string>,body?:unknown)=>{
  const response=await fetch(new Request(origin+path,{method,headers:{origin,...(body===undefined?{}:{'content-type':'application/json'}),...headers},...(body===undefined?{}:{body:JSON.stringify(body)})}));
  return {status:response.status,body:await response.json().catch(()=>null) as Record<string,unknown>|null};
 };
 const signIn=async(email:string)=>{
  const post=(path:string,body:unknown,headers:Record<string,string>={})=>fetch(new Request(origin+path,{method:'POST',headers:{origin,'content-type':'application/json',...headers},body:JSON.stringify(body)}));
  const {login,cookie}=await otpSignIn(post,email,()=>otpOf(email),{prefix:'/api/auth'});
  expect(login.status).toBe(200);
  const token=(await (await post('/api/authentication/token',{},{cookie})).json() as {access_token:string}).access_token;
  /** This person signs an agent in as `group` at `role` themselves: its token row's id. */
  const asGroup=async(group:string,role:'member'|'editor')=>String((await (await post('/api/authentication/token',{group_id:group,group_role:role},{cookie})).json() as {id:string}).id);
  return {cookie,token,asGroup,userId:(await sql<{id:string}>('SELECT id FROM users WHERE email=$1',[email]))[0]!.id};
 };
 /** The group settings API, as a person in their browser. */
 const approvals=(who:{cookie:string},group:string)=>send('GET',`/api/groups/${group}/service-sign-ins`,{cookie:who.cookie});
 const approve=(who:{cookie:string},group:string,service_id:string,role:string)=>send('POST',`/api/groups/${group}/service-sign-ins`,{cookie:who.cookie},{service_id,role});
 const revoke=(who:{cookie:string},group:string,id:string)=>send('DELETE',`/api/groups/${group}/service-sign-ins/${id}`,{cookie:who.cookie});
 /** The service's own call: its secret and the approval. */
 const groupSignIn=(secret:string,body:unknown,path=GROUP_SIGN_IN_PATH)=>send('POST',path,{[SERVICE_AUTH_HEADER]:secret},body);
 /** The service's list of its own approvals. */
 const grants=(secret:string,body:unknown={},path=GROUP_SIGN_IN_GRANTS_PATH)=>send('POST',path,{[SERVICE_AUTH_HEADER]:secret},body);
 /** The group's agent sign-ins, as its Admin's settings page reads them. */
 const signIns=(who:{cookie:string},group:string,query='')=>send('GET',`/api/groups/${group}/sign-ins${query}`,{cookie:who.cookie});
 const api=(token:string,method:string,path:string,body?:unknown)=>send(method,path,{authorization:`Bearer ${token}`},body);
 const introspect=async(token:string)=>(await send('POST',IDENTITY_INTROSPECT_PATH,{[SERVICE_AUTH_HEADER]:SECRET},{token})).body;
 return {approvals,approve,revoke,groupSignIn,grants,signIns,api,introspect,signIn,send};
}

async function tree(host:Awaited<ReturnType<typeof composed>>){
 const ada=await host.signIn('mxmx_test_sg_ada@example.test'),rob=await host.signIn('mxmx_test_sg_rob@example.test'),eve=await host.signIn('mxmx_test_sg_eve@example.test');
 const root=await createGroup(ada.userId,{handle:'sg_root',name:'Root'});
 const team=await createGroup(ada.userId,{handle:'sg_team',name:'Team',parent_id:root.id});
 const squad=await createGroup(ada.userId,{handle:'sg_squad',name:'Squad',parent_id:team.id});
 await admitGroupMember(ada.userId,root.id,rob.userId,'admin');
 await admitGroupMember(ada.userId,team.id,eve.userId,'editor');
 const page=(await host.api(eve.token,'POST','/api/artifacts',{title:'Team page',html:'<!doctype html><html><head></head><body><p>Team</p></body></html>',destination:{type:'group',id:team.id},visibility:'private'})).body!.id as string;
 return {ada,rob,eve,root,team,squad,page};
}

it('an Admin, direct or through an ancestor, approves an opted-in service at member or editor level; an Editor cannot',async()=>{
 const host=await composed(),{ada,rob,eve,team}=await tree(host);
 const direct=await host.approve(ada,team.id,'warehouse','editor');
 expect(direct.status,JSON.stringify(direct.body)).toBe(201);
 const inherited=await host.approve(rob,team.id,'crm','member');
 expect(inherited.status).toBe(201);
 // The same approval again answers the one already there.
 expect((await host.approve(ada,team.id,'warehouse','editor')).body).toEqual(direct.body);
 // An Editor, a service that did not opt in or does not exist, and an admin level: refused, nothing written.
 expect(await host.approve(eve,team.id,'warehouse','member')).toMatchObject({status:403,body:{error:'forbidden'}});
 for(const service of ['ledger','nowhere'])expect(await host.approve(ada,team.id,service,'member')).toMatchObject({status:400,body:{error:'unknown_service'}});
 expect(await host.approve(ada,team.id,'warehouse','admin')).toMatchObject({status:400,body:{error:'invalid_role'}});
 // The settings page's list: each approval with who approved it, and the services that may be approved.
 const listed=await host.approvals(ada,team.id);
 expect(listed.body).toEqual({approvals:[
  {id:direct.body!.id,service_id:'warehouse',role:'editor',created_at:expect.any(String),approved_by:expect.objectContaining({id:ada.userId}),configured:true},
  {id:inherited.body!.id,service_id:'crm',role:'member',created_at:expect.any(String),approved_by:expect.objectContaining({id:rob.userId}),configured:true},
 ],services:[{id:'warehouse',origin:'http://warehouse.localhost:7444'},{id:'crm',origin:'http://crm.localhost:7446'}]});
 expect((await host.approvals(eve,team.id)).status).toBe(403);
 // The identity views show the approvals, and nothing secret.
 expect(await sql('SELECT group_id,role,service_id,approved_by,deleted_at FROM identity.group_sign_in_grants ORDER BY created_at')).toEqual([
  {group_id:team.id,role:'editor',service_id:'warehouse',approved_by:ada.userId,deleted_at:null},
  {group_id:team.id,role:'member',service_id:'crm',approved_by:rob.userId,deleted_at:null},
 ]);
});

it('the service obtains the group\'s sign-in for its own approval: the group at that level, no person, no refresh, audited',async()=>{
 const host=await composed(),{ada,team,page}=await tree(host);
 const grant=String((await host.approve(ada,team.id,'warehouse','editor')).body!.id);
 const issued=await host.groupSignIn(WAREHOUSE_SECRET,{grant_id:grant,expires_in:3600});
 expect(issued.status,JSON.stringify(issued.body)).toBe(200);
 const answer=issued.body as unknown as GroupSignIn;
 expect(answer).toEqual({access_token:expect.stringMatching(/^mx_/),token_type:'Bearer',token_id:expect.stringMatching(/^tok_/),expires_at:expect.any(String),expires_at_ms:Date.parse(answer.expires_at),server:origin,group_id:team.id,group_role:'editor',grant_id:grant});
 expect(answer).not.toHaveProperty('refresh_token');
 expect(await sql('SELECT user_id,group_id,group_role,issued_by,grant_id FROM auth.tokens WHERE id=$1',[answer.token_id])).toEqual([{user_id:null,group_id:team.id,group_role:'editor',issued_by:'warehouse',grant_id:grant}]);
 expect(await host.introspect(answer.access_token)).toMatchObject({active:true,principal_kind:'group',user_id:null,group_id:team.id,group_role:'editor',issued_by:'warehouse'});
 // It acts as the group: reads and edits the group's page, creates in the group.
 expect((await host.api(answer.access_token,'GET',`/api/artifacts/${page}`)).status).toBe(200);
 expect((await host.api(answer.access_token,'POST','/api/artifacts',{title:'Nightly',html:'<!doctype html><html><head></head><body><p>Nightly</p></body></html>'})).status).toBe(201);
 // The group's Admins see it as its approval's row among the agents signed in as the group, labelled with the service.
 const listed=(await host.signIns(ada,team.id)).body!;
 expect(listed.services).toEqual([expect.objectContaining({grant_id:grant,service_id:'warehouse',role:'editor',count:1})]);
 expect(listed.sign_ins).toEqual([]);
 // Audited as a mint by the group, naming the approval and the service.
 await expect.poll(async()=>sql("SELECT subject_kind,subject_id,payload->>'grant_id' AS grant_id,payload->>'service' AS service FROM events.events WHERE verb='minted' AND object_id=$1",[answer.token_id]))
  .toEqual([{subject_kind:'group',subject_id:team.id,grant_id:grant,service:'warehouse'}]);
});

it('refuses every other ask: no opt-in or a wrong secret is an unknown route; another service\'s approval, a revoked one, a deleted group are refused',async()=>{
 const host=await composed(),{ada,team,squad}=await tree(host);
 const grant=String((await host.approve(ada,team.id,'warehouse','member')).body!.id);
 // Not opted in, the installation's own secret, a wrong secret, no secret: exactly what an unknown sibling path answers.
 for(const secret of [LEDGER_SECRET,SECRET,'not-a-configured-secret','']){
  const unknown=await host.groupSignIn(secret,{grant_id:grant},'/api/internal/identity/no-such-route');
  expect(await host.groupSignIn(secret,{grant_id:grant}),secret||'no secret').toEqual(unknown);
 }
 // Another opted-in service presenting Warehouse's approval.
 expect(await host.groupSignIn(CRM_SECRET,{grant_id:grant})).toEqual({status:403,body:{error:'grant_refused'}});
 // Asking for anything but the approval (a level, a group) is malformed; so is an expiry that is not seconds.
 for(const body of [{grant_id:grant,group_role:'admin'},{grant_id:grant,group_id:squad.id},{},{grant_id:'not-a-grant'}])expect((await host.groupSignIn(WAREHOUSE_SECRET,body)).status,JSON.stringify(body)).toBe(400);
 expect(await host.groupSignIn(WAREHOUSE_SECRET,{grant_id:grant,expires_in:'1h'})).toEqual({status:400,body:{error:'invalid_expiry'}});
 // Revoked: refused. A deleted group's approval: refused.
 expect((await host.revoke(ada,team.id,grant)).status).toBe(204);
 expect(await host.groupSignIn(WAREHOUSE_SECRET,{grant_id:grant})).toEqual({status:403,body:{error:'grant_refused'}});
 const leaf=String((await host.approve(ada,squad.id,'warehouse','member')).body!.id);
 await deleteGroup(ada.userId,squad.id,'sg_squad');
 expect(await host.groupSignIn(WAREHOUSE_SECRET,{grant_id:leaf})).toEqual({status:403,body:{error:'grant_refused'}});
 expect(await sql('SELECT count(*)::int AS n FROM auth.tokens WHERE grant_id IS NOT NULL')).toEqual([{n:0}]);
});

it('lives only while its approval does: revoking it or deleting the group ends it; the approver losing Admin does not',async()=>{
 const host=await composed(),{ada,rob,squad,page,team}=await tree(host);
 const grant=String((await host.approve(rob,team.id,'warehouse','member')).body!.id);
 const token=String((await host.groupSignIn(WAREHOUSE_SECRET,{grant_id:grant})).body!.access_token);
 // The Admin who approved it is no longer one: the approval is the group's, and stands.
 await setGroupMember(ada.userId,(await sql<{group_id:string}>("SELECT group_id FROM group_members WHERE user_id=$1",[rob.userId]))[0]!.group_id,rob.userId,'member');
 expect((await host.api(token,'GET',`/api/artifacts/${page}`)).status).toBe(200);
 // Revoked: ended on the next request.
 expect((await host.revoke(ada,team.id,grant)).status).toBe(204);
 expect(await host.introspect(token)).toEqual({active:false});
 expect((await host.api(token,'GET',`/api/artifacts/${page}`)).status).not.toBe(200);
 expect(await sql('SELECT live FROM tokens WHERE grant_id=$1',[grant])).toEqual([{live:false}]);
 // A deleted group ends what was issued under its approval.
 const leaf=String((await host.approve(ada,squad.id,'warehouse','member')).body!.id);
 const leafToken=String((await host.groupSignIn(WAREHOUSE_SECRET,{grant_id:leaf})).body!.access_token);
 expect(await host.introspect(leafToken)).toMatchObject({active:true});
 await deleteGroup(ada.userId,squad.id,'sg_squad');
 expect(await host.introspect(leafToken)).toEqual({active:false});
});

it('the opt-in is explicit and needs the service\'s own secret',()=>{
 const entry={id:'warehouse',origin:'http://warehouse.localhost:7444',introspection_secret_sha256:'a'.repeat(64)};
 expect(parseServiceAudiences(JSON.stringify([entry]))[0]).not.toHaveProperty('groupSignIns');
 expect(parseServiceAudiences(JSON.stringify([{...entry,group_sign_ins:true}]))[0]!.groupSignIns).toBe(true);
 for(const bad of [{...entry,group_sign_ins:'yes'},{id:'warehouse',origin:'http://warehouse.localhost:7444',group_sign_ins:true}])
  expect(()=>parseServiceAudiences(JSON.stringify([bad])),JSON.stringify(bad)).toThrow(/IDENTITY__SERVICE_AUDIENCES/);
});

it('audits every approval and every revocation: who, which group, which service and which level',async()=>{
 const host=await composed(),{ada,team}=await tree(host);
 const grant=String((await host.approve(ada,team.id,'warehouse','editor')).body!.id);
 // Approving it again changes nothing, and records nothing.
 expect((await host.approve(ada,team.id,'warehouse','editor')).body).toEqual({id:grant});
 expect((await host.revoke(ada,team.id,grant)).status).toBe(204);
 const details={grant_id:grant,service_id:'warehouse',role:'editor'};
 expect(await sql("SELECT actor_user_id,group_id,action,details FROM group_audit WHERE action LIKE 'service_sign_in_%' ORDER BY action")).toEqual([
  {actor_user_id:ada.userId,group_id:team.id,action:'service_sign_in_approved',details},
  {actor_user_id:ada.userId,group_id:team.id,action:'service_sign_in_revoked',details}]);
 await expect.poll(async()=>sql("SELECT subject_kind,subject_id,object_kind,object_id,payload->>'action' AS action FROM events.events WHERE verb='changed' AND payload->>'action' LIKE 'service_sign_in_%' ORDER BY payload->>'action'"))
  .toEqual([{subject_kind:'user',subject_id:ada.userId,object_kind:'group',object_id:team.id,action:'service_sign_in_approved'},{subject_kind:'user',subject_id:ada.userId,object_kind:'group',object_id:team.id,action:'service_sign_in_revoked'}]);
});

it('a test account approves nothing, and an approval a test account made issues nothing and keeps nothing live',async()=>{
 const host=await composed(),{ada,rob,team,page}=await tree(host);
 const tess=await host.signIn('mxmx_test_sg_tess@example.test');
 await admitGroupMember(ada.userId,team.id,tess.userId,'admin');
 await sql('UPDATE auth.users SET test_account=true WHERE id=$1',[tess.userId]);
 expect(await host.approve(tess,team.id,'warehouse','member')).toMatchObject({status:403,body:{error:'test_account_restricted'}});
 expect(await sql('SELECT count(*)::int AS n FROM group_sign_in_grants')).toEqual([{n:0}]);
 // Rob approved and the service signed in; his account then becomes a test account: nothing issued under it stands.
 const grant=String((await host.approve(rob,team.id,'warehouse','member')).body!.id);
 const token=String((await host.groupSignIn(WAREHOUSE_SECRET,{grant_id:grant})).body!.access_token);
 expect((await host.api(token,'GET',`/api/artifacts/${page}`)).status).toBe(200);
 await sql('UPDATE auth.users SET test_account=true WHERE id=$1',[rob.userId]);
 expect(await host.introspect(token)).toEqual({active:false});
 expect((await host.api(token,'GET',`/api/artifacts/${page}`)).status).not.toBe(200);
 expect(await host.groupSignIn(WAREHOUSE_SECRET,{grant_id:grant})).toEqual({status:403,body:{error:'grant_refused'}});
 expect((await host.grants(WAREHOUSE_SECRET)).body).toEqual({approvals:[]});
});

it('a service\'s sign-in lives at most a day, and only while that service is still configured with the opt-in at the origin it was approved at',async()=>{
 const host=await composed(),{ada,team,page}=await tree(host);
 const grant=String((await host.approve(ada,team.id,'warehouse','member')).body!.id);
 const left=(body:Record<string,unknown>|null)=>Date.parse(String(body!.expires_at))-Date.now();
 const long=await host.groupSignIn(WAREHOUSE_SECRET,{grant_id:grant,expires_in:365*86400});
 expect(long.status,JSON.stringify(long.body)).toBe(200);
 expect(left(long.body)).toBeLessThanOrEqual(24*3600*1000);
 expect(left(long.body)).toBeGreaterThan(23*3600*1000);
 // Unasked, it stays short (six hours).
 const short=left((await host.groupSignIn(WAREHOUSE_SECRET,{grant_id:grant})).body);
 expect(short).toBeLessThanOrEqual(6*3600*1000);
 expect(short).toBeGreaterThan(5*3600*1000);
 const token=String(long.body!.access_token),tokenId=String(long.body!.token_id);
 expect((await host.api(token,'GET',`/api/artifacts/${page}`)).status).toBe(200);
 /** The installation reconfigured (the app's settings and a new host's), and what each reader then makes of the token. */
 const reconfigured=async(audiences:string)=>{
  overrideConfig({internalServiceSecret:SECRET,publicBaseUrl:origin},{IDENTITY__SERVICE_AUDIENCES:audiences});await syncIdentitySettings(await getDb());
  const next=await composed(audiences);
  const reader=createBearerReader({db:await getDb() as unknown as Queryable,authSchema:'auth',readSchema:'identity',serviceAudiences:parseServiceAudiences(audiences)});
  return {host:next,bearer:await reader.byToken(token),app:await liveGroupSignIn(tokenId),read:(await next.api(token,'GET',`/api/artifacts/${page}`)).status,introspected:await next.introspect(token)};
 };
 const ledger=delegatedService('ledger','http://ledger.localhost:7445',LEDGER_SECRET);
 const CHANGES:Record<string,string>={
  'the opt-in removed':serviceAudiences(delegatedService('warehouse','http://warehouse.localhost:7444',WAREHOUSE_SECRET),ledger),
  'the entry removed':serviceAudiences(ledger),
  'another service under the old id':serviceAudiences({...delegatedService('warehouse','http://warehouse-two.localhost:7447',WAREHOUSE_SECRET),group_sign_ins:true},ledger),
 };
 for(const [change,audiences] of Object.entries(CHANGES)){
  const seen=await reconfigured(audiences);
  expect({bearer:seen.bearer,app:seen.app,introspected:seen.introspected},change).toEqual({bearer:null,app:null,introspected:{active:false}});
  expect(seen.read,change).not.toBe(200);
  // Nor is a new one issued, and the approval is not listed to whoever holds the id now.
  expect((await seen.host.groupSignIn(WAREHOUSE_SECRET,{grant_id:grant})).status,change).not.toBe(200);
  expect((await seen.host.grants(WAREHOUSE_SECRET)).body?.approvals ?? [],change).toEqual([]);
  // Its Admins still see the approval, marked as no longer that service's, and may revoke it.
  expect((await seen.host.approvals(ada,team.id)).body!.approvals,change).toEqual([expect.objectContaining({id:grant,configured:false})]);
 }
 // The same service configured again, at its own origin with the opt-in: the approval is its own once more.
 const back=await reconfigured(AUDIENCES);
 expect(back.bearer).toMatchObject({id:tokenId,groupId:team.id});
 expect(back.read).toBe(200);
});

it('a service lists its own live approvals and nobody else\'s, through a route hidden as the sign-in route is',async()=>{
 const host=await composed(),{ada,rob,root,team,squad}=await tree(host);
 const editor=String((await host.approve(ada,team.id,'warehouse','editor')).body!.id);
 const member=String((await host.approve(rob,root.id,'warehouse','member')).body!.id);
 const crm=String((await host.approve(ada,team.id,'crm','member')).body!.id);
 const gone=String((await host.approve(ada,team.id,'warehouse','member')).body!.id);
 expect((await host.revoke(ada,team.id,gone)).status).toBe(204);
 const leaf=String((await host.approve(ada,squad.id,'warehouse','member')).body!.id);
 await deleteGroup(ada.userId,squad.id,'sg_squad');
 const listed=await host.grants(WAREHOUSE_SECRET);
 expect(listed).toEqual({status:200,body:{approvals:[
  {id:editor,group_id:team.id,group_handle:'sg_team',group_name:'Team',role:'editor',approved_at:expect.any(String)},
  {id:member,group_id:root.id,group_handle:'sg_root',group_name:'Root',role:'member',approved_at:expect.any(String)},
 ]}});
 expect(JSON.stringify(listed.body)).not.toContain(leaf);
 expect((await host.grants(CRM_SECRET)).body).toEqual({approvals:[expect.objectContaining({id:crm,group_id:team.id,role:'member'})]});
 // Not opted in, the installation's own secret, a wrong secret, no secret: exactly what an unknown sibling path answers.
 for(const secret of [LEDGER_SECRET,SECRET,'not-a-configured-secret','']){
  const unknown=await host.grants(secret,{},'/api/internal/identity/no-such-route');
  expect(await host.grants(secret),secret||'no secret').toEqual(unknown);
 }
 // It takes no question: another group or service is not askable.
 expect((await host.grants(WAREHOUSE_SECRET,{service_id:'crm'})).status).toBe(400);
 // What it lists is what the sign-in route takes.
 expect((await host.groupSignIn(WAREHOUSE_SECRET,{grant_id:editor})).status).toBe(200);
});

it('shows an Admin a service\'s sign-ins as one row per approval with their count, and people\'s in full, page by page',async()=>{
 const host=await composed(),{ada,eve,team}=await tree(host);
 const grant=String((await host.approve(ada,team.id,'warehouse','editor')).body!.id);
 for(let i=0;i<3;i++)expect((await host.groupSignIn(WAREHOUSE_SECRET,{grant_id:grant})).status).toBe(200);
 const people:string[]=[];
 for(let i=0;i<3;i++)people.push(await eve.asGroup(team.id,'editor'));
 const first=await host.signIns(ada,team.id,'?limit=2');
 expect(first.status,JSON.stringify(first.body)).toBe(200);
 expect(first.body!.services).toEqual([{grant_id:grant,service_id:'warehouse',role:'editor',count:3,last_issued_at:expect.any(String),approved_at:expect.any(String)}]);
 const second=await host.signIns(ada,team.id,`?limit=2&cursor=${String(first.body!.next_cursor)}`);
 expect(second.status,JSON.stringify(second.body)).toBe(200);
 expect(second.body!.next_cursor).toBeNull();
 const ids=[...first.body!.sign_ins as Array<{id:string}>,...second.body!.sign_ins as Array<{id:string}>].map(row=>row.id);
 expect(ids).toEqual([...people].reverse());
 expect((await host.signIns(ada,team.id,'?cursor=not-a-cursor')).status).toBe(400);
 // Revoking the approval ends all three, and its row goes.
 expect((await host.revoke(ada,team.id,grant)).status).toBe(204);
 expect((await host.signIns(ada,team.id)).body!.services).toEqual([]);
});

it('counts in an Admin\'s list only a service\'s sign-ins that would be accepted, by the same rules that refuse them on use',async()=>{
 const host=await composed(),{ada,rob,team,page}=await tree(host);
 const grant=String((await host.approve(rob,team.id,'warehouse','editor')).body!.id);
 const token=String((await host.groupSignIn(WAREHOUSE_SECRET,{grant_id:grant})).body!.access_token);
 const listed=async(on=host)=>(await on.signIns(ada,team.id)).body!.services;
 const counted=[expect.objectContaining({grant_id:grant,count:1})];
 expect(await listed()).toEqual(counted);
 /** What the token gets on use, and whether the list counts it, must agree. */
 const agrees=async(change:string,accepted:boolean,on=host)=>{
  expect((await on.api(token,'GET',`/api/artifacts/${page}`)).status===200,change).toBe(accepted);
  expect(await listed(on),change).toEqual(accepted?counted:[]);
 };
 // The approver became a test account: refused on use, so not counted.
 await sql('UPDATE auth.users SET test_account=true WHERE id=$1',[rob.userId]);
 await agrees('approver a test account',false);
 await sql('UPDATE auth.users SET test_account=false WHERE id=$1',[rob.userId]);
 await agrees('approver an account again',true);
 // The approval has no recorded service origin.
 const recorded=(await sql<{service_origin:string}>('SELECT service_origin FROM auth.group_sign_in_grants WHERE id=$1',[grant]))[0]!.service_origin;
 await sql('UPDATE auth.group_sign_in_grants SET service_origin=NULL WHERE id=$1',[grant]);
 await agrees('no recorded origin',false);
 await sql('UPDATE auth.group_sign_in_grants SET service_origin=$2 WHERE id=$1',[grant,recorded]);
 await agrees('origin recorded again',true);
 // The service removed, its opt-in lost, or configured at another origin.
 const ledger=delegatedService('ledger','http://ledger.localhost:7445',LEDGER_SECRET);
 const CHANGES:Record<string,string>={
  'the opt-in removed':serviceAudiences(delegatedService('warehouse','http://warehouse.localhost:7444',WAREHOUSE_SECRET),ledger),
  'the entry removed':serviceAudiences(ledger),
  'another origin':serviceAudiences({...delegatedService('warehouse','http://warehouse-two.localhost:7447',WAREHOUSE_SECRET),group_sign_ins:true},ledger),
  'configured as approved':AUDIENCES,
 };
 for(const [change,audiences] of Object.entries(CHANGES)){
  overrideConfig({internalServiceSecret:SECRET,publicBaseUrl:origin},{IDENTITY__SERVICE_AUDIENCES:audiences});await syncIdentitySettings(await getDb());
  await agrees(change,audiences===AUDIENCES,await composed(audiences));
 }
});
