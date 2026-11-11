/**
 * WHAT EVERY READER LEARNS ABOUT WHO SOMEONE IS (cross-repository contract §2), end to end on the composed host: the
 * identity read views (contracts `IDENTITY_VIEWS`, @artifactbin/auth identity-store/views) read with plain SQL, as
 * MinusX's database role and the app itself read them, and the one HTTP door left, bearer introspection, through the
 * auth host in front. A person's agent gets a token carrying the `minusx` scope through the ordinary email sign-in grant.
 *
 * The view names and columns are the cross-repository contract: the literal below pins them, so changing one is a
 * reviewed edit here and in MinusX (its tests apply a byte-for-byte copy of IDENTITY.sql).
 */
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {afterEach,beforeEach,expect,it} from 'vitest';
import {IDENTITY_INTROSPECT_PATH,IDENTITY_OWNED_TABLES,IDENTITY_VIEWS,SERVICE_AUTH_HEADER} from '@artifactbin/contracts';
import {identityViewColumns} from '@artifactbin/auth/identity-store/views';
import {createAuthComposedHost} from '@/test/helpers/auth-host';
import {AUTH_SECRET,ensureLocalIdentity,getDb,syncIdentitySettings} from '@/lib/platform';
import {overrideConfig} from '@/lib/platform/config';
import {createGroup,deleteGroup,setGroupParent} from '@/lib/groups';
import {canUseDeploymentIdentity,createUser} from '@/lib/accounts';
import {canAuthenticateUser} from '@/lib/user-kinds';
import {admitGroupMember,useAppHarness} from './harness';
useAppHarness();
const SECRET='identity-test-service-secret',origin='http://localhost:3000';
let directory='';
beforeEach(async()=>{overrideConfig({internalServiceSecret:SECRET,publicBaseUrl:origin});directory=await mkdtemp(join(tmpdir(),'identity-'));});
afterEach(async()=>{await rm(directory,{recursive:true,force:true});});

/** The composed host, whose boot (its database open, then Better Auth's tables) made the views. */
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
const sql=async<T=Record<string,unknown>>(text:string,params:unknown[]=[])=>(await (await getDb()).query<T>(text,params)).rows;
const userIdOf=async(email:string)=>(await sql<{id:string}>('SELECT id FROM users WHERE email=$1',[email]))[0]!.id;
const token=async(id:string)=>(await sql<{user_id:string;scopes:string[];live:boolean}>('SELECT user_id,scopes,live FROM identity.tokens WHERE id=$1',[id]))[0]??null;
const chainOf=async(id:string)=>(await sql<{id:string}>(`WITH RECURSIVE c(id,parent_id,depth) AS (SELECT id,parent_id,0 FROM identity.groups WHERE id=$1 AND deleted_at IS NULL
  UNION ALL SELECT g.id,g.parent_id,c.depth+1 FROM c JOIN identity.groups g ON g.id=c.parent_id AND g.deleted_at IS NULL) SELECT id FROM c ORDER BY depth`,[id])).map(row=>row.id);
const revision=async()=>Number((await sql<{revision:string}>("SELECT revision FROM identity.group_hierarchy WHERE id='installation'"))[0]?.revision);

