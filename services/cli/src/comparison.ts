import {createTwoFilesPatch} from 'diff';
import {CliError,type ParsedCommand} from './commands';
import {resolve} from 'node:path';
import {resolveReference} from './reference';
import {writeDocument} from './document';
import {snapshotDocument,localSourceDiff,localDiff} from './local';
import {snapshotResource,writeResourceFile} from './resource-file';
import {atomicWrite,digest} from './files';
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

export async function comparisonTargets(workspace:Workspace,input:string|string[]|undefined,server:string){
 const inputs=input===undefined?[]:Array.isArray(input)?input:[input];
 if(!inputs.length)return(await inspectWorkspace(workspace)).map(file=>({file,version:undefined as number|undefined}));
 const targets=[];
 for(const one of inputs){
  const ref=await resolveReference(one,{root:workspace.root,cwd:workspace.cwd,server});
  const path=ref.kind==='path'?ref.path:Object.entries(workspace.lock?.files??{}).find(([,file])=>file.id===ref.id)?.[0];
  if(!path)throw new CliError('not_tracked','Diff needs a local working file for this artifact.','Use afbin pull <ref> first.');
  if(targets.some(target=>target.file.path===path))throw new CliError('duplicate_identity',`The selected references address ${path} more than once.`);
  const [file]=await inspectWorkspace(workspace,[resolve(workspace.root,path)]);
  targets.push({file,version:ref.version});
 }
 return targets;
}
export async function compare(workspace:Workspace,input:string|string[]|undefined,server:string,remote:boolean,client?:HttpClient){
 const targets=await comparisonTargets(workspace,input,server);const diffs=[];
 for(const {file,version} of targets){
  const tracked=file.tracked;
  if(!tracked){
   if(remote||version)throw new CliError('not_tracked',`${file.path} has no saved base.`);
   diffs.push({path:file.path,diff:file.document?createTwoFilesPatch(`base/${file.path}`,`local/${file.path}`,'',file.bytes?.toString()??''): `Binary file ${file.path} is new`});continue;
  }
  let fetched=false;
  let snapshot=version?tracked.versions?.[String(version)]:tracked.snapshot;
  if(version===tracked.snapshot.version&&!snapshot)snapshot=tracked.snapshot;
  if(remote&&!version){if(!client)throw new CliError('network_required','Remote comparison needs a server connection.');snapshot=await client.request<Snapshot>(`/artifacts/${tracked.id}`);}
  if(version&&!snapshot){
   if(!client)throw new CliError('network_required','This historical version is not cached.');
   const value=await client.request<Record<string,unknown>>(`/artifacts/${tracked.id}/versions/${version}`);
   fetched=true;
   const meta=value.meta as Record<string,unknown>|undefined;
   snapshot={...tracked.snapshot,...value,version,theme:meta?.theme as string|null??null,template:meta?.template as string|null??null};
  }
  const textual=!!(file.document||file.resource);
  let before=textual?Buffer.from(tracked.baseline,'base64').toString():tracked.baseline;
  if(remote||version){
   if(file.resource)before=writeResourceFile(snapshotResource(snapshot!,file.resource));
   else if(file.document){const document=snapshotDocument(snapshot!);before=writeDocument(document);}
   else if(typeof snapshot?.content_base64==='string')before=snapshot.content_base64;
   else if(client){before=(await client.content(`/artifacts/${tracked.id}/content?version=${snapshot!.version}`)).bytes.toString('base64');snapshot={...snapshot!,content_base64:before};fetched=true;}
   else throw new CliError('network_required','Historical binary content is not cached.');
  }
  if(version&&fetched)await cacheVersion(workspace,file.path,snapshot!);
  const after=textual?file.bytes?.toString()??'':file.bytes?.toString('base64')??'';
  if(textual)diffs.push({path:file.path,diff:createTwoFilesPatch(`base/${file.path}`,`local/${file.path}`,before,after,remote?'remote head':version?`version ${version}`:'last observed','working file',{context:3})});
  else diffs.push({path:file.path,diff:before===after?'':`Binary file ${file.path} differs`});
  if(!remote&&!version){const source=await localSourceDiff(workspace,file);if(source)diffs.push(source);}
 }
 return{remote:remote?'current':'last_observed',diffs};
}

/** One diff, however many targets: the text is written once, to a file or to stdout. */
export async function diffCommand(workspace:Workspace,parsed:ParsedCommand,server:string,remote:boolean,stdout:(value:string)=>void,client?:HttpClient):Promise<Record<string,unknown>|undefined>{
 const {flags,positionals}=parsed;const output=flags.output as string|undefined;
 if(output==='-'&&flags.json)throw new CliError('conflicting_output','--json cannot share stdout with the diff text.','Choose a file with --output, or omit --json.');
 const result=positionals.length||remote?await compare(workspace,positionals,server,remote,client):await localDiff(workspace);
 if(output===undefined)return result;
 const text=result.diffs.map(entry=>entry.diff).filter(Boolean).map(entry=>entry.endsWith('\n')?entry:entry+'\n').join('');
 if(output==='-'){stdout(text);return undefined;}
 const path=resolve(workspace.cwd,output);
 try{await atomicWrite(path,text,{exclusive:true});}
 catch(error){if((error as NodeJS.ErrnoException).code==='EEXIST')throw new CliError('output_exists',`Output already exists: ${path}.`,'Choose a new --output path; diff never replaces an existing file.');throw error;}
 return{...result,output:path};
}

/** Cache immutable observations under the workspace lock without moving its accepted base. */
async function cacheVersion(workspace:Workspace,path:string,snapshot:Snapshot){
 await withProcessLock(workspace.root,async()=>{
  await recoverFiles(workspace.root);
  const fresh=await loadWorkspace(workspace.cwd);const tracked=fresh.lock?.files[path];
  if(!tracked||tracked.id!==snapshot.id)throw new CliError('workspace_changed','Tracking changed while reading history.','Retry the comparison in the current workspace.');
  const lock=structuredClone(fresh.lock!);
  lock.files[path].versions={...tracked.versions,[String(snapshot.version)]:snapshot};
  await stageFiles(workspace.root,[{path:'afbin.lock',before:digest(fresh.raw!),data:Buffer.from(JSON.stringify(lock,null,2)+'\n')}]);
  await recoverFiles(workspace.root);
 });
}
