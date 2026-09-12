import {CliError,type ParsedCommand} from './commands';
import {artifactReference} from './read-commands';
import {localQuery,queryParameters} from './local-query';
import {localDefinition} from './dataset-source';
import {digest} from './files';
import {resolve} from 'node:path';
import {batchCommand} from './batch';
import type {DatasetConnection} from '../../app/lib/datasets/types';
import {inspectWorkspace,type Workspace,type Snapshot} from './workspace';
import type {HttpClient} from './http';

/** Every read page is bound to its inputs, so a cursor cannot be carried to another target. */
function page(rows:Record<string,unknown>[],flags:ParsedCommand['flags'],fingerprint:string){
 const limit=Number(flags.limit??20);let offset=0;
 if(flags.cursor){
  let cursor:{fingerprint?:unknown;offset?:unknown}|undefined;
  try{cursor=JSON.parse(Buffer.from(String(flags.cursor),'base64url').toString());}catch{/* Invalid cursors fail below. */}
  if(!cursor||cursor.fingerprint!==fingerprint||!Number.isSafeInteger(cursor.offset)||Number(cursor.offset)<0)throw new CliError('invalid_cursor','The cursor does not match this collection.','Run the command without --cursor to start again.');
  offset=Number(cursor.offset);
 }
 return{execution:'remote',rows:rows.slice(offset,offset+limit),next_cursor:rows.length>offset+limit?Buffer.from(JSON.stringify({fingerprint,offset:offset+limit})).toString('base64url'):null};
}
/** The connection a discovery or preview runs against: the local definition first, the published one otherwise. */
async function connectedDataset(workspace:Workspace,input:string,client:HttpClient):Promise<{connection:DatasetConnection;id?:string}>{
 const local=await localDefinition(workspace,input,client.connection.server);
 if(local?.definition.connection)return{connection:local.definition.connection,...(local.id?{id:local.id}:{})};
 const ref=await artifactReference(workspace,input,client.connection.server,true);
 const head=await client.request<Snapshot>(`/artifacts/${ref.id}`);
 if(head.format!=='dataset')throw new CliError('invalid_container',`${ref.id} is a ${head.format} artifact, not a dataset.`);
 const connection=(head.meta as {catalog?:{connection?:DatasetConnection}}|undefined)?.catalog?.connection;
 if(!connection)throw new CliError('unsupported_source','This dataset holds stored rows and has no source to discover.','Source discovery applies to a connected dataset definition.');
 return{connection,id:ref.id};
}
export async function discoverTables(workspace:Workspace,parsed:ParsedCommand,client:HttpClient){
 if(typeof parsed.flags.in!=='string')throw new CliError('invalid_container','A table listing is scoped to the dataset that defines the source.','Name it with --in <dataset>.');
 const source=await connectedDataset(workspace,parsed.flags.in,client);
 const discovered=await client.request<{tables?:Array<{schema:string;name:string;columns?:Array<{name:string;type?:string}>}>}>('/datasets/discover','POST',{connection:source.connection,...(source.id?{datasetId:source.id}:{})},{},{readOnly:true});
 const rows=(discovered.tables??[]).flatMap(table=>(table.columns??[]).map(column=>({schema:table.schema,table:table.name,column:column.name,type:column.type??null})));
 return page(rows,parsed.flags,digest(JSON.stringify(['tables',source.id??null,source.connection.host,source.connection.database])));
}
/** A read runs on the engine its own target allows; one unavailable input never moves the others. */
export async function mixedQuery(workspace:Workspace,parsed:ParsedCommand,sql:string|undefined,client:HttpClient){
 return batchCommand(parsed.positionals,async target=>{
  const local=await localQuery(workspace,{...parsed,positionals:[target]},sql,client.connection.server);
  return local??remoteQueryTarget(workspace,parsed,sql,client,target);
 });
}
async function remoteQueryTarget(workspace:Workspace,parsed:ParsedCommand,sql:string|undefined,client:HttpClient,target:string){
 const {flags}=parsed;
 {
  // A notebook cell is previewed against the definition's own connection, never the published tables.
  if(typeof flags.name==='string'&&sql===undefined){
   const local=await localDefinition(workspace,target,client.connection.server);
   const cell=local?.definition.notebook?.cells.find(item=>item.name===flags.name||item.id===flags.name);
   if(local&&cell){
    if(!local.definition.connection)throw new CliError('unsupported_source','A notebook cell previews against the dataset connection.');
    const result=await client.request(`/datasets/notebook/preview`,'POST',{connection:local.definition.connection,notebook:local.definition.notebook,cellId:cell.id,...(local.id?{datasetId:local.id}:{})},{},{readOnly:true});
    return{path:local.path,name:cell.name,execution:'remote',...result};
   }
  }
  const ref=await artifactReference(workspace,target,client.connection.server);
  if(ref.version!==undefined)throw new CliError('historical_query','Remote queries operate on the current resource.','Pull the historical version, then query the local data.');
  const result=await client.request(`/artifacts/${ref.id}/query`,'POST',{
   ...(sql===undefined?{}:{sql}),values:queryParameters(flags.param as string[]|undefined),
   ...(flags.name?{name:flags.name}:{}),limit:Number(flags.limit??20),
   ...(flags.cursor?{cursor:flags.cursor}:{}),...(flags.remote?{refresh:true}:{}),
  },{},{readOnly:true});
  // A refreshed read runs on published content: say so when the working file has moved on.
  const freshness=flags.remote&&ref.path?await draftFreshness(workspace,ref.path):undefined;
  return freshness?{...result,...freshness}:result;
 }
}
async function draftFreshness(workspace:Workspace,path:string){
 const tracked=workspace.tracking?.files[path];if(!tracked)return{path,draft:'untracked'};
 const [file]=await inspectWorkspace(workspace,[resolve(workspace.root,path)]);
 return{path,draft:file?.status==='unchanged'?'published':file?.status??'missing',base_version:tracked.snapshot.version};
}
