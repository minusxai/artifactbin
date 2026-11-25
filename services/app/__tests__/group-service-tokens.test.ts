/**
 * AN AGENT SIGNED IN AS A GROUP REACHES A CONFIGURED SERVICE (contracts service-audiences `group_principals`), end to
 * end on the composed host: either kind of group sign-in (a person's `--as-group`, or a service's under a group Admin's
 * approval) exchanges its own API bearer at SERVICE_TOKEN_PATH exactly as a person does, for a service that opts in;
 * the service's introspection then answers the group itself, and stops the second the parent stops being live by any
 * rule. A service that does not opt in never sees a group, a person's exchange is unchanged, and a group's service
 * token never becomes another token. The skill's own helper does it unchanged.
 */
import {createHash} from 'node:crypto';
import {chmod,mkdir,readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {beforeEach,expect,it,onTestFinished} from 'vitest';
import {GROUP_PRINCIPALS_NOT_ACCEPTED, GROUP_SIGN_IN_PATH, RUN_SIGN_IN_PATH, SERVICE_TOKEN_PATH} from '@artifactbin/contracts/service-audiences';
import {IDENTITY_INTROSPECT_PATH} from '@artifactbin/contracts/identity-service';
import {SERVICE_AUTH_HEADER} from '@artifactbin/contracts/routes';
import {createAuthComposedHost} from '@/test/helpers/auth-host';
import {AUTH_SECRET,getDb} from '@/lib/platform';
import { syncIdentitySettings } from '@/lib/platform/testing';
import {overrideConfig} from '@/lib/platform/config';
import {createGroup,deleteGroup,removeGroupMember,setGroupMember} from '@/lib/groups';
import {admitGroupMember,useAppHarness} from './harness';
import {tempDir} from '@artifactbin/test-support/temp-dir';
import {delegatedService,otpSignIn,serviceAudiences} from '../../auth/__tests__/helpers';
import {authCommand} from '../skills/artifactbin/scripts/auth.mjs';
import {makeClient} from '../skills/artifactbin/scripts/toolbox-client.mjs';
import {serviceToken} from '../skills/artifactbin/scripts/toolbox-service-token.mjs';
useAppHarness();
const SECRET='group-service-token-secret',origin='http://localhost:3000';
const WAREHOUSE='http://warehouse.localhost:7444',CRM='http://crm.localhost:7446',LEDGER='http://ledger.localhost:7445';
const SECRETS={warehouse:'gst-warehouse-secret',crm:'gst-crm-secret',ledger:'gst-ledger-secret'};
// Warehouse takes groups and also signs agents in as one, runs work and reads pages; CRM takes groups; Ledger does not.
const warehouse=(extra:Record<string,unknown>={})=>({...delegatedService('warehouse',WAREHOUSE,SECRETS.warehouse),group_principals:true,group_sign_ins:true,run_sign_ins:true,artifact_reads:true,...extra});
const crm=(extra:Record<string,unknown>={})=>({...delegatedService('crm',CRM,SECRETS.crm),group_principals:true,...extra});
const ledger=()=>delegatedService('ledger',LEDGER,SECRETS.ledger);
const AUDIENCES=serviceAudiences(warehouse(),crm(),ledger());
let directory='';
const configure=async(audiences:string)=>{overrideConfig({internalServiceSecret:SECRET,publicBaseUrl:origin},{IDENTITY__SERVICE_AUDIENCES:audiences});await syncIdentitySettings(await getDb());};
beforeEach(async()=>{await configure(AUDIENCES);directory=await tempDir('group-service-token-',onTestFinished);});

const sql=async<T=Record<string,unknown>>(text:string,params:unknown[]=[])=>(await (await getDb()).query<T>(text,params)).rows;
const otpOf=async(email:string)=>(await readFile(join(directory,'outbox.jsonl'),'utf8')).trim().split('\n').map(line=>JSON.parse(line)).filter(message=>message.to===email).at(-1).otp as string;
type Answer={status:number;body:Record<string,unknown>|null};

async function composed(audiences=AUDIENCES){
 const application=await createAuthComposedHost({APP__PUBLIC_BASE_URL:origin,AUTH__SECRET:AUTH_SECRET,INTERNAL__SERVICE_SECRET:SECRET,IDENTITY__SERVICE_AUDIENCES:audiences,EMAIL__DEV_OUTBOX_PATH:join(directory,'outbox.jsonl')});
 onTestFinished(application.close);
 const fetch=(request:Request)=>application.fetch(request);
 const send=async(method:string,path:string,headers:Record<string,string>,body?:unknown):Promise<Answer>=>{
  const response=await fetch(new Request(origin+path,{method,headers:{origin,...(body===undefined?{}:{'content-type':'application/json'}),...headers},...(body===undefined?{}:{body:JSON.stringify(body)})}));
  return {status:response.status,body:await response.json().catch(()=>null) as Record<string,unknown>|null};
 };
 const signIn=async(email:string)=>{
  const post=(path:string,body:unknown,headers:Record<string,string>={})=>fetch(new Request(origin+path,{method:'POST',headers:{origin,'content-type':'application/json',...headers},body:JSON.stringify(body)}));
  const {login,cookie}=await otpSignIn(post,email,()=>otpOf(email),{prefix:'/api/auth'});
  expect(login.status).toBe(200);
  const grant=(await send('POST','/api/authentication/token',{cookie},{})).body as {id:string;access_token:string};
  /** This person signs an agent in as `group` at `role`: the token row's id and its bearer. */
  const asGroup=async(group:string,role:'member'|'editor')=>{const issued=(await send('POST','/api/authentication/token',{cookie},{group_id:group,group_role:role})).body!;return {id:String(issued.id),token:String(issued.access_token)};};
  return {cookie,grant,asGroup,userId:(await sql<{id:string}>('SELECT id FROM users WHERE email=$1',[email]))[0]!.id};
 };
 /** A group Admin approves `service` at `role`, and that service signs an agent in as the group: the row's id and its bearer. */
 const serviceSignIn=async(admin:{cookie:string},group:string,role:'member'|'editor',service='warehouse')=>{
  const grant=String((await send('POST',`/api/groups/${group}/service-sign-ins`,{cookie:admin.cookie},{service_id:service,role})).body!.id);
  const issued=(await send('POST',GROUP_SIGN_IN_PATH,{[SERVICE_AUTH_HEADER]:SECRETS[service as keyof typeof SECRETS]},{grant_id:grant})).body!;
  return {grant,id:String(issued.token_id),token:String(issued.access_token)};
 };
 /** The exchange, as the skill does it: the caller's own API bearer for a token for `audience`. */
 const exchange=(bearer:string,audience='warehouse')=>send('POST',SERVICE_TOKEN_PATH,{authorization:`Bearer ${bearer}`},{audience});
 const serviceTokenOf=async(bearer:string,audience='warehouse')=>{const answer=await exchange(bearer,audience);expect(answer.status,JSON.stringify(answer.body)).toBe(200);return String(answer.body!.access_token);};
 /** Introspection as the service with `secret` asks it (default: the installation itself). */
 const introspect=async(token:string,secret=SECRET)=>(await send('POST',IDENTITY_INTROSPECT_PATH,{[SERVICE_AUTH_HEADER]:secret},{token})).body;
 const api=(token:string,method='GET',path='/api/artifacts',body?:unknown)=>send(method,path,{authorization:`Bearer ${token}`},body);
 return {fetch,send,signIn,serviceSignIn,exchange,serviceTokenOf,introspect,api};
}
type Host=Awaited<ReturnType<typeof composed>>;

/** Root > Team > Squad, all Ada's; Eve edits Team. */
async function tree(host:Host){
 const ada=await host.signIn('mxmx_test_gst_ada@example.test'),eve=await host.signIn('mxmx_test_gst_eve@example.test');
 const root=await createGroup(ada.userId,{handle:'gst_root',name:'Root'});
 const team=await createGroup(ada.userId,{handle:'gst_team',name:'Team',parent_id:root.id});
 const squad=await createGroup(ada.userId,{handle:'gst_squad',name:'Squad',parent_id:team.id});
 await admitGroupMember(ada.userId,team.id,eve.userId,'admin');
 return {ada,eve,root,team,squad};
}
const groupAnswer=(group:string,role:string,issuedBy:string,parent:string,audience=WAREHOUSE,userId:string|null=null)=>({active:true,principal_kind:'group',user_id:userId,token_id:expect.stringMatching(/^vtk_/),scopes:[],audience,expires_at:expect.any(String),parent:{kind:'token',id:parent},group_id:group,group_role:role,issued_by:issuedBy});

it('a person\'s group sign-in exchanges its own bearer as a person does, and the service learns the group, exactly',async()=>{
 const host=await composed(),{eve,team}=await tree(host);
 const agent=await eve.asGroup(team.id,'editor');
 const exchanged=await host.exchange(agent.token);
 expect(exchanged.status,JSON.stringify(exchanged.body)).toBe(200);
 expect(exchanged.body).toEqual({access_token:expect.stringMatching(/^vgt_/),token_type:'Bearer',expires_in:expect.any(Number),expires_at:expect.any(String),audience:'warehouse',resource:WAREHOUSE});
 expect(Object.keys(exchanged.body!)).toEqual(['access_token','token_type','expires_in','expires_at','audience','resource']);
 expect(exchanged.body!.expires_in).toBeGreaterThan(290);
 expect(exchanged.body!.expires_in).toBeLessThanOrEqual(300);
 expect(exchanged.body).not.toHaveProperty('refresh_token');
 const token=String(exchanged.body!.access_token);
 // The service, with its own secret: the group at that level, no person, who signed it in, and the parent sign-in.
 const seen=await host.introspect(token,SECRETS.warehouse);
 expect(seen).toEqual(groupAnswer(team.id,'editor',eve.userId,agent.id,WAREHOUSE,eve.userId));
 expect(Object.keys(seen!)).toEqual(['active','principal_kind','user_id','token_id','scopes','audience','expires_at','parent','group_id','group_role','issued_by']);
 expect(seen!.expires_at).toBe(exchanged.body!.expires_at);
 expect(await host.introspect(token)).toEqual(seen);
 // Another service, opted in or not, learns nothing from it; and it is the same for the other opted-in service.
 expect(await host.introspect(token,SECRETS.crm)).toEqual({active:false});
 expect(await host.introspect(token,SECRETS.ledger)).toEqual({active:false});
 const forCrm=await host.serviceTokenOf(agent.token,'crm');
 expect(await host.introspect(forCrm,SECRETS.crm)).toEqual(groupAnswer(team.id,'editor',eve.userId,agent.id,CRM,eve.userId));
 expect(await host.introspect(forCrm,SECRETS.warehouse)).toEqual({active:false});
});

it('a service\'s group sign-in, the very token it was given, is exchanged by whoever holds it, for it or another opted-in service',async()=>{
 const host=await composed(),{ada,team}=await tree(host);
 const agent=await host.serviceSignIn(ada,team.id,'member');
 for(const [audience,secret,at] of [['warehouse',SECRETS.warehouse,WAREHOUSE],['crm',SECRETS.crm,CRM]] as const){
  const token=await host.serviceTokenOf(agent.token,audience);
  expect(token).toMatch(/^vgt_/);
  expect(await host.introspect(token,secret),audience).toEqual(groupAnswer(team.id,'member','warehouse',agent.id,at));
 }
 expect(await host.exchange(agent.token,'ledger')).toEqual({status:403,body:{error:GROUP_PRINCIPALS_NOT_ACCEPTED,hint:expect.any(String)}});
});

it('a service that does not opt in is never handed a group',async()=>{
 const host=await composed(),{ada,eve,team}=await tree(host);
 for(const agent of [await eve.asGroup(team.id,'editor'),await host.serviceSignIn(ada,team.id,'member')]){
  expect(await host.exchange(agent.token,'ledger')).toEqual({status:403,body:{error:GROUP_PRINCIPALS_NOT_ACCEPTED,hint:'This service does not accept an agent signed in as a group.'}});
  expect(await host.exchange(agent.token,'nowhere')).toEqual({status:400,body:{error:'invalid_audience',hint:'Name a configured service id.'}});
 }
});

it('a person\'s exchange and introspection answers are unchanged, field for field, with or without any opt-in',async()=>{
 // Audiences any installation could have had before group principals existed, beside one that opts in.
 const before=serviceAudiences(delegatedService('warehouse',WAREHOUSE,SECRETS.warehouse),ledger());
 await configure(before);
 const host=await composed(before),eve=await host.signIn('mxmx_test_gst_eve@example.test');
 for(const [audience,at,secret] of [['ledger',LEDGER,SECRETS.ledger],['warehouse',WAREHOUSE,SECRETS.warehouse]] as const){
  const exchanged=await host.exchange(eve.grant.access_token,audience);
  expect(exchanged.status,audience).toBe(200);
  expect(Object.keys(exchanged.body!)).toEqual(['access_token','token_type','expires_in','expires_at','audience','resource']);
  expect(exchanged.body).toEqual({access_token:expect.stringMatching(/^vwt_/),token_type:'Bearer',expires_in:expect.any(Number),expires_at:expect.any(String),audience,resource:at});
  expect([299,300]).toContain(exchanged.body!.expires_in);
  const seen=await host.introspect(String(exchanged.body!.access_token),secret);
  expect(Object.keys(seen!)).toEqual(['active','principal_kind','user_id','token_id','scopes','audience','expires_at','parent','group_id','group_role','issued_by']);
  expect(seen).toEqual({active:true,principal_kind:'user',user_id:eve.userId,token_id:expect.stringMatching(/^vtk_/),scopes:[],audience:at,expires_at:exchanged.body!.expires_at,parent:{kind:'token',id:eve.grant.id},group_id:null,group_role:null,issued_by:null});
 }
 // From a page (the session) too, unchanged.
 const page=await host.send('POST',SERVICE_TOKEN_PATH,{cookie:eve.cookie},{audience:'ledger'});
 expect(page.body).toEqual({access_token:expect.stringMatching(/^vwt_/),token_type:'Bearer',expires_in:expect.any(Number),expires_at:expect.any(String),audience:'ledger',resource:LEDGER});
 expect(await host.introspect(String(page.body!.access_token),SECRETS.ledger)).toMatchObject({principal_kind:'user',user_id:eve.userId,parent:{kind:'session'}});
});

it('never outlives its parent: a group sign-in near its end gives a token that ends with it, and none once it has ended',async()=>{
 const host=await composed(),{eve,team}=await tree(host);
 const agent=await eve.asGroup(team.id,'member');
 const ends=(await sql<{at:Date}>("UPDATE auth.tokens SET expires_at=date_trunc('second',now())+interval '90 seconds' WHERE id=$1 RETURNING expires_at AS at",[agent.id]))[0]!.at;
 const exchanged=await host.exchange(agent.token);
 expect(exchanged.status).toBe(200);
 expect(exchanged.body!.expires_at).toBe(new Date(ends).toISOString());
 expect(Number(exchanged.body!.expires_in)).toBeLessThanOrEqual(90);
 expect((await host.introspect(String(exchanged.body!.access_token),SECRETS.warehouse))!.expires_at).toBe(new Date(ends).toISOString());
});

/** Each rule a group sign-in lives by, broken: the token already issued answers not active at once, and no new one is issued. */
const DEAD={status:401,body:{error:'authentication_required',hint:expect.any(String)}};
const NOT_ACCEPTED={status:403,body:{error:GROUP_PRINCIPALS_NOT_ACCEPTED,hint:expect.any(String)}};
const UNKNOWN={status:400,body:{error:'invalid_audience',hint:'Name a configured service id.'}};
async function endsBoth(host:Host,change:string,agent:{token:string},apply:()=>Promise<unknown>,audience:'warehouse'|'crm'='warehouse',next:()=>Host|Promise<Host>=()=>host,refused:unknown=DEAD){
 const issued=await host.serviceTokenOf(agent.token,audience);
 const secret=SECRETS[audience];
 expect(await host.introspect(issued,secret),`${change}: before`).toMatchObject({active:true,principal_kind:'group'});
 await apply();
 const now=await next();
 // A service no longer configured cannot ask at all; any other is told it is not active.
 expect(await now.introspect(issued,secret),change).toEqual(refused===UNKNOWN?{error:'unauthorized'}:{active:false});
 expect(await now.introspect(issued),change).toEqual({active:false});
 expect(await now.exchange(agent.token,audience),change).toEqual(refused);
}

it('a person\'s group sign-in: demotion, removal, deactivation, deletion, either revocation and expiry end its service tokens at once',async()=>{
 const host=await composed(),{ada,eve,team,squad}=await tree(host);
 const max=await host.signIn('mxmx_test_gst_max@example.test');
 await admitGroupMember(ada.userId,team.id,max.userId,'member');
 const editor=await eve.asGroup(team.id,'editor'),member=await eve.asGroup(team.id,'member');
 await endsBoth(host,'demoted below the level',editor,()=>setGroupMember(ada.userId,team.id,eve.userId,'member'));
 // Her member sign-in still stands, and its token too.
 expect(await host.introspect(await host.serviceTokenOf(member.token),SECRETS.warehouse)).toMatchObject({active:true,group_role:'member'});
 await endsBoth(host,'removed from the group',member,()=>removeGroupMember(ada.userId,team.id,eve.userId));
 const deactivated=await max.asGroup(team.id,'member');
 await endsBoth(host,'issuer no longer an active account',deactivated,()=>sql("UPDATE users SET kind='guest' WHERE id=$1",[max.userId]));
 await sql("UPDATE users SET kind='account' WHERE id=$1",[max.userId]);
 const leaf=await ada.asGroup(squad.id,'editor');
 await endsBoth(host,'group deleted',leaf,()=>deleteGroup(ada.userId,squad.id,'gst_squad'));
 const own=await ada.asGroup(team.id,'member');
 await endsBoth(host,'revoked by the person',own,async()=>expect((await host.send('DELETE',`/api/my/tokens/${own.id}`,{cookie:ada.cookie})).status).toBe(204));
 const theirs=await max.asGroup(team.id,'member');
 await endsBoth(host,'revoked by a group Admin',theirs,async()=>expect((await host.send('DELETE',`/api/groups/${team.id}/sign-ins/${theirs.id}`,{cookie:ada.cookie})).status).toBe(204));
 const expiring=await ada.asGroup(team.id,'editor');
 await endsBoth(host,'expired',expiring,()=>sql("UPDATE auth.tokens SET expires_at=now()-interval '1 second' WHERE id=$1",[expiring.id]));
 // The service that took groups no longer does: what it was given ends, and a new one is refused by name.
 const lasting=await ada.asGroup(team.id,'editor');
 const noLonger=serviceAudiences(warehouse(),crm({group_principals:false}),ledger());
 await endsBoth(host,'service opt-in removed',lasting,()=>configure(noLonger),'crm',()=>composed(noLonger),NOT_ACCEPTED);
 // The service's whole entry removed: the same, and the service is no longer one to name.
 const removed=serviceAudiences(warehouse(),ledger());
 await configure(AUDIENCES);
 await endsBoth(await composed(),'service entry removed',lasting,()=>configure(removed),'crm',()=>composed(removed),UNKNOWN);
 await configure(noLonger);
 // ... and the person's own exchange for that service is untouched.
 expect(await (await composed(noLonger)).introspect(await (await composed(noLonger)).serviceTokenOf(ada.grant.access_token,'crm'),SECRETS.crm)).toMatchObject({active:true,principal_kind:'user',user_id:ada.userId});
});

it('a service\'s group sign-in: revoked approval, deleted group, the issuing service unconfigured and expiry end its service tokens at once',async()=>{
 const host=await composed(),{ada,team,squad}=await tree(host);
 const revoked=await host.serviceSignIn(ada,team.id,'member');
 await endsBoth(host,'approval revoked',revoked,async()=>expect((await host.send('DELETE',`/api/groups/${team.id}/service-sign-ins/${revoked.grant}`,{cookie:ada.cookie})).status).toBe(204),'crm');
 const leaf=await host.serviceSignIn(ada,squad.id,'editor');
 await endsBoth(host,'group deleted',leaf,()=>deleteGroup(ada.userId,squad.id,'gst_squad'),'crm');
 const expiring=await host.serviceSignIn(ada,team.id,'editor');
 await endsBoth(host,'expired',expiring,()=>sql("UPDATE auth.tokens SET expires_at=now()-interval '1 second' WHERE id=$1",[expiring.id]),'crm');
 const tokenRevoked=await host.serviceSignIn(ada,team.id,'member');
 await endsBoth(host,'its own token revoked',tokenRevoked,()=>sql('UPDATE auth.tokens SET deleted_at=now() WHERE id=$1',[tokenRevoked.id]),'crm');
 // The service that signed the agent in is no longer configured to: its group sign-in, and so its service tokens, end.
 for(const [change,audiences] of [['issuer\'s group_sign_ins removed',serviceAudiences(warehouse({group_sign_ins:false}),crm(),ledger())],['issuer\'s entry removed',serviceAudiences(crm(),ledger())],['issuer\'s id at another origin',serviceAudiences(warehouse({origin:'http://warehouse-two.localhost:7447'}),crm(),ledger())]] as const){
  await configure(AUDIENCES);
  const agent=await (await composed()).serviceSignIn(ada,team.id,'member');
  await endsBoth(await composed(),change,agent,()=>configure(audiences),'crm',()=>composed(audiences));
 }
});

it('a group\'s service token obtains nothing: not this API, not another exchange, not a run sign-in',async()=>{
 const host=await composed(),{ada,eve,team}=await tree(host);
 for(const agent of [await eve.asGroup(team.id,'editor'),await host.serviceSignIn(ada,team.id,'editor')]){
  const token=await host.serviceTokenOf(agent.token);
  expect((await host.api(token)).status).toBe(401);
  expect((await host.exchange(token)).status).toBe(401);
  expect((await host.exchange(token,'crm')).status).toBe(401);
  expect((await host.send('POST','/api/authentication/token',{authorization:`Bearer ${token}`},{})).status).toBe(401);
  // Warehouse runs work for people: with a group's token, it gets no run sign-in.
  expect(await host.send('POST',RUN_SIGN_IN_PATH,{[SERVICE_AUTH_HEADER]:SECRETS.warehouse},{token})).toEqual({status:401,body:{error:'unauthorized'}});
 }
 expect(await sql('SELECT count(*)::int AS n FROM auth.tokens WHERE issued_by=$1 AND group_id IS NULL',['warehouse'])).toEqual([{n:0}]);
 // A group still cannot be signed in for a service audience directly, nor by OAuth for a service's resource.
 expect((await host.send('POST','/api/authentication/token',{cookie:eve.cookie},{audience:'warehouse',group_id:team.id,group_role:'member'})).status).toBe(400);
});

it('the skill\'s own helper exchanges a group\'s sign-in as it does a person\'s: ARTIFACTBIN_AS_GROUP, or a service\'s sign-in file',async()=>{
 const host=await composed(),{ada,eve,team}=await tree(host);
 const fetcher=async(url:RequestInfo|URL,init?:RequestInit)=>host.fetch(new Request(url,init));
 const home=join(directory,'home'),env={ARTIFACTBIN_HOME:home};
 const auth=(sub:string,values:Record<string,unknown>)=>authCommand({sub,values:{server:origin,...values},positionals:[]},{env,fetcher});
 const login=async(values:Record<string,unknown>)=>{
  const {challenge}=await auth('login',{email:'mxmx_test_gst_eve@example.test'});
  await writeFile(join(directory,'code.txt'),await otpOf('mxmx_test_gst_eve@example.test'));
  return auth('login',{challenge,'code-file':join(directory,'code.txt'),...values});
 };
 expect(await login({})).toMatchObject({authenticated:true,actsAs:'user'});
 expect(await login({'as-group':team.id,level:'editor'})).toMatchObject({authenticated:true,actsAs:{group:team.id,level:'editor'}});
 const person=makeClient(origin,{env,fetcher}),group=makeClient(origin,{env:{...env,ARTIFACTBIN_AS_GROUP:team.id},fetcher});
 const asGroup=await serviceToken(group,'warehouse'),asPerson=await serviceToken(person,'warehouse');
 expect(await host.introspect(asGroup,SECRETS.warehouse)).toMatchObject({active:true,principal_kind:'group',user_id:eve.userId,group_id:team.id,group_role:'editor',issued_by:eve.userId});
 // Each client keeps its own: the person's is still the person's.
 expect(await host.introspect(asPerson,SECRETS.warehouse)).toMatchObject({active:true,principal_kind:'user',user_id:eve.userId});
 expect(await serviceToken(group,'warehouse')).toBe(asGroup);
 // A sandbox given a service's group sign-in in the skill's sign-in file, as a run sign-in's is written.
 const agent=await host.serviceSignIn(ada,team.id,'member');
 const sandbox=join(directory,'sandbox'),hostDirectory=join(sandbox,'hosts',createHash('sha256').update(origin).digest('hex').slice(0,16));
 await mkdir(hostDirectory,{recursive:true,mode:0o700});
 for(const dir of [sandbox,join(sandbox,'hosts'),hostDirectory])await chmod(dir,0o700);
 const expiresAt=(await sql<{at:Date}>('SELECT expires_at AS at FROM auth.tokens WHERE id=$1',[agent.id]))[0]!.at;
 await writeFile(join(hostDirectory,'credentials.env'),`ARTIFACTBIN_URL=${origin}\nARTIFACTBIN_TOKEN=${agent.token}\nARTIFACTBIN_EXPIRES_AT=${new Date(expiresAt).getTime()}\n`,{mode:0o600});
 const inSandbox=await serviceToken(makeClient(origin,{env:{ARTIFACTBIN_HOME:sandbox},fetcher}),'crm');
 expect(await host.introspect(inSandbox,SECRETS.crm)).toEqual(groupAnswer(team.id,'member','warehouse',agent.id,CRM));
 // A service that takes no groups refuses the skill by name.
 await expect(serviceToken(group,'ledger')).rejects.toMatchObject({code:GROUP_PRINCIPALS_NOT_ACCEPTED});
});

it('narrows a personal service token to a Member run sign-in under its original parent',async()=>{
 const host=await composed(),{ada,eve,team,squad}=await tree(host);
 await setGroupMember(ada.userId,team.id,eve.userId,'member');
 const token=await host.serviceTokenOf(eve.grant.access_token);
 const run=(body:Record<string,unknown>,secret=SECRETS.warehouse)=>host.send('POST',RUN_SIGN_IN_PATH,{[SERVICE_AUTH_HEADER]:secret},{token,...body});
 const scope={group_id:team.id,group_role:'member'};
 for(const bad of [{group_id:team.id},{group_role:'member'},{...scope,group_id:null},{...scope,group_role:'editor'},{...scope,group_role:'admin'},{...scope,grant_id:'sgg_example'}])
  expect((await run(bad)).status).toBe(400);
 expect((await run({...scope,group_id:squad.id})).status).toBe(403);
 expect((await run({...scope,token:await host.serviceTokenOf(eve.grant.access_token,'crm')})).status).toBe(401);
 const standing=await host.serviceSignIn(ada,team.id,'member');
 expect((await run({...scope,token:await host.serviceTokenOf(standing.token)})).status).toBe(401);
 const issue=async()=>{
  const result=await run({...scope,expires_in:3600});
  expect(result.status).toBe(200);
  const {access_token,token_id,expires_at,expires_at_ms}=result.body!;
  expect(result.body).toMatchObject({token_type:'Bearer',server:origin,expires_at_ms:Date.parse(String(expires_at))});
  expect(Math.abs(Number(expires_at_ms)-Date.now()-3600000)).toBeLessThan(5000);
  expect(await host.introspect(String(access_token))).toMatchObject({active:true,principal_kind:'group',...scope,user_id:eve.userId,issued_by:eve.userId});
  expect(await sql('SELECT grant_id FROM auth.tokens WHERE id=$1',[token_id])).toEqual([{grant_id:null}]);
  const exchanged=await host.serviceTokenOf(String(access_token),'crm');
  expect(await host.introspect(exchanged,SECRETS.crm)).toEqual(groupAnswer(team.id,'member',eve.userId,String(token_id),CRM,eve.userId));
  return [String(access_token),exchanged];
 };
 const first=await issue();
 await removeGroupMember(ada.userId,team.id,eve.userId);
 for(const bearer of first)expect(await host.introspect(bearer)).toEqual({active:false});
 expect((await run(scope)).status).toBe(403);
 await admitGroupMember(ada.userId,team.id,eve.userId,'member');
 const second=await issue();
 expect((await host.send('DELETE',`/api/my/tokens/${eve.grant.id}`,{cookie:eve.cookie})).status).toBe(204);
 for(const bearer of second)expect(await host.introspect(bearer)).toEqual({active:false});
 expect((await run(scope)).status).toBe(401);
 expect(await host.introspect(standing.token)).toMatchObject({active:true,user_id:null,issued_by:'warehouse'});
});
