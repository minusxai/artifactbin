/**
 * AN AGENT SIGNED IN AS A GROUP (contracts identity-service `GROUP_SIGN_IN_RULE`), end to end on the composed host: a
 * person with a verified session who holds at least a level on a group obtains, through the skill's sign-in door, a
 * sign-in whose principal is the group itself at that level, naming the authorising person for audit; it is live only while that still
 * holds, refreshes as a person's does, introspects as the group, is listed and revoked by the person and by the group's
 * Admins, is never taken for an unowned token, and (until the access rule admits it) every app route refuses it with
 * one code.
 */
import {readFile,readdir,stat,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {beforeEach,expect,it,onTestFinished} from 'vitest';
import {GROUP_PRINCIPAL_REFUSED} from '@artifactbin/contracts/actor';
import {GROUP_PRINCIPALS_NOT_ACCEPTED, SERVICE_TOKEN_PATH} from '@artifactbin/contracts/service-audiences';
import {IDENTITY_INTROSPECT_PATH} from '@artifactbin/contracts/identity-service';
import {SERVICE_AUTH_HEADER} from '@artifactbin/contracts/routes';
import {createAuthComposedHost} from '@/test/helpers/auth-host';
import {AUTH_SECRET,getDb,syncIdentitySettings} from '@/lib/platform';
import {overrideConfig} from '@/lib/platform/config';
import {createGroup,deleteGroup,removeGroupMember,setGroupMember,setGroupParent} from '@/lib/groups';
import {resolveTokenById} from '@/lib/accounts';
import {admitGroupMember,useAppHarness} from './harness';
import {tempDir} from '@artifactbin/test-support/temp-dir';
import {otpSignIn,serviceAudiences,delegatedService} from '../../auth/__tests__/helpers';
import {authCommand} from '../skills/artifactbin/scripts/auth.mjs';
import {makeClient} from '../skills/artifactbin/scripts/toolbox-client.mjs';
useAppHarness();
const SECRET='group-sign-in-test-service-secret',origin='http://localhost:3000';
const AUDIENCES=serviceAudiences(delegatedService('warehouse','http://warehouse.localhost:7444','warehouse-secret'));
let directory='';
beforeEach(async()=>{overrideConfig({internalServiceSecret:SECRET,publicBaseUrl:origin},{IDENTITY__SERVICE_AUDIENCES:AUDIENCES});await syncIdentitySettings(await getDb());directory=await tempDir('group-sign-in-',onTestFinished);});

const sql=async<T=Record<string,unknown>>(text:string,params:unknown[]=[])=>(await (await getDb()).query<T>(text,params)).rows;
const userIdOf=async(email:string)=>(await sql<{id:string}>('SELECT id FROM users WHERE email=$1',[email]))[0]!.id;
const otpOf=async(email:string)=>(await readFile(join(directory,'outbox.jsonl'),'utf8')).trim().split('\n').map(line=>JSON.parse(line)).filter(message=>message.to===email).at(-1).otp as string;

async function composed(){
 const application=await createAuthComposedHost({APP__PUBLIC_BASE_URL:origin,AUTH__SECRET:AUTH_SECRET,INTERNAL__SERVICE_SECRET:SECRET,IDENTITY__SERVICE_AUDIENCES:AUDIENCES,EMAIL__DEV_OUTBOX_PATH:join(directory,'outbox.jsonl')});
 const fetch=(request:Request)=>application.fetch(request);
 const post=(path:string,body:unknown,headers:Record<string,string>={})=>fetch(new Request(origin+path,{method:'POST',headers:{origin,'content-type':'application/json',...headers},body:JSON.stringify(body)}));
 const json=async(response:Response)=>({status:response.status,body:await response.json().catch(()=>null) as Record<string,unknown>|null});
 const signIn=async(email:string)=>{
  const {login,cookie}=await otpSignIn(post,email,()=>otpOf(email),{prefix:'/api/auth'});
  expect(login.status).toBe(200);
  const grant=await (await post('/api/authentication/token',{},{cookie})).json() as {id:string;access_token:string};
  return {cookie,grant,userId:await userIdOf(email)};
 };
 /** The skill's sign-in door, asking for a group's sign-in. */
 const asGroup=async(cookie:string,group_id:string,group_role:string)=>json(await post('/api/authentication/token',{group_id,group_role},{cookie}));
 const api=(token:string,path='/api/artifacts')=>fetch(new Request(origin+path,{headers:{authorization:`Bearer ${token}`}}));
 const introspect=async(token:string)=>(await json(await post(IDENTITY_INTROSPECT_PATH,{token},{[SERVICE_AUTH_HEADER]:SECRET}))).body;
 const refresh=async(grant:{client_id:string;refresh_token:string})=>json(await post('/oauth/token',{grant_type:'refresh_token',client_id:grant.client_id,refresh_token:grant.refresh_token}));
 const live=async(id:string)=>(await sql<{live:boolean}>('SELECT live FROM tokens WHERE id=$1',[id]))[0]?.live;
 const myTokens=async(cookie:string)=>(await (await fetch(new Request(origin+'/api/my/tokens',{headers:{cookie}}))).json() as {tokens:Array<Record<string,unknown>>}).tokens;
 return {fetch,post,json,signIn,asGroup,api,introspect,refresh,live,myTokens};
}
type Grant={id:string;access_token:string;refresh_token:string;client_id:string;group_id:string;group_role:string};

/** A three-level tree: Root (Ada created all three; Rob administers Root only) > Team (Eve edits, Max is a member) > Squad. */
async function tree(host:Awaited<ReturnType<typeof composed>>){
 const ada=await host.signIn('mxmx_test_gs_ada@example.test'),eve=await host.signIn('mxmx_test_gs_eve@example.test');
 const max=await host.signIn('mxmx_test_gs_max@example.test'),out=await host.signIn('mxmx_test_gs_out@example.test');
 const rob=await host.signIn('mxmx_test_gs_rob@example.test');
 const root=await createGroup(ada.userId,{handle:'gs_root',name:'Root'});
 const team=await createGroup(ada.userId,{handle:'gs_team',name:'Team',parent_id:root.id});
 const squad=await createGroup(ada.userId,{handle:'gs_squad',name:'Squad',parent_id:team.id});
 await admitGroupMember(ada.userId,team.id,eve.userId,'admin');
 await admitGroupMember(ada.userId,team.id,max.userId,'member');
 await admitGroupMember(ada.userId,root.id,rob.userId,'admin');
 // Rob holds no row below Root: what he holds on Team and Squad is the inherited Admin rule alone.
 expect(await sql('SELECT group_id FROM group_members WHERE user_id=$1',[rob.userId])).toEqual([{group_id:root.id}]);
 return {ada,eve,max,out,rob,root,team,squad};
}

it('obtains a group sign-in at each level a person holds, and refuses every other ask',async()=>{
 const host=await composed(),{ada,eve,max,out,root,team,squad}=await tree(host);
 // Held: an Admin (direct on Root, inherited on Team and Squad) at both levels; a direct Admin at both; a Member at member.
 for(const [who,group,role] of [[ada,root,'editor'],[ada,team,'editor'],[ada,squad,'member'],[eve,team,'editor'],[eve,team,'member'],[max,team,'member']] as const){
  const issued=await host.asGroup(who.cookie,group.id,role);
  expect(issued.status,`${group.name} ${role}`).toBe(201);
  expect(issued.body).toMatchObject({group_id:group.id,group_role:role,token_type:'Bearer',refresh_token:expect.stringMatching(/^mxr_/),resource:`${origin}/api`,scope:'artifacts'});
  expect(await sql('SELECT user_id,group_id,group_role,issued_by,grant_id,audience FROM auth.tokens WHERE id=$1',[issued.body!.id])).toEqual([{user_id:null,group_id:group.id,group_role:role,issued_by:who.userId,grant_id:null,audience:`${origin}/api`}]);
  expect(await host.live(String(issued.body!.id))).toBe(true);
  expect(await sql('SELECT user_id,group_id,group_role FROM tokens WHERE id=$1',[issued.body!.id])).toEqual([{user_id:who.userId,group_id:group.id,group_role:role}]);
  // Audited as a mint for the person who authorised it, naming the group.
  await expect.poll(async()=>sql("SELECT subject_id,payload->>'group_id' AS group_id FROM events.events WHERE verb='minted' AND object_kind='token' AND object_id=$1",[issued.body!.id])).toEqual([{subject_id:who.userId,group_id:group.id}]);
 }
 // Not held: a Member asking editor, a Member outside its group, someone outside, a deleted or unknown group.
 for(const [who,group,role] of [[max,team.id,'editor'],[max,squad.id,'member'],[out,team.id,'member'],[max,root.id,'member'],[ada,'grp_nowhere','member']] as const)
  expect(await host.asGroup(who.cookie,group,role),`${group} ${role}`).toEqual({status:403,body:{error:'group_level_not_held',hint:expect.any(String)}});
 // Malformed: admin is never a level, a level with no group, a group with an audience.
 expect((await host.asGroup(ada.cookie,team.id,'admin')).body).toMatchObject({error:'invalid_group_sign_in'});
 expect((await host.json(await host.post('/api/authentication/token',{group_role:'member'},{cookie:ada.cookie}))).body).toMatchObject({error:'invalid_group_sign_in'});
 expect((await host.json(await host.post('/api/authentication/token',{group_id:team.id,group_role:'member',audience:'warehouse'},{cookie:ada.cookie}))).body).toMatchObject({error:'invalid_group_sign_in'});
 // A bearer (even the person's own) never obtains one: the door takes a verified browser session only.
 expect((await host.json(await host.post('/api/authentication/token',{group_id:team.id,group_role:'member'},{authorization:`Bearer ${ada.grant.access_token}`}))).status).toBe(401);
 // Nothing was written for any refusal.
 expect(await sql('SELECT count(*)::int AS n FROM auth.tokens WHERE group_id IS NOT NULL')).toEqual([{n:6}]);
});

it('an Admin of an ancestor alone holds both levels below it, lists and revokes there, and loses them with the ancestor role or the edge',async()=>{
 const host=await composed(),{ada,rob,max,root,team,squad}=await tree(host);
 const sign=async(group:string,role:string)=>{const issued=await host.asGroup(rob.cookie,group,role);expect(issued.status,`${group} ${role}`).toBe(201);return issued.body as unknown as Grant;};
 const onSquad=await sign(squad.id,'editor'),onTeam=await sign(team.id,'member');
 expect(await host.introspect(onSquad.access_token)).toMatchObject({principal_kind:'group',group_id:squad.id,group_role:'editor',issued_by:rob.userId});
 // He sees and revokes sign-ins on a subgroup he administers through Root, whoever authorised them.
 const maxs=(await host.asGroup(max.cookie,team.id,'member')).body as unknown as Grant;
 const listed=await host.json(await host.fetch(new Request(`${origin}/api/groups/${team.id}/sign-ins`,{headers:{cookie:rob.cookie}})));
 expect((listed.body!.sign_ins as Array<{id:string}>).map(row=>row.id).sort()).toEqual([onTeam.id,maxs.id].sort());
 expect((await host.fetch(new Request(`${origin}/api/groups/${team.id}/sign-ins/${maxs.id}`,{method:'DELETE',headers:{cookie:rob.cookie,origin}}))).status).toBe(204);
 expect(await host.live(maxs.id)).toBe(false);
 // The edge goes (Team moved to the top level): nothing below Root is his any more.
 await setGroupParent(ada.userId,team.id,null,root.id);
 for(const grant of [onSquad,onTeam]){expect(await host.live(grant.id)).toBe(false);expect(await host.introspect(grant.access_token)).toEqual({active:false});}
 expect((await host.asGroup(rob.cookie,squad.id,'member')).status).toBe(403);
 // The edge back, then the ancestor role goes: the same.
 await setGroupParent(ada.userId,team.id,root.id,null);
 const again=await sign(squad.id,'member');
 await setGroupMember(ada.userId,root.id,rob.userId,'member');
 expect(await host.live(again.id)).toBe(false);
 expect((await host.asGroup(rob.cookie,squad.id,'member')).status).toBe(403);
 // A Root member is a member of Root alone: Editor and Member never flow down.
 expect((await host.asGroup(rob.cookie,root.id,'member')).status).toBe(201);
});

it('acts as the group, not the person: introspection, the lists, and one refusal at every app route',async()=>{
 const host=await composed(),{ada,eve,team}=await tree(host);
 const issued=(await host.asGroup(eve.cookie,team.id,'editor')).body as unknown as Grant;
 expect(await host.introspect(issued.access_token)).toEqual({active:true,principal_kind:'group',user_id:eve.userId,token_id:issued.id,scopes:['artifacts'],audience:`${origin}/api`,expires_at:expect.any(String),parent:null,group_id:team.id,group_role:'editor',issued_by:eve.userId});
 // The person's own sign-in still introspects as the person.
 expect(await host.introspect(eve.grant.access_token)).toMatchObject({principal_kind:'user',user_id:eve.userId,group_id:null});
 // Every route the app does not admit for a group's sign-in (server/group-admission) answers the one refusal: the
 // listing, a download, the account's lists, the group's own administration. What it admits is group-principal-access's.
 const page=(await (await host.post('/api/artifacts',{title:'Public',html:'<div><h1>Public</h1></div>',visibility:'public'},{authorization:`Bearer ${eve.grant.access_token}`})).json() as {id:string}).id;
 for(const path of ['/api/artifacts','/api/me',`/a/${page}/download`,'/api/my/tokens',`/api/groups/${team.id}`]){
  const refused=await host.api(issued.access_token,path);
  expect(refused.status,path).toBe(403);
  expect(await refused.json(),path).toMatchObject({error:GROUP_PRINCIPAL_REFUSED});
 }
 // A public page reads as it would for a member of the group.
 expect((await host.api(issued.access_token,`/api/artifacts/${page}`)).status).toBe(200);
 // Never exchanged for a service that does not opt in to group principals (group-service-tokens.test.ts has those that do).
 expect(await host.json(await host.post(SERVICE_TOKEN_PATH,{audience:'warehouse'},{authorization:`Bearer ${issued.access_token}`}))).toMatchObject({status:403,body:{error:GROUP_PRINCIPALS_NOT_ACCEPTED}});
 // The person sees it among their tokens, labelled with the group and level; the group's Admin sees it on the group.
 expect((await host.myTokens(eve.cookie)).find(token=>token.id===issued.id)).toMatchObject({group:{id:team.id,name:'Team',role:'editor'},status:'active'});
 expect((await host.myTokens(eve.cookie)).find(token=>token.id===issued.id)).not.toHaveProperty('issued_by');
 expect((await host.myTokens(ada.cookie)).some(token=>token.id===issued.id)).toBe(false);
 const listed=await host.json(await host.fetch(new Request(`${origin}/api/groups/${team.id}/sign-ins`,{headers:{cookie:ada.cookie}})));
 expect(listed.body!.sign_ins).toEqual([expect.objectContaining({id:issued.id,role:'editor',issued_by:expect.objectContaining({id:eve.userId}),live:true})]);
 expect(JSON.stringify(listed.body)).not.toContain(issued.access_token);
 expect((await host.fetch(new Request(`${origin}/api/groups/${team.id}/sign-ins`,{headers:{cookie:eve.cookie}}))).status).toBe(200);
});

it('is live only while its rule holds: demotion, removal, deactivation, deletion and either revocation end it',async()=>{
 const host=await composed(),{ada,eve,max,root,team,squad}=await tree(host);
 const sign=async(who:{cookie:string},group:string,role:string)=>(await host.asGroup(who.cookie,group,role)).body as unknown as Grant;
 const refusedAsNoOne=async(grant:Grant)=>{expect(await host.live(grant.id)).toBe(false);expect(await host.introspect(grant.access_token)).toEqual({active:false});expect((await host.api(grant.access_token)).status).not.toBe(200);};
 // Demotion below the level: Eve's editor sign-in ends; her member one keeps going.
 const editor=await sign(eve,team.id,'editor'),member=await sign(eve,team.id,'member');
 await setGroupMember(ada.userId,team.id,eve.userId,'member');
 await refusedAsNoOne(editor);
 expect(await host.live(member.id)).toBe(true);
 // Removal from the group ends the rest.
 await removeGroupMember(ada.userId,team.id,eve.userId);
 await refusedAsNoOne(member);
 // An inherited admin's sign-in ends when the ancestor role goes; the account no longer active ends Max's.
 const inherited=await sign(ada,squad.id,'editor');
 expect(await host.live(inherited.id)).toBe(true);
 const maxs=await sign(max,team.id,'member');
 await sql("UPDATE users SET kind='guest' WHERE id=$1",[max.userId]);
 await refusedAsNoOne(maxs);
 await sql("UPDATE users SET kind='account' WHERE id=$1",[max.userId]);
 // A test account reaches through a group no further than it may itself: it signs no agent in as one.
 const testAccount=await sign(max,team.id,'member');
 await sql('UPDATE auth.users SET test_account=true WHERE id=$1',[max.userId]);
 await refusedAsNoOne(testAccount);
 expect((await host.asGroup(max.cookie,team.id,'member')).status).toBe(403);
 await sql('UPDATE auth.users SET test_account=false WHERE id=$1',[max.userId]);
 // Deleting the group (Squad, a leaf) ends every sign-in as it.
 await deleteGroup(ada.userId,squad.id,'gs_squad');
 await refusedAsNoOne(inherited);
 // The person revokes their own; an Admin of an ancestor revokes anyone's.
 const own=await sign(ada,root.id,'member');
 expect((await host.fetch(new Request(`${origin}/api/my/tokens/${own.id}`,{method:'DELETE',headers:{cookie:ada.cookie,origin}}))).status).toBe(204);
 await refusedAsNoOne(own);
 const theirs=await sign(max,team.id,'member');
 expect((await host.fetch(new Request(`${origin}/api/groups/${team.id}/sign-ins/${theirs.id}`,{method:'DELETE',headers:{cookie:max.cookie,origin}}))).status).toBe(403);
 expect((await host.fetch(new Request(`${origin}/api/groups/${root.id}/sign-ins/${theirs.id}`,{method:'DELETE',headers:{cookie:ada.cookie,origin}}))).status).toBe(404);
 expect((await host.fetch(new Request(`${origin}/api/groups/${team.id}/sign-ins/${theirs.id}`,{method:'DELETE',headers:{cookie:ada.cookie,origin}}))).status).toBe(204);
 await refusedAsNoOne(theirs);
 // Someone else's person token is never revocable as a group's sign-in.
 expect((await host.fetch(new Request(`${origin}/api/groups/${team.id}/sign-ins/${max.grant.id}`,{method:'DELETE',headers:{cookie:ada.cookie,origin}}))).status).toBe(404);
 expect(await host.live(max.grant.id)).toBe(true);
 await expect.poll(async()=>sql("SELECT subject_id FROM events.events WHERE verb='revoked' AND object_kind='token' AND object_id=$1",[theirs.id])).toEqual([{subject_id:ada.userId}]);
});

it('refreshes as a person\'s does, re-checking the rule each time; a replay or a lapsed rule ends the family',async()=>{
 const host=await composed(),{ada,eve,team}=await tree(host);
 const first=(await host.asGroup(eve.cookie,team.id,'editor')).body as unknown as Grant;
 const rotated=await host.refresh(first);
 expect(rotated.status).toBe(200);
 expect(rotated.body).toMatchObject({group_id:team.id,group_role:'editor',refresh_token:expect.stringMatching(/^mxr_/)});
 const second=await host.introspect(String(rotated.body!.access_token));
 expect(second).toMatchObject({principal_kind:'group',group_id:team.id,group_role:'editor',issued_by:eve.userId});
 // A replayed refresh token revokes the whole family.
 expect((await host.refresh(first)).body).toMatchObject({error:'invalid_grant'});
 expect(await host.introspect(String(rotated.body!.access_token))).toEqual({active:false});
 // A fresh sign-in, then the rule lapses: the refresh answers invalid_grant (never "retry later") and the family ends,
 // so holding the level again later does not bring it back.
 const next=(await host.asGroup(eve.cookie,team.id,'editor')).body as unknown as Grant;
 await setGroupMember(ada.userId,team.id,eve.userId,'member');
 expect(await host.refresh(next)).toEqual({status:400,body:{error:'invalid_grant',error_description:expect.any(String)}});
 await setGroupMember(ada.userId,team.id,eve.userId,'admin');
 expect(await host.live(next.id)).toBe(false);
 expect((await host.refresh(next)).body).toMatchObject({error:'invalid_grant'});
});

it('is never taken for an unowned token, and a malformed group row is live for no one',async()=>{
 const host=await composed(),{eve,team}=await tree(host);
 const issued=(await host.asGroup(eve.cookie,team.id,'member')).body as unknown as Grant;
 // The agent-cookie and browser-session read by id: a group's sign-in is not a token it resolves.
 expect(await resolveTokenById(issued.id)).toBeNull();
 // An unowned token (no person, no group) stays as it was: never live in the view.
 await sql("INSERT INTO auth.tokens(id,name,token_hash) VALUES('tok_unowned','x','hash_unowned')");
 expect(await host.live('tok_unowned')).toBe(false);
 // Rows no writer makes are live for no one: a person AND a group, an admin level, an approval (not in this change).
 for(const [column,value] of [['user_id',eve.userId],['group_role','admin'],['grant_id','sgg_1']] as const){
  await sql(`UPDATE auth.tokens SET ${column}=$2 WHERE id=$1`,[issued.id,value]);
  expect(await host.live(issued.id),column).toBe(false);
  expect(await host.introspect(issued.access_token),column).toEqual({active:false});
  await sql(`UPDATE auth.tokens SET ${column}=$2 WHERE id=$1`,[issued.id,column==='group_role'?'member':null]);
 }
 expect(await host.live(issued.id)).toBe(true);
});

it('the consent page says the agent acts as the group at that level, and its code becomes the group\'s sign-in',async()=>{
 const host=await composed(),{eve,team}=await tree(host);
 const client=await (await host.post('/oauth/register',{client_name:'agent',redirect_uris:['http://127.0.0.1:9/callback']})).json() as {client_id:string};
 const verifier='v'.repeat(43),challenge=(await import('node:crypto')).createHash('sha256').update(verifier).digest('base64url');
 const query=(group_role:string)=>new URLSearchParams({client_id:client.client_id,redirect_uri:'http://127.0.0.1:9/callback',response_type:'code',code_challenge:challenge,code_challenge_method:'S256',state:'s',group_id:team.id,group_role});
 const consent=await host.fetch(new Request(`${origin}/oauth/authorize?${query('editor')}`,{headers:{cookie:eve.cookie}}));
 const html=await consent.text();
 expect(consent.status).toBe(200);
 expect(html).toContain('act as the group <strong>Team</strong> at <strong>editor</strong> level, not as you');
 // A level not held: no page to approve.
 await setGroupMember((await userIdOf('mxmx_test_gs_ada@example.test')),team.id,eve.userId,'member');
 expect((await host.fetch(new Request(`${origin}/oauth/authorize?${query('editor')}`,{headers:{cookie:eve.cookie}}))).status).toBe(403);
 // Approving a forged field set is checked again at the approval.
 const form=(group_role:string)=>new URLSearchParams({...Object.fromEntries(query(group_role)),resource:`${origin}/api`,scope:'artifacts',action:'approve'});
 const forged=await host.fetch(new Request(`${origin}/oauth/authorize/approve`,{method:'POST',headers:{cookie:eve.cookie,origin,'content-type':'application/x-www-form-urlencoded'},body:form('editor')}));
 expect(forged.status).toBe(403);
 const approved=await host.fetch(new Request(`${origin}/oauth/authorize/approve`,{method:'POST',headers:{cookie:eve.cookie,origin,'content-type':'application/x-www-form-urlencoded'},body:form('member')}));
 expect(approved.status).toBe(303);
 const code=new URL(approved.headers.get('location')!).searchParams.get('code')!;
 const token=await host.json(await host.post('/oauth/token',{grant_type:'authorization_code',client_id:client.client_id,code,code_verifier:verifier,redirect_uri:'http://127.0.0.1:9/callback'}));
 expect(token.body).toMatchObject({group_id:team.id,group_role:'member',token_type:'Bearer'});
 expect(await host.introspect(String(token.body!.access_token))).toMatchObject({principal_kind:'group',group_id:team.id,group_role:'member',issued_by:eve.userId});
});

/** Every file under `root` with its bytes (directories marked), for "nothing else was touched". */
async function files(root:string):Promise<Record<string,string>>{
 const out:Record<string,string>={};
 for(const name of await readdir(root,{recursive:true})){const file=join(root,name);out[name]=(await stat(file)).isFile()?await readFile(file,'utf8'):'dir';}
 return out;
}

it('the skill signs in as the group into its own file beside the user\'s, says who each acts as, and every script can be told to use it',async()=>{
 const host=await composed(),{eve,team}=await tree(host);
 const home=join(directory,'home'),env={ARTIFACTBIN_HOME:home};
 const fetcher=async(url:RequestInfo|URL,init?:RequestInit)=>host.fetch(new Request(url,init));
 const auth=(sub:string,values:Record<string,unknown>,extra:Record<string,string>={})=>authCommand({sub,values:{server:origin,...values},positionals:[]},{env:{...env,...extra},fetcher});
 const login=async(values:Record<string,unknown>)=>{
  const {challenge}=await auth('login',{email:'mxmx_test_gs_eve@example.test'});
  await writeFile(join(directory,'code.txt'),await otpOf('mxmx_test_gs_eve@example.test'));
  return auth('login',{challenge,'code-file':join(directory,'code.txt'),...values});
 };
 expect(await login({})).toMatchObject({authenticated:true,actsAs:'user'});
 const person=await files(home);
 expect(await login({'as-group':team.id,level:'editor'})).toMatchObject({authenticated:true,actsAs:{group:team.id,level:'editor'}});
 const after=await files(home);
 // The user's file is untouched; the group's sits beside it.
 const userFile=Object.keys(person).find(name=>name.endsWith('credentials.env'))!;
 expect(after[userFile]).toBe(person[userFile]);
 const groupFile=Object.keys(after).find(name=>name.endsWith(`group-${team.id}.env`))!;
 expect(after[groupFile]).toMatch(new RegExp(`^ARTIFACTBIN_URL=${origin}\\nARTIFACTBIN_GROUP=${team.id}\\nARTIFACTBIN_GROUP_ROLE=editor\\nARTIFACTBIN_TOKEN=mx_`));
 // status proves each with the server and says who it acts as.
 expect(await auth('status',{})).toMatchObject({authenticated:true,actsAs:'user',source:'private-store'});
 expect(await auth('status',{'as-group':team.id})).toMatchObject({authenticated:true,actsAs:{group:team.id,level:'editor'}});
 expect(await auth('status',{},{ARTIFACTBIN_AS_GROUP:team.id})).toMatchObject({actsAs:{group:team.id,level:'editor'}});
 // ARTIFACTBIN_AS_GROUP makes any script's client use the group's sign-in (refused at the app until it admits groups).
 const asGroup=makeClient(origin,{env:{...env,ARTIFACTBIN_AS_GROUP:team.id},fetcher});
 await expect(asGroup.request('/api/artifacts')).rejects.toMatchObject({code:GROUP_PRINCIPAL_REFUSED});
 await expect(makeClient(origin,{env,fetcher}).request('/api/artifacts')).resolves.toBeTruthy();
 // The selector wins over an environment grant, in the client and in status alike.
 const both={...env,ARTIFACTBIN_URL:origin,ARTIFACTBIN_TOKEN:eve.grant.access_token,ARTIFACTBIN_AS_GROUP:team.id};
 await expect(makeClient(origin,{env:both,fetcher}).request('/api/artifacts')).rejects.toMatchObject({code:GROUP_PRINCIPAL_REFUSED});
 expect(await authCommand({sub:'status',values:{server:origin},positionals:[]},{env:both,fetcher})).toMatchObject({source:'private-store',actsAs:{group:team.id,level:'editor'}});
 await expect(makeClient(origin,{env:{...both,ARTIFACTBIN_AS_GROUP:''},fetcher}).request('/api/artifacts')).resolves.toBeTruthy();
 // Malformed asks never reach the server.
 await expect(auth('login',{challenge:'00000000-0000-0000-0000-000000000000','code-file':'x','as-group':team.id})).rejects.toMatchObject({code:'invalid_group'});
 await expect(auth('login',{challenge:'00000000-0000-0000-0000-000000000000','code-file':'x','as-group':team.id,level:'admin'})).rejects.toMatchObject({code:'invalid_group'});
 // logout --as-group ends the group's sign-in on the server and removes only its file (the user's status refreshed theirs).
 const refreshed=(await files(home))[userFile];
 expect(await auth('logout',{'as-group':team.id})).toMatchObject({serverRevoked:true,localGrantRemoved:true});
 const out=await files(home);
 expect(out[groupFile]).toBeUndefined();
 expect(out[userFile]).toBe(refreshed);
 expect(await auth('status',{'as-group':team.id})).toMatchObject({authenticated:false});
 expect(await sql('SELECT count(*)::int AS n FROM tokens WHERE group_id=$1 AND live',[team.id])).toEqual([{n:0}]);
 expect(await auth('status',{})).toMatchObject({authenticated:true,actsAs:'user'});
});
