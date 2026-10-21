import type { LegacyArtifact, MigrationManifest, SqlReader } from './contracts.ts';
/** Explicit allowlist: credentials, sessions and derived caches are never exported. */
export const MIGRATION_TABLES = ['users','groups','group_members','group_invitations','group_links','artifacts','artifact_versions','artifact_edits','artifact_source_ids','artifact_shares','annotations','comment_images','dataset_policy_audit'] as const;
export async function exportLegacy(reader:SqlReader,options:{schema:string;sourceNamespace:string;now:()=>Date}):Promise<MigrationManifest>{
 if(!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(options.schema))throw new Error('Explicit valid source schema required');
 if(!options.sourceNamespace)throw new Error('Source namespace required');
 const tables:MigrationManifest['tables']={};
 await reader.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
 try{
  for(const table of MIGRATION_TABLES){
   // A missing table is a hard error: never silently switch schema or omit content.
   tables[table]=(await reader.query(`SELECT * FROM "${options.schema}"."${table}"`)).rows;
  }
  const tokenOwners=(await reader.query(`SELECT id, user_id FROM "${options.schema}"."tokens"`)).rows.map(row=>({id:String(row.id),user_id:row.user_id===null?null:String(row.user_id)}));
  await reader.query('COMMIT');
  return {schemaVersion:1,sourceNamespace:options.sourceNamespace,exportedAt:options.now().toISOString(),artifacts:tables.artifacts as LegacyArtifact[],tables,tokenOwners};
 }catch(error){await reader.query('ROLLBACK');throw error;}
}
