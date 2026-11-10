/**
 * THE IDENTITY ENDPOINTS end to end (contracts `IDENTITY_PATHS`, cross-repository contract §2), through the
 * composed host exactly as MinusX reaches it: the auth host in front (service secret, introspection and
 * `token_active` from its bearer read), the app behind it (accounts, sessions, groups). A person's agent gets a
 * token carrying the `minusx` scope through the ordinary email sign-in grant.
 */
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {afterEach,beforeEach,expect,it} from 'vitest';
import {IDENTITY_PATHS,SERVICE_AUTH_HEADER} from '@artifactbin/contracts';
import {createAuthComposedHost} from '@/test/helpers/auth-host';
import {AUTH_SECRET,getDb,setServices} from '@/lib/platform';
import {overrideConfig} from '@/lib/platform/config';
import {createGroup,deleteGroup,setGroupParent} from '@/lib/groups';
import {createUser} from '@/lib/accounts';
import {POST as resolveRoute} from '@/app/api/internal/identity/resolve/route';
import {admitGroupMember,request,useAppHarness} from './harness';
useAppHarness();
const SECRET='identity-test-service-secret',origin='http://localhost:3000';
let directory='';
beforeEach(async()=>{overrideConfig({internalServiceSecret:SECRET});directory=await mkdtemp(join(tmpdir(),'identity-'));});
afterEach(async()=>{await rm(directory,{recursive:true,force:true});});

async function composed(){
 const application=await createAuthComposedHost({APP__PUBLIC_BASE_URL:origin,AUTH__SECRET:AUTH_SECRET,INTERNAL__SERVICE_SECRET:SECRET,EMAIL__DEV_OUTBOX_PATH:join(directory,'outbox.jsonl')});
 const post=(path:string,body:unknown,headers:Record<string,string>={})=>application.fetch(new Request(origin+path,{method:'POST',headers:{origin,'content-type':'application/json',...headers},body:JSON.stringify(body)}));
 const service=async(path:string,body:unknown,secret=SECRET)=>{const response=await post(path,body,{[SERVICE_AUTH_HEADER]:secret});return {status:response.status,body:await response.json()};};
 /** Email sign-in, then the bearer grant with `scope` (absent: the default). */
 const signIn=async(email:string,scope?:string)=>{
  expect((await post('/api/auth/email-otp/send-verification-otp',{email,type:'sign-in'})).status).toBe(200);
  const sent=(await readFile(join(directory,'outbox.jsonl'),'utf8')).trim().split('\n').map(line=>JSON.parse(line)).filter(message=>message.to===email);
  const login=await post('/api/auth/sign-in/email-otp',{email,otp:sent.at(-1).otp});expect(login.status).toBe(200);
  const cookie=login.headers.getSetCookie().map(value=>value.split(';')[0]).join('; ');
  const minted=await post('/api/authentication/token',scope===undefined?{}:{scope},{cookie});
  return {status:minted.status,grant:await minted.json(),cookie};
 };
 const get=(path:string)=>application.fetch(new Request(origin+path));
 return {post,get,service,signIn};
}
const userIdOf=async(email:string)=>(await (await getDb()).query<{id:string}>('SELECT id FROM users WHERE email=$1',[email])).rows[0]!.id;

it('mints a minusx-scoped grant through email sign-in; introspect reports its scopes, and a revoked grant is inactive',async()=>{
 const host=await composed();
 const email='mxmx_test_agent_owner@example.test';
 const scoped=await host.signIn(email,'minusx artifacts');
 expect(scoped.status).toBe(201);expect(scoped.grant.scope).toBe('artifacts minusx');
 const user=await userIdOf(email);
 expect(await host.service(IDENTITY_PATHS.introspect,{token:scoped.grant.access_token})).toEqual({status:200,body:{active:true,user_id:user,token_id:scoped.grant.id,scopes:['artifacts','minusx']}});
 const plain=await host.signIn(email);
 expect(plain.grant.scope).toBe('artifacts');
 expect((await host.service(IDENTITY_PATHS.introspect,{token:plain.grant.access_token})).body.scopes).toEqual(['artifacts']);
 for(const scope of ['minusx','artifacts admin',''])expect((await host.signIn(email,scope)).status,scope).toBe(400);
 // The resolve endpoint's token_active follows the same read.
 expect((await host.service(IDENTITY_PATHS.resolve,{user_id:user,token_id:scoped.grant.id})).body.token_active).toBe(true);
 expect((await host.post('/oauth/revoke',{client_id:scoped.grant.client_id,token:scoped.grant.refresh_token})).status).toBe(200);
 expect((await host.service(IDENTITY_PATHS.introspect,{token:scoped.grant.access_token})).body).toEqual({active:false});
 expect((await host.service(IDENTITY_PATHS.resolve,{user_id:user,token_id:scoped.grant.id})).body.token_active).toBe(false);
 expect((await host.service(IDENTITY_PATHS.resolve,{user_id:user,token_id:'tok_nobody'})).body.token_active).toBe(false);
 expect((await host.service(IDENTITY_PATHS.resolve,{user_id:user})).body.token_active).toBeNull();
 // Discovery advertises it for the authorization-code consent too.
 expect((await (await host.get('/.well-known/oauth-authorization-server')).json()).scopes_supported).toEqual(['artifacts','minusx']);
});

