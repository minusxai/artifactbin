/**
 * THE IDENTITY BOOT'S READINESS (ensureIdentitySchema): the app's tables AND every column the views read from them
 * are the app's boot's. A split-role identity host that boots first answers IdentityNotReady (which the boot loop
 * retries), never a raw 42703 from creating the views.
 */
import {PGlite} from '@electric-sql/pglite';
import {afterEach,describe,expect,it} from 'vitest';
import type {Queryable,TransactionalQueryable} from '@artifactbin/contracts';
import {IdentityNotReady,ensureIdentitySchema} from '../src/identity-store';

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
