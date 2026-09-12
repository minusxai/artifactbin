/**
 * A workspace is a directory the CLI has registered in its own store. No file is
 * ever written into it to mark it: discovery walks up from the working directory
 * and stops at the nearest ancestor that holds a `workspace` record.
 *
 * Tracking is hashes, not bytes. `TrackedFile.file` is the sha256 of the local
 * bytes last accepted, and the base text a diff or a merge needs is derived from
 * the server snapshot by `baselineOf`.
 */
import {realpath} from 'node:fs/promises';
import {dirname,extname,relative,resolve} from 'node:path';
import {ARTIFACT_ID_PATTERN,type ArtifactResourceFile} from '@artifactbin/contracts';
import {homedir} from 'node:os';
import {normalizeServer} from './config';
import {CliError} from './commands';
import {parseDocument,writeDocument,type LocalDocument,type DocumentMetadata} from './document';
import {digest,readOptional} from './files';
import {confinedPath} from './journal';
import {stateFor} from './state-access';
import type {State} from './state';
import {snapshotDocument} from './local';
import {restoreDependencyPaths} from './dependencies';
import {parseResourceFile,readResourceSource,snapshotResource,writeResourceFile,type ResourceSource} from './resource-file';
export interface Snapshot {id:string;version:number;edit_id:string;state:string;markup?:string;format?:string;title?:string|null;theme?:string|null;template?:string|null;visibility?:DocumentMetadata['visibility'];link_role?:DocumentMetadata['link'];parent_id?:string|null;[key:string]:unknown}
export interface TrackedFile {source?:ResourceSource;id:string;file:string;url:string;snapshot:Snapshot;observed?:Snapshot;selected?:Snapshot;versions?:Record<string,Snapshot>;paths?:Record<string,string>}
export interface WorkspaceTracking {server:string;account:string;files:Record<string,TrackedFile>}
export interface Workspace {virtualFiles?:Record<string,Buffer>;home:string;root:string;cwd:string;tracking:WorkspaceTracking|null}
export interface LocalFile {path:string;bytes:Buffer|null;document?:LocalDocument;resource?:ArtifactResourceFile;tracked?:TrackedFile;renamedFrom?:string;status:'new'|'unchanged'|'modified'|'missing'|'renamed'}

/** The workspace record every tracked scope carries: which server and account own it. */
export interface WorkspaceRecord {server:string;account:string}
export interface TrackingUpdate {server:string;account:string;set?:Record<string,TrackedFile>;remove?:string[]}
/** Synchronous by design: the caller runs it inside one `state.transaction`. */
export function writeTracking(state:State,root:string,update:TrackingUpdate):void{
 state.put(root,'workspace',root,{server:normalizeServer(update.server),account:update.account} satisfies WorkspaceRecord);
 for(const path of update.remove??[])state.delete(root,'tracked',path);
 for(const [path,entry] of Object.entries(update.set??{}))state.put(root,'tracked',path,entry);
}
/** Write tracking on its own, when no file change accompanies it. */
export async function saveTracking(workspace:Workspace,update:TrackingUpdate):Promise<void>{
 const state=await stateFor(workspace.home);
 state.transaction(()=>writeTracking(state,workspace.root,update));
}

const hash=(value:unknown)=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
/** Discovery is the nearest registered ancestor of the working directory, else the directory itself. */
export async function loadWorkspace(cwd=process.cwd(),home=homedir()):Promise<Workspace>{
 cwd=await realpath(cwd);
 const state=await stateFor(home);
 const found=state.nearestWorkspace<WorkspaceRecord>(cwd);
 if(!found)return{home,root:cwd,cwd,tracking:null};
 const {root,value}=found;
 if(typeof value?.server!=='string'||typeof value.account!=='string')throw new CliError('invalid_tracking','The stored workspace record is incomplete.','Run afbin pull to re-establish tracking for this directory.');
 normalizeServer(value.server);
 const files:Record<string,TrackedFile>={};const ids=new Set<string>();
 for(const record of state.list<TrackedFile>(root,'tracked')){
  const entry=record.value;
  await confinedPath(root,record.key);
  if(!entry||!ARTIFACT_ID_PATTERN.test(entry.id)||ids.has(entry.id)||!hash(entry.file)||entry.snapshot?.id!==entry.id||!Number.isSafeInteger(entry.snapshot.version)||entry.snapshot.version<1||!entry.snapshot.edit_id||!hash(entry.snapshot.state))throw new CliError('invalid_tracking',`Invalid tracking entry for ${record.key}.`);
  ids.add(entry.id);files[record.key]=entry;
 }
 return{home,root,cwd,tracking:{server:value.server,account:value.account,files}};
}

