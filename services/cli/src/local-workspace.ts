/** Portable authoring state. Identity and discussion belong to the folder; credentials remain at home. */
import {AsyncLocalStorage} from 'node:async_hooks';
import {randomBytes,randomUUID} from 'node:crypto';
import {readFile,lstat,realpath,link,unlink} from 'node:fs/promises';
import {basename,dirname,extname,join,relative,resolve,sep} from 'node:path';
import {ARTIFACT_ID_PATTERN} from '@artifactbin/contracts';
import {State,withLock} from './state';
import {recordLocalHistory,assertLocalHistoryMove,moveLocalHistory} from './local-history';
import {stateFor,readState} from './state-access';
import {workspaceStateEnv} from './config';
import {atomicWrite,digest,privateDirectory,readOptional} from './files';
import {confinedPath,stageFiles,recoverFiles,type FileChange} from './journal';
import {parseDocument,writeDocument} from './document';
import {parseResourceFile,writeResourceFile} from './resource-file';
import {assetInput} from './upload-input';
import {CliError} from './errors';
import type {Workspace} from './workspace';

export const LOCAL_WORKSPACE_SCOPE='workspace';
interface WorkspaceMarker {format:1;id:string}
const markerPath=(root:string)=>join(root,'.artifactbin','workspace.json');
async function marker(root:string):Promise<WorkspaceMarker|null>{
 const bytes=await readOptional(markerPath(root));if(!bytes)return null;
 const directory=await lstat(join(root,'.artifactbin')),file=await lstat(markerPath(root));
 if(directory.isSymbolicLink()||!directory.isDirectory()||file.isSymbolicLink()||!file.isFile())throw new CliError('invalid_workspace','The workspace state must be a real directory and file.');
 let value:WorkspaceMarker;try{value=JSON.parse(bytes.toString());}catch{throw new CliError('invalid_workspace','Invalid workspace marker.');}
 if(value?.format!==1||typeof value.id!=='string'||! /^[a-f0-9-]{36}$/.test(value.id))throw new CliError('invalid_workspace','Unsupported workspace marker.');
 return value;
}
export async function findLocalWorkspace(cwd:string):Promise<string|null>{
 for(let root=await realpath(cwd);;root=dirname(root)){
  if(basename(root)==='.artifactbin')return null;
  if(await marker(root))return root;
  if(dirname(root)===root)return null;
 }
}
export async function localWorkspaceState(root:string):Promise<State>{
 root=await realpath(root);
 if(!await marker(root)){
  await privateDirectory(join(root,'.artifactbin'));
  try{await atomicWrite(markerPath(root),JSON.stringify({format:1,id:randomUUID()} satisfies WorkspaceMarker)+'\n',{exclusive:true});}
  catch(error){if((error as NodeJS.ErrnoException).code!=='EEXIST')throw error;await marker(root);}
 }
 return stateFor(root,workspaceStateEnv(root));
}
export async function readLocalWorkspaceState(root:string):Promise<State|null>{
 return await marker(root)?readState(root,workspaceStateEnv(root)):null;
}
const localLockOwners=new AsyncLocalStorage<ReadonlySet<string>>();
export async function withLocalLock<T>(root:string,run:()=>Promise<T>):Promise<T>{
 root=await realpath(root);await localWorkspaceState(root);
 if(localLockOwners.getStore()?.has(root))return run();
 const owned=new Set(localLockOwners.getStore());owned.add(root);
 return withLock(root,LOCAL_WORKSPACE_SCOPE,()=>localLockOwners.run(owned,run),{reentrant:false},workspaceStateEnv(root));
}
/** Same checksummed, recoverable journal as connected editing, with a location-independent scope. */
export async function stageLocalFiles(root:string,changes:FileChange[],also?:(store:State)=>void):Promise<void>{
 return stageFiles(root,root,changes,also,{store:await localWorkspaceState(root),scope:LOCAL_WORKSPACE_SCOPE});
}
export async function recoverLocalFiles(root:string):Promise<'clean'|'recovered'>{
 await recoverLocalMove(root);
 return recoverFiles(root,root,{store:await localWorkspaceState(root),scope:LOCAL_WORKSPACE_SCOPE});
}
export async function localReferenceMap(root:string):Promise<Record<string,string>>{
 const store=await readLocalWorkspaceState(root);if(!store)return {};
 const ids=new Set<string>();const result:Record<string,string>={};
 for(const row of store.list<{id:string}>(LOCAL_WORKSPACE_SCOPE,'draft-identity')){
  if(!ARTIFACT_ID_PATTERN.test(row.value?.id)||ids.has(row.value.id))throw new CliError('invalid_workspace','Invalid or duplicate local identity.');
  await confinedPath(root,row.key);
  ids.add(row.value.id);result[row.value.id]=row.key;
 }
 return result;
}
/** Registering is local and idempotent; no server reservation or account binding. */
export async function registerLocalFiles(workspace:Workspace,inputs:string[],options:{intent?:'automatic'|'explicit'}={}):Promise<Record<string,string>>{
 return withLocalLock(workspace.root,async()=>{
  const {root}=workspace;await recoverLocalFiles(root);
  const known=await localReferenceMap(root),byPath=new Map(Object.entries(known).map(([id,path])=>[path,id]));
  const assigned:Record<string,string>={},trusted=new Map<string,boolean>(),changes:FileChange[]=[];
  for(const input of [...new Set(inputs)]){
   const full=await confinedPath(root,resolve(workspace.cwd,input)),path=relative(root,full).split(sep).join('/');
   if(path.split('/').includes('.artifactbin'))throw new CliError('invalid_path','Workspace state cannot be registered as document content.');
   const bytes=await readFile(full),extension=extname(path).toLowerCase();
   const document=extension==='.jsx'?parseDocument(bytes.toString()):undefined;
   const resource=['.yaml','.yml'].includes(extension)?parseResourceFile(bytes.toString()):undefined;
   if(!document&&!resource)assetInput(path,bytes);
   const metadata=document?.metadata??resource;
   let id=metadata?.id??byPath.get(path);
   if(id&&byPath.has(path)&&id!==byPath.get(path))throw new CliError('identity_mismatch',`Identity changed in ${path}.`);
   if(id&&known[id]&&known[id]!==path&&await readOptional(await confinedPath(root,known[id]!)))throw new CliError('duplicate_identity',`Both ${known[id]} and ${path} claim ${id}.`);
   if(!id){do{id=randomBytes(9).toString('base64').replace(/[^A-Za-z0-9]/g,'').slice(0,6);}while(id.length!==6||known[id]);}
   known[id]=path;byPath.set(path,id);assigned[path]=id;
   trusted.set(path,!metadata?.id||options.intent!=='automatic'||(await localWorkspaceState(root)).get<{trusted?:boolean}>(LOCAL_WORKSPACE_SCOPE,'draft-identity',path)?.value.trusted===true);
   if(document&&!document.metadata.id)changes.push({path,before:digest(bytes),data:Buffer.from(writeDocument({...document,metadata:{...document.metadata,id}}))});
   if(resource&&!resource.id)changes.push({path,before:digest(bytes),data:Buffer.from(writeResourceFile({...resource,id}))});
  }
  await stageLocalFiles(root,changes,state=>{
   if(workspace.tracking){
    state.put(LOCAL_WORKSPACE_SCOPE,'workspace',LOCAL_WORKSPACE_SCOPE,{server:workspace.tracking.server,account:workspace.tracking.account});
    for(const [path,tracked] of Object.entries(workspace.tracking.files))state.put(LOCAL_WORKSPACE_SCOPE,'tracked',path,tracked);
   }
   for(const [path,id] of Object.entries(assigned)){
    for(const row of state.list<{id:string}>(LOCAL_WORKSPACE_SCOPE,'draft-identity'))if(row.value.id===id&&row.key!==path)state.delete(LOCAL_WORKSPACE_SCOPE,'draft-identity',row.key);
    state.put(LOCAL_WORKSPACE_SCOPE,'draft-identity',path,{id,trusted:trusted.get(path)});
   }
  });
  await recoverLocalFiles(root);return assigned;
 });
}
/** One-time migration copies local discussion; tokens and account-wide state never enter a workspace. */
export async function migrateLocalDiscussion(root:string,home:string,portable:State):Promise<void>{
 if(portable.get(LOCAL_WORKSPACE_SCOPE,'archive','migration/discussion'))return;
 const legacy=await readState(home);if(!legacy||legacy.path===portable.path)return;
 const kinds=['preview-thread','preview-thread-request','preview-comment'] as const;
 portable.transaction(()=>{for(const kind of kinds)for(const row of legacy.list(root,kind))if(!portable.get(LOCAL_WORKSPACE_SCOPE,kind,row.key))portable.put(LOCAL_WORKSPACE_SCOPE,kind,row.key,row.value);portable.put(LOCAL_WORKSPACE_SCOPE,'archive','migration/discussion',{done:true});});
}
/** Local saves retain the previous bytes in the workspace's recovery history. */
export async function saveLocalFile(root:string,path:string,before:string,data:Buffer):Promise<void>{
 await withLocalLock(root,async()=>{
  await recoverLocalFiles(root);const current=await readFile(await confinedPath(root,path));
  if(digest(current)!==before)throw new CliError('stale_save','File changed; draft retained.');
  await stageLocalFiles(root,[{path,before,data}],state=>recordLocalHistory(state,path,current,data));
  await recoverLocalFiles(root);
 });
}

