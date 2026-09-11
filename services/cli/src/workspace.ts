import {realpath} from 'node:fs/promises';
import {dirname,extname,join,relative,resolve} from 'node:path';
import {parse as parseYaml} from 'yaml';
import {ARTIFACT_ID_PATTERN} from '@artifactbin/contracts';
import {normalizeServer} from './config';
import {CliError} from './commands';
import {parseDocument,type LocalDocument,type DocumentMetadata} from './document';
import {digest,readOptional} from './files';
import {confinedPath} from './journal';
export interface Snapshot {id:string;version:number;edit_id:string;state:string;markup?:string;format?:string;title?:string|null;theme?:string|null;template?:string|null;visibility?:DocumentMetadata['visibility'];link_role?:DocumentMetadata['link'];parent_id?:string|null;[key:string]:unknown}
export interface TrackedFile {baseline:string;id:string;base:string;file:string;url:string;snapshot:Snapshot;observed?:Snapshot;selected?:Snapshot;versions?:Record<string,Snapshot>;paths?:Record<string,string>}
export interface WorkspaceLock {schema:1;server:string;account:string;root:string;files:Record<string,TrackedFile>}
export interface Workspace {virtualFiles?:Record<string,Buffer>;root:string;cwd:string;lock:WorkspaceLock|null;raw:Buffer|null}
export interface LocalFile {path:string;bytes:Buffer|null;document?:LocalDocument;tracked?:TrackedFile;renamedFrom?:string;status:'new'|'unchanged'|'modified'|'missing'|'renamed'}
export async function loadWorkspace(cwd=process.cwd()):Promise<Workspace>{
 cwd=await realpath(cwd);let root=cwd;
 for(;;){
  const raw=await readOptional(join(root,'afbin.lock'));
  if(raw){
   let lock:WorkspaceLock;
   try{lock=parseYaml(raw.toString(),{maxAliasCount:0,uniqueKeys:true}) as WorkspaceLock;}catch{throw new CliError('invalid_lock','afbin.lock is invalid YAML.');}
   if(lock?.schema!==1||typeof lock.server!=='string'||typeof lock.account!=='string'||typeof lock.root!=='string'||!lock.files||typeof lock.files!=='object'||Array.isArray(lock.files))throw new CliError('invalid_lock','afbin.lock does not match the current workspace schema.');
   normalizeServer(lock.server);
   const ids=new Set<string>();
   for(const [path,entry] of Object.entries(lock.files)){
    await confinedPath(root,path);
    if(!entry||!ARTIFACT_ID_PATTERN.test(entry.id)||ids.has(entry.id)||!hash(entry.base)||!hash(entry.file)||typeof entry.baseline!=='string'||Buffer.from(entry.baseline,'base64').toString('base64')!==entry.baseline||entry.snapshot?.id!==entry.id||!Number.isSafeInteger(entry.snapshot.version)||entry.snapshot.version<1||!entry.snapshot.edit_id||!hash(entry.snapshot.state))throw new CliError('invalid_lock',`Invalid tracking entry for ${path}.`);
    ids.add(entry.id);
   }
   return{root,cwd,lock,raw};
  }
  if(await readOptional(join(root,'.artifactbin','pending-request.json'))||await readOptional(join(root,'.artifactbin','pending-files.json')))return{root,cwd,lock:null,raw:null};
  const parent=dirname(root);if(parent===root)return{root:cwd,cwd,lock:null,raw:null};root=parent;
 }
}
const hash=(value:unknown)=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
export async function inspectWorkspace(workspace:Workspace,paths?:string[]):Promise<LocalFile[]>{
 const selected=paths?.length?await Promise.all(paths.map(async path=>relative(workspace.root,await confinedPath(workspace.root,resolve(workspace.cwd,path))))):Object.keys(workspace.lock?.files??{});
 const seen=new Map<string,string>();
 const results:LocalFile[]=[];
 for(const path of [...new Set(selected)]){
  const bytes=workspace.virtualFiles?.[path]??await readOptional(await confinedPath(workspace.root,path));
  let tracked=workspace.lock?.files[path];
  let renamedFrom:string|undefined;
  const document=bytes&&extname(path)==='.jsx'?parseDocument(bytes.toString()):undefined;
  if(document&&tracked&&document.metadata.id!==tracked.id)throw new CliError('identity_mismatch',`Fence id ${document.metadata.id??'(missing)'} disagrees with tracked id ${tracked.id} in ${path}.`,'Restore the tracked identity fields, or remove all identity fields from an untracked copy to fork it.');
  const id=document?.metadata.id??tracked?.id;
  if(id){
   const previous=seen.get(id);if(previous&&previous!==path)throw duplicate(id,previous,path);
   seen.set(id,path);
   const other=Object.entries(workspace.lock?.files??{}).find(([p,e])=>p!==path&&e.id===id);
   if(other){
    if(await readOptional(await confinedPath(workspace.root,other[0])))throw duplicate(id,other[0],path);
    tracked=other[1];renamedFrom=other[0];
   }
  }
  results.push({path,bytes,...(document?{document}:{}),...(tracked?{tracked}:{}),...(renamedFrom?{renamedFrom}:{}),status:!bytes?'missing':renamedFrom?'renamed':!tracked?'new':digest(bytes)===digest(Buffer.from(tracked.baseline,'base64'))?'unchanged':'modified'});
 }
 return results;
}
function duplicate(id:string,a:string,b:string):CliError{return new CliError('duplicate_identity',`duplicate_identity: ${a} and ${b} both claim ${id}.`,'To fork a copy, remove id, edit_id, head_version, state and version from its fence.');}
