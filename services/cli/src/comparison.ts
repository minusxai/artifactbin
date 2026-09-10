import {createTwoFilesPatch} from 'diff';
import {CliError} from './commands';
import {resolve} from 'node:path';
import {resolveReference} from './reference';
import {writeDocument} from './document';
import {snapshotDocument} from './local';
import {digest} from './files';
import {recoverFiles,stageFiles} from './journal';
import {withProcessLock} from './process-lock';
import {inspectWorkspace,loadWorkspace,type Workspace,type Snapshot} from './workspace';
import type {HttpClient} from './http';

/** Observation never moves the accepted base or rewrites working files. */
export async function remoteStatus(workspace:Workspace,client:HttpClient){
 if(!workspace.lock)return{remote:'current',files:[]};
 return withProcessLock(workspace.root,async()=>{
  await recoverFiles(workspace.root);workspace=await loadWorkspace(workspace.cwd);
  const lock=structuredClone(workspace.lock!);const files=[];
  for(const file of await inspectWorkspace(workspace)){
   const base=file.tracked!.snapshot;
   const head=await client.request<Snapshot>(`/artifacts/${base.id}`);
   if(head.id!==base.id||typeof head.state!=='string')throw new CliError('invalid_response','Remote status requires a complete head snapshot.');
   lock.files[file.path].observed=head;
   files.push({path:file.path,id:head.id,status:file.status,remote:head.state===base.state?'unchanged':'changed',base_version:base.version,version:head.version});
  }
  await stageFiles(workspace.root,[{path:'afbin.lock',before:digest(workspace.raw!),data:Buffer.from(JSON.stringify(lock,null,2)+'\n')}]);await recoverFiles(workspace.root);
  return{remote:'current',server:lock.server,files};
 });
}

export async function comparisonTargets(workspace:Workspace,input:string|undefined,server:string){
 if(!input)return(await inspectWorkspace(workspace)).map(file=>({file,version:undefined as number|undefined}));
 const ref=await resolveReference(input,{root:workspace.root,cwd:workspace.cwd,server});
 const path=ref.kind==='path'?ref.path:Object.entries(workspace.lock?.files??{}).find(([,file])=>file.id===ref.id)?.[0];
 if(!path)throw new CliError('not_tracked','Diff needs a local working file for this artifact.','Use afbin pull <ref> first.');
 const [file]=await inspectWorkspace(workspace,[resolve(workspace.root,path)]);
 return[{file,version:ref.version}];
}
export async function compare(workspace:Workspace,input:string|undefined,server:string,remote:boolean,client?:HttpClient){
 const targets=await comparisonTargets(workspace,input,server);const diffs=[];
 for(const {file,version} of targets){
  const tracked=file.tracked;
  if(!tracked){
   if(remote||version)throw new CliError('not_tracked',`${file.path} has no saved base.`);
   diffs.push({path:file.path,diff:file.document?createTwoFilesPatch(`base/${file.path}`,`local/${file.path}`,'',file.bytes?.toString()??''): `Binary file ${file.path} is new`});continue;
  }
  let snapshot=version?tracked.versions?.[String(version)]:tracked.snapshot;
  if(version===tracked.snapshot.version)snapshot=tracked.snapshot;
  if(remote&&!version){if(!client)throw new CliError('network_required','Remote comparison needs a server connection.');snapshot=await client.request<Snapshot>(`/artifacts/${tracked.id}`);}
  if(version&&!snapshot){
   if(!client)throw new CliError('network_required','This historical version is not cached.');
   const value=await client.request<Record<string,unknown>>(`/artifacts/${tracked.id}/versions/${version}`);
   const meta=value.meta as Record<string,unknown>|undefined;
   snapshot={...tracked.snapshot,...value,version,theme:meta?.theme as string|null??null,template:meta?.template as string|null??null};
  }
  let before=file.document?Buffer.from(tracked.baseline,'base64').toString():tracked.baseline;
  if(remote||version){
   if(file.document){const document=snapshotDocument(snapshot!);before=writeDocument(document);}
   else if(client)before=(await client.content(`/artifacts/${tracked.id}/content?version=${snapshot!.version}`)).bytes.toString('base64');
   else throw new CliError('network_required','Historical binary content is not cached.');
  }
  const after=file.document?file.bytes?.toString()??'':file.bytes?.toString('base64')??'';
  if(file.document)diffs.push({path:file.path,diff:createTwoFilesPatch(`base/${file.path}`,`local/${file.path}`,before,after,remote?'remote head':version?`version ${version}`:'last observed','working file',{context:3})});
  else diffs.push({path:file.path,diff:before===after?'':`Binary file ${file.path} differs`});
 }
 return{remote:remote?'current':'last_observed',diffs};
}
