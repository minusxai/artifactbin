/**
 * RUN SIGN-INS (contracts `RUN_SIGN_IN_PATH`), end to end on the composed host: a configured service that opted in
 * (`run_sign_ins`) presents its own secret and a person's exchanged token for its own audience, and receives an
 * ordinary API sign-in for that person: a stored access token with the skill sign-in's audience and scope, no refresh
 * token, `issued_by` the service's id, live only while the credential the exchanged token came from is. The person
 * lists and revokes it with their other tokens, and the skill's client works from a sign-in file holding only the
 * answer, until its expiry, then refuses as it refuses any lapsed sign-in.
 */
import {chmod,mkdir,readFile,readdir,stat,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {join} from 'node:path';
import {afterEach,beforeEach,expect,it,onTestFinished,vi} from 'vitest';
import {DEFAULT_TOKEN_TTL_MS, MAX_TOKEN_TTL_MS, MIN_TOKEN_TTL_MS} from '@artifactbin/contracts/handles';
import {IDENTITY_INTROSPECT_PATH} from '@artifactbin/contracts/identity-service';
import {CHAT_SIGN_IN_PATH, RUN_SIGN_IN_PATH, SCHEDULE_SIGN_IN_PATH, SERVICE_TOKEN_PATH, type ChatSignInRequest, type RunSignIn, type ScheduleSignInRequest} from '@artifactbin/contracts/service-audiences';
import {SERVICE_AUTH_HEADER} from '@artifactbin/contracts/routes';
import {createAuthComposedHost} from '@/test/helpers/auth-host';
import {AUTH_SECRET,getDb,syncIdentitySettings} from '@/lib/platform';
import {overrideConfig} from '@/lib/platform/config';
import {useAppHarness} from './harness';
import {tempDir} from '@artifactbin/test-support/temp-dir';
import {delegatedService,otpSignIn,serviceAudiences} from '../../auth/__tests__/helpers';
import {makeClient,toolFailure} from '../skills/artifactbin/scripts/toolbox-client.mjs';
useAppHarness();
const SECRET='run-sign-in-test-service-secret',origin='http://localhost:3000';
const WAREHOUSE='http://warehouse.localhost:7444',WAREHOUSE_SECRET='warehouse-introspection-secret',LEDGER_SECRET='ledger-introspection-secret',CRM_SECRET='crm-introspection-secret';
// Warehouse and CRM opted in; Ledger has its own secret and nothing else.
const AUDIENCES=serviceAudiences({...delegatedService('warehouse',WAREHOUSE,WAREHOUSE_SECRET),run_sign_ins:true,group_principals:true},delegatedService('ledger','http://ledger.localhost:7445',LEDGER_SECRET),
 {...delegatedService('crm','http://crm.localhost:7446',CRM_SECRET),run_sign_ins:true});
let directory='';
beforeEach(async()=>{overrideConfig({internalServiceSecret:SECRET,publicBaseUrl:origin},{IDENTITY__SERVICE_AUDIENCES:AUDIENCES});await syncIdentitySettings(await getDb());directory=await tempDir('run-sign-in-',onTestFinished);});
afterEach(()=>{vi.useRealTimers();});

async function composed(){
 const application=await createAuthComposedHost({APP__PUBLIC_BASE_URL:origin,AUTH__SECRET:AUTH_SECRET,INTERNAL__SERVICE_SECRET:SECRET,IDENTITY__SERVICE_AUDIENCES:AUDIENCES,EMAIL__DEV_OUTBOX_PATH:join(directory,'outbox.jsonl')});
 const fetch=(request:Request)=>application.fetch(request);
 const post=(path:string,body:unknown,headers:Record<string,string>={})=>fetch(new Request(origin+path,{method:'POST',headers:{origin,'content-type':'application/json',...headers},body:JSON.stringify(body)}));
 const json=async(response:Response)=>({status:response.status,body:await response.json().catch(()=>null) as Record<string,unknown>|null});
 const signIn=async(email:string)=>{
  const {login,cookie}=await otpSignIn(post,email,async()=>(await readFile(join(directory,'outbox.jsonl'),'utf8')).trim().split('\n').map(line=>JSON.parse(line)).filter(message=>message.to===email).at(-1).otp,{prefix:'/api/auth'});
  expect(login.status).toBe(200);
  const grant=await (await post('/api/authentication/token',{},{cookie})).json() as {id:string;access_token:string;refresh_token:string;client_id:string};
  return {cookie,grant};
 };
 /** The exchange, as a page (`cookie`) or an agent (`bearer`) does it: a five-minute token for `audience`. */
 const exchange=async(audience:string,credential:{cookie:string}|{bearer:string})=>{
  const response=await post(SERVICE_TOKEN_PATH,{audience},'cookie' in credential?{cookie:credential.cookie}:{authorization:`Bearer ${credential.bearer}`});
  expect(response.status).toBe(200);
  return (await response.json() as {access_token:string}).access_token;
 };
 const runSignIn=async(body:unknown,secret=WAREHOUSE_SECRET,path=RUN_SIGN_IN_PATH)=>json(await post(path,body,{[SERVICE_AUTH_HEADER]:secret}));
 const api=(token:string)=>fetch(new Request(origin+'/api/artifacts',{headers:{authorization:`Bearer ${token}`}}));
 const introspect=async(token:string)=>(await json(await post(IDENTITY_INTROSPECT_PATH,{token},{[SERVICE_AUTH_HEADER]:SECRET}))).body;
 const myTokens=async(cookie:string)=>(await (await fetch(new Request(origin+'/api/my/tokens',{headers:{cookie}}))).json() as {tokens:Array<Record<string,unknown>>}).tokens;
 return {fetch,post,signIn,exchange,runSignIn,api,introspect,myTokens};
}
const sql=async<T=Record<string,unknown>>(text:string,params:unknown[]=[])=>(await (await getDb()).query<T>(text,params)).rows;
const userIdOf=async(email:string)=>(await sql<{id:string}>('SELECT id FROM users WHERE email=$1',[email]))[0]!.id;

it('authorizes only the consenting direct seat and permanently fences revoked or departed schedule runs',async()=>{
 const host=await composed(),email='mxmx_test_schedule_owner@example.test';
 const {cookie}=await host.signIn(email), user=await userIdOf(email);
 const group='grp_schedule', other='grp_other', child='grp_child';
 await sql("INSERT INTO auth.groups(id,handle,name,created_by,parent_id) VALUES($1,'schedule','Schedule',$4,NULL),($2,'other','Other',$4,NULL),($3,'child','Child',$4,$1)",[group,other,child,user]);
 const addSeat=()=>sql("INSERT INTO auth.group_members(group_id,user_id,role) VALUES($1,$2,'admin')",[group,user]);
 const removeSeat=()=>sql('DELETE FROM auth.group_members WHERE group_id=$1 AND user_id=$2',[group,user]);
 await addSeat();
 const call=(body:ScheduleSignInRequest,secret=WAREHOUSE_SECRET)=>host.runSignIn(body,secret,SCHEDULE_SIGN_IN_PATH);
 const token=await host.exchange('warehouse',{cookie});
 const consent={action:'consent' as const,token,group_id:group,schedule_id:'schedule-demo',revision:'revision-1'};
 for(const scope of [other,child])expect((await call({...consent,group_id:scope})).status).toBe(403);
 expect((await call(consent,CRM_SECRET)).status).toBe(401);
 const issued=await call(consent);
 expect(issued).toEqual({status:200,body:{grant_id:expect.any(String),user_id:user,group_id:group,group_role:'member'}});
 expect(await call(consent)).toEqual(issued);
 expect((await call({...consent,revision:'revision-2'})).status).toBe(409);
 const action={grant_id:String(issued.body!.grant_id),schedule_id:consent.schedule_id,revision:consent.revision};
 expect((await call({...action,action:'issue'},CRM_SECRET)).status).toBe(403);
 expect((await call({...action,action:'revoke'},CRM_SECRET)).status).toBe(403);
 expect((await call({...action,action:'issue',revision:'stale'})).status).toBe(403);
 const issue=async(input=action)=>{
  const run=await call({...input,action:'issue',expires_in:600});
  expect(run.status).toBe(200);
  const bearer=String(run.body!.access_token);
  expect(await host.introspect(bearer)).toMatchObject({active:true,principal_kind:'group',user_id:user,group_id:group,group_role:'member'});
  return bearer;
 };
 const first=await issue();
 const exchanged=await host.exchange('warehouse',{bearer:first});
 expect(await host.introspect(exchanged)).toMatchObject({active:true,group_id:group,group_role:'member'});
 await removeSeat();
 expect(await host.introspect(first)).toEqual({active:false});
 await addSeat();
 expect(await host.introspect(exchanged)).toEqual({active:false});
 expect(await host.introspect(first)).toEqual({active:false});
 expect((await call({...action,action:'issue'})).status).toBe(403);
 expect((await call(consent)).status).toBe(409);
 for(let attempt=0;attempt<2;attempt++)expect((await call({...action,action:'revoke'})).status).toBe(200);
 const fresh={...consent,revision:'revision-2'};
 const next=await call(fresh);
 expect(next.status).toBe(200);
 const current={...action,grant_id:String(next.body!.grant_id),revision:fresh.revision};
 const last=await issue(current);
 expect((await call({...current,action:'revoke'})).status).toBe(200);
 expect(await host.introspect(last)).toEqual({active:false});
 expect((await call(fresh)).status).toBe(409);
});

it('confines explicit interactive Admin consent to its owner, context, service and one group',async()=>{
 const host=await composed();
 const owner=await host.signIn('mxmx_test_interactive_owner@example.test');
 const peer=await host.signIn('mxmx_test_interactive_peer@example.test');
 const groupFor=async(handle:string,cookie=owner.cookie,parent_id?:string)=>{
  const response=await host.post('/api/groups',{handle,name:handle,...(parent_id?{parent_id}:{})},{cookie});
  expect(response.status,await response.clone().text()).toBe(201);
  return (await response.json() as {id:string}).id;
 };
 const root=await groupFor('interactive_root'), group=await groupFor('interactive_team',owner.cookie,root);
 const child=await groupFor('interactive_child',owner.cookie,group), other=await groupFor('interactive_other');
 const peerId=await userIdOf('mxmx_test_interactive_peer@example.test');
 const user=await userIdOf('mxmx_test_interactive_owner@example.test');
 await sql("INSERT INTO auth.group_members(group_id,user_id,role) VALUES($1,$2,'admin'),($3,$2,'admin')",[root,peerId,group]);
 // The owner is effective Admin via the root, with no direct seat on this group.
 await sql('DELETE FROM auth.group_members WHERE group_id=$1 AND user_id=$2',[group,user]);
 const token=await host.exchange('warehouse',{cookie:owner.cookie});
 const scope={group_id:group,chat_id:'conversation-demo'};
 const call=(body:unknown,secret=WAREHOUSE_SECRET)=>host.runSignIn(body,secret,CHAT_SIGN_IN_PATH);
 const consent={...scope,action:'consent',token,group_role:'admin'} satisfies ChatSignInRequest;
 const recorded=await call(consent);
 expect(recorded).toEqual({status:200,body:{grant_id:expect.any(String),user_id:user,group_id:group,group_role:'admin'}});
 expect(await call(consent)).toEqual(recorded);
 expect((await call({...consent,group_id:other})).status).toBe(409);
 const peerToken=await host.exchange('warehouse',{cookie:peer.cookie});
 expect((await call({...consent,token:peerToken,group_id:other,chat_id:'forbidden-context'})).status).toBe(403);
 expect((await call(consent,LEDGER_SECRET)).status).toBe(404);
 const action={...scope,grant_id:String(recorded.body!.grant_id)};
 const issue={...action,action:'issue',expires_in:600,token};
 for(const denied of [{...issue,chat_id:'elsewhere'},{...issue,group_id:other},
  {...issue,token:peerToken},
  {...issue,token:await host.exchange('warehouse',{bearer:owner.grant.access_token})}])
  expect((await call(denied)).status).toBe(403);
 expect((await call(issue,CRM_SECRET)).status).toBe(401);
 expect((await call({...action,action:'revoke'},CRM_SECRET)).status).toBe(403);
 expect((await call({...action,action:'revoke',group_id:other})).status).toBe(403);
 expect((await call({...action,action:'revoke',chat_id:'elsewhere'})).status).toBe(403);
 const mint=async(body=issue)=>{
  const answer=await call(body);
  expect(answer.status,JSON.stringify(answer.body)).toBe(200);
  return String(answer.body!.access_token);
 };
 const bearer=await mint();
 const auth=(bearer:string)=>({authorization:'Bearer '+bearer});
 const patch=(id:string,bearer:string,body:Record<string,unknown>={description:'Updated in context'})=>
  host.fetch(new Request(origin+'/api/groups/'+id,{method:'PATCH',headers:{...auth(bearer),'content-type':'application/json'},body:JSON.stringify(body)}));
 expect(await host.introspect(bearer)).toMatchObject({active:true,principal_kind:'group',group_role:'admin',group_id:group,user_id:user});
 expect((await patch(group,bearer)).status).toBe(200);
 expect(await sql('SELECT description FROM groups WHERE id=$1',[group])).toEqual([{description:'Updated in context'}]);
 expect(await sql("SELECT actor_user_id,actor_token_id FROM group_audit WHERE group_id=$1 AND action='updated'",[group]))
  .toEqual([{actor_user_id:user,actor_token_id:(await host.introspect(bearer))!.token_id}]);
 for(const id of [other,root,child])expect((await patch(id,bearer)).status).toBe(403);
 expect((await patch(group,bearer,{tenancy_id:'other-tenant'})).status).toBe(403);
 expect((await host.post('/api/deployment/setup',{group_id:group},auth(bearer))).status).toBe(403);
 expect((await host.fetch(new Request(origin+'/api/me',{headers:auth(bearer)}))).status).toBe(403);
 const exchanged=await host.exchange('warehouse',{bearer});
 expect(await host.introspect(exchanged)).toMatchObject({active:true,principal_kind:'group',group_role:'admin',group_id:group,user_id:user});
 expect((await host.post(SERVICE_TOKEN_PATH,{audience:'crm'},auth(bearer))).status).toBe(403);
 expect((await call({...consent,token:exchanged,chat_id:'secondary'})).status).toBe(401);
 expect((await host.runSignIn({token:exchanged})).status).toBe(401);
 expect((await host.runSignIn({token,group_id:group,group_role:'admin'})).status).toBe(400);
 expect((await host.post('/api/authentication/token',{group_id:group,group_role:'admin'},{cookie:owner.cookie})).status).toBe(400);
 const changeRole=async(role:string)=>host.fetch(new Request(origin+'/api/groups/'+root+'/members/'+user,{
  method:'PUT',headers:{cookie:peer.cookie,origin,'content-type':'application/json'},body:JSON.stringify({role})
 }));
 expect((await changeRole('member')).status).toBe(200);
 expect((await patch(group,bearer)).status).toBe(401);
 expect((await changeRole('admin')).status).toBe(200);
 expect(await host.introspect(exchanged)).toEqual({active:false});
 expect(await host.introspect(bearer)).toEqual({active:false});
 expect((await call(issue)).status).toBe(403);
 expect((await call(consent)).status).toBe(409);

 const freshConsent={...consent,chat_id:'another-conversation'};
 const fresh=await call(freshConsent);
 const current={...issue,chat_id:freshConsent.chat_id,grant_id:String(fresh.body!.grant_id)};
 const second=await mint(current), secondExchange=await host.exchange('warehouse',{bearer:second});
 const revoke={action:'revoke',group_id:group,chat_id:current.chat_id,grant_id:String(current.grant_id)} satisfies ChatSignInRequest;
 for(let attempt=0;attempt<2;attempt++)expect(await call(revoke)).toEqual({status:200,body:{ok:true}});
 expect(await host.introspect(second)).toEqual({active:false});
 expect(await host.introspect(secondExchange)).toEqual({active:false});
 expect((await call(current)).status).toBe(403);

 const movedConsent={...consent,chat_id:'inherited-conversation'};
 const movedGrant=await call(movedConsent);
 const movedIssue={...issue,chat_id:movedConsent.chat_id,grant_id:String(movedGrant.body!.grant_id)};
 const movedBearer=await mint(movedIssue);
 const setParent=async(parent_id:string|null,from_parent_id:string|null)=>host.fetch(new Request(origin+'/api/groups/'+group+'/parent',{
  method:'PUT',headers:{cookie:peer.cookie,origin,'content-type':'application/json'},body:JSON.stringify({parent_id,from_parent_id})
 }));
 expect((await setParent(null,root)).status).toBe(200);
 expect((await setParent(root,null)).status).toBe(200);
 expect(await host.introspect(movedBearer)).toEqual({active:false});
 expect((await call(movedIssue)).status).toBe(403);

 const finalConsent={...consent,chat_id:'session-bound-conversation'};
 const finalGrant=await call(finalConsent);
 const finalIssue={...issue,chat_id:finalConsent.chat_id,grant_id:String(finalGrant.body!.grant_id)};
 const last=await mint(finalIssue), lastExchange=await host.exchange('warehouse',{bearer:last});
 expect((await host.post('/api/auth/sign-out',{},{cookie:owner.cookie})).status).toBe(200);
 expect(await host.introspect(last)).toEqual({active:false});
 expect(await host.introspect(lastExchange)).toEqual({active:false});
 expect((await call(finalIssue)).status).toBe(401);

 const personalToken=await host.exchange('warehouse',{bearer:peer.grant.access_token});
 const tokenConsent={...consent,chat_id:'bearer-bound-conversation',token:personalToken};
 const tokenGrant=await call(tokenConsent);
 const tokenIssue={...issue,chat_id:tokenConsent.chat_id,grant_id:String(tokenGrant.body!.grant_id),token:personalToken};
 const tokenRun=await mint(tokenIssue), tokenExchange=await host.exchange('warehouse',{bearer:tokenRun});
 expect((await host.post('/oauth/revoke',{client_id:peer.grant.client_id,token:peer.grant.refresh_token})).status).toBe(200);
 expect(await host.introspect(tokenRun)).toEqual({active:false});
 expect(await host.introspect(tokenExchange)).toEqual({active:false});
 expect((await call(tokenIssue)).status).toBe(401);
});

it('the happy path: a stored API token for the person, issued_by the service, no refresh family, listed and revocable by them',async()=>{
 const host=await composed(),email='mxmx_test_run_owner@example.test';
 const {cookie,grant}=await host.signIn(email);
 const user=await userIdOf(email);
 const before=Date.now();
 const issued=await host.runSignIn({token:await host.exchange('warehouse',{bearer:grant.access_token}),expires_in:7200});
 expect(issued.status).toBe(200);
 const answer=issued.body as unknown as RunSignIn;
 expect(answer).toEqual({access_token:expect.stringMatching(/^mx_/),token_type:'Bearer',token_id:expect.stringMatching(/^tok_/),expires_at:expect.any(String),expires_at_ms:Date.parse(answer.expires_at),server:origin});
 expect(answer.expires_at_ms-before).toBeGreaterThanOrEqual(7200_000-5000);expect(answer.expires_at_ms-before).toBeLessThanOrEqual(7200_000+5000);
 expect(answer).not.toHaveProperty('refresh_token');
 // An ordinary sign-in at this installation's API, as the person.
 expect((await host.api(answer.access_token)).status).toBe(200);
 // It publishes as the person, exactly as the person's own sign-in does.
 const publish=async(token:string,title:string)=>{
  const response=await host.fetch(new Request(origin+'/api/artifacts',{method:'POST',headers:{authorization:`Bearer ${token}`,'content-type':'application/json'},body:JSON.stringify({title,html:`<div><h1>${title}</h1></div>`})}));
  expect(response.status,await response.clone().text()).toBe(201);
  return (await response.json() as {id:string}).id;
 };
 const byRun=await publish(answer.access_token,'From the run'),byLogin=await publish(grant.access_token,'From the laptop');
 expect(await sql('SELECT user_id,group_id FROM artifacts WHERE id=ANY($1::text[]) ORDER BY title',[[byRun,byLogin]])).toEqual([{user_id:user,group_id:null},{user_id:user,group_id:null}]);
 expect(await sql('SELECT token_id FROM artifacts WHERE id=$1',[byRun])).toEqual([{token_id:answer.token_id}]);
 expect(await sql('SELECT user_id,audience,scope,issued_by,group_id,group_role,grant_id FROM auth.tokens WHERE id=$1',[answer.token_id])).toEqual([{user_id:user,audience:`${origin}/api`,scope:'artifacts',issued_by:'warehouse',group_id:null,group_role:null,grant_id:null}]);
 expect(await sql("SELECT 1 FROM auth.credentials WHERE kind IN ('refresh_token','refresh_family') AND (payload->>'access_token_id'=$1 OR payload->'access_ids' ? $1)",[answer.token_id])).toEqual([]);
 expect(await sql('SELECT live FROM identity.tokens WHERE id=$1',[answer.token_id])).toEqual([{live:true}]);
 expect(await host.introspect(answer.access_token)).toEqual({active:true,principal_kind:'user',user_id:user,token_id:answer.token_id,scopes:['artifacts'],audience:`${origin}/api`,expires_at:answer.expires_at,parent:null,group_id:null,group_role:null,issued_by:'warehouse'});
 // Every other token still introspects with issued_by null.
 expect(await host.introspect(grant.access_token)).toMatchObject({active:true,issued_by:null});
 // Audited as a mint, for the person.
 await expect.poll(async()=>sql("SELECT subject_id FROM events.events WHERE verb='minted' AND object_kind='token' AND object_id=$1",[answer.token_id])).toEqual([{subject_id:user}]);
 // Listed with the service's id, and revoked there: refused at once.
 const listed=(await host.myTokens(cookie)).find(token=>token.id===answer.token_id);
 expect(listed).toMatchObject({id:answer.token_id,name:'run-warehouse',issued_by:'warehouse',status:'active'});
 expect((await host.myTokens(cookie)).find(token=>token.id===grant.id)).not.toHaveProperty('issued_by');
 const revoked=await host.fetch(new Request(`${origin}/api/my/tokens/${answer.token_id}`,{method:'DELETE',headers:{cookie,origin}}));
 expect(revoked.status).toBe(204);
 expect((await host.api(answer.access_token)).status).toBe(401);
 expect(await host.introspect(answer.access_token)).toEqual({active:false});
});

it('lives only while its parent does: revoking the parent token or signing out ends it; a parent revoked before refuses the mint',async()=>{
 const host=await composed(),email='mxmx_test_run_parent@example.test';
 const {cookie,grant}=await host.signIn(email);
 const fromToken=await host.runSignIn({token:await host.exchange('warehouse',{bearer:grant.access_token})});
 const fromSession=await host.runSignIn({token:await host.exchange('warehouse',{cookie})});
 const lateExchange=await host.exchange('warehouse',{bearer:grant.access_token});
 for(const issued of [fromToken,fromSession])expect((await host.api(String(issued.body!.access_token))).status).toBe(200);
 // The parent token revoked: the sign-in it gave ends on the next request, and reads expired in the list.
 expect((await host.post('/oauth/revoke',{client_id:grant.client_id,token:grant.refresh_token})).status).toBe(200);
 expect((await host.api(String(fromToken.body!.access_token))).status).toBe(401);
 expect(await sql('SELECT live FROM identity.tokens WHERE id=$1',[fromToken.body!.token_id])).toEqual([{live:false}]);
 expect((await host.myTokens(cookie)).find(token=>token.id===fromToken.body!.token_id)).toMatchObject({status:'expired',issued_by:'warehouse'});
 // An exchanged token whose parent is already revoked obtains nothing.
 expect(await host.runSignIn({token:lateExchange})).toEqual({status:401,body:{error:'unauthorized'}});
 // The session's sign-in is untouched until the person signs out.
 expect((await host.api(String(fromSession.body!.access_token))).status).toBe(200);
 expect((await host.post('/api/auth/sign-out',{},{cookie})).status).toBe(200);
 expect((await host.api(String(fromSession.body!.access_token))).status).toBe(401);
});

it('refuses everything else: no opt-in or a wrong secret answer as an unknown route; another audience, expiry, an inactive account, an ordinary bearer and a run sign-in as parent are refused',async()=>{
 const host=await composed(),email='mxmx_test_run_refused@example.test';
 const {grant}=await host.signIn(email);
 const user=await userIdOf(email);
 const warehouse=await host.exchange('warehouse',{bearer:grant.access_token}),ledger=await host.exchange('ledger',{bearer:grant.access_token});
 // Not opted in, the installation's own secret, a wrong secret, no secret: exactly what an unknown sibling path answers.
 for(const secret of [LEDGER_SECRET,SECRET,'not-a-configured-secret','']){
  const unknown=await host.runSignIn({token:secret===LEDGER_SECRET?ledger:warehouse},secret,'/api/internal/identity/no-such-route');
  expect(await host.runSignIn({token:secret===LEDGER_SECRET?ledger:warehouse},secret),secret||'no secret').toEqual(unknown);
  expect(unknown.status).toBeGreaterThanOrEqual(400);
 }
 // The exchanged token for another audience: Ledger's at Warehouse, Warehouse's at CRM (both opted in).
 expect(await host.runSignIn({token:ledger})).toEqual({status:401,body:{error:'unauthorized'}});
 expect(await host.runSignIn({token:warehouse},CRM_SECRET)).toEqual({status:401,body:{error:'unauthorized'}});
 // An ordinary bearer in place of the exchanged token, and no token at all.
 expect(await host.runSignIn({token:grant.access_token})).toEqual({status:401,body:{error:'unauthorized'}});
 expect(await host.runSignIn({})).toEqual({status:400,body:{error:'bad_request'}});
 expect(await host.runSignIn({token:warehouse,user_id:'usr_someone_else'})).toEqual({status:400,body:{error:'bad_request'}});
 // An inactive account.
 await sql("UPDATE users SET kind='guest' WHERE id=$1",[user]);
 expect(await host.runSignIn({token:warehouse})).toEqual({status:401,body:{error:'unauthorized'}});
 await sql("UPDATE users SET kind='account' WHERE id=$1",[user]);
 // A run sign-in is never the parent of another.
 const first=await host.runSignIn({token:warehouse});
 expect(first.status).toBe(200);
 expect(await host.runSignIn({token:await host.exchange('warehouse',{bearer:String(first.body!.access_token)})})).toEqual({status:403,body:{error:'parent_not_eligible'}});
 // Expired: the exchanged token's five minutes are over.
 vi.useFakeTimers({toFake:['Date'],now:Date.now()+301_000});
 expect(await host.runSignIn({token:warehouse})).toEqual({status:401,body:{error:'unauthorized'}});
 vi.useRealTimers();
 expect(await sql('SELECT count(*)::int AS n FROM auth.tokens WHERE issued_by IS NOT NULL')).toEqual([{n:1}]);
});

it('clamps the lifetime asked to the token bounds, defaults it, and refuses a malformed one',async()=>{
 const host=await composed();
 const {grant}=await host.signIn('mxmx_test_run_ttl@example.test');
 const lifetime=async(expires_in?:unknown)=>{
  const before=Date.now(),issued=await host.runSignIn({token:await host.exchange('warehouse',{bearer:grant.access_token}),...(expires_in===undefined?{}:{expires_in})});
  expect(issued.status).toBe(200);
  return Math.round((Number(issued.body!.expires_at_ms)-before)/60_000)*60_000;
 };
 expect(await lifetime(60)).toBe(MIN_TOKEN_TTL_MS);
 expect(await lifetime(10*365*24*3600)).toBe(MAX_TOKEN_TTL_MS);
 expect(await lifetime(3*3600)).toBe(3*3600_000);
 expect(await lifetime()).toBe(DEFAULT_TOKEN_TTL_MS);
 for(const expires_in of ['3600',-1,0,null])
  expect(await host.runSignIn({token:await host.exchange('warehouse',{bearer:grant.access_token}),expires_in}),String(expires_in)).toEqual({status:400,body:{error:'invalid_expiry'}});
 // The mint's bound: at most 50 live run sign-ins per person and service; then rate_limited, with nothing written.
 const user=await userIdOf('mxmx_test_run_ttl@example.test');
 for(let i=0;i<46;i++)await sql("INSERT INTO auth.tokens(id,name,token_hash,user_id,expires_at,issued_by) VALUES($1,'run-warehouse',$2,$3,now()+interval '1 hour','warehouse')",[`tok_cap${i}`,`hash_cap${i}`,user]);
 const capped=await host.runSignIn({token:await host.exchange('warehouse',{bearer:grant.access_token})});
 expect(capped).toEqual({status:429,body:{error:'rate_limited',retry_after:3600}});
 expect(await sql("SELECT count(*)::int AS n FROM auth.tokens WHERE issued_by='warehouse'")).toEqual([{n:50}]);
});

/** Every file under `root`, with its bytes and modification time. */
async function tree(root:string):Promise<Record<string,string>>{
 const out:Record<string,string>={};
 for(const name of await readdir(root,{recursive:true})){
  const file=join(root,name),info=await stat(file);
  out[name]=info.isFile()?`${info.mtimeMs}:${await readFile(file,'utf8')}`:'dir';
 }
 return out;
}

it('the skill client, given only the URL, the token and its expiry, works until the expiry and then asks to sign in again, never refreshing or writing',async()=>{
 const host=await composed();
 const {grant}=await host.signIn('mxmx_test_run_client@example.test');
 const answer=(await host.runSignIn({token:await host.exchange('warehouse',{bearer:grant.access_token}),expires_in:3600})).body as unknown as RunSignIn;
 // The file as the contract says to write it (contracts service-audiences, RUN SIGN-IN).
 const home=join(directory,'home'),hostDirectory=join(home,'hosts',createHash('sha256').update(answer.server).digest('hex').slice(0,16));
 await mkdir(hostDirectory,{recursive:true,mode:0o700});
 for(const dir of [home,join(home,'hosts'),hostDirectory])await chmod(dir,0o700);
 await writeFile(join(hostDirectory,'credentials.env'),`ARTIFACTBIN_URL=${answer.server}\nARTIFACTBIN_TOKEN=${answer.access_token}\nARTIFACTBIN_EXPIRES_AT=${answer.expires_at_ms}\n`,{mode:0o600});
 const untouched=await tree(home);
 const calls:string[]=[];
 const client=makeClient(answer.server,{env:{ARTIFACTBIN_HOME:home},retryDelays:[],fetcher:async(url:RequestInfo|URL,init?:RequestInit)=>{const request=new Request(url,init);calls.push(new URL(request.url).pathname);return host.fetch(request);}});
 expect(await client.request('/api/artifacts')).toMatchObject({});
 // Just before the expiry it still works; the server sees the person.
 vi.useFakeTimers({toFake:['Date'],now:answer.expires_at_ms-60_000});
 expect(await client.request('/api/artifacts')).toMatchObject({});
 vi.useRealTimers();
 expect(calls).toEqual(['/api/artifacts','/api/artifacts']);
 // Ordinary use reads the file and writes nothing beside it (the agent identity included).
 const kept=await tree(home);
 expect(kept).toEqual(untouched);
 // After it: the ordinary lapsed sign-in refusal, with no request made and nothing in the home touched.
 vi.useFakeTimers({toFake:['Date'],now:answer.expires_at_ms+1000});
 const refusal=await client.request('/api/artifacts').catch((error:unknown)=>error);
 vi.useRealTimers();
 // The client's own answer when it holds no live sign-in: sign in again (exit 3).
 expect(refusal).toMatchObject({code:'auth_required',exit:3,recovery:expect.stringMatching(/^Run node scripts\/auth\.mjs login/)});
 expect(toolFailure('read',refusal)).toMatchObject({ok:false,code:'auth_required'});
 expect(calls).toHaveLength(2);
 expect(calls.some(path=>path.startsWith('/oauth'))).toBe(false);
 expect(await tree(home)).toEqual(kept);
});
