import {isDatasetFile} from './dataset-file';
import {isProgramFile} from './program-file';
import {publicationCopies} from './workspace-rebind';
import {withPrivateStateHome} from './config';
import {readState} from './state-access';
/** Remotely bound originals remain the authoring baseline. The publication store
 * is only a delivery projection; confirmed writes are journaled back locally. */
import {readFile,mkdir} from 'node:fs/promises';
import {dirname,extname,join} from 'node:path';
import {CliError} from './errors';
import {digest,atomicWrite} from './files';
import {confinedPath} from './journal';
import {parseDocument,writeDocument} from './document';
import {parseResourceFile,reconcileResource,writeResourceFile,readResourceSource,type ResourceSource} from './resource-file';
import {reconcileDocument} from './reconcile';
import {baselineOf,saveTracking,writeTracking,type Workspace,type TrackedFile} from './workspace';
import {localWorkspaceState,readLocalWorkspaceState,LOCAL_WORKSPACE_SCOPE,stageLocalFiles,recoverLocalFiles} from './local-workspace';
import {readConflicts,persistConflict,clearConflict} from './conflict-state';
import {withDeliveryObserver} from './delivery-observer';
import type {HttpClient} from './http';
import type {State} from './state';
interface PublicationInput {localId?:string;bytes:string;hash:string;ids?:Record<string,string>}
export interface PublicationManifest {format:1;server:string;account:string;root:string;inputs:Record<string,PublicationInput>;ids:Record<string,string>}
interface Bound {path:string;localId:string;tracked:TrackedFile;bytes:Buffer;source?:ResourceSource}
interface Finalization {checksum:string;server:string;account:string;path:string;frozen:string;accepted:string;entry:TrackedFile;source?:ResourceSource}
const prefix='publication-finalize/';
const bindingKey=(server:string,path:string)=>'publication-bound/'+digest(server).slice(0,24)+'/'+path;
/** No reservations or writes occur until every selected identity has been verified. */
export async function prepareBindings(workspace:Workspace,paths:string[],pathIds:Record<string,string>,manifest:PublicationManifest,client:HttpClient):Promise<Bound[]>{
 const bound:Bound[]=[];
 if(workspace.tracking&&!client.sameServer(workspace.tracking.server))throw new CliError('wrong_server','The authoring baseline belongs to another server.');

 const portable=await localWorkspaceState(workspace.root);
 if(portable.get(LOCAL_WORKSPACE_SCOPE,'archive','workspace-rebind/current'))throw new CliError('pending_recovery','Finish the interrupted workspace rebind before publishing.','Run afbin workspace rebind --account current.',undefined,3);
 if(workspace.tracking&&client.account!==workspace.tracking.account){
  const previous=client.account;client.account=workspace.tracking.account;
  try{await client.request('/artifacts?limit=1');}catch(error){client.account=previous;throw error;}
 }
 for(const path of paths){
  const bytes=await readFile(await confinedPath(workspace.root,path)),extension=extname(path).toLowerCase();
  const identity=extension==='.jsx'?parseDocument(bytes.toString()).metadata:['.yaml','.yml'].includes(extension)?parseResourceFile(bytes.toString()):undefined;
  const localId=pathIds[path]??identity?.id;
  const retired=portable.get<{target:string;localId:string}>(LOCAL_WORKSPACE_SCOPE,'archive','rebind-target/'+digest(client.connection.server).slice(0,24)+'/'+path)?.value;
  if(retired&&localId===retired.localId)throw new CliError('rebind_publication_target',`${path} was published to ${retired.target} under the former account.`,'Pull that original with an authorized account, or explicitly fork into a new path. Rebind never silently recreates a published draft.',{path,target:retired.target},3);
  let tracked=workspace.tracking?.files[path];
  const other=identity?.id&&Object.entries(workspace.tracking?.files??{}).find(([other,entry])=>other!==path&&entry.id===identity.id);
  if(other)throw new CliError('duplicate_identity',`${path} and ${other[0]} claim the same published identity.`,'Use the tracked original or explicitly fork the copy.');
  if(tracked&&identity&&(identity.id!==tracked.id||identity.edit_id!==tracked.snapshot.edit_id||identity.state!==tracked.snapshot.state||identity.head_version!==tracked.snapshot.version||identity.version!==undefined&&identity.version!==tracked.selected?.version))throw new CliError('identity_mismatch',`${path} disagrees with its tracked identity.`);
  // Existing mappings are deliberately retained, including old duplicates.
  if(localId&&manifest.ids[localId]&&manifest.ids[localId]!==tracked?.id)continue;
  const fence=identity&&[identity.edit_id,identity.state,identity.head_version,identity.version];
  const published=!!fence?.some(value=>value!==undefined);
  if(!tracked&&!published){
   if(identity?.id&&!portable.get<{trusted?:boolean}>(LOCAL_WORKSPACE_SCOPE,'draft-identity',path)?.value.trusted&&!portable.get(LOCAL_WORKSPACE_SCOPE,'archive','import-baseline/'+path))throw new CliError('unverified_identity',`${path} has an unregistered identity.`,'Run afbin add explicitly for a local draft, or pull the original before editing.');
   continue;
  }
  if(!tracked){
   if(!identity?.id||typeof identity.edit_id!=='string'||typeof identity.state!=='string'||!Number.isSafeInteger(identity.head_version)||(identity.version!==undefined&&!Number.isSafeInteger(identity.version)))throw new CliError('unverified_identity',`${path} has an incomplete published fence.`,'Pull the original or remove all identity fields in an explicit fork.');
   const head=await client.request<TrackedFile['snapshot']>(`/artifacts/${identity.id}`);
   if(head.id!==identity.id||head.edit_id!==identity.edit_id||head.state!==identity.state||head.version!==identity.head_version||(identity.version!==undefined&&identity.version!==head.version))throw new CliError('state_conflict',`${path} does not match the authenticated remote baseline.`,'Pull the original before editing; the copied stale fence was retained.',undefined,3);
   tracked={id:head.id,url:`${client.connection.server}/a/${head.id}`,snapshot:head,file:''};
   const baseline=await baselineOf(workspace,path,tracked);if(!baseline)throw new CliError('unverified_identity',`Cannot verify the baseline for ${path}.`);
   tracked.file=digest(baseline);
  }
  if(!localId)throw new CliError('unverified_identity',`${path} has no resolved identity.`);
  if(!manifest.ids[localId]){
   const head=await client.request<TrackedFile['snapshot']>(`/artifacts/${tracked.id}`);
   if(head.id!==tracked.id||(head.capabilities as {edit?:boolean}|undefined)?.edit!==true)throw new CliError('edit_required',`Your account cannot edit ${path} (${tracked.id}).`,'Select an account allowed to edit the original.');
  }
  const source=identity&&['.yaml','.yml'].includes(extension)?await readResourceSource(parseResourceFile(bytes.toString()),path,workspace.root):undefined;
  bound.push({path,localId,tracked,bytes,source});
 }
 return bound;
}
/** Explicit pull changes the original baseline. Refresh only after delivery
 * recovery, retaining a stale local proposal's actual write conditions. */