const RESOURCE_TYPES:Record<string,string>={markup:'artifact',folder:'folder',dataset:'dataset'};
/**
 * The accepted base text for a tracked file, derived from the snapshot rather
 * than stored beside it. Binaries have none: they are compared by hash alone.
 */
export async function baselineOf(workspace:Workspace,path:string,tracked:TrackedFile):Promise<Buffer|null>{
 const extension=extname(path).toLowerCase();
 if(extension==='.jsx'){
  const head=tracked.snapshot;const chosen=tracked.selected??head;
  const document=snapshotDocument({...chosen,edit_id:head.edit_id,state:head.state});
  document.metadata.head_version=head.version;
  if(tracked.selected)document.metadata.version=tracked.selected.version;
  document.body=await restoreDependencyPaths(document.body,tracked.paths??{},path,workspace.root);
  return Buffer.from(writeDocument(document));
 }
 if(['.yaml','.yml'].includes(extension)){
  const type=RESOURCE_TYPES[tracked.snapshot.format??'']??'file';
  const prototype={type,...(tracked.source?{source:relative(dirname(path),tracked.source.path)}:{})} as ArtifactResourceFile;
  return Buffer.from(writeResourceFile(snapshotResource(tracked.snapshot,prototype)));
 }
 return null;
}

export async function inspectWorkspace(workspace:Workspace,paths?:string[]):Promise<LocalFile[]>{
 const selected=paths?.length?await Promise.all(paths.map(async path=>relative(workspace.root,await confinedPath(workspace.root,resolve(workspace.cwd,path))))):Object.keys(workspace.tracking?.files??{});
 const seen=new Map<string,string>();
 const results:LocalFile[]=[];
 for(const path of [...new Set(selected)]){
  const bytes=workspace.virtualFiles?.[path]??await readOptional(await confinedPath(workspace.root,path));
  let tracked=workspace.tracking?.files[path];
  let renamedFrom:string|undefined;
  const document=bytes&&extname(path).toLowerCase()==='.jsx'?parseDocument(bytes.toString()):undefined;
  const resource=bytes&&['.yaml','.yml'].includes(extname(path).toLowerCase())?parseResourceFile(bytes.toString()):undefined;
  const identity=document?.metadata??resource;
  if(identity&&tracked&&identity.id!==tracked.id)throw new CliError('identity_mismatch',`File id ${identity.id??'(missing)'} disagrees with tracked id ${tracked.id} in ${path}.`,'Restore the tracked identity fields, or remove all identity fields from an untracked copy to fork it.');
  const id=identity?.id??tracked?.id;
  if(id){
   const previous=seen.get(id);if(previous&&previous!==path)throw duplicate(id,previous,path);
   seen.set(id,path);
   const other=Object.entries(workspace.tracking?.files??{}).find(([p,e])=>p!==path&&e.id===id);
   if(other){
    if(await readOptional(await confinedPath(workspace.root,other[0])))throw duplicate(id,other[0],path);
    tracked=other[1];renamedFrom=other[0];
   }
  }
  const source=resource?await readResourceSource(resource,path,workspace.root):undefined;
  const sourceChanged=source?.bytes!==tracked?.source?.bytes;
  results.push({path,bytes,...(document?{document}:{}),...(resource?{resource}:{}),...(tracked?{tracked}:{}),...(renamedFrom?{renamedFrom}:{}),status:!bytes?'missing':renamedFrom?'renamed':!tracked?'new':!sourceChanged&&digest(bytes)===tracked.file?'unchanged':'modified'});
 }
 return results;
}
function duplicate(id:string,a:string,b:string):CliError{return new CliError('duplicate_identity',`duplicate_identity: ${a} and ${b} both claim ${id}.`,'To fork a copy, remove id, edit_id, head_version, state and version from its fence.');}
