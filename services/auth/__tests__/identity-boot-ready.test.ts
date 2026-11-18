/**
 * THE IDENTITY BOOT'S READINESS (ensureIdentitySchema): the app's tables AND every column the views read from them
 * are the app's boot's. A split-role identity host that boots first answers IdentityNotReady (which the boot loop
 * retries), never a raw 42703 from creating the views.
 */
import {PGlite} from '@electric-sql/pglite';
import {afterEach,describe,expect,it} from 'vitest';
import type {Queryable,TransactionalQueryable} from '@artifactbin/contracts';
import {IdentityNotReady,ensureIdentitySchema} from '../src/identity-store';
import {assertGroupRoleModel,migrateGroupRoles} from '../src/identity-store/group-role-migration';

const schemas={auth:'auth',app:'public',read:'identity'};
let pg:PGlite|null=null;
afterEach(async()=>{await pg?.close();pg=null;});

const open=():{pg:PGlite;db:TransactionalQueryable}=>{
 pg=new PGlite();
 const db={query:pg.query.bind(pg),transaction:<T,>(fn:(tx:Queryable)=>Promise<T>)=>pg!.transaction(tx=>fn(tx as unknown as Queryable))} as unknown as TransactionalQueryable;
 return {pg,db};
};
const APP_TABLES=(audiences:string)=>`
 CREATE TABLE deployment_members (user_id TEXT PRIMARY KEY);
 CREATE TABLE deployment_state (id TEXT PRIMARY KEY, setup_complete BOOLEAN NOT NULL DEFAULT false);
 CREATE TABLE identity_settings (id TEXT PRIMARY KEY, deployment_mode TEXT NOT NULL DEFAULT 'public', api_audiences TEXT[] NOT NULL DEFAULT '{}'${audiences});`;

describe('ensureIdentitySchema readiness',()=>{
 it('refuses legacy grants until an explicit migration, then preserves new Editors across restarts',async()=>{
  const {pg,db}=open();
  await pg.exec(APP_TABLES(",service_audiences TEXT[] NOT NULL DEFAULT '{}'"));
  await ensureIdentitySchema(db,schemas);
  await assertGroupRoleModel(db,'identity');
  await pg.exec("UPDATE auth.group_hierarchy SET role_model_version=1; INSERT INTO auth.group_members(group_id,user_id,role) VALUES('g','old','editor')");
  await expect(ensureIdentitySchema(db,schemas)).rejects.toThrow('migrate:groups');
  await expect(assertGroupRoleModel(db,'identity')).rejects.toThrow('migrate:groups');
  expect((await pg.query('SELECT role FROM auth.group_members')).rows).toEqual([{role:'editor'}]);
  await migrateGroupRoles(db,{schema:'auth',writesPausedAndBackupVerified:true});
  await pg.exec("INSERT INTO auth.group_members(group_id,user_id,role) VALUES('g','new','editor')");
  await ensureIdentitySchema(db,schemas);
  await assertGroupRoleModel(db,'identity');
  expect((await pg.query('SELECT user_id,role FROM identity.group_members ORDER BY user_id')).rows).toEqual([{user_id:'new',role:'editor'},{user_id:'old',role:'admin'}]);
 });
 it('answers IdentityNotReady while identity_settings lacks a column the views read, then boots once the app adds it',async()=>{
  const {pg,db}=open();
  await pg.exec(APP_TABLES(''));
  await expect(ensureIdentitySchema(db,schemas)).rejects.toBeInstanceOf(IdentityNotReady);
  await expect(ensureIdentitySchema(db,schemas)).rejects.toThrow(/identity_settings has no service_audiences/);
  // Nothing was created by the refused boot.
  expect((await pg.query("SELECT 1 FROM pg_namespace WHERE nspname IN ('auth','identity')")).rows).toEqual([]);
  await pg.exec("ALTER TABLE identity_settings ADD COLUMN service_audiences TEXT[] NOT NULL DEFAULT '{}'");
  await ensureIdentitySchema(db,schemas);
  const views=(await pg.query<{table_name:string}>("SELECT table_name FROM information_schema.views WHERE table_schema='identity' ORDER BY 1")).rows.map(row=>row.table_name);
  expect(views).toEqual(expect.arrayContaining(['users','tokens','groups']));
 });
});