export async function installBindings(workspace:Workspace,stage:Workspace,bindings:Bound[],manifest:PublicationManifest):Promise<void>{
 const portable=await localWorkspaceState(workspace.root);
 for(const binding of bindings){
  const {path,localId,tracked}=binding,prior=stage.tracking?.files[path];
  const marker=portable.get<{file:string}>(LOCAL_WORKSPACE_SCOPE,'archive',bindingKey(manifest.server,path))?.value;
  if(prior&&marker?.file===tracked.file){manifest.ids[localId]=tracked.id;continue;}
  const baseline=await baselineOf(workspace,path,tracked)??binding.bytes;
  const target=await confinedPath(stage.root,path);await mkdir(dirname(target),{recursive:true});await atomicWrite(target,baseline);
  // A published offline CSV/JSON can be explicitly pulled as typed YAML.
  // Its authoring baseline has one new path, so the hidden projection must
  // retire its former path too; keeping both corrupts tracking on reload.
  const retired=Object.entries(stage.tracking?.files??{}).filter(([previous,entry])=>previous!==path&&entry.id===tracked.id).map(([previous])=>previous);
  await saveTracking(stage,{server:manifest.server,account:manifest.account,set:{[path]:tracked},remove:retired});
  await clearConflict(stage.home,stage.root,tracked.id);
  manifest.ids[localId]=tracked.id;
  manifest.inputs[path]={localId,bytes:baseline.toString('base64'),hash:digest(baseline),ids:{...manifest.ids}};
  portable.put(LOCAL_WORKSPACE_SCOPE,'archive',bindingKey(manifest.server,path),{file:tracked.file,id:tracked.id});
  if(!workspace.tracking?.files[path]){
   // A verified copied fence becomes a durable authoring baseline before HTTP,
   // so a lost reply can recover even after the remote head has advanced.
   portable.transaction(()=>{writeTracking(portable,LOCAL_WORKSPACE_SCOPE,{server:manifest.server,account:manifest.account,set:{[path]:tracked}});portable.put(LOCAL_WORKSPACE_SCOPE,'archive','tracking-to-home/current',{server:manifest.server,account:manifest.account});});
   await saveTracking(workspace,{server:manifest.server,account:manifest.account,set:{[path]:tracked}});portable.delete(LOCAL_WORKSPACE_SCOPE,'archive','tracking-to-home/current');
  }
 }
}
/** Retain evidence before sync clears its sole HTTP journal. Replaying this
 * intent only writes local files/tracking and can never repeat an artifact edit. */
