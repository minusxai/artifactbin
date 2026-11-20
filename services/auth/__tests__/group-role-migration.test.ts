/** The role rename must preserve authority once, including invitations, without promoting new Editors. */
import {PGlite} from '@electric-sql/pglite';
import {afterEach,beforeEach,expect,it} from 'vitest';
import type {TransactionalQueryable} from '@artifactbin/contracts/identity-module';
import {assertGroupRoleModel,migrateGroupRoles} from '../src/identity-store/group-role-migration';
import manifest from '../package.json';
let pg:PGlite;
let db:TransactionalQueryable;
beforeEach(async()=>{
 pg=new PGlite();
 db={query:async(sql,params)=>pg.query(sql,params),transaction:fn=>pg.transaction(tx=>fn({query:async(sql,params)=>tx.query(sql,params)}))};
 await pg.exec(`CREATE SCHEMA auth;
 CREATE TABLE auth.group_hierarchy(id text PRIMARY KEY,revision bigint NOT NULL DEFAULT 0);
 INSERT INTO auth.group_hierarchy VALUES('installation',7);
 CREATE TABLE auth.group_members(group_id text,user_id text,role text NOT NULL);
 CREATE TABLE auth.group_invitations(id text,role text NOT NULL);
 INSERT INTO auth.group_members VALUES('one','alice','editor'),('one','ben','viewer');
 INSERT INTO auth.group_invitations VALUES('invite-admin','editor'),('invite-member','viewer');`);
});
afterEach(async()=>{await pg.close();});
it('refuses startup and unacknowledged changes, preserves both sets of grants, and is idempotent',async()=>{
 await expect(assertGroupRoleModel(db,'auth')).rejects.toThrow('migrate:groups');
 await expect(migrateGroupRoles(db,{schema:'auth',writesPausedAndBackupVerified:false})).rejects.toThrow('Stop all');
 expect(await migrateGroupRoles(db,{schema:'auth',writesPausedAndBackupVerified:true})).toEqual({changed:true});
 expect((await pg.query('SELECT role FROM auth.group_members ORDER BY user_id')).rows).toEqual([{role:'admin'},{role:'member'}]);
 expect((await pg.query('SELECT role FROM auth.group_invitations ORDER BY id')).rows).toEqual([{role:'admin'},{role:'member'}]);
 expect((await pg.query('SELECT revision FROM auth.group_hierarchy')).rows).toEqual([{revision:7}]);
 expect((await pg.query('SELECT role_model_version FROM auth.group_hierarchy')).rows).toEqual([{role_model_version:manifest.groupRoleModelVersion}]);
 await pg.exec("INSERT INTO auth.group_members VALUES('one','cara','editor')");
 await assertGroupRoleModel(db,'auth');
 expect(await migrateGroupRoles(db,{schema:'auth',writesPausedAndBackupVerified:true})).toEqual({changed:false});
 expect((await pg.query("SELECT role FROM auth.group_members WHERE user_id='cara'")).rows).toEqual([{role:'editor'}]);
});
it('rejects unknown legacy roles atomically instead of guessing their authority',async()=>{
 await pg.exec("INSERT INTO auth.group_invitations VALUES('unknown','custom')");
 await expect(migrateGroupRoles(db,{schema:'auth',writesPausedAndBackupVerified:true})).rejects.toThrow('Unexpected group role');
 expect((await pg.query("SELECT role FROM auth.group_members WHERE user_id='alice'")).rows).toEqual([{role:'editor'}]);
 await expect(assertGroupRoleModel(db,'auth')).rejects.toThrow('migrate:groups');
});
it('updates an existing split-host read view atomically while preserving its grants and dependents',async()=>{
 await pg.exec(`CREATE SCHEMA identity; CREATE ROLE reader NOLOGIN;
  CREATE VIEW identity.group_hierarchy AS SELECT id,revision FROM auth.group_hierarchy;
  CREATE VIEW identity.revisions AS SELECT id,revision FROM identity.group_hierarchy;
  GRANT USAGE ON SCHEMA identity TO reader; GRANT SELECT ON identity.group_hierarchy TO reader;`);
 const options={schema:'auth',readSchema:'identity',writesPausedAndBackupVerified:true};
 const oid=(await pg.query("SELECT 'identity.group_hierarchy'::regclass::oid AS oid")).rows[0];
 expect(await migrateGroupRoles(db,options)).toEqual({changed:true});
 expect((await pg.query('SELECT role_model_version FROM identity.group_hierarchy')).rows).toEqual([{role_model_version:2}]);
 expect((await pg.query("SELECT 'identity.group_hierarchy'::regclass::oid AS oid")).rows[0]).toEqual(oid);
 expect((await pg.query('SELECT revision FROM identity.revisions')).rows).toEqual([{revision:7}]);
 await pg.exec('SET ROLE reader');await assertGroupRoleModel(db,'identity');await pg.exec('RESET ROLE');
});
it('rolls back the role conversion if the requested read view cannot be refreshed',async()=>{
 const options={schema:'auth',readSchema:'missing_read_schema',writesPausedAndBackupVerified:true};
 await expect(migrateGroupRoles(db,options)).rejects.toThrow();
 expect((await pg.query("SELECT role FROM auth.group_members WHERE user_id='alice'")).rows).toEqual([{role:'editor'}]);
 await expect(assertGroupRoleModel(db,'auth')).rejects.toThrow('migrate:groups');
});
it('can refresh a stale read view after conversion without promoting a newly created Editor',async()=>{
 await pg.exec('CREATE SCHEMA identity; CREATE VIEW identity.group_hierarchy AS SELECT id,revision FROM auth.group_hierarchy');
 await migrateGroupRoles(db,{schema:'auth',writesPausedAndBackupVerified:true});
 await pg.exec("INSERT INTO auth.group_members VALUES('one','new-editor','editor')");
 const options={schema:'auth',readSchema:'identity',writesPausedAndBackupVerified:true};
 expect(await migrateGroupRoles(db,options)).toEqual({changed:false});
 await assertGroupRoleModel(db,'identity');
 expect((await pg.query("SELECT role FROM auth.group_members WHERE user_id='new-editor'")).rows).toEqual([{role:'editor'}]);
});