/**
 * A database from before the principal columns (`tokens.group_id`, `group_role`, `issued_by`, `grant_id`): its base
 * table lacks them, its `tokens` view has the thirteen columns readers know, and a reader built a view on top of it.
 * The boot adds the columns (every row NULL) and appends them to the view in place, so the reader's view survives and
 * every column it knew keeps its position.
 */
describe('ensureIdentitySchema on a database from before the principal columns',()=>{
 const PRINCIPAL=['group_id','group_role','issued_by','grant_id'];
 const BEFORE=['id','name','user_id','client_harness','audience','scope','request_authority','created_at','deleted_at','expires_at','last_used_at','scopes','live'];
 const viewColumns=async(pg:PGlite,view:string)=>(await pg.query<{column_name:string}>("SELECT column_name FROM information_schema.columns WHERE table_schema='identity' AND table_name=$1 ORDER BY ordinal_position",[view])).rows.map(row=>row.column_name);
 /** Boot, then rewind `tokens` to the earlier shape: the columns gone, the old view, a reader's view over it, one live token. */
 const before=async()=>{
  const {pg,db}=open();
  await pg.exec(APP_TABLES(",service_audiences TEXT[] NOT NULL DEFAULT '{}'"));
  await pg.exec("INSERT INTO identity_settings(id) VALUES('installation')");
  await ensureIdentitySchema(db,schemas);
  await pg.exec(`DROP VIEW identity.tokens CASCADE;
   ${PRINCIPAL.map(column=>`ALTER TABLE auth.tokens DROP COLUMN ${column};`).join('\n')}
   CREATE VIEW identity.tokens AS SELECT ${BEFORE.slice(0,-2).map(column=>`t.${column}`).join(', ')},
    array_remove(regexp_split_to_array(coalesce(t.scope, ''), '\\s+'), '') AS scopes, (t.deleted_at IS NULL) AS live FROM auth.tokens t;
   CREATE SCHEMA reader;
   CREATE VIEW reader.live_tokens AS SELECT id, user_id, scope, live FROM identity.tokens WHERE live;
   INSERT INTO auth.users(id,email) VALUES('usr_kept','kept@example.com');
   INSERT INTO auth.tokens(id,name,token_hash,user_id,scope) VALUES('tok_kept','laptop','hash_kept','usr_kept','artifacts');`);
  expect(await viewColumns(pg,'tokens')).toEqual(BEFORE);
  return {pg,db};
 };
 it('adds the columns with every row NULL and appends them to the view in place, keeping a reader\'s view on top of it',async()=>{
  const {pg,db}=await before();
  await ensureIdentitySchema(db,schemas);
  expect(await viewColumns(pg,'tokens')).toEqual([...BEFORE,...PRINCIPAL]);
  expect((await pg.query(`SELECT id,user_id,${PRINCIPAL.join(',')} FROM auth.tokens`)).rows).toEqual([{id:'tok_kept',user_id:'usr_kept',group_id:null,group_role:null,issued_by:null,grant_id:null}]);
  expect((await pg.query(`SELECT id,live,${PRINCIPAL.join(',')} FROM identity.tokens`)).rows).toEqual([{id:'tok_kept',live:true,group_id:null,group_role:null,issued_by:null,grant_id:null}]);
  // The reader's view was not dropped, and reads as before.
  expect((await pg.query('SELECT id,user_id,scope FROM reader.live_tokens')).rows).toEqual([{id:'tok_kept',user_id:'usr_kept',scope:'artifacts'}]);
  // A second boot changes nothing.
  await ensureIdentitySchema(db,schemas);
  expect(await viewColumns(pg,'tokens')).toEqual([...BEFORE,...PRINCIPAL]);
  expect((await pg.query("SELECT 1 FROM information_schema.views WHERE table_schema='reader' AND table_name='live_tokens'")).rows).toHaveLength(1);
 });
 it('still drops and recreates a view whose columns changed in any other way than growing at the end',async()=>{
  const {pg,db}=await before();
  await pg.exec('DROP VIEW reader.live_tokens; DROP VIEW identity.tokens; CREATE VIEW identity.tokens AS SELECT t.name, t.id FROM auth.tokens t');
  await ensureIdentitySchema(db,schemas);
  expect(await viewColumns(pg,'tokens')).toEqual([...BEFORE,...PRINCIPAL]);
 });
});
