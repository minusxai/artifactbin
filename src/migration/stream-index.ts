import {createHash} from 'node:crypto';
import {createReadStream} from 'node:fs';
import {appendFile,mkdir,open,readFile,rename} from 'node:fs/promises';
import {createInterface} from 'node:readline';
import {join} from 'node:path';
import type {LegacyArtifact,LegacyRow,MigrationManifest} from './contracts.ts';
import type {StreamManifest} from './stream-contracts.ts';
import {readPartRows} from './stream.ts';
const key=(id:string)=>createHash('sha256').update(id).digest('hex');
const activeTables=new Set(['artifacts','artifact_versions','annotations','artifact_source_ids','artifact_shares']);
/** One row is held at a time. Prunable edits remain only in the verified source archive. */
export async function indexStreamArchive(sourceDirectory:string,indexDirectory:string,manifest:StreamManifest):Promise<void>{
 await mkdir(indexDirectory,{recursive:true,mode:0o700});const lock=await open(join(indexDirectory,'.index-lock'),'wx',0o600);await lock.close();
 for(const part of manifest.parts){for await(const row of readPartRows(sourceDirectory,part)){
  if(activeTables.has(part.table)){
   const id=String(part.table==='artifacts'?row.id:row.artifact_id);const directory=join(indexDirectory,key(id));await mkdir(directory,{recursive:true,mode:0o700});
   await appendFile(join(directory,part.table+'.ndjson'),JSON.stringify(row)+'\n',{mode:0o600});
   if(part.table==='artifacts')await appendFile(join(indexDirectory,'artifacts.ndjson'),JSON.stringify({id,key:key(id),format:row.format})+'\n',{mode:0o600});
  }else if(part.table==='users'||part.table==='token_owners')await appendFile(join(indexDirectory,part.table+'.ndjson'),JSON.stringify(row)+'\n',{mode:0o600});
 }}
 await appendFile(join(indexDirectory,'manifest.json.partial'),JSON.stringify(manifest),{mode:0o600,flag:'wx'});await rename(join(indexDirectory,'manifest.json.partial'),join(indexDirectory,'manifest.json'));
}
async function* lines(path:string):AsyncGenerator<LegacyRow>{
 const source=createReadStream(path);const reader=createInterface({input:source,crlfDelay:Infinity});try{for await(const line of reader)yield JSON.parse(line) as LegacyRow;}finally{reader.close();source.destroy();}
}
async function rowsIfExists(path:string):Promise<LegacyRow[]>{try{const rows=[];for await(const row of lines(path))rows.push(row);return rows;}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return [];throw error;}}
export async function* indexedArtifactIds(indexDirectory:string):AsyncGenerator<string>{
 // A completed manifest is the commit marker. Partial indexes are never consumed.
 await readFile(join(indexDirectory,'manifest.json'),'utf8');
 for await(const row of lines(join(indexDirectory,'artifacts.ndjson')))yield String(row.id);
}
export async function readIndexedAccounts(indexDirectory:string):Promise<{users:LegacyRow[];tokenOwners:{id:string;user_id:string|null}[]}>{
 return {users:await rowsIfExists(join(indexDirectory,'users.ndjson')),tokenOwners:(await rowsIfExists(join(indexDirectory,'token_owners.ndjson'))).map(r=>({id:String(r.id),user_id:r.user_id===null?null:String(r.user_id)}))};
}
export async function readIndexedArtifact(indexDirectory:string,manifest:StreamManifest,id:string):Promise<MigrationManifest>{
 const directory=join(indexDirectory,key(id));const tables:Record<string,LegacyRow[]>={};for(const table of activeTables)tables[table]=await rowsIfExists(join(directory,table+'.ndjson'));
 const artifacts=tables.artifacts as LegacyArtifact[];if(artifacts.length!==1||artifacts[0]?.id!==id)throw new Error('Invalid indexed artifact identity');
 return {schemaVersion:1,sourceNamespace:manifest.sourceNamespace,exportedAt:manifest.exportedAt,tables,artifacts,tokenOwners:[]};
}
