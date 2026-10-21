import {createHash} from 'node:crypto';
import {createReadStream} from 'node:fs';
import {mkdir,open,readFile,rename,stat} from 'node:fs/promises';
import {createInterface} from 'node:readline';
import {join,resolve,sep} from 'node:path';
import type {LegacyRow,SqlReader} from './contracts.ts';
import type {StreamExportOptions,StreamManifest,StreamPart} from './stream-contracts.ts';
import {MIGRATION_TABLES} from './export.ts';
const ident=(value:string)=>{if(!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(value))throw new Error('Explicit valid schema/table required');return '"'+value+'"'};
const aborted=(signal?:AbortSignal)=>{if(signal?.aborted)throw new Error('Migration export aborted');};
export async function exportLegacyStream(db:SqlReader,options:StreamExportOptions,tables:readonly string[]=[...MIGRATION_TABLES,'token_owners']):Promise<StreamManifest>{
 const schema=ident(options.schema);const batch=options.batchRows??20;const limit=options.partBytes??8*1024*1024;
 if(!Number.isInteger(batch)||batch<1||batch>20||!Number.isInteger(limit)||limit<1)throw new Error('Invalid stream bounds');
 if(!options.sourceNamespace)throw new Error('Source namespace required');
 await mkdir(options.directory,{recursive:true,mode:0o700});
 const marker=await open(join(options.directory,'.export-lock'),'wx',0o600);await marker.close();
 const manifest:StreamManifest={schemaVersion:2,sourceNamespace:options.sourceNamespace,schema:options.schema,exportedAt:options.now().toISOString(),parts:[]};
 await db.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
 try{
 for(const table of tables){
  aborted(options.signal);const token=table==='token_owners';const query=token?`SELECT id,user_id FROM ${schema}."tokens"`:`SELECT * FROM ${schema}.${ident(table)}`;
  await db.query(`DECLARE migration_export NO SCROLL CURSOR FOR ${query}`);
  let file:Awaited<ReturnType<typeof open>>|null=null;let part:StreamPart|null=null;let hash=createHash('sha256');let ordinal=0;
  const finish=async()=>{if(!file||!part)return;await file.sync();await file.close();file=null;part.sha256=hash.digest('hex');await rename(join(options.directory,part.path+'.partial'),join(options.directory,part.path));manifest.parts.push(part);part=null;};
  try{while(true){
   aborted(options.signal);const result=await db.query(`FETCH FORWARD ${batch} FROM migration_export`);aborted(options.signal);if(!result.rows.length)break;
   for(const row of result.rows){aborted(options.signal);const text=JSON.stringify(row)+'\n';const bytes=Buffer.byteLength(text);
    if(part&&part.bytes+bytes>limit)await finish();
    if(!file){part={table,path:`${table}-${String(ordinal++).padStart(6,'0')}.ndjson`,rows:0,bytes:0,sha256:''};file=await open(join(options.directory,part.path+'.partial'),'wx',0o600);hash=createHash('sha256');}
    await file.writeFile(text);hash.update(text);part!.rows++;part!.bytes+=bytes;
   }
  }await finish();}finally{if(file)await file.close();}
  await db.query('CLOSE migration_export');
 }
 aborted(options.signal);await db.query('COMMIT');
 const output=await open(join(options.directory,'manifest.json.partial'),'wx',0o600);try{await output.writeFile(JSON.stringify(manifest));await output.sync();}finally{await output.close();}await rename(join(options.directory,'manifest.json.partial'),join(options.directory,'manifest.json'));return manifest;
 }catch(error){await db.query('ROLLBACK');throw error;}
}
export async function readStreamManifest(directory:string):Promise<StreamManifest>{
 const value=JSON.parse(await readFile(join(directory,'manifest.json'),'utf8')) as StreamManifest;
 if(value.schemaVersion!==2||!Array.isArray(value.parts)||!value.sourceNamespace)throw new Error('Unsupported stream manifest');return value;
}
export async function* readPartRows(directory:string,part:StreamPart):AsyncGenerator<LegacyRow>{
 const path=resolve(directory,part.path);if(!path.startsWith(resolve(directory)+sep))throw new Error('Archive part escapes directory');
 const info=await stat(path);if(info.size!==part.bytes)throw new Error('Archive part size mismatch');
 const hash=createHash('sha256');for await(const bytes of createReadStream(path))hash.update(bytes);if(hash.digest('hex')!==part.sha256)throw new Error('Archive part digest mismatch');
 const lines=createInterface({input:createReadStream(path),crlfDelay:Infinity});let rows=0;
 try{for await(const line of lines){if(!line)throw new Error('Empty archive record');const row=JSON.parse(line) as LegacyRow;if(!row||Array.isArray(row)||typeof row!=='object')throw new Error('Invalid archive record');rows++;yield row;}}finally{lines.close();}
 if(rows!==part.rows)throw new Error('Archive row count mismatch');
}
