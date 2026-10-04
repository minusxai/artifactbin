/**
 * Publication is a recoverable copy, never a conversion of an offline workspace.
 * Server fences, reserved identities and immutable pending writes belong only to
 * this copy. The existing push journal remains the single HTTP write protocol.
 */
import {mkdir,readFile} from 'node:fs/promises';
import {dirname,extname,join,relative,resolve} from 'node:path';
import {CliError} from './commands';
import {withPrivateStateHome} from './config';
import {digest,readOptional,atomicWrite} from './files';
import {confinedPath} from './journal';
import {localIdentities,addFiles} from './identities';
import {parseDocument,writeDocument} from './document';
import {parseResourceFile,writeResourceFile,readResourceSource} from './resource-file';
import {referenceIds} from './preview/graph';
import {datasetFileRows,datasetFileBytes,isDatasetFile} from './dataset-file';
import {reconcileDocument} from './reconcile';
import {stampNodeIds} from '../../app/lib/story/document/node-ids';
import {push} from './sync';
import {loadWorkspace,type Workspace} from './workspace';
import {stateFor} from './state-access';
import {withLock} from './state';
import {readPendingRequest} from './pending-request';
import type {HttpClient} from './http';
interface Options {force?:boolean;dryRun?:boolean;access?:'read'|'readwrite';policy?:'viewers-write'|'none'}
interface Input {localId?:string;bytes:string;hash:string}
interface Publication {format:1;server:string;account:string;root:string;inputs:Record<string,Input>;ids:Record<string,string>}
const fence=['id','edit_id','head_version','state','version'] as const;
/** Exact resource addresses only; arbitrary IDs and prose are not rewritten. */
function rewrite(value:string,ids:Record<string,string>):string{
 return value.replace(/\bref:([A-Za-z0-9]{6,12})(?![A-Za-z0-9])/g,(whole,id:string)=>ids[id]?`ref:${ids[id]}`:whole)
  .replace(/\/a\/([A-Za-z0-9]{6,12})(?![A-Za-z0-9])/g,(whole,id:string)=>ids[id]?`/a/${ids[id]}`:whole);
}
function rowReferences(value:unknown):Set<string>{
 const found=new Set<string>();const visit=(item:unknown)=>{if(typeof item==='string'){for(const match of item.matchAll(/(?:\bref:|\/a\/)([A-Za-z0-9]{6,12})(?![A-Za-z0-9])/g))found.add(match[1]!);}else if(Array.isArray(item))item.forEach(visit);else if(item&&typeof item==='object')Object.values(item).forEach(visit);};visit(value);return found;
}
async function dependencies(workspace:Workspace,paths:string[],identities:Record<string,string>):Promise<string[]>{
 const ordered:string[]=[],active=new Set<string>(),done=new Set<string>();
 async function visit(path:string):Promise<void>{
  path=relative(workspace.root,await confinedPath(workspace.root,path));if(done.has(path))return;
  if(active.has(path))throw new CliError('dependency_cycle',`Cyclic publication reference: ${path}.`);
  active.add(path);const bytes=await readFile(await confinedPath(workspace.root,path));const extension=extname(path).toLowerCase();
  let refs=new Set<string>();
  if(extension==='.jsx')refs=referenceIds(parseDocument(bytes.toString()).body);
  else if(isDatasetFile(path))refs=rowReferences(datasetFileRows(path,bytes));
  else if(['.yaml','.yml'].includes(extension)){
   const resource=parseResourceFile(bytes.toString()),source=await readResourceSource(resource,path,workspace.root);
   if(source)await visit(source.path);
   refs=rowReferences(resource);
  }
  for(const id of refs)if(identities[id])await visit(identities[id]!);
  active.delete(path);done.add(path);ordered.push(path);
 }
 for(const path of paths.length?paths:Object.values(identities))await visit(resolve(workspace.cwd,path));return ordered;
}
async function saveManifest(path:string,manifest:Publication):Promise<void>{
 await atomicWrite(path,JSON.stringify(manifest,null,2)+'\n');
}
function mappedBytes(path:string,bytes:Buffer,ids:Record<string,string>,remote?:Buffer):Buffer{
 const extension=extname(path).toLowerCase();
 if(extension==='.jsx'){
  const local=parseDocument(bytes.toString());const metadata={...local.metadata};for(const key of fence)delete metadata[key];
  if(remote){const previous=parseDocument(remote.toString());for(const key of fence)if(previous.metadata[key]!==undefined)Object.assign(metadata,{[key]:previous.metadata[key]});}
  return Buffer.from(writeDocument({...local,metadata,body:rewrite(local.body,ids)}));
 }
 if(['.yaml','.yml'].includes(extension)){
  const resource=parseResourceFile(bytes.toString());for(const key of fence)delete resource[key];
  if(remote){const previous=parseResourceFile(remote.toString());for(const key of fence)if(previous[key]!==undefined)Object.assign(resource,{[key]:previous[key]});}
  return Buffer.from(writeResourceFile(JSON.parse(rewrite(JSON.stringify(resource),ids))));
 }
 if(isDatasetFile(path)){
  const rows=datasetFileRows(path,bytes);return datasetFileBytes(path,JSON.parse(rewrite(JSON.stringify(rows),ids)));
 }
 return bytes;
}
export async function publishLocalWorkspace(workspace:Workspace,paths:string[],client:HttpClient,options:Options={}):Promise<unknown>{
 const identities=await localIdentities(workspace),ordered=await dependencies(workspace,paths,identities);
 if(options.dryRun)return{dry_run:true,local_only:true,operations:ordered.map(path=>({path,status:'would_publish'}))};
 const publication=join(workspace.root,'.artifactbin','publications',digest(client.connection.server).slice(0,24));
 const manifestPath=join(publication,'manifest.json'),home=join(publication,'private'),root=join(publication,'files');
 if(!client.account)await client.request('/artifacts?limit=1');
 if(!client.account)throw new CliError('account_required','Publication requires an authenticated account.');
 const existing=await readOptional(manifestPath);let manifest:Publication=existing?JSON.parse(existing.toString()):{format:1,server:client.connection.server,account:client.account,root,inputs:{},ids:{}};
 if(manifest.format!==1||!client.sameServer(manifest.server)||manifest.account!==client.account)throw new CliError('account_mismatch','This publication copy is bound to a different server or account.');
 await mkdir(root,{recursive:true,mode:0o700});
 return withPrivateStateHome(home,join(home,'.artifactbin'),()=>withLock(home,publication,async()=>{
  // The state store travels with the workspace. Only its scope contains an
  // absolute path; rebase it before ordinary journal recovery or discovery.
  const state=await stateFor(home);if(manifest.root!==root){state.rebaseScope(manifest.root,root);manifest={...manifest,root};await saveManifest(manifestPath,manifest);}
  let stage=await loadWorkspace(root,home);
  if(await readPendingRequest(home,root)){
   await push(stage,[],client,{});stage=await loadWorkspace(root,home);
  }
  // Materialize unassigned copies first so addFiles can recover its own
  // reservation pool after an interruption. Never carry a local fence to HTTP.
  const reverse=Object.fromEntries(Object.entries(identities).map(([id,path])=>[path,id]));
  for(const path of ordered){
   const target=await confinedPath(root,path),bytes=await readFile(await confinedPath(workspace.root,path));
   if(!await readOptional(target)){await mkdir(dirname(target),{recursive:true});await atomicWrite(target,mappedBytes(path,bytes,manifest.ids));}
  }
  const assigned=await addFiles(stage,ordered.map(path=>join(root,path)),client);
  for(const [path,id] of Object.entries(assigned))if(reverse[path])manifest.ids[reverse[path]!]=id;
  await saveManifest(manifestPath,manifest);stage=await loadWorkspace(root,home);
  for(const path of ordered){
   const bytes=await readFile(await confinedPath(workspace.root,path)),hash=digest(bytes),previous=manifest.inputs[path];if(previous?.hash===hash)continue;
   const target=await confinedPath(root,path),remote=await readFile(target);let mapped=mappedBytes(path,bytes,manifest.ids,remote);
   if(previous&&extname(path).toLowerCase()==='.jsx'){
    const base=parseDocument(mappedBytes(path,Buffer.from(previous.bytes,'base64'),manifest.ids,remote).toString());const local=parseDocument(mapped.toString()),confirmed=parseDocument(remote.toString());
    // Server-assigned node IDs are normalization, not an intervening user edit.
    // Match them before computing changes; keep author originals unchanged.
    base.body=stampNodeIds(base.body,{previousSource:confirmed.body}).source;
    local.body=stampNodeIds(local.body,{previousSource:base.body}).source;
    const merged=reconcileDocument(base,local,confirmed);
    if(!merged.ok)throw new CliError('merge_conflict',`Publication normalization overlaps local changes in ${path}.`,'Preserve the local source and inspect its publication copy.',{base:writeDocument(base),local:writeDocument(local),remote:writeDocument(confirmed),fields:merged.fields});
    mapped=Buffer.from(writeDocument(merged.document));
   }
   await atomicWrite(target,mapped);manifest.inputs[path]={bytes:bytes.toString('base64'),hash,...(reverse[path]?{localId:reverse[path]}:{})};
  }
  // Persist the frozen local input before HTTP: retries recover exactly these
  // bytes, then stage newer local changes against the confirmed remote head.
  await saveManifest(manifestPath,manifest);
  const result=await push(await loadWorkspace(root,home),ordered.map(path=>join(root,path)),client,options);
  return{...result,publication_copy:relative(workspace.root,publication),local_source_preserved:true};
 }));
}