it('pins the contract: schema identity holds exactly these views, these columns in this order, and nothing else',async()=>{
 await composed();
 // Generated from the identity module's declarations minus its secret columns, and equal to the contract literal.
 expect(identityViewColumns()).toEqual(IDENTITY_VIEWS);
 expect(Object.keys(IDENTITY_VIEWS).sort()).toEqual([...IDENTITY_OWNED_TABLES,'sessions'].sort());
 // The app's own connection reads the views by the tables' names.
 expect(await sql("SELECT n.nspname AS schema,c.relkind::text AS kind FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE c.oid=to_regclass('users')")).toEqual([{schema:'identity',kind:'v'}]);
 const relations=await sql<{name:string;kind:string}>("SELECT c.relname AS name,c.relkind::text AS kind FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='identity' ORDER BY c.relname");
 expect(relations).toEqual(Object.keys(IDENTITY_VIEWS).sort().map(name=>({name,kind:'v'})));
 const columns=await sql<{table_name:string;column_name:string}>("SELECT table_name,column_name FROM information_schema.columns WHERE table_schema='identity' ORDER BY table_name,ordinal_position");
 const actual:Record<string,string[]>={};for(const c of columns)(actual[c.table_name]??=[]).push(c.column_name);
 expect(actual).toEqual(IDENTITY_VIEWS);
 // A second boot replaces the views in place (grants survive): same relations, no error.
 await ensureLocalIdentity(await getDb());
 expect((await sql("SELECT 1 FROM pg_views WHERE schemaname='identity'")).length).toBe(Object.keys(IDENTITY_VIEWS).length);
});

it('reaches no secret: no login code, session token, token hash or credential hash through any view, and a role granted only the views reads no base table',async()=>{
 const host=await composed();
 const email='mxmx_test_secret_owner@example.test';
 const scoped=await host.signIn(email,'minusx artifacts');
 const user=await userIdOf(email);
 const secrets=[
  scoped.grant.access_token,scoped.grant.refresh_token,
  ...(await sql<{token:string}>('SELECT token FROM auth.session')).map(r=>r.token),
  ...(await sql<{token_hash:string}>('SELECT token_hash FROM auth.tokens')).map(r=>r.token_hash),
  ...(await sql<{credential_hash:string}>('SELECT credential_hash FROM auth.credentials')).map(r=>r.credential_hash),
 ].filter(Boolean);
 expect(secrets.length).toBeGreaterThanOrEqual(4);
 const everything=(await Promise.all(Object.keys(IDENTITY_VIEWS).map(view=>sql<{row:string}>(`SELECT row_to_json(v)::text AS row FROM identity.${view} v`)))).flat().map(r=>r.row).join('\n');
 expect(everything).toContain(user);
 for(const secret of secrets)expect(everything.includes(secret),'a secret is readable through the identity views').toBe(false);
 // The operator's grant (IDENTITY.sql): USAGE on the schema, SELECT on its views, nothing else.
 const db=await getDb();
 await db.query('CREATE ROLE mxmx_test_identity_reader NOLOGIN');
 try{
  await db.query('GRANT USAGE ON SCHEMA identity TO mxmx_test_identity_reader');
  await db.query('GRANT SELECT ON ALL TABLES IN SCHEMA identity TO mxmx_test_identity_reader');
  const asReader=async(text:string)=>db.transaction(async tx=>{await tx.query('SET LOCAL ROLE mxmx_test_identity_reader');return (await tx.query(text)).rows;});
  expect(await asReader(`SELECT active FROM identity.users WHERE id='${user}'`)).toEqual([{active:true}]);
  // Readers never write, even through an updatable view.
  for(const statement of [`UPDATE identity.users SET name='x' WHERE id='${user}'`,"DELETE FROM identity.group_members","INSERT INTO identity.groups(id,handle,name,created_by) VALUES ('g','g','g','u')"])
   await expect(asReader(statement),statement).rejects.toThrow(/permission denied/);
  for(const table of [...IDENTITY_OWNED_TABLES.map(table=>`auth.${table}`),'auth.session','auth.credentials','auth."user"'])
   await expect(asReader(`SELECT 1 FROM ${table} LIMIT 1`),table).rejects.toThrow(/permission denied/);
 }finally{
  await db.query('REVOKE ALL ON ALL TABLES IN SCHEMA identity FROM mxmx_test_identity_reader');
  await db.query('REVOKE ALL ON SCHEMA identity FROM mxmx_test_identity_reader');
  await db.query('DROP ROLE mxmx_test_identity_reader');
 }
});

