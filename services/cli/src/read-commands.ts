import {collectionFilters} from './collection-filters';
import {recoverableOperation} from './recoverable-operation';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {CliError,type ParsedCommand} from './commands';
import {parseResourceFile} from './resource-file';
import {parseDocument} from './document';
import {resolveReference} from './reference';
import type {Workspace} from './workspace';
import type {HttpClient} from './http';

/** All native commands share file identity resolution; no identity HTTP request. */
export async function artifactReference(workspace:Workspace,input:string,server:string,writable=false){
 const ref=await resolveReference(input,{root:workspace.root,cwd:workspace.cwd,server,writable});
 if(ref.kind==='id')return{id:ref.id,version:ref.version,notices:ref.notices};
 const tracked=workspace.tracking?.files[ref.path];
 const id=ref.path.toLowerCase().endsWith('.jsx')?parseDocument(await readFile(join(workspace.root,ref.path),'utf8')).metadata.id:/\.ya?ml$/i.test(ref.path)?parseResourceFile(await readFile(join(workspace.root,ref.path),'utf8')).id:tracked?.id;
 if(!id)throw new CliError('unpublished_file',`${ref.path} has no published identity.`,'Publish it with afbin push first.');
 if(tracked&&tracked.id!==id)throw new CliError('identity_mismatch',`The fence identity for ${ref.path} differs from the tracked identity.`,'Resolve the identity before operating on the remote artifact.');
 return{id,version:ref.version,path:ref.path,notices:ref.notices};
}
export function pageQuery(flags:ParsedCommand['flags']):string{
 const params=new URLSearchParams();
 for(const key of ['limit','cursor'])if(typeof flags[key]==='string')params.set(key,flags[key] as string);
 return params.size?`?${params}`:'';
}
export async function readCommand(workspace:Workspace,parsed:ParsedCommand,client:HttpClient){
 if(parsed.command==='list'&&parsed.positionals.length){
  const ref=await artifactReference(workspace,parsed.positionals[0],client.connection.server);
  return client.request(`/artifacts/${ref.id}${ref.version!==undefined?`/versions/${ref.version}`:''}`);
 }
 if(parsed.command==='list'){
  const query=new URLSearchParams(pageQuery(parsed.flags));
  for(const [key,value] of Object.entries(collectionFilters('list',parsed.flags.filter as string[]|undefined)))query.set(key,value);
  if(parsed.flags.type)query.set('type',String(parsed.flags.type));
  if(parsed.flags.in){const folder=await artifactReference(workspace,String(parsed.flags.in),client.connection.server);if(folder.version!==undefined)throw new CliError('invalid_container','Collection scopes use current folder identity.');query.set('parent_id',folder.id);}
  return client.request(`/artifacts${query.size?'?'+query:''}`);
 }
 const ref=await artifactReference(workspace,parsed.positionals[0],client.connection.server);
 // History is read per target: the page, the filters and any cursor belong to this reference alone.
 const query=new URLSearchParams(pageQuery(parsed.flags));if(ref.version!==undefined)query.set('version',String(ref.version));
 if(parsed.flags.type!==undefined)checkTrackedType(workspace,ref.path,String(parsed.flags.type));
 for(const [key,value] of Object.entries(collectionFilters('log',parsed.flags.filter as string[]|undefined)))query.set(key,value);
 return client.request(`/artifacts/${ref.id}/versions${query.size?'?'+query:''}`);
}
const RESOURCE_KINDS:Record<string,string>={markup:'artifact',folder:'folder',dataset:'dataset',image:'file',pdf:'file',file:'file'};
/** A typed target is checked against what tracking already knows; nothing is fetched to decide it. */
export function checkTrackedType(workspace:Workspace,path:string|undefined,requested:string):void{
 const tracked=path?workspace.tracking?.files[path]:undefined;
 const kind=tracked?RESOURCE_KINDS[String(tracked.snapshot.format)]??'artifact':undefined;
 if(kind&&kind!==requested)throw new CliError('type_mismatch',`${path} tracks a ${kind}, not a ${requested}.`,'Omit --type, or select the kind this reference addresses.');
}

export async function commentCommand(workspace:Workspace,parsed:ParsedCommand,client:HttpClient,body?:string){
 const ref=await artifactReference(workspace,parsed.positionals[0],client.connection.server,true);
 const {flags}=parsed;const path=`/artifacts/${ref.id}/annotations`;
 if(flags['dry-run']){
  const head=await client.request<{capabilities?:{comment?:boolean};annotations?:Array<{id:string}>;nodes?:string[]}>(`/artifacts/${ref.id}`);
  if(head.capabilities&&head.capabilities.comment===false)throw new CliError('forbidden','You cannot comment on this artifact.','Ask the owner for commenter access.');
  if(flags.thread&&Array.isArray(head.annotations)&&!head.annotations.some(item=>item.id===flags.thread))throw new CliError('invalid_thread',`Thread ${flags.thread} is not on this artifact.`,'List threads with afbin comment <ref>.');
  if(flags.node&&Array.isArray(head.nodes)&&!head.nodes.includes(String(flags.node)))throw new CliError('invalid_node',`Node ${flags.node} is not in the current document.`,'Use a current node id.');
  return {dry_run:true,id:ref.id,action:flags.thread?(body!==undefined?'reply':'state'):'thread',...(flags.thread?{thread:flags.thread}:{}),...(flags.node?{node:flags.node}:{}),...(flags.quote?{quote:flags.quote}:{}),...(flags.state?{state:flags.state}:{})};
 }
 const mutate=(target:string,input:unknown)=>recoverableOperation(workspace,client,{path:target,method:'POST',body:input,prepare:async()=>{const head=await client.request<{capabilities?:{comment_receipts?:boolean}}>(`/artifacts/${ref.id}`);if(!head.capabilities?.comment_receipts)throw new CliError('unsupported_server','This server does not support recoverable comments.');}});
 if(flags.thread){
  if(!/^[A-Za-z0-9_-]+$/.test(String(flags.thread)))throw new CliError('invalid_thread','Use the thread id returned by afbin comment.');
  return mutate(`${path}/${flags.thread}`, {...(body!==undefined?{reply:body}:{}),...(flags.state?flags.state==='resolved'?{resolve:true}:{reopen:true}:{})});
 }
 if(body!==undefined)return mutate(path,{body,...(flags.node?{node_id:flags.node}:{quote:flags.quote})});
 const query=new URLSearchParams(pageQuery(flags));
 for(const [key,value] of Object.entries(collectionFilters('comment',flags.filter as string[]|undefined)))query.set(key==='state'?'status':key,value);
 return client.request(`${path}${query.size?'?'+query:''}`);
}