it('resolve: direct membership only, the chain to the root, a revision that moves on topology; groups lists direct ones',async()=>{
 const host=await composed();
 const admin=await createUser({email:'mxmx_test_identity_admin@example.com'}),bob=await createUser({email:'mxmx_test_identity_bob@example.com'});
 const finance=await createGroup(admin.id,{handle:'finance',name:'Finance'});
 const retail=await createGroup(admin.id,{handle:'retail',name:'Retail',parent_id:finance.id});
 await admitGroupMember(admin.id,retail.id,bob.id,'viewer');
 setServices({humanSessions:{live:async(session,user)=>session==='sess_bob'&&user===bob.id}});
 const first=await host.service(IDENTITY_PATHS.resolve,{user_id:bob.id,session_id:'sess_bob',group_id:retail.id});
 expect(first.status).toBe(200);
 expect(first.body).toEqual({active:true,session_live:true,token_active:null,group:{id:retail.id,member:true,chain:[retail.id,finance.id],hierarchy_revision:expect.any(Number)}});
 const revision=first.body.group.hierarchy_revision;
 // Membership of a descendant is not membership of the ancestor.
 expect((await host.service(IDENTITY_PATHS.resolve,{user_id:bob.id,group_id:finance.id})).body).toEqual({active:true,session_live:null,token_active:null,group:{id:finance.id,member:false,chain:[finance.id],hierarchy_revision:revision}});
 expect((await host.service(IDENTITY_PATHS.resolve,{user_id:bob.id,session_id:'sess_other'})).body).toEqual({active:true,session_live:false,token_active:null,group:null});
 expect((await host.service(IDENTITY_PATHS.resolve,{user_id:'usr_nobody',group_id:'grp_missing'})).body).toEqual({active:false,session_live:null,token_active:null,group:null});
 // A service principal asks for the chain alone.
 expect((await host.service(IDENTITY_PATHS.resolve,{group_id:retail.id})).body).toEqual({active:null,session_live:null,token_active:null,group:{id:retail.id,member:false,chain:[retail.id,finance.id],hierarchy_revision:revision}});
 expect((await host.service(IDENTITY_PATHS.resolve,{})).body).toEqual({active:null,session_live:null,token_active:null,group:null});
 expect(await host.service(IDENTITY_PATHS.groups,{user_id:bob.id})).toEqual({status:200,body:{groups:[{id:retail.id,handle:'retail',name:'Retail',parent_id:finance.id}]}});
 // Topology moves the revision and the chain; deletion answers no group.
 await setGroupParent(admin.id,retail.id,null,finance.id);
 const moved=(await host.service(IDENTITY_PATHS.resolve,{user_id:bob.id,group_id:retail.id})).body.group;
 expect(moved).toMatchObject({member:true,chain:[retail.id]});expect(moved.hierarchy_revision).toBeGreaterThan(revision);
 await deleteGroup(admin.id,retail.id,'retail');
 expect((await host.service(IDENTITY_PATHS.resolve,{user_id:bob.id,group_id:retail.id})).body.group).toBeNull();
 expect((await host.service(IDENTITY_PATHS.groups,{user_id:bob.id})).body).toEqual({groups:[]});
 // Malformed input.
 expect((await host.service(IDENTITY_PATHS.resolve,{user_id:7})).status).toBe(400);
 expect((await host.service(IDENTITY_PATHS.groups,{})).status).toBe(400);
});

it('refuses without the service secret, at the auth host and at the app route behind it',async()=>{
 const host=await composed();
 for(const path of Object.values(IDENTITY_PATHS)){
  expect((await host.service(path,{user_id:'usr_1',token:'mx_x'},'wrong-secret')).status,path).toBe(401);
  expect((await host.post(path,{user_id:'usr_1',token:'mx_x'})).status,path).toBe(401);
 }
 expect((await resolveRoute(request(IDENTITY_PATHS.resolve,{method:'POST',json:{user_id:'usr_1'}}))).status).toBe(401);
 expect((await resolveRoute(request(IDENTITY_PATHS.resolve,{method:'POST',json:{user_id:'usr_1'},headers:{[SERVICE_AUTH_HEADER]:'wrong'}}))).status).toBe(401);
 expect((await resolveRoute(request(IDENTITY_PATHS.resolve,{method:'POST',json:{user_id:'usr_1'},headers:{[SERVICE_AUTH_HEADER]:SECRET}}))).status).toBe(200);
 overrideConfig({internalServiceSecret:undefined});
 expect((await resolveRoute(request(IDENTITY_PATHS.resolve,{method:'POST',json:{user_id:'usr_1'},headers:{[SERVICE_AUTH_HEADER]:''}}))).status).toBe(401);
});
