/**
 * THE SPLIT-ROLE IDENTITY MODEL on a real PostgreSQL 17 (a disposable `postgres:17-alpine`), with the generated
 * roles.sql and grants.sql applied as an operator would: `artifactbin_app` boots its own tables (search_path `app`),
 * `artifactbin_auth` (the identity module) boots its base tables in `auth` and the read views in `identity`, and a
 * third reader role, `service_reader`, gets the IDENTITY.sql grant. Proven:
 *  - the identity role performs every identity write, through the identity store itself;
 *  - both readers are refused (42501) every base identity table, every write through a view, and a row lock;
 *  - both readers SELECT the views, no view exposes a secret column, and the app role, with its real search_path
 *    (`app, identity`), resolves `users` to the view and runs the app's own access SQL over it correctly.
 * And the production upgrade: a database whose app role still owns the identity tables (and the former identity views)
 * refuses the identity boot with the one-time move named; after `identityMoveStatements`, run by a superuser, it boots,
 * every row is kept, and the app role reads them only through the views.
 * Runs in the `integration` project; skipped without the image, except in CI, which provides it (test-support/docker).
 */
import {execFileSync,spawnSync} from 'node:child_process';
import { dockerImage } from '@artifactbin/test-support/docker';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import pg from 'pg';
import {afterAll,beforeAll,describe,expect,it} from 'vitest';
import {IDENTITY_OWNED_TABLES} from '@artifactbin/contracts/identity-module';
import {IDENTITY_VIEWS} from '@artifactbin/contracts/identity-service';
import type {Queryable} from '@artifactbin/contracts/db';
import {IdentityNotReady,createIdentityStore,ensureIdentitySchema,identityDbOf,identityMoveStatements} from '@artifactbin/auth/identity-store';
import {assertGroupRoleModel,migrateGroupRoles} from '@artifactbin/auth/identity-store/group-role-migration';
import {SECRET_COLUMNS} from '@artifactbin/auth/identity-store/schema';
import {createAuthHost,createBearerReader,createHumanAuth,sessionStoreOf,ensureHumanAuthSchema} from '@artifactbin/auth';
import {IDENTITY_INTROSPECT_PATH} from '@artifactbin/contracts/identity-service';
import {SCHEDULE_SIGN_IN_PATH,SERVICE_TOKEN_PATH} from '@artifactbin/contracts/service-audiences';
import {SERVICE_AUTH_HEADER} from '@artifactbin/contracts/routes';
import {createHash} from 'node:crypto';
import {SCHEMA_STATEMENTS} from '@/lib/platform';
import {tenancyIssuer} from '@/test/helpers/trusted-tenancy';
import {projectHostTenancyChanges,reachedGroupsSql,subtreeSql} from '@/lib/groups';
import {enrollCompanyRoot,planCompanyRootEnrollment} from '../../../../auth/scripts/enroll-company-root';
import {transactionAccessFacts} from '@/lib/artifact-access';

import {setPersonTenancy} from '../../../../auth/scripts/set-person-tenancy';

const ROOT=join(__dirname,'../../../../..');

