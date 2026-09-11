import {CliError} from './commands';
import {artifactReference} from './read-commands';
import {readPendingRequest} from './pending-request';
import {withProcessLock} from './process-lock';
import {recoverFiles,stageFiles} from './journal';
import {digest} from './files';
import {loadWorkspace,type Workspace} from './workspace';
import type {HttpClient} from './http';

export async function deleteArtifact(workspace:Workspace,input:string,client:HttpClient,options:{force?:boolean;dryRun?:boolean}){
 const ref=await artifactReference(workspace,input,client.connection.server,true);
 if(options.dryRun)return{dry_run:true,...await client.request('/artifacts/preflight','POST',{id:ref.id,mode:'delete',input:{force:!!options.force}})};
 return withProcessLock(workspace.root,async()=>{
  await recoverFiles(workspace.root);workspace=await loadWorkspace(workspace.cwd);
  if(await readPendingRequest(workspace.root))throw new CliError('pending_recovery','Recover the pending publication before deleting an artifact.','Run afbin push to recover its result.');
  const result=await client.request(`/artifacts/${ref.id}${options.force?'?force=true':''}`,'DELETE');
  const lock=workspace.lock?structuredClone(workspace.lock):null;
  if(lock){
   const deleted=new Set([ref.id,...(Array.isArray(result.deleted_ids)?result.deleted_ids.filter((id):id is string=>typeof id==='string'):[])]);
   for(const [path,file] of Object.entries(lock.files))if(deleted.has(file.id))delete lock.files[path];
   await stageFiles(workspace.root,[{path:'afbin.lock',before:digest(workspace.raw!),data:Buffer.from(JSON.stringify(lock,null,2)+'\n')}]);await recoverFiles(workspace.root);
  }
  return{...result,id:ref.id,status:'deleted',local_file:'preserved'};
 });
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
