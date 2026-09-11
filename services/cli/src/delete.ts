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