interface LocalMove {from:string;to:string;id:string;hash:string;trusted?:boolean}
async function recoverLocalMove(root:string):Promise<void>{
 const store=await localWorkspaceState(root),pending=store.get<LocalMove>(LOCAL_WORKSPACE_SCOPE,'identity-move','current')?.value;if(!pending)return;
 assertLocalHistoryMove(store,pending.from,pending.to);
 const from=await confinedPath(root,pending.from),to=await confinedPath(root,pending.to);
 const source=await readOptional(from),destination=await readOptional(to);
 if(!source&&!destination)throw new CliError('missing_file','Move source and destination are missing.');
 if(source&&digest(source)!==pending.hash||destination&&digest(destination)!==pending.hash)throw new CliError('move_conflict','File changed during move; both paths were retained.');
 if(source){
  if(destination){const [a,b]=await Promise.all([lstat(from),lstat(to)]);if(a.ino!==b.ino||a.dev!==b.dev)throw new CliError('move_conflict','Move destination already exists.');}
  else await link(from,to);
  await unlink(from);
 }
 store.transaction(()=>{
  moveLocalHistory(store,pending.from,pending.to);
  const baseline=store.get(LOCAL_WORKSPACE_SCOPE,'archive','import-baseline/'+pending.from);if(baseline){store.put(LOCAL_WORKSPACE_SCOPE,'archive','import-baseline/'+pending.to,baseline.value,{data:baseline.data});store.delete(LOCAL_WORKSPACE_SCOPE,'archive','import-baseline/'+pending.from);}
  store.delete(LOCAL_WORKSPACE_SCOPE,'draft-identity',pending.from);store.put(LOCAL_WORKSPACE_SCOPE,'draft-identity',pending.to,{id:pending.id,trusted:pending.trusted});
  const tracked=store.get(LOCAL_WORKSPACE_SCOPE,'tracked',pending.from);if(tracked){store.delete(LOCAL_WORKSPACE_SCOPE,'tracked',pending.from);store.put(LOCAL_WORKSPACE_SCOPE,'tracked',pending.to,tracked.value);}
  for(const kind of ['preview-comment','preview-thread'] as const)for(const row of store.list<{file:string}>(LOCAL_WORKSPACE_SCOPE,kind))if(row.value.file===pending.from)store.put(LOCAL_WORKSPACE_SCOPE,kind,row.key,{...row.value,file:pending.to});
  store.delete(LOCAL_WORKSPACE_SCOPE,'identity-move','current');
 });
}
export async function moveLocalFile(workspace:Workspace,from:string,to:string):Promise<void>{
 await withLocalLock(workspace.root,async()=>{
  const root=workspace.root;await recoverLocalFiles(root);const store=await localWorkspaceState(root);
  from=relative(root,await confinedPath(root,resolve(workspace.cwd,from))).split(sep).join('/');
  to=relative(root,await confinedPath(root,resolve(workspace.cwd,to))).split(sep).join('/');
  if(from===to)return;
  if(to.split('/').includes('.artifactbin'))throw new CliError('invalid_path','Cannot move document content into workspace state.');
  const identity=store.get<{id:string;trusted?:boolean}>(LOCAL_WORKSPACE_SCOPE,'draft-identity',from)?.value,id=identity?.id;
  if(!id)throw new CliError('unregistered_file','Register the source before moving it.');
  if(await readOptional(await confinedPath(root,to)))throw new CliError('file_exists','Move destination already exists.');
  const bytes=await readFile(await confinedPath(root,from));
  assertLocalHistoryMove(store,from,to);
  if(store.get(LOCAL_WORKSPACE_SCOPE,'archive','import-baseline/'+to))throw new CliError('move_conflict','The destination has another imported baseline. Choose a new path.');
  store.put(LOCAL_WORKSPACE_SCOPE,'identity-move','current',{from,to,id,hash:digest(bytes),trusted:identity?.trusted} satisfies LocalMove);await recoverLocalMove(root);
 });
}