it('tokens: a minusx-scoped grant is live with its scopes until revoked; introspect answers the bearer; a foreign audience is not live',async()=>{
 const host=await composed();
 const email='mxmx_test_agent_owner@example.test';
 const scoped=await host.signIn(email,'minusx artifacts');
 expect(scoped.status).toBe(201);expect(scoped.grant.scope).toBe('artifacts minusx');
 const user=await userIdOf(email);
 expect(await host.service(IDENTITY_INTROSPECT_PATH,{token:scoped.grant.access_token})).toEqual({status:200,body:{active:true,user_id:user,token_id:scoped.grant.id,scopes:['artifacts','minusx']}});
 expect(await token(scoped.grant.id)).toEqual({user_id:user,scopes:['artifacts','minusx'],live:true});
 const plain=await host.signIn(email);
 expect(plain.grant.scope).toBe('artifacts');
 expect((await host.service(IDENTITY_INTROSPECT_PATH,{token:plain.grant.access_token})).body.scopes).toEqual(['artifacts']);
 expect((await token(plain.grant.id))?.scopes).toEqual(['artifacts']);
 for(const scope of ['minusx','artifacts admin',''])expect((await host.signIn(email,scope)).status,scope).toBe(400);
 // The deployment's API audiences come from its settings: an OAuth token bound to an origin no longer served is not live.
 overrideConfig({publicBaseUrl:'http://elsewhere.test'});await syncIdentitySettings(await getDb());
 expect((await token(scoped.grant.id))?.live).toBe(false);
 overrideConfig({publicBaseUrl:'http://elsewhere.test',aliasOrigins:[origin]});await syncIdentitySettings(await getDb());
 expect((await token(scoped.grant.id))?.live).toBe(true);
 overrideConfig({publicBaseUrl:origin,aliasOrigins:[]});await syncIdentitySettings(await getDb());
 // Revocation: the bearer and the view agree on the next read.
 expect((await host.post('/oauth/revoke',{client_id:scoped.grant.client_id,token:scoped.grant.refresh_token})).status).toBe(200);
 expect((await host.service(IDENTITY_INTROSPECT_PATH,{token:scoped.grant.access_token})).body).toEqual({active:false});
 expect((await token(scoped.grant.id))?.live).toBe(false);
 expect(await token('tok_nobody')).toBeNull();
 // An account that may no longer sign in holds no live token.
 expect((await token(plain.grant.id))?.live).toBe(true);
 await (await getDb()).query("UPDATE users SET kind='guest' WHERE id=$1",[user]);
 expect((await token(plain.grant.id))?.live).toBe(false);
 // Discovery advertises the scope for the authorization-code consent too.
 expect((await (await host.get('/.well-known/oauth-authorization-server')).json()).scopes_supported).toEqual(['artifacts','minusx']);
});

it('sessions: a browser session is live by id for its user until it expires',async()=>{
 const host=await composed();
 const email='mxmx_test_session_owner@example.test';
 await host.signIn(email);
 const user=await userIdOf(email);
 const [session]=await sql<{id:string;user_id:string;live:boolean}>('SELECT id,"userId" AS user_id,live FROM identity.sessions');
 expect(session).toEqual({id:expect.any(String),user_id:user,live:true});
 await (await getDb()).query(`UPDATE auth.session SET "expiresAt"=now()-interval '1 second' WHERE id=$1`,[session!.id]);
 expect((await sql('SELECT live FROM identity.sessions WHERE id=$1',[session!.id]))).toEqual([{live:false}]);
});