describe.skipIf(!dockerImage('postgres:17-alpine'))('identity tables in a split-role database',()=>{
 let container='',port=0;
 const pools:pg.Pool[]=[];
 const pool=(user:string,searchPath:string,database='postgres')=>{const p=new pg.Pool({host:'127.0.0.1',port,user,password:'pw',database,options:`-c search_path=${searchPath}`,max:2});pools.push(p);return p;};
 const code=(promise:Promise<unknown>)=>promise.then(()=>'ok',(error:{code?:string})=>error.code??String(error));
 let superuser:pg.Pool,app:pg.Pool,auth:pg.Pool,service:pg.Pool;

 beforeAll(async()=>{
  container=execFileSync('docker',['run','--rm','-d','--tmpfs','/var/lib/postgresql/data','-e','POSTGRES_PASSWORD=pw','-p','127.0.0.1::5432','postgres:17-alpine'],{encoding:'utf8'}).trim();
  port=Number(execFileSync('docker',['port',container,'5432/tcp'],{encoding:'utf8'}).trim().split('\n')[0]!.split(':').at(-1));
  superuser=pool('postgres','public');
  for(let attempt=0;;attempt++){
   try{await superuser.query('SELECT 1');break;}catch{if(attempt>120)throw Error('postgres never became ready');await new Promise(r=>setTimeout(r,500));}
  }
  // The operator's fresh-database steps: roles.sql (with passwords), the app's boot, the identity host's boot, grants.sql.
  await superuser.query(readFileSync(join(ROOT,'roles.sql'),'utf8'));
  await superuser.query("ALTER ROLE artifactbin_app PASSWORD 'pw'; ALTER ROLE artifactbin_auth PASSWORD 'pw'; CREATE ROLE service_reader LOGIN PASSWORD 'pw'");
  // No role may create a schema in this database: every boot must check before creating (product bug 2).
  await superuser.query('REVOKE CREATE ON DATABASE postgres FROM PUBLIC');
  app=pool('artifactbin_app','app,identity');
  for(const statement of SCHEMA_STATEMENTS)await app.query(statement);
  await app.query("INSERT INTO identity_settings(id,deployment_mode,api_audiences) VALUES('installation','public',ARRAY['http://app.test/api'])");
  await superuser.query('CREATE TABLE events.events(id text)');
  await superuser.query(readFileSync(join(ROOT,'grants.sql'),'utf8'));
  // Another service's grant, as IDENTITY.sql's header gives it (render-schema --reader-role).
  await superuser.query(`GRANT USAGE ON SCHEMA identity TO service_reader; GRANT SELECT ON ALL TABLES IN SCHEMA identity TO service_reader;
   ALTER DEFAULT PRIVILEGES FOR ROLE artifactbin_auth IN SCHEMA identity GRANT SELECT ON TABLES TO service_reader`);
  auth=pool('artifactbin_auth','auth');
  // Upgrade from split roles with preferences still in the app, including a stored group choice.
  await app.query(`CREATE TABLE app.account_preferences(user_id text PRIMARY KEY, default_destination jsonb NOT NULL);
   INSERT INTO app.account_preferences VALUES ('prior','{"type":"group","id":"root_b"}')`);
  await expect(ensureIdentitySchema(identityDbOf(auth),{auth:'auth',app:'app',read:'identity'})).rejects.toThrow(/stop the old app/);
  await superuser.query('BEGIN; ALTER TABLE app.account_preferences SET SCHEMA auth; ALTER TABLE auth.account_preferences OWNER TO artifactbin_auth; COMMIT');
  await ensureHumanAuthSchema({pool:auth,schema:'auth'});
  await ensureIdentitySchema(identityDbOf(auth),{auth:'auth',app:'app',read:'identity'});
  service=pool('service_reader','identity');
  await auth.query(`INSERT INTO auth.users(id,email) VALUES ('prior','prior@example.com');
   INSERT INTO auth.groups(id,name,handle,created_by,parent_id) VALUES ('root_b','Root','root_b','prior',NULL),('child_b','Child','child_b','prior','root_b');
   INSERT INTO auth.group_members(group_id,user_id,role) VALUES ('root_b','prior','member'),('child_b','prior','member')`);
  expect((await service.query("SELECT default_group_id FROM users WHERE id='prior'")).rows).toEqual([{default_group_id:'root_b'}]);
 },180_000);
 afterAll(async()=>{
  for(const p of pools)await p.end().catch(()=>{});
  if(container)spawnSync('docker',['rm','-f',container],{stdio:'ignore'});
 },30_000);

 it('serializes competing schedule consents and invalidates old credentials at takeover',async()=>{
  const db=identityDbOf(auth),baseURL='http://app.test',secret='disposable-schedule-cookie-key-0000';
  const serviceSecret='disposable-schedule-service-key',otherSecret='disposable-other-service-key';
  const configured=(id:string,key:string)=>({id,origin:`https://${id}.example.test`,run_sign_ins:true,group_principals:true,
   introspection_secret_sha256:createHash('sha256').update(key).digest('hex')});
  let otp='';
  const human=await createHumanAuth({pool:auth,schema:'auth',secret,baseURL,mail:{send:async message=>{otp=message.otp??'';}}});
  const host=createAuthHost({env:{APP__PUBLIC_BASE_URL:baseURL,INTERNAL__SERVICE_SECRET:secret,
   IDENTITY__SERVICE_AUDIENCES:JSON.stringify([configured('scheduler',serviceSecret),configured('other',otherSecret)])},
   cookieSecret:secret,tokens:createBearerReader({db}),sessions:sessionStoreOf(human),identityDb:db,appSchema:'app',upstream:async()=>new Response(null,{status:404})});
  const post=(path:string,body:unknown,headers:Record<string,string>={})=>host.request(baseURL+path,{method:'POST',
   headers:{origin:baseURL,'content-type':'application/json',...headers},body:JSON.stringify(body)});
  const store=createIdentityStore({db,authSchema:'auth',appSchema:'app'});
  await auth.query("INSERT INTO auth.groups(id,handle,name,created_by) VALUES('grp_schedule','disposable_schedule','Schedule','prior'),('grp_alternate','disposable_alternate','Alternate','prior')");
  const person=async(email:string,role:string)=>{
   expect((await post('/api/auth/email-otp/send-verification-otp',{email,type:'sign-in'})).status).toBe(200);
   const login=await post('/api/auth/sign-in/email-otp',{email,otp});
   expect(login.status).toBe(200);
   const cookie=login.headers.getSetCookie().map(line=>line.split(';')[0]).join('; ');
   const user=(await login.json()).user.id as string;
   await store.syncProfile({userId:user,email,testAccount:false});
   await auth.query("INSERT INTO auth.group_members(group_id,user_id,role) VALUES('grp_schedule',$1,$2),('grp_alternate',$1,'member')",[user,role]);
   const serviceToken=await post(SERVICE_TOKEN_PATH,{audience:'scheduler'},{cookie});
   expect(serviceToken.status,await serviceToken.clone().text()).toBe(200);
   return {user,token:(await serviceToken.json()).access_token as string};
  };
  const first=await person('mxmx_test_schedule_first@example.test','admin');
  const second=await person('mxmx_test_schedule_second@example.test','member');
  const call=async(body:unknown,key=serviceSecret)=>{
   const response=await post(SCHEDULE_SIGN_IN_PATH,body,{[SERVICE_AUTH_HEADER]:key});
   return {status:response.status,body:await response.json()};
  };
  const scope={schedule_id:'daily',revision:'before'},consent={...scope,action:'consent',token:first.token,group_id:'grp_schedule'};
  const results=await Promise.all([call(consent),call(consent),call({...consent,token:second.token})]);
  // Whichever owner wins, only that owner may retry this revision.
  const grant=results[2]!.status===200?results[2]!:results[0]!;
  expect(grant.status,JSON.stringify(results)).toBe(200);
  expect(results).toEqual(grant.body.user_id===first.user?[grant,grant,{status:409,body:{error:'schedule_conflict'}}]:
   [{status:409,body:{error:'schedule_conflict'}},{status:409,body:{error:'schedule_conflict'}},grant]);
  const prior={...scope,grant_id:grant.body.grant_id};
  expect((await call({...prior,action:'issue'},otherSecret)).status).toBe(403);
  const start=await call({...prior,action:'issue'});
  expect(start.status).toBe(200);
  const exchange=await post(SERVICE_TOKEN_PATH,{audience:'scheduler'},{authorization:`Bearer ${start.body.access_token}`});
  expect(exchange.status,await exchange.clone().text()).toBe(200);
  const exchanged=(await exchange.json()).access_token;
  const inspect=async(token:string)=>(await post(IDENTITY_INTROSPECT_PATH,{token},{[SERVICE_AUTH_HEADER]:secret})).json();
  expect(await inspect(exchanged)).toMatchObject({active:true,user_id:grant.body.user_id,group_id:'grp_schedule',group_role:'member'});
  expect((await call({...prior,action:'revoke'})).status).toBe(200);
  const successor=grant.body.user_id===first.user?second:first;
  expect((await call({...consent,revision:'after',token:successor.token,group_id:'grp_alternate'})).status).toBe(409);
  const takeover=await call({...consent,revision:'after',token:successor.token});
  expect(takeover).toEqual({status:200,body:{grant_id:expect.any(String),user_id:successor.user,group_id:'grp_schedule',group_role:'member'}});
  expect((await call({...prior,action:'issue'})).status).toBe(403);
  expect(await inspect(exchanged)).toEqual({active:false});
  expect(await inspect(start.body.access_token)).toEqual({active:false});

  const current={action:'issue',schedule_id:scope.schedule_id,revision:'after',grant_id:takeover.body.grant_id};
  const activeRun=await call(current);
  expect(activeRun.status).toBe(200);
  expect(await inspect(activeRun.body.access_token)).toMatchObject({active:true,user_id:successor.user,group_role:'member'});
  await auth.query("DELETE FROM auth.group_members WHERE group_id='grp_schedule' AND user_id=$1",[successor.user]);
  expect(await inspect(activeRun.body.access_token)).toEqual({active:false});
  await auth.query("INSERT INTO auth.group_members(group_id,user_id,role) VALUES('grp_schedule',$1,'member')",[successor.user]);
  expect(await inspect(activeRun.body.access_token)).toEqual({active:false});
  expect((await call(current)).status).toBe(403);
 });

 it('exposes an operator-assigned personal tenancy to the read-only identity role',async()=>{
  const read=()=>service.query("SELECT tenancy_id FROM users WHERE id='prior'").then(result=>result.rows);
  expect(await read()).toEqual([{tenancy_id:null}]);
  const set=(expected:string|null,tenancy:string|null)=>setPersonTenancy(superuser,'auth','prior',expected,tenancy);
  await set(null,'tenant-a');
  try {
   expect(await read()).toEqual([{tenancy_id:'tenant-a'}]);
   await expect(set(null,'tenant-b')).rejects.toThrow('person_tenancy_changed_or_missing');
   await expect(set('tenant-a','')).rejects.toThrow('invalid_person_tenancy');
   expect(await code(service.query("UPDATE identity.users SET tenancy_id=NULL WHERE id='prior'"))).toBe('42501');
   expect(await read()).toEqual([{tenancy_id:'tenant-a'}]);
  } finally {
   await set('tenant-a',null);
  }
  expect(await read()).toEqual([{tenancy_id:null}]);
 });

 it('migrates existing grants atomically on PostgreSQL and never promotes a new Editor on a repeated run',async()=>{
  await superuser.query(`CREATE SCHEMA role_upgrade;
   CREATE TABLE role_upgrade.group_hierarchy(id text PRIMARY KEY,revision bigint NOT NULL DEFAULT 0);
   CREATE TABLE role_upgrade.group_members(group_id text,user_id text,role text NOT NULL);
   CREATE TABLE role_upgrade.group_invitations(id text,role text NOT NULL);
   INSERT INTO role_upgrade.group_hierarchy VALUES('installation',9);
   INSERT INTO role_upgrade.group_members VALUES('g','old','editor');
   INSERT INTO role_upgrade.group_invitations VALUES('pending','viewer'),('bad','unknown');`);
  const db=identityDbOf(superuser),options={schema:'role_upgrade',writesPausedAndBackupVerified:true};
  await expect(migrateGroupRoles(db,options)).rejects.toThrow('Unexpected group role');
  expect((await superuser.query('SELECT role FROM role_upgrade.group_members')).rows).toEqual([{role:'editor'}]);
  await superuser.query("DELETE FROM role_upgrade.group_invitations WHERE id='bad'");
  expect(await migrateGroupRoles(db,options)).toEqual({changed:true});
  await superuser.query("INSERT INTO role_upgrade.group_members VALUES('g','new','editor')");
  expect(await migrateGroupRoles(db,options)).toEqual({changed:false});
  await assertGroupRoleModel(db,'role_upgrade');
  expect((await superuser.query('SELECT user_id,role FROM role_upgrade.group_members ORDER BY user_id')).rows).toEqual([{user_id:'new',role:'member'},{user_id:'old',role:'admin'}]);
  expect((await superuser.query('SELECT role FROM role_upgrade.group_invitations')).rows).toEqual([{role:'member'}]);
 });

 it('projects admitted changes across roles and retries a failed audit insert',async()=>{
  const issuer=tenancyIssuer(),db=identityDbOf(auth),baseURL='http://localhost:3000';
  const secret='disposable-split-role-test-secret';
  const human=await createHumanAuth({pool:auth,schema:'auth',secret,baseURL,mail:{send:async()=>{}}});
  const host=createAuthHost({env:issuer.env,cookieSecret:secret,tokens:{byToken:async()=>null},sessions:sessionStoreOf(human),
    identityTransactions:db,identityDb:db,appSchema:'app',upstream:async()=>new Response()});
  expect((await host.fetch(issuer.request('initial','creator'))).status).toBe(303);
  const results=await Promise.all(['left','right'].map(tenant=>host.fetch(issuer.request(tenant,'reader'))));
  expect(results.map(r=>r.status)).toEqual([303,303]);
  expect(await code(auth.query('SELECT * FROM app.group_audit'))).toBe('42501');
  await app.query("ALTER TABLE group_audit ADD CONSTRAINT fail_projection CHECK (action <> 'host_tenancy_changed')");
  try {expect(await code(projectHostTenancyChanges(app))).toBe('23514');}
  finally {await app.query('ALTER TABLE group_audit DROP CONSTRAINT fail_projection');}
  await Promise.all([projectHostTenancyChanges(app),projectHostTenancyChanges(app)]);
  const final=(await app.query("SELECT tenancy_id FROM groups WHERE handle='host_team'")).rows[0].tenancy_id;
  const middle=final==='left'?'right':'left';
  expect((await app.query(`SELECT details->'previous'->>'tenancy_id' AS prior,details->'next'->>'tenancy_id' AS next
    FROM group_audit WHERE action='host_tenancy_changed' ORDER BY created_at,host_change_seq`)).rows)
    .toEqual([{prior:'initial',next:middle},{prior:middle,next:final}]);
 });

 it('the identity role performs every identity write, through the identity store', async()=>{
  const store=createIdentityStore({db:identityDbOf(auth),authSchema:'auth',appSchema:'app'});
  const owner=await store.createUser({email:'owner@example.com'});
  await store.syncProfile({userId:'usr_member',email:'member@example.com',testAccount:false});
  expect(await store.setUsername({userId:owner.id,username:'owner_one'})).toEqual({ok:true,username:'owner_one'});
  expect((await store.setImageKey({userId:owner.id,key:'avatar/1'})).previous).toBeNull();
  await store.confirmWelcome({userId:'usr_member'});await store.setAutoAcceptMentions({userId:owner.id,autoAccept:false});
  const finance=(await store.createGroup({actorId:owner.id,handle:'finance',name:'Finance'})).group;
  const retail=(await store.createGroup({actorId:owner.id,handle:'retail',name:'Retail',parentId:finance.id})).group;
  const readerDefault=async()=>(await service.query('SELECT default_group_id FROM users WHERE id=$1',[owner.id])).rows[0].default_group_id;
  expect(await readerDefault()).toBe(retail.id);
  await store.setDefaultDestination({userId:owner.id,destination:{type:'group',id:finance.id}});
  expect(await readerDefault()).toBe(finance.id);
  const invited=await store.inviteGroupMember({actorId:owner.id,groupId:retail.id,email:'member@example.com',role:'member'});
  expect(invited.changes).toHaveLength(1);
  expect((await store.acceptGroupInvitations({userId:'usr_member',email:'member@example.com'})).groupIds).toEqual([retail.id]);
  await store.setGroupMember({actorId:owner.id,groupId:retail.id,userId:'usr_member',role:'admin'});
  await store.setGroupMember({actorId:owner.id,groupId:retail.id,userId:'usr_member',role:'member'});
  const second=await store.inviteGroupMember({actorId:owner.id,groupId:finance.id,email:'later@example.com',role:'member'});
  await store.removeGroupInvitation({actorId:owner.id,groupId:finance.id,invitationId:second.invitation.id});
  await store.inviteGroupMember({actorId:owner.id,groupId:finance.id,email:'pending@example.com',role:'member'});
  expect((await store.setGroupParent({actorId:owner.id,groupId:retail.id,parentId:null,fromParentId:finance.id})).changed).toBe(true);
  await store.setGroupParent({actorId:owner.id,groupId:retail.id,parentId:finance.id,fromParentId:null});
  const doomed=(await store.createGroup({actorId:owner.id,handle:'doomed',name:'Doomed'})).group;
  await store.deleteGroup({actorId:owner.id,groupId:doomed.id,handle:'doomed'});
  expect(await store.admitToGroup({userId:owner.id,email:'owner@example.com',groupId:finance.id,inviteOnly:false})).toMatchObject({admitted:true});
  // A group's approval of a service (group sign-ins), written and revoked by the identity role alone.
  const approval=(await store.approveServiceGroupSignIn({actorId:owner.id,groupId:finance.id,serviceId:'warehouse',serviceOrigin:'https://warehouse.example.com',role:'member'})).grant;
  expect(approval).toMatchObject({group_id:finance.id,service_id:'warehouse',role:'member',approved_by:owner.id,service_origin:'https://warehouse.example.com'});
  expect((await store.revokeServiceGroupSignIn({actorId:owner.id,groupId:finance.id,id:approval.id}))?.grant).toMatchObject({id:approval.id});
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
  for(const [role,reader] of [['artifactbin_app',app],['service_reader',service]] as const){
   for(const table of [...IDENTITY_OWNED_TABLES,'session','credentials','user','account','verification'])
    expect(await code(reader.query(`SELECT 1 FROM auth."${table}" LIMIT 1`)),`${role} SELECT auth.${table}`).toBe('42501');
   for(const [view,columns] of Object.entries(IDENTITY_VIEWS)){
    const column=`"${columns[0]}"`;
    // The computed group_admins view is writable by nobody: a write is refused as not updatable (55000) before any
    // privilege is consulted. Every other view refuses it as a privilege (42501).
    const refused=view==='group_admins'?'55000':'42501';
    expect(await code(reader.query(`DELETE FROM identity.${view}`)),`${role} DELETE identity.${view}`).toBe(refused);
    expect(await code(reader.query(`UPDATE identity.${view} SET ${column}=${column}`)),`${role} UPDATE identity.${view}`).toBe(refused);
   }
   expect(await code(reader.query("INSERT INTO identity.users(id,email) VALUES ('usr_x','x@example.com')")),`${role} INSERT`).toBe('42501');
   expect(await code(reader.query("INSERT INTO identity.groups(id,handle,name,created_by) VALUES ('g','g','g','u')")),`${role} INSERT`).toBe('42501');
   expect(await code(reader.query('SELECT 1 FROM identity.group_members FOR SHARE')),`${role} FOR SHARE`).toBe('42501');
  }
 });

 it('both readers read every view, and no view exposes a secret column', async()=>{
  for(const reader of [app,service]){
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
  expect((await service.query("SELECT active FROM identity.users WHERE email='owner@example.com'")).rows).toEqual([{active:true}]);
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
   expect(await facts.groupRole(groups.retail!)).toBe('admin');
   expect(await facts.userKind(owner)).toBe('account');
   await client.query('COMMIT');
  }finally{client.release();}
 });

 it('enrolls only the reviewed admissions into a moved root once, under split-role PostgreSQL',async()=>{
  const target={appSchema:'app',authSchema:'auth',ownerId:'move_owner',defaultId:'move_root'};
  const operator=identityDbOf(superuser);
  await auth.query(`INSERT INTO users(id,email) VALUES
   ('move_owner','move-owner@example.com'),('ordinary','ordinary@example.com'),('strong','strong@example.com'),
   ('removed','removed@example.com'),('excluded','excluded@example.com'),('revoked','revoked@example.com'),('late','late@example.com');
   INSERT INTO groups(id,handle,name,created_by,parent_id) VALUES
   ('move_root','move_root','New root','move_owner',NULL),('private_branch','private_branch','Branch','strong','move_root');
   INSERT INTO group_members(group_id,user_id,role) VALUES
   ('move_root','move_owner','admin'),('move_root','strong','editor'),('private_branch','strong','admin');`);
  await app.query(`UPDATE identity_settings SET deployment_mode='company' WHERE id='installation';
   INSERT INTO deployment_state(id,owner_user_id,default_group_id,setup_complete)
   VALUES ('company','move_owner','move_root',true) ON CONFLICT (id) DO UPDATE
   SET owner_user_id=excluded.owner_user_id, default_group_id=excluded.default_group_id, setup_complete=true;
   INSERT INTO deployment_members(user_id,admitted_at) SELECT id,now()-interval '1 day' FROM users
   WHERE id IN ('move_owner','ordinary','strong','removed','revoked');
   INSERT INTO group_audit(id,group_id,actor_user_id,action,details) VALUES
   ('prepared','move_root','move_owner','company_root_prepared','{"previous_default_group_id":"root_b"}'),
   ('moved','move_root','move_owner','company_default_changed','{"previous_default_group_id":"root_b"}'),
   ('removed','move_root','move_owner','member_removed','{"user_id":"removed"}');
   INSERT INTO deployment_members(user_id,admitted_at) VALUES ('late',now()+interval '1 hour');
   INSERT INTO artifacts(id,token_id,visibility) VALUES ('branch_page','tok','private');
   INSERT INTO artifact_group_shares(artifact_id,group_id,role,created_by) VALUES ('branch_page','private_branch','viewer','strong');`);
  const read=(userId:string)=>transactionAccessFacts({userId,tokenId:null,email:null,documentEditor:false} as never,
   {query:async(sql:string,params?:unknown[])=>({rows:(await app.query(sql,params as never[])).rows})} as Queryable).groupShareRole('branch_page');
  expect(await read('ordinary')).toBe('none');
  await expect(planCompanyRootEnrollment(operator,{...target,ownerId:'strong'})).rejects.toMatchObject({code:'deployment_owner_required'});
  await expect(planCompanyRootEnrollment(operator,{...target,defaultId:'root_b'})).rejects.toMatchObject({code:'default_group_changed'});
  const original=await planCompanyRootEnrollment(operator,target);
  await expect(enrollCompanyRoot(identityDbOf(app),target,original)).rejects.toMatchObject({code:'42501'});
  await expect(enrollCompanyRoot(identityDbOf(auth),target,original)).rejects.toMatchObject({code:'42501'});
  await app.query("DELETE FROM deployment_members WHERE user_id='revoked'");
  await expect(enrollCompanyRoot(operator,target,original)).rejects.toMatchObject({code:'enrollment_plan_changed'});
  await app.query("UPDATE deployment_state SET default_group_id='root_b' WHERE id='company'");
  await expect(enrollCompanyRoot(operator,target,original)).rejects.toMatchObject({code:'default_group_changed'});
  await app.query("UPDATE deployment_state SET default_group_id='move_root' WHERE id='company'");
  const hierarchyPlan=await planCompanyRootEnrollment(operator,target);
  await auth.query("UPDATE group_hierarchy SET revision=revision+1 WHERE id='installation'");
  await expect(enrollCompanyRoot(operator,target,hierarchyPlan)).rejects.toMatchObject({code:'enrollment_plan_changed'});
  const plan=await planCompanyRootEnrollment(operator,target);
  expect(plan.accounts.map(({id,role,removed})=>({id,role,removed}))).toEqual([
   {id:'move_owner',role:'admin',removed:false},{id:'ordinary',role:null,removed:false},
   {id:'removed',role:null,removed:true},{id:'strong',role:'editor',removed:false},
  ]);
  const before=await auth.query("SELECT (SELECT count(*) FROM group_invitations) AS invitations,(SELECT count(*) FROM group_mail_outbox) AS mail");
  await app.query("ALTER TABLE group_audit ADD CONSTRAINT reject_enrollment CHECK (action <> 'company_root_enrolled')");
  try {
   await expect(enrollCompanyRoot(operator,target,plan)).rejects.toMatchObject({code:'23514'});
   expect(await planCompanyRootEnrollment(operator,target)).toEqual(plan);
  } finally {
   await app.query('ALTER TABLE group_audit DROP CONSTRAINT reject_enrollment');
  }
  expect((await Promise.all([enrollCompanyRoot(operator,target,plan),enrollCompanyRoot(operator,target,plan)])).sort())
   .toEqual(['already_applied','applied']);
  expect((await auth.query("SELECT user_id,role FROM group_members WHERE group_id='move_root' ORDER BY user_id")).rows).toEqual([
   {user_id:'move_owner',role:'admin'},{user_id:'ordinary',role:'member'},{user_id:'strong',role:'editor'},
  ]);
  expect((await auth.query("SELECT (SELECT count(*) FROM group_invitations) AS invitations,(SELECT count(*) FROM group_mail_outbox) AS mail")).rows).toEqual(before.rows);
  expect(await read('ordinary')).toBe('none');
  expect(await read('strong')).toBe('viewer');
  expect((await app.query("SELECT actor_user_id,details->'added_user_ids' AS added FROM group_audit WHERE action='company_root_enrolled' AND group_id='move_root'")).rows)
   .toEqual([{actor_user_id:'move_owner',added:['ordinary']}]);
  await createIdentityStore({db:identityDbOf(auth),authSchema:'auth',appSchema:'app'})
   .removeGroupMember({actorId:'move_owner',groupId:'move_root',userId:'ordinary'});
  expect(await enrollCompanyRoot(operator,target,plan)).toBe('already_applied');
  await expect(planCompanyRootEnrollment(operator,target)).rejects.toMatchObject({code:'root_already_enrolled'});
  expect((await auth.query("SELECT user_id FROM group_members WHERE group_id='move_root' AND user_id='ordinary'")).rows).toEqual([]);
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
