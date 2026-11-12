/** Operator-only coordinated migration; never invoked by server startup. Connection details stay out of logs. */
import {pathToFileURL} from 'node:url';
import {Pool} from 'pg';
import {identityDbOf} from '../src/identity-store';
import {GROUP_ROLE_UPGRADE,migrateGroupRoles} from '../src/identity-store/group-role-migration';
import {migrationTarget} from './migrate-account';

async function main(){
 if(process.argv.slice(2).join(' ')!=='--writes-paused-backup-verified')throw new Error(GROUP_ROLE_UPGRADE);
 const {connectionString,schema}=migrationTarget(process.env);
 const pool=new Pool({connectionString,max:1});
 try{
  const result=await migrateGroupRoles(identityDbOf(pool),{schema,writesPausedAndBackupVerified:true});
  console.log(result.changed?'Group roles migrated; existing membership and invitation authority preserved.':'Group roles already compatible; no changes.');
 }finally{await pool.end();}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)main().catch(error=>{
 console.error(error instanceof Error&&error.message===GROUP_ROLE_UPGRADE?GROUP_ROLE_UPGRADE:'Group role migration failed; keep processes stopped and inspect diagnostics privately.');
 process.exitCode=1;
});
