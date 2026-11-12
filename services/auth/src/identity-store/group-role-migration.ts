/** Offline, versioned group-role migration. Startup checks compatibility; it never reinterprets existing grants. */
import type {Queryable,TransactionalQueryable} from '@artifactbin/contracts';
import {identityTables} from './tables';

export const GROUP_ROLE_UPGRADE = 'Stop all identity and app processes and verify a restorable database backup, then run npm run migrate:groups -w services/auth -- --writes-paused-backup-verified with AUTH__MIGRATION_DATABASE_URL and AUTH__SCHEMA identifying the reviewed database. Start only the new release; older releases cannot interpret these roles. Startup never applies this migration.';
const versionColumn=async(db:Queryable,schema:string)=>!!(await db.query('SELECT 1 FROM information_schema.columns WHERE table_schema=$1 AND table_name=$2 AND column_name=$3',[schema,'group_hierarchy','role_model_version'])).rows.length;

/** Works against the identity base schema or its read views (for a split app host). */
export async function assertGroupRoleModel(db:Queryable,schema:string):Promise<void>{
 const t=identityTables(schema);
 if(!await versionColumn(db,schema))throw new Error(GROUP_ROLE_UPGRADE);
 const version=(await db.query<{role_model_version:number}>(`SELECT role_model_version FROM ${t.group_hierarchy} WHERE id='installation'`)).rows[0]?.role_model_version;
 if(version!==2)throw new Error(GROUP_ROLE_UPGRADE);
}

/** Called only during initial identity boot, under its schema lock. An empty installation needs no conversion. */
export async function initializeGroupRoleModel(db:Queryable,schema:string):Promise<void>{
 const t=identityTables(schema);
 const rows=(await db.query(`SELECT 1 FROM ${t.group_members} UNION ALL SELECT 1 FROM ${t.group_invitations} LIMIT 1`)).rows;
 if(!rows.length)await db.query(`INSERT INTO ${t.group_hierarchy}(id,revision,role_model_version) VALUES('installation',0,2) ON CONFLICT(id) DO UPDATE SET role_model_version=2 WHERE ${t.group_hierarchy}.role_model_version=1`);
 await assertGroupRoleModel(db,schema);
}

/** All old editors become Admins and all old viewers become Members, invitations included, exactly once. */
export async function migrateGroupRoles(db:TransactionalQueryable,options:{schema:string;writesPausedAndBackupVerified:boolean}):Promise<{changed:boolean}>{
 if(options.writesPausedAndBackupVerified!==true)throw new Error(GROUP_ROLE_UPGRADE);
 const t=identityTables(options.schema);
 return db.transaction(async tx=>{
  await tx.query("SELECT pg_advisory_xact_lock(hashtext('artifactbin.identity.schema'))");
  await tx.query(`LOCK TABLE ${t.group_hierarchy},${t.group_members},${t.group_invitations} IN ACCESS EXCLUSIVE MODE`);
  await tx.query(`ALTER TABLE ${t.group_hierarchy} ADD COLUMN IF NOT EXISTS role_model_version INTEGER NOT NULL DEFAULT 1`);
  const version=(await tx.query<{role_model_version:number}>(`SELECT role_model_version FROM ${t.group_hierarchy} WHERE id='installation'`)).rows[0]?.role_model_version??1;
  if(version===2)return {changed:false};
  if(version!==1)throw new Error('Unexpected group role model version; no changes applied.');
  for(const table of [t.group_members,t.group_invitations]){
   if((await tx.query(`SELECT 1 FROM ${table} WHERE role NOT IN ('editor','viewer') LIMIT 1`)).rows.length)throw new Error('Unexpected group role in legacy membership or invitation; no changes applied.');
   await tx.query(`UPDATE ${table} SET role=CASE role WHEN 'editor' THEN 'admin' WHEN 'viewer' THEN 'member' END`);
  }
  await tx.query(`INSERT INTO ${t.group_hierarchy}(id,revision,role_model_version) VALUES('installation',0,2) ON CONFLICT(id) DO UPDATE SET role_model_version=2`);
  return {changed:true};
 });
}
