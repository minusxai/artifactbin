/**
 * THE SPLIT-ROLE IDENTITY MODEL on a real PostgreSQL 17 (a disposable `postgres:17-alpine`), with the generated
 * roles.sql and grants.sql applied as an operator would: `artifactbin_app` boots its own tables (search_path `app`),
 * `artifactbin_auth` (the identity module) boots its base tables in `auth` and the read views in `identity`, and a
 * third reader role, `minusx_reader`, gets the IDENTITY.sql grant. Proven:
 *  - the identity role performs every identity write, through the identity store itself;
 *  - both readers are refused (42501) every base identity table, every write through a view, and a row lock;
 *  - both readers SELECT the views, no view exposes a secret column, and the app role, with its real search_path
 *    (`app, identity`), resolves `users` to the view and runs the app's own access SQL over it correctly.
 * And the production upgrade: a database whose app role still owns the identity tables (and the former identity views)
 * refuses the identity boot with the one-time move named; after `identityMoveStatements`, run by a superuser, it boots,
 * every row is kept, and the app role reads them only through the views.
 * Runs in the `integration` project; skipped without the image.
 */
import {execFileSync,spawnSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import pg from 'pg';
import {afterAll,beforeAll,describe,expect,it} from 'vitest';
import {IDENTITY_OWNED_TABLES,IDENTITY_VIEWS,type Queryable} from '@artifactbin/contracts';
import {IdentityNotReady,createIdentityStore,ensureIdentitySchema,identityDbOf,identityMoveStatements} from '@artifactbin/auth/identity-store';
import {SECRET_COLUMNS} from '@artifactbin/auth/identity-store/schema';
import {ensureHumanAuthSchema} from '@artifactbin/auth';
import {SCHEMA_STATEMENTS} from '@/lib/platform';
import {reachedGroupsSql,subtreeSql} from '@/lib/groups';
import {transactionAccessFacts} from '@/lib/artifact-access';

const dockerAvailable=spawnSync('docker',['image','inspect','postgres:17-alpine'],{stdio:'ignore'}).status===0;
const ROOT=join(__dirname,'../../../../..');

describe.skipIf(!dockerAvailable)('identity tables in a split-role database',()=>{
 let container='',port=0;
 const pools:pg.Pool[]=[];
 const pool=(user:string,searchPath:string,database='postgres')=>{const p=new pg.Pool({host:'127.0.0.1',port,user,password:'pw',database,options:`-c search_path=${searchPath}`,max:2});pools.push(p);return p;};
 const code=(promise:Promise<unknown>)=>promise.then(()=>'ok',(error:{code?:string})=>error.code??String(error));
 let superuser:pg.Pool,app:pg.Pool,auth:pg.Pool,minusx:pg.Pool;

 beforeAll(async()=>{
  container=execFileSync('docker',['run','--rm','-d','-e','POSTGRES_PASSWORD=pw','-p','127.0.0.1::5432','postgres:17-alpine'],{encoding:'utf8'}).trim();
  port=Number(execFileSync('docker',['port',container,'5432/tcp'],{encoding:'utf8'}).trim().split('\n')[0]!.split(':').at(-1));
  superuser=pool('postgres','public');
  for(let attempt=0;;attempt++){
   try{await superuser.query('SELECT 1');break;}catch{if(attempt>120)throw Error('postgres never became ready');await new Promise(r=>setTimeout(r,500));}
  }
  // The operator's fresh-database steps: roles.sql (with passwords), the app's boot, the identity host's boot, grants.sql.
  await superuser.query(readFileSync(join(ROOT,'roles.sql'),'utf8'));
  await superuser.query("ALTER ROLE artifactbin_app PASSWORD 'pw'; ALTER ROLE artifactbin_auth PASSWORD 'pw'; CREATE ROLE minusx_reader LOGIN PASSWORD 'pw'");
  // No role may create a schema in this database: every boot must check before creating (product bug 2).
  await superuser.query('REVOKE CREATE ON DATABASE postgres FROM PUBLIC');
  app=pool('artifactbin_app','app,identity');
  for(const statement of SCHEMA_STATEMENTS)await app.query(statement);
  await app.query("INSERT INTO identity_settings(id,deployment_mode,api_audiences) VALUES('installation','public',ARRAY['http://app.test/api'])");
  await superuser.query('CREATE TABLE events.events(id text)');
  await superuser.query(readFileSync(join(ROOT,'grants.sql'),'utf8'));
  // MinusX's grant, as IDENTITY.sql's header gives it.
  await superuser.query(`GRANT USAGE ON SCHEMA identity TO minusx_reader; GRANT SELECT ON ALL TABLES IN SCHEMA identity TO minusx_reader;
   ALTER DEFAULT PRIVILEGES FOR ROLE artifactbin_auth IN SCHEMA identity GRANT SELECT ON TABLES TO minusx_reader`);
  auth=pool('artifactbin_auth','auth');
  await ensureHumanAuthSchema({pool:auth,schema:'auth'});
  await ensureIdentitySchema(identityDbOf(auth),{auth:'auth',app:'app',read:'identity'});
  minusx=pool('minusx_reader','identity');
 },180_000);
 afterAll(async()=>{
  for(const p of pools)await p.end().catch(()=>{});
  if(container)spawnSync('docker',['rm','-f',container],{stdio:'ignore'});
 },30_000);

 it('the identity role performs every identity write, through the identity store', async()=>{
  const store=createIdentityStore({db:identityDbOf(auth),authSchema:'auth'});
  const owner=await store.createUser({email:'owner@example.com'});
  await store.syncProfile({userId:'usr_member',email:'member@example.com',testAccount:false});
  expect(await store.setUsername({userId:owner.id,username:'owner_one'})).toEqual({ok:true,username:'owner_one'});
  expect((await store.setImageKey({userId:owner.id,key:'avatar/1'})).previous).toBeNull();
  await store.confirmWelcome({userId:'usr_member'});await store.setAutoAcceptMentions({userId:owner.id,autoAccept:false});
  const finance=(await store.createGroup({actorId:owner.id,handle:'finance',name:'Finance'})).group;
  const retail=(await store.createGroup({actorId:owner.id,handle:'retail',name:'Retail',parentId:finance.id})).group;
  const invited=await store.inviteGroupMember({actorId:owner.id,groupId:retail.id,email:'member@example.com',role:'viewer'});
  expect(invited.changes).toHaveLength(1);
  expect((await store.acceptGroupInvitations({userId:'usr_member',email:'member@example.com'})).groupIds).toEqual([retail.id]);
  await store.setGroupMember({actorId:owner.id,groupId:retail.id,userId:'usr_member',role:'editor'});
  await store.setGroupMember({actorId:owner.id,groupId:retail.id,userId:'usr_member',role:'viewer'});
  const second=await store.inviteGroupMember({actorId:owner.id,groupId:finance.id,email:'later@example.com',role:'viewer'});
  await store.removeGroupInvitation({actorId:owner.id,groupId:finance.id,invitationId:second.invitation.id});
  await store.inviteGroupMember({actorId:owner.id,groupId:finance.id,email:'pending@example.com',role:'viewer'});
  expect((await store.setGroupParent({actorId:owner.id,groupId:retail.id,parentId:null,fromParentId:finance.id})).changed).toBe(true);
  await store.setGroupParent({actorId:owner.id,groupId:retail.id,parentId:finance.id,fromParentId:null});
  const doomed=(await store.createGroup({actorId:owner.id,handle:'doomed',name:'Doomed'})).group;
  await store.deleteGroup({actorId:owner.id,groupId:doomed.id,handle:'doomed'});
  expect(await store.admitToGroup({userId:owner.id,email:'owner@example.com',groupId:finance.id,inviteOnly:false})).toMatchObject({admitted:true});
  const minted=await store.mintToken({name:'cli',userId:owner.id,expiresInMs:3_600_000});
  expect((await store.findToken({hash:(await auth.query('SELECT token_hash FROM auth.tokens WHERE id=$1',[minted.id])).rows[0].token_hash}))?.id).toBe(minted.id);
  await store.touchToken({id:minted.id});await store.setTokenHarness({id:minted.id,harness:'codex'});await store.markRequestAuthority({prefix:'cli'});
  expect((await store.ensureWebToken({userId:owner.id})).minted).toBe(true);
  expect(await store.revokeToken({id:minted.id,userId:owner.id})).toEqual({name:'cli'});
  const tester=await store.createTestUser({parentId:owner.id,label:'Test user ab12',ttlMs:3_600_000,limit:3,tokenName:'mxmx_test_user'});
  expect(tester).not.toBeNull();
  await store.removeGroupMember({actorId:owner.id,groupId:retail.id,userId:'usr_member'});
  const claim=await store.claimGroupMail({leaseSeconds:60,maxAttempts:8});
  expect(claim).not.toBeNull();
  expect(await store.settleGroupMail({id:claim!.id,claimToken:claim!.claim_token,outcome:'sent',maxAttempts:8})).toEqual({owned:true});
  expect(await store.eraseTestUser({userId:tester!.id})).toBe(true);
  // Every identity table has rows the identity role wrote.
  for(const table of IDENTITY_OWNED_TABLES)expect(Number((await auth.query(`SELECT count(*) AS n FROM auth.${table}`)).rows[0].n),table).toBeGreaterThan(0);
 });

 it('both readers are refused every base table, every write through a view, and a row lock', async()=>{
  for(const [role,reader] of [['artifactbin_app',app],['minusx_reader',minusx]] as const){
   for(const table of [...IDENTITY_OWNED_TABLES,'session','credentials','user','account','verification'])
    expect(await code(reader.query(`SELECT 1 FROM auth."${table}" LIMIT 1`)),`${role} SELECT auth.${table}`).toBe('42501');
   for(const [view,columns] of Object.entries(IDENTITY_VIEWS)){
    const column=`"${columns[0]}"`;
    expect(await code(reader.query(`DELETE FROM identity.${view}`)),`${role} DELETE identity.${view}`).toBe('42501');
    expect(await code(reader.query(`UPDATE identity.${view} SET ${column}=${column}`)),`${role} UPDATE identity.${view}`).toBe('42501');
   }
   expect(await code(reader.query("INSERT INTO identity.users(id,email) VALUES ('usr_x','x@example.com')")),`${role} INSERT`).toBe('42501');
   expect(await code(reader.query("INSERT INTO identity.groups(id,handle,name,created_by) VALUES ('g','g','g','u')")),`${role} INSERT`).toBe('42501');
   expect(await code(reader.query('SELECT 1 FROM identity.group_members FOR SHARE')),`${role} FOR SHARE`).toBe('42501');
  }
 });

 it('both readers read every view, and no view exposes a secret column', async()=>{
  for(const reader of [app,minusx]){
   for(const [view,columns] of Object.entries(IDENTITY_VIEWS)){
    const rows=await reader.query(`SELECT * FROM identity.${view} LIMIT 1`);
    expect(rows.fields.map(field=>field.name),view).toEqual(columns);
   }
   for(const column of SECRET_COLUMNS.tokens!)expect(await code(reader.query(`SELECT ${column} FROM identity.tokens`))).toBe('42703');
   for(const column of SECRET_COLUMNS.session!)expect(await code(reader.query(`SELECT ${column} FROM identity.sessions`))).toBe('42703');
  }
  const exposed=(await superuser.query("SELECT table_name,column_name FROM information_schema.columns WHERE table_schema='identity'")).rows as {table_name:string;column_name:string}[];
  for(const [table,secrets] of Object.entries(SECRET_COLUMNS))
   for(const secret of secrets)expect(exposed.filter(c=>c.column_name===secret),`${table}.${secret}`).toEqual([]);
  expect((await minusx.query("SELECT active FROM identity.users WHERE email='owner@example.com'")).rows).toEqual([{active:true}]);
 });

 it('the app role, on its own search_path, reads identity through the views and runs its access SQL over them', async()=>{
  expect((await app.query("SELECT n.nspname AS schema,c.relkind::text AS kind FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE c.oid=to_regclass('users')")).rows).toEqual([{schema:'identity',kind:'v'}]);
  const owner=(await app.query("SELECT id FROM users WHERE email='owner@example.com'")).rows[0].id as string;
  const groups=Object.fromEntries((await app.query('SELECT handle,id FROM groups WHERE deleted_at IS NULL')).rows.map(row=>[row.handle,row.id]));
  // The tree as the app reads it: the owner's reach (direct memberships and ancestors), a subtree.
  expect((await app.query(`${reachedGroupsSql('$1')} ORDER BY id`,[owner])).rows.map(row=>row.id).sort()).toEqual([groups.finance,groups.retail].sort());
  expect((await app.query(`${subtreeSql('$1')}`,[groups.finance])).rows.map(row=>row.id).sort()).toEqual([groups.finance,groups.retail].sort());
  // The app's own table and an access decision inside its own transaction, through the views.
  await app.query("INSERT INTO artifacts(id,token_id,format) VALUES ('data','tok','dataset') ON CONFLICT DO NOTHING");
  await app.query("INSERT INTO artifact_group_shares(artifact_id,group_id,role,created_by) VALUES ('data',$1,'editor',$2)",[groups.finance,owner]);
  const client=await app.connect();
  try{
   await client.query('BEGIN');
   const facts=transactionAccessFacts({userId:owner,tokenId:null,email:null,documentEditor:false} as never,{query:async(sql:string,params?:unknown[])=>({rows:(await client.query(sql,params as never[])).rows})} as Queryable);
   expect(await facts.groupShareRole('data')).toBe('editor');
   expect(await facts.groupRole(groups.retail!)).toBe('editor');
   expect(await facts.userKind(owner)).toBe('account');
   await client.query('COMMIT');
  }finally{client.release();}
 });

 it('upgrades a database whose app role owns the identity tables: refused until the one-time move, then every row kept and only the views readable', async()=>{
  await superuser.query('CREATE DATABASE upgrade');
  const root=pool('postgres','public','upgrade');
  // The former layout: identity's tables in the app's schema, the identity views the app's.
  await root.query(`REVOKE CREATE ON DATABASE upgrade FROM PUBLIC; CREATE SCHEMA app AUTHORIZATION artifactbin_app; CREATE SCHEMA auth AUTHORIZATION artifactbin_auth;
   CREATE SCHEMA identity AUTHORIZATION artifactbin_app; GRANT USAGE ON SCHEMA app TO artifactbin_auth; GRANT USAGE ON SCHEMA auth TO artifactbin_app`);
  const oldApp=pool('artifactbin_app','app','upgrade');
  await oldApp.query(`CREATE TABLE users (id text PRIMARY KEY, email text, kind text NOT NULL DEFAULT 'account'); INSERT INTO users(id,email) VALUES ('usr_kept','kept@example.com');
   CREATE TABLE tokens (id text PRIMARY KEY, token_hash text NOT NULL, user_id text); INSERT INTO tokens VALUES ('tok_kept','hash-kept','usr_kept');
   CREATE TABLE groups (id text PRIMARY KEY, handle text NOT NULL, name text NOT NULL, created_by text NOT NULL); INSERT INTO groups VALUES ('grp_kept','kept','Kept','usr_kept');
   CREATE VIEW identity.users AS SELECT id, true AS active FROM app.users`);
  for(const statement of SCHEMA_STATEMENTS)await oldApp.query(statement);
  await oldApp.query("INSERT INTO identity_settings(id,deployment_mode) VALUES('installation','public')");
  await root.query('GRANT SELECT ON app.deployment_members, app.deployment_state, app.identity_settings TO artifactbin_auth');
  const authDb=identityDbOf(pool('artifactbin_auth','auth','upgrade')),schemas={auth:'auth',app:'app',read:'identity'};
  await expect(ensureIdentitySchema(authDb,schemas)).rejects.toBeInstanceOf(IdentityNotReady);
  await expect(ensureIdentitySchema(authDb,schemas)).rejects.toThrow(/ALTER TABLE IF EXISTS app\.users SET SCHEMA auth/);
  // The operator's one-shot, then the grants as grants.sql gives them, then the identity boot.
  for(const statement of identityMoveStatements({...schemas,owner:'artifactbin_auth'}))await root.query(statement);
  await root.query(`REVOKE USAGE ON SCHEMA auth FROM artifactbin_app; GRANT USAGE ON SCHEMA identity TO artifactbin_app;
   ALTER DEFAULT PRIVILEGES FOR ROLE artifactbin_auth IN SCHEMA identity GRANT SELECT ON TABLES TO artifactbin_app`);
  await ensureIdentitySchema(authDb,schemas);
  const app2=pool('artifactbin_app','app,identity','upgrade');
  expect((await app2.query("SELECT n.nspname AS schema,c.relkind::text AS kind FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE c.oid=to_regclass('users')")).rows).toEqual([{schema:'identity',kind:'v'}]);
  expect((await app2.query('SELECT id,email,active FROM users')).rows).toEqual([{id:'usr_kept',email:'kept@example.com',active:true}]);
  expect((await app2.query('SELECT id,user_id FROM tokens')).rows).toEqual([{id:'tok_kept',user_id:'usr_kept'}]);
  expect((await app2.query('SELECT id,deleted_at FROM groups')).rows).toEqual([{id:'grp_kept',deleted_at:null}]);
  for(const table of ['users','tokens','groups'])expect(await code(app2.query(`SELECT 1 FROM auth.${table}`)),table).toBe('42501');
  expect((await root.query("SELECT tablename,tableowner FROM pg_tables WHERE schemaname='auth' AND tablename IN ('users','tokens','groups') ORDER BY 1")).rows)
   .toEqual(['groups','tokens','users'].map(tablename=>({tablename,tableowner:'artifactbin_auth'})));
 });
});
