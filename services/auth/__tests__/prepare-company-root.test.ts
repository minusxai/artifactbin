import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
import {afterAll,beforeAll,describe,expect,it} from 'vitest';
import {createIdentityStore} from '../src/identity-store';
import {prepareCompanyRoot} from '../scripts/prepare-company-root';

const input={appSchema:'app',authSchema:'auth',ownerId:'owner',defaultId:'original',expectedRevision:0,handle:'company_root',name:'Company root'};
let db:PGlite;

beforeAll(async()=>{
 db=new PGlite();
 await db.exec('CREATE SCHEMA app; CREATE SCHEMA auth; CREATE SCHEMA events; CREATE SCHEMA identity;');
 await db.exec(readFileSync(new URL('../../../SCHEMA.sql',import.meta.url),'utf8'));
 await db.exec(`
  INSERT INTO app.identity_settings(id,deployment_mode) VALUES ('installation','company');
  INSERT INTO app.deployment_state(id,owner_user_id,default_group_id,setup_complete) VALUES ('company','owner','original',true);
  INSERT INTO app.deployment_members(user_id) VALUES ('owner'),('branch_admin');
  INSERT INTO auth.users(id,email) VALUES ('owner','owner@example.com'),('branch_admin','branch-admin@example.com');
  INSERT INTO auth.groups(id,handle,name,created_by,parent_id) VALUES
    ('original','original','Original','owner',NULL),('branch','branch','Branch','branch_admin',NULL),('child','child','Child','branch_admin','branch');
  INSERT INTO auth.group_members(group_id,user_id,role) VALUES
    ('original','owner','admin'),('branch','owner','editor'),('branch','branch_admin','admin'),('child','branch_admin','admin');
  INSERT INTO auth.group_hierarchy(id,revision) VALUES ('installation',0);
 `);
});
afterAll(async()=>{await db?.close();});

describe('prepare a company root',()=>{
 it('checks the designated owner, default and revision without permitting public root creation or detach',async()=>{
  const identity=createIdentityStore({db,appSchema:'app'});
  await expect(identity.createGroup({actorId:'owner',handle:'normal_root',name:'Normal root'})).rejects.toMatchObject({code:'company_parent_required'});
  await expect(identity.setGroupParent({actorId:'branch_admin',groupId:'child',parentId:null,fromParentId:'branch'})).rejects.toMatchObject({code:'company_parent_required'});
  await expect(prepareCompanyRoot(db,{...input,ownerId:'branch_admin'})).rejects.toMatchObject({code:'deployment_owner_required'});
  await expect(prepareCompanyRoot(db,{...input,defaultId:'branch'})).rejects.toMatchObject({code:'default_group_changed'});
  await expect(prepareCompanyRoot(db,{...input,expectedRevision:1})).rejects.toMatchObject({code:'hierarchy_changed'});
  expect((await db.query('SELECT revision FROM auth.group_hierarchy')).rows).toEqual([{revision:0}]);
 });

 it('rolls back creation, handle reservation and revision if audit fails',async()=>{
  await db.exec("ALTER TABLE app.group_audit ADD CONSTRAINT refuse_preparation CHECK (action <> 'company_root_prepared')");
  try {
   await expect(prepareCompanyRoot(db,input)).rejects.toThrow(/refuse_preparation/);
   expect((await db.query('SELECT revision FROM auth.group_hierarchy')).rows).toEqual([{revision:0}]);
   expect((await db.query('SELECT id FROM auth.groups ORDER BY id')).rows).toEqual([{id:'branch'},{id:'child'},{id:'original'}]);
  } finally {
   await db.exec('ALTER TABLE app.group_audit DROP CONSTRAINT refuse_preparation');
  }
 });

 it('commits one fresh root and one audit row, keeping every old edge, role and admission',async()=>{
  const before=async()=> (await Promise.all([
   db.query('SELECT * FROM app.deployment_state'),
   db.query('SELECT * FROM app.deployment_members ORDER BY user_id'),
   db.query("SELECT * FROM auth.groups WHERE id IN ('original','branch','child') ORDER BY id"),
   db.query("SELECT * FROM auth.group_members WHERE group_id IN ('original','branch','child') ORDER BY group_id,user_id"),
  ])).map(r=>r.rows);
  const original=await before();
  const id=await prepareCompanyRoot(db,input);
  await expect(prepareCompanyRoot(db,input)).rejects.toMatchObject({code:'hierarchy_changed'});
  await expect(prepareCompanyRoot(db,{...input,expectedRevision:1})).rejects.toMatchObject({code:'handle_taken'});
  expect(await before()).toEqual(original);
  expect((await db.query('SELECT parent_id,trusted_issuer,tenancy_id FROM auth.groups WHERE id=$1',[id])).rows)
   .toEqual([{parent_id:null,trusted_issuer:null,tenancy_id:null}]);
  expect((await db.query('SELECT user_id,role FROM auth.group_members WHERE group_id=$1',[id])).rows)
   .toEqual([{user_id:'owner',role:'admin'}]);
  expect((await db.query('SELECT group_id,actor_user_id,action,details FROM app.group_audit')).rows)
   .toEqual([{group_id:id,actor_user_id:'owner',action:'company_root_prepared',details:{previous_default_group_id:'original'}}]);
  expect((await db.query('SELECT revision FROM auth.group_hierarchy')).rows).toEqual([{revision:1}]);
 });
});