export async function deliverBound<T>(workspace:Workspace,bindings:Bound[],manifest:PublicationManifest,run:()=>Promise<T>):Promise<T>{
 const portable=await localWorkspaceState(workspace.root),boundPrefix='publication-bound/'+digest(manifest.server).slice(0,24)+'/';
 const paths=new Set(portable.list(LOCAL_WORKSPACE_SCOPE,'archive').filter(row=>row.key.startsWith(boundPrefix)).map(row=>row.key.slice(boundPrefix.length)));
 for(const binding of bindings){
  paths.add(binding.path);
  const marker=portable.get<Record<string,unknown>>(LOCAL_WORKSPACE_SCOPE,'archive',bindingKey(manifest.server,binding.path))?.value??{};
  portable.put(LOCAL_WORKSPACE_SCOPE,'archive',bindingKey(manifest.server,binding.path),{...marker,source:binding.source});
 }
 return withDeliveryObserver(async(path,entry,accepted)=>{
  if(!paths.has(path))return;
  const input=manifest.inputs[path];if(!input)throw new CliError('invalid_journal','The frozen authoring input is missing.');
  const evidence={server:manifest.server,account:manifest.account,path,frozen:input.bytes,accepted:accepted.toString('base64'),entry,source:bindings.find(binding=>binding.path===path)?.source??portable.get<{source?:ResourceSource}>(LOCAL_WORKSPACE_SCOPE,'archive',bindingKey(manifest.server,path))?.value.source};
  if(digest(Buffer.from(input.bytes,'base64'))!==input.hash||digest(accepted)!==entry.file)throw new CliError('invalid_journal','Publication evidence checksum mismatch.');
  portable.put(LOCAL_WORKSPACE_SCOPE,'archive',prefix+digest(manifest.server).slice(0,24)+'/'+path,{...evidence,checksum:digest(JSON.stringify(evidence))} satisfies Finalization);
 },run);
}
function writePortableTracking(store:State,intent:Finalization):void{
 writeTracking(store,LOCAL_WORKSPACE_SCOPE,{server:intent.server,account:intent.account,set:{[intent.path]:intent.entry}});
}
export async function finalizeBindings(workspace:Workspace,options:{onProgress?:(phase:string)=>void}={}):Promise<void>{
 const portable=await localWorkspaceState(workspace.root);await recoverLocalFiles(workspace.root);
 const mirror=portable.get<{server:string;account:string}>(LOCAL_WORKSPACE_SCOPE,'archive','tracking-to-home/current')?.value;
 if(mirror){await saveTracking(workspace,{...mirror,set:Object.fromEntries(portable.list<TrackedFile>(LOCAL_WORKSPACE_SCOPE,'tracked').map(row=>[row.key,row.value]))});portable.delete(LOCAL_WORKSPACE_SCOPE,'archive','tracking-to-home/current');}
 for(const row of portable.list<Finalization>(LOCAL_WORKSPACE_SCOPE,'archive').filter(row=>row.key.startsWith(prefix))){
  const intent=row.value,{path,entry}=intent;
  const {checksum,...evidence}=intent;if(checksum!==digest(JSON.stringify(evidence))||digest(Buffer.from(intent.accepted,'base64'))!==entry.file)throw new CliError('invalid_journal','Publication finalization checksum mismatch.');
  const current=await readFile(await confinedPath(workspace.root,path)),accepted=Buffer.from(intent.accepted,'base64');
  const frozen=Buffer.from(intent.frozen,'base64');let written=accepted;
  if(extname(path).toLowerCase()==='.jsx'||['.yaml','.yml'].includes(extname(path).toLowerCase())){
   const identity=(bytes:Buffer)=>extname(path).toLowerCase()==='.jsx'?parseDocument(bytes.toString()).metadata:parseResourceFile(bytes.toString());
   const latest=identity(current),before=identity(frozen),after=identity(accepted);
   const keys=['id','edit_id','head_version','state','version'] as const;
   if(!keys.every(key=>JSON.stringify(latest[key])===JSON.stringify(before[key]))&&!keys.every(key=>JSON.stringify(latest[key])===JSON.stringify(after[key])))throw new CliError('identity_mismatch',`${path} changed identity while publication completed; the confirmed result was retained.`,'Restore its verified identity, then retry push.');
  }
  if(!current.equals(frozen)&&!current.equals(accepted)){
   if(extname(path).toLowerCase()==='.jsx'){
    const merged=reconcileDocument(parseDocument(frozen.toString()),parseDocument(current.toString()),parseDocument(accepted.toString()));
    if(!merged.ok)throw await persistConflict(workspace.home,workspace.root,entry.id,path,new CliError('merge_conflict',`${path} changed while publication completed.`,undefined,{base:frozen.toString(),local:current.toString(),remote:accepted.toString(),fields:merged.fields},3));
    written=Buffer.from(writeDocument(merged.document));
   }else if(['.yaml','.yml'].includes(extname(path).toLowerCase())){
    const merged=reconcileResource(parseResourceFile(frozen.toString()),parseResourceFile(current.toString()),parseResourceFile(accepted.toString()));
    if(!merged.ok)throw new CliError('merge_conflict',`${path} changed while publication completed.`,undefined,undefined,3);
    written=Buffer.from(writeResourceFile(merged.resource));
   }else if(accepted.equals(frozen)||!isDatasetFile(path)&&!isProgramFile(path))written=current;
   else{
    const merged=reconcileDocument({metadata:{},body:frozen.toString()},{metadata:{},body:current.toString()},{metadata:{},body:accepted.toString()});
    if(!merged.ok)throw new CliError('merge_conflict',`${path} changed while publication completed.`,undefined,undefined,3);
    written=Buffer.from(merged.document.body);
   }
  }
  const changes=[{path,before:digest(current),data:written}];
  if(intent.source&&entry.source){
   if(intent.source.path!==entry.source.path)throw new CliError('identity_mismatch','The accepted source path changed; recovery was retained.');
   const sourceCurrent=await readFile(await confinedPath(workspace.root,entry.source.path)),sourceFrozen=Buffer.from(intent.source.bytes,'base64'),sourceAccepted=Buffer.from(entry.source.bytes,'base64');let sourceWritten=sourceAccepted;
   if(!sourceCurrent.equals(sourceFrozen)&&!sourceCurrent.equals(sourceAccepted)){
    if(sourceAccepted.equals(sourceFrozen)||!isDatasetFile(entry.source.path)&&extname(entry.source.path).toLowerCase()!=='.jsx')sourceWritten=sourceCurrent;
    else{
     const merged=reconcileDocument({metadata:{},body:sourceFrozen.toString()},{metadata:{},body:sourceCurrent.toString()},{metadata:{},body:sourceAccepted.toString()});
     if(!merged.ok)throw new CliError('merge_conflict',`${entry.source.path} changed while publication completed.`,undefined,undefined,3);
     sourceWritten=Buffer.from(merged.document.body);
    }
   }
   changes.push({path:entry.source.path,before:digest(sourceCurrent),data:sourceWritten});
  }
  await stageLocalFiles(workspace.root,changes,store=>writePortableTracking(store,intent));
  await recoverLocalFiles(workspace.root);options.onProgress?.('portable');
  await saveTracking(workspace,{server:intent.server,account:intent.account,set:{[path]:entry}});
  options.onProgress?.('home');
  await clearConflict(workspace.home,workspace.root,entry.id);
  portable.transaction(()=>{portable.put(LOCAL_WORKSPACE_SCOPE,'archive',bindingKey(intent.server,path),{file:entry.file,id:entry.id});portable.delete(LOCAL_WORKSPACE_SCOPE,'archive',row.key);});
 }
}
export async function projectBindingConflicts(workspace:Workspace,stage:Workspace,bindings:Bound[]):Promise<void>{
 const conflicts=await readConflicts(stage.home,stage.root);
 for(const {path,tracked} of bindings){const conflict=conflicts[tracked.id];if(conflict)await persistConflict(workspace.home,workspace.root,tracked.id,path,new CliError(conflict.code,`${path} has an unresolved publication conflict.`,undefined,conflict.details,3));}
}

