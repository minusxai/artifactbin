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
import {GROUP_SIGN_IN_PATH,IDENTITY_INTROSPECT_PATH,SERVICE_AUTH_HEADER,parseServiceAudiences,type GroupSignIn} from '@artifactbin/contracts';
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

async function composed(){
 const application=await createAuthComposedHost({APP__PUBLIC_BASE_URL:origin,AUTH__SECRET:AUTH_SECRET,INTERNAL__SERVICE_SECRET:SECRET,IDENTITY__SERVICE_AUDIENCES:AUDIENCES,EMAIL__DEV_OUTBOX_PATH:join(directory,'outbox.jsonl')});
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
  return {cookie,token,userId:(await sql<{id:string}>('SELECT id FROM users WHERE email=$1',[email]))[0]!.id};
 };
 /** The group settings API, as a person in their browser. */
 const approvals=(who:{cookie:string},group:string)=>send('GET',`/api/groups/${group}/service-sign-ins`,{cookie:who.cookie});
 const approve=(who:{cookie:string},group:string,service_id:string,role:string)=>send('POST',`/api/groups/${group}/service-sign-ins`,{cookie:who.cookie},{service_id,role});
 const revoke=(who:{cookie:string},group:string,id:string)=>send('DELETE',`/api/groups/${group}/service-sign-ins/${id}`,{cookie:who.cookie});
 /** The service's own call: its secret and the approval. */
 const groupSignIn=(secret:string,body:unknown,path=GROUP_SIGN_IN_PATH)=>send('POST',path,{[SERVICE_AUTH_HEADER]:secret},body);
 const api=(token:string,method:string,path:string,body?:unknown)=>send(method,path,{authorization:`Bearer ${token}`},body);
 const introspect=async(token:string)=>(await send('POST',IDENTITY_INTROSPECT_PATH,{[SERVICE_AUTH_HEADER]:SECRET},{token})).body;
 return {approvals,approve,revoke,groupSignIn,api,introspect,signIn,send};
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
  {id:direct.body!.id,service_id:'warehouse',role:'editor',created_at:expect.any(String),approved_by:expect.objectContaining({id:ada.userId})},
  {id:inherited.body!.id,service_id:'crm',role:'member',created_at:expect.any(String),approved_by:expect.objectContaining({id:rob.userId})},
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
 // The group's Admins see it among the agents signed in as the group, labelled with the service.
 const listed=(await host.send('GET',`/api/groups/${team.id}/sign-ins`,{cookie:ada.cookie})).body!.sign_ins as Array<Record<string,unknown>>;
 expect(listed).toContainEqual(expect.objectContaining({id:answer.token_id,role:'editor',service:'warehouse'}));
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