it('groups and memberships: direct membership only, the chain to the root, a revision that moves on topology, deleted groups gone',async()=>{
 await composed();
 const admin=await createUser({email:'mxmx_test_identity_admin@example.com'}),bob=await createUser({email:'mxmx_test_identity_bob@example.com'});
 const finance=await createGroup(admin.id,{handle:'finance',name:'Finance'});
 const retail=await createGroup(admin.id,{handle:'retail',name:'Retail',parent_id:finance.id});
 await admitGroupMember(admin.id,retail.id,bob.id,'viewer');
 // Thin views: the reader keeps live groups itself, as MinusX does.
 const member=async(user:string,group:string)=>(await sql('SELECT 1 FROM identity.group_members m JOIN identity.groups g ON g.id=m.group_id AND g.deleted_at IS NULL WHERE m.user_id=$1 AND m.group_id=$2',[user,group])).length===1;
 expect(await member(bob.id,retail.id)).toBe(true);
 // Membership of a descendant is not membership of the ancestor.
 expect(await member(bob.id,finance.id)).toBe(false);
 expect(await chainOf(retail.id)).toEqual([retail.id,finance.id]);
 expect(await sql('SELECT id,handle,name,parent_id FROM identity.groups WHERE id=$1',[retail.id])).toEqual([{id:retail.id,handle:'retail',name:'Retail',parent_id:finance.id}]);
 expect(await sql('SELECT active FROM identity.users WHERE id=$1',[bob.id])).toEqual([{active:true}]);
 const before=await revision();
 expect(before).toBeGreaterThan(0);
 await setGroupParent(admin.id,retail.id,null,finance.id);
 expect(await chainOf(retail.id)).toEqual([retail.id]);expect(await member(bob.id,retail.id)).toBe(true);
 expect(await revision()).toBeGreaterThan(before);
 const moved=await revision();
 await deleteGroup(admin.id,retail.id,'retail');
 expect(await chainOf(retail.id)).toEqual([]);expect(await member(bob.id,retail.id)).toBe(false);
 expect(await revision()).toBeGreaterThan(moved);
});

it('users.active is canAuthenticateUser && canUseDeploymentIdentity, for every kind, in both deployment modes',async()=>{
 await composed();
 const db=await getDb();
 const users:[string,string,string|null,string|null,string|null][]=[
  ['acct','account','mxmx_test_acct@example.com',null,null],['acct_member','account','mxmx_test_member@example.com',null,null],
  ['acct_no_email','account',null,null,null],['guest','guest',null,null,null],
  ['tu_live','testuser',null,'acct_member',null],['tu_unadmitted_parent','testuser',null,'acct',null],
  ['tu_expired','testuser',null,'acct_member',new Date(Date.now()-1000).toISOString()],['tu_orphan','testuser',null,'missing',null],
  ['tu_guest_parent','testuser',null,'guest',null],
 ];
 for(const [id,kind,email,parent,expires] of users)await db.query('INSERT INTO users (id,kind,email,parent_user_id,expires_at) VALUES ($1,$2,$3,$4,$5)',[id,kind,email,parent,expires]);
 await db.query("INSERT INTO deployment_members(user_id) VALUES ('acct_member'),('acct_no_email'),('guest'),('tu_expired')");
 const ids=[...users.map(u=>u[0]),'nobody'];
 const agree=async(label:string)=>{
  await syncIdentitySettings(db);
  const view=new Map((await sql<{id:string;active:boolean}>('SELECT id,active FROM identity.users')).map(r=>[r.id,r.active]));
  for(const id of ids)expect(view.get(id)??false,`${label}: ${id}`).toBe(await canAuthenticateUser(id)&&await canUseDeploymentIdentity(id));
  return ids.filter(id=>view.get(id));
 };
 expect(await agree('public')).toEqual(['acct','acct_member','tu_live','tu_unadmitted_parent']);
 overrideConfig({},{APP__DEPLOYMENT_MODE:'company',APP__DEPLOYMENT_OWNER_EMAIL:'owner@example.com'});
 await db.query("INSERT INTO deployment_state(id,setup_complete) VALUES ('company',false) ON CONFLICT (id) DO UPDATE SET setup_complete=false");
 expect(await agree('company, setup pending')).toEqual(['acct_member']);
 await db.query("UPDATE deployment_state SET setup_complete=true WHERE id='company'");
 expect(await agree('company')).toEqual(['acct_member','tu_live']);
 // No settings row (a boot that never ran): no account is active.
 await db.query('DELETE FROM identity_settings');
 expect(await sql('SELECT id FROM identity.users WHERE active')).toEqual([]);
});