/** Explicit pulls cannot discard an uncertain delivery in a hidden copy. */
export async function assertBoundPullIdle(workspace:Workspace,client:HttpClient,ids:string[]):Promise<void>{
 for(const copy of await publicationCopies(workspace,client)){
  if(!Object.values(copy.manifest.ids).some(id=>ids.includes(id)))continue;
  await withPrivateStateHome(copy.home,join(copy.home,'.artifactbin'),async()=>{
   const store=await readState(copy.home);
   if(store?.list(copy.manifest.root,'pending-request').length||store?.list(copy.manifest.root,'pending-operation').length||store?.list(copy.manifest.root,'staged-file').length)throw new CliError('pending_recovery','The publication copy has an uncertain write.','Run afbin push with its original account to recover it before pulling.',{publication_copy:copy.directory},3);
  });
 }
}
export async function refreshPulledBindings(workspace:Workspace,server:string,account:string,entries:Record<string,TrackedFile>):Promise<void>{
 const portable=await readLocalWorkspaceState(workspace.root);if(!portable)return;
 portable.transaction(()=>{
  writeTracking(portable,LOCAL_WORKSPACE_SCOPE,{server,account,set:entries});
  for(const [path,entry] of Object.entries(entries)){
   portable.delete(LOCAL_WORKSPACE_SCOPE,'archive',bindingKey(server,path));
   const key=prefix+digest(server).slice(0,24)+'/'+path,accepted=portable.get<Finalization>(LOCAL_WORKSPACE_SCOPE,'archive',key);
   if(accepted?.value.entry.id===entry.id){portable.put(LOCAL_WORKSPACE_SCOPE,'archive','pulled-finalization/'+digest(JSON.stringify(accepted.value)),accepted.value,{data:accepted.data});portable.delete(LOCAL_WORKSPACE_SCOPE,'archive',key);}
  }
 });
}
/** CLI locks serialize commands, not a person's editor. Identity changes during
 * preflight are refusals; content proposals stay frozen and newer typing merges. */
export async function assertBindingInputs(workspace:Workspace,bindings:Bound[]):Promise<void>{
 for(const binding of bindings){
  const extension=extname(binding.path).toLowerCase();if(extension!=='.jsx'&&!['.yaml','.yml'].includes(extension))continue;
  const current=await readFile(await confinedPath(workspace.root,binding.path));
  const identity=(bytes:Buffer)=>extension==='.jsx'?parseDocument(bytes.toString()).metadata:parseResourceFile(bytes.toString());
  const before=identity(binding.bytes),after=identity(current);
  if(['id','edit_id','head_version','state','version'].some(key=>JSON.stringify(before[key as keyof typeof before])!==JSON.stringify(after[key as keyof typeof after])))throw new CliError('identity_mismatch',`The identity in ${binding.path} changed during publication preflight.`,'Restore its verified identity or explicitly fork the copy; no artifact write was sent.');
 }
}
