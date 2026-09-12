import {CliError,type ParsedCommand} from './commands';
import {batchCommand} from './batch';
import {artifactReference} from './read-commands';
import {readPendingRequest} from './pending-request';
import {recoverableOperation} from './recoverable-operation';
import {pendingOperation} from './restore';
import {recoverFiles,stageFiles} from './journal';
import {terminateSession} from './sessions';
import {digest} from './files';
import {loadWorkspace,type Workspace} from './workspace';
import type {HttpClient} from './http';

/** The server's stored format, named in the resource vocabulary the CLI uses. */
export const resourceKind=(format:unknown):string=>format==='markup'?'artifact':format==='folder'?'folder':format==='dataset'?'dataset':'file';

/**
 * Delete is one command over two resource families: artifacts and their kinds
 * are soft-deleted, remote sessions are terminated. Every local file survives
 * either — deletion is a remote act, and the bytes on disk are the author's.
 */
export async function deleteResources(workspace:Workspace,parsed:ParsedCommand,client:HttpClient):Promise<{value:unknown;exitCode:number}>{
 const {positionals,flags}=parsed;
 const options={force:!!flags.force,dryRun:!!flags['dry-run'],type:typeof flags.type==='string'?flags.type:undefined};
 if(options.type==='session'){
  if(options.force)throw new CliError('unsupported_flag','--force permits deleting a referenced asset; a session has no references.','Run afbin delete --type session <id>.');
  if(options.dryRun)return {value:{dry_run:true,operations:positionals.map(id=>({id,status:'would_terminate'}))},exitCode:0};
  const operations=[];
  for(const id of positionals)operations.push(await terminateSession(workspace,client,id));
  return {value:{operations},exitCode:0};
 }
 return batchCommand(positionals,ref=>deleteArtifact(workspace,ref,client,options));
}

export async function deleteArtifact(workspace:Workspace,input:string,client:HttpClient,options:{force?:boolean;dryRun?:boolean;type?:string}){
 const ref=await artifactReference(workspace,input,client.connection.server,true);
 if(options.dryRun)return{dry_run:true,...await client.request('/artifacts/preflight','POST',{id:ref.id,mode:'delete',input:{force:!!options.force}})};
 // The head read names the kind being deleted, so a selected --type that
 // disagrees refuses instead of deleting the wrong thing; it also identifies
 // the account before the durable record claims an operation key. A typed local
 // file carries its own kind, so --type is only the default for a bare id.
 let kind:string|undefined;
 if(!await pendingOperation(workspace)){
  const head=await client.request<Record<string,unknown>>(`/artifacts/${ref.id}`);
  kind=resourceKind(head.format);
  const declared=ref.path?undefined:options.type;
  if(declared&&declared!==kind)throw new CliError('type_conflict',`${input} is a ${kind}, not a ${declared}.`,`Run afbin delete --type ${kind} ${input}.`);
  if((head.capabilities as {delete?:boolean}|undefined)?.delete===false)throw new CliError('not_permitted',`Only the owner can delete ${ref.id}.`,'Ask the owner to delete it.');
 }
 if(await readPendingRequest(workspace.root))throw new CliError('pending_recovery','Recover the pending publication before deleting an artifact.','Run afbin push to recover its result.');
 const result=await recoverableOperation(workspace,client,{
  path:`/artifacts/${ref.id}${options.force?'?force=true':''}`,method:'DELETE',body:undefined,identity:{type:'delete',id:ref.id},
  prepare:async()=>{},
  // Tracking forgets every identity the delete actually took, including a
  // folder's subtree, and the working files it named stay exactly where they
  // are. Runs inside the operation's own lock, after its reply is durable.
  finalize:async response=>{
   await recoverFiles(workspace.root);
   const current=await loadWorkspace(workspace.cwd,workspace.home);
   if(!current.lock)return;
   const lock=structuredClone(current.lock);
   const deleted=new Set([ref.id,...(Array.isArray(response.deleted_ids)?response.deleted_ids.filter((id):id is string=>typeof id==='string'):[])]);
   for(const [path,file] of Object.entries(lock.files))if(deleted.has(file.id))delete lock.files[path];
   await stageFiles(current.root,[{path:'afbin.lock',before:digest(current.raw!),data:Buffer.from(JSON.stringify(lock,null,2)+'\n')}]);
   await recoverFiles(current.root);
  },
 });
 return{...result,id:ref.id,...(kind?{type:kind}:{}),status:'deleted',local_file:'preserved'};
}

/** Comment deletion is the owner's verb; the container artifact is explicit, never inferred. */
export async function deleteComments(workspace:Workspace,container:string,ids:string[],client:HttpClient,options:{dryRun?:boolean}){
 const ref=await artifactReference(workspace,container,client.connection.server,true);
 const operations:Array<Record<string,unknown>>=[];let failed=false;
 for(const id of ids){
  if(!/^[A-Za-z0-9_-]+$/.test(id)){operations.push({id,artifact:ref.id,error:{code:'invalid_thread',message:'Use the thread id returned by afbin comment.'}});failed=true;continue;}
  try{
   if(options.dryRun){const head=await client.request<{capabilities?:{delete?:boolean;comment?:boolean}}>(`/artifacts/${ref.id}`);if(head.capabilities&&head.capabilities.delete===false)throw new CliError('forbidden','Only the owner can delete comments.');operations.push({id,artifact:ref.id,status:'would_delete'});continue;}
   await client.request(`/artifacts/${ref.id}/annotations/${id}`,'DELETE');operations.push({id,artifact:ref.id,status:'deleted'});
  }catch(error){failed=true;operations.push({id,artifact:ref.id,error:error instanceof CliError?{code:error.code,message:error.message,...(error.fix?{fix:error.fix}:{})}:{code:'operation_failed',message:error instanceof Error?error.message:String(error)}});}
 }
 return {value:{...(options.dryRun?{dry_run:true}:{}),operations},exitCode:failed?1:0};
}
