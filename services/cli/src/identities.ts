/** Shared registration and resolution. One account pool; workspace paths own identities independently of published baselines. */
import {randomUUID} from 'node:crypto';
import {readFile,link,unlink,lstat} from 'node:fs/promises';
import {resolve,relative,extname} from 'node:path';
import {ARTIFACT_ID_PATTERN} from '@artifactbin/contracts';
import type {Workspace} from './workspace';
import {loadWorkspace} from './workspace';
import type {HttpClient} from './http';
import {HOME_SCOPE,withLock} from './state';
import {stateFor,readState} from './state-access';
import {confinedPath,recoverFiles,stageFiles,type FileChange} from './journal';
import {parseDocument,writeDocument} from './document';
import {readOptional,digest} from './files';
import {parseResourceFile,writeResourceFile} from './resource-file';
import {assetInput} from './upload-input';
interface Pool {ids:string[];pending?:string}
interface Move {from:string;to:string;id:string;hash:string}
export async function addFiles(workspace:Workspace,paths:string[],client:HttpClient):Promise<Record<string,string>>{
 if(!paths.length)return {};
 const {home,root}=workspace;
 return withLock(home,HOME_SCOPE,()=>withLock(home,root,async()=>{
  await recoverFiles(home,root);await recoverMove(workspace);
  workspace=await loadWorkspace(workspace.cwd,home);
  if(workspace.tracking&&!client.sameServer(workspace.tracking.server))throw Error('Wrong server for workspace');
  if(!client.account)await client.request('/artifacts?limit=1');
  const account=client.account;if(!account||account==='anonymous')throw Error('Account required');
  if(workspace.tracking&&workspace.tracking.account!==account)throw Error('Wrong account for workspace');
  const state=await stateFor(home),poolKey=JSON.stringify([client.connection.server,account]);
  let pool=state.get<Pool>(HOME_SCOPE,'identity-pool',poolKey)?.value??{ids:[]};
  const mappings=new Map(state.list<{id:string}>(root,'draft-identity').map(row=>[row.key,row.value.id]));
  for(const [path,tracked] of Object.entries(workspace.tracking?.files??{}))mappings.set(path,tracked.id);
  const assigned:Record<string,string>={},changes:FileChange[]=[],removed:string[]=[];
  for(const input of [...new Set(paths)]){
   const full=await confinedPath(root,resolve(workspace.cwd,input)),path=relative(root,full);
   const bytes=await readFile(full),document=extname(path).toLowerCase()==='.jsx'?parseDocument(bytes.toString()):undefined;
   const resource=['.yaml','.yml'].includes(extname(path).toLowerCase())?parseResourceFile(bytes.toString()):undefined;
   if(!document&&!resource)assetInput(path,bytes);
   const metadata=document?.metadata??resource;
   let id=mappings.get(path);
   if(metadata?.id){
    if(id&&id!==metadata!.id)throw Error('Identity mismatch');
    id=metadata!.id;
    const existing=[...mappings].find(([,known])=>known===id);
    if(!existing){
     if(!metadata?.head_version)throw Error('Unknown identity: pull published files or register an unassigned draft');
    }
    if(existing&&existing[0]!==path){
     if(await readOptional(await confinedPath(root,existing[0])))throw Error('Duplicate identity');
     removed.push(existing[0]);mappings.delete(existing[0]);
    }
   }
   if(!id){
    if(!pool.ids.length){
     pool={ids:[],pending:pool.pending??randomUUID()};state.put(HOME_SCOPE,'identity-pool',poolKey,pool);
     const batch=await client.request<{ids:string[]}>('/artifacts/reservations','POST',undefined,{'Idempotency-Key':pool.pending!});
     if(batch.ids.length!==100||new Set(batch.ids).size!==100||batch.ids.some(id=>!ARTIFACT_ID_PATTERN.test(id)))throw Error('Invalid reservation batch');
     pool={ids:[...pool.ids,...batch.ids]};state.put(HOME_SCOPE,'identity-pool',poolKey,pool);
    }
    id=pool.ids.shift()!;
   }
   mappings.set(path,id);assigned[path]=id;
   if(document&&!document.metadata.id)changes.push({path,before:digest(bytes),data:Buffer.from(writeDocument({...document,metadata:{...document.metadata,id}}))});
   if(resource&&!resource.id)changes.push({path,before:digest(bytes),data:Buffer.from(writeResourceFile({...resource,id}))});
  }
  await stageFiles(home,root,changes,store=>{
   store.put(root,'workspace',root,{server:client.connection.server,account});
   store.put(HOME_SCOPE,'identity-pool',poolKey,pool);
   for(const path of removed)store.delete(root,'draft-identity',path);
   for(const [path,id] of Object.entries(assigned))store.put(root,'draft-identity',path,{id});
  });
  await recoverFiles(home,root);
  if(pool.ids.length<=20){
   pool={...pool,pending:pool.pending??randomUUID()};state.put(HOME_SCOPE,'identity-pool',poolKey,pool);
   try{
    const batch=await client.request<{ids:string[]}>('/artifacts/reservations','POST',undefined,{'Idempotency-Key':pool.pending!},{timeoutMs:2000});
    if(batch.ids.length!==100||new Set(batch.ids).size!==100||batch.ids.some(id=>!ARTIFACT_ID_PATTERN.test(id)))throw Error('Invalid reservation batch');
    pool={ids:[...pool.ids,...batch.ids]};state.put(HOME_SCOPE,'identity-pool',poolKey,pool);
   }catch{/* A durable pending key retries the same refill; cached identities remain usable. */}
  }
  return assigned;
 }));
}
export async function localIdentities(workspace:Workspace):Promise<Record<string,string>>{
 const state=await readState(workspace.home);
 return Object.fromEntries([...Object.entries(workspace.tracking?.files??{}).map(([path,value])=>[value.id,path]),...(state?.list<{id:string}>(workspace.root,'draft-identity').map(row=>[row.value.id,row.key])??[])]);
}
/** Hard-link then unlink gives no-overwrite moves; the journal repairs a crash between the steps. */
async function recoverMove(workspace:Workspace):Promise<void>{
 const {root,home}=workspace,state=await stateFor(home),move=state.get<Move>(root,'identity-move','current')?.value;if(!move)return;
 const from=await confinedPath(root,move.from),to=await confinedPath(root,move.to);
 let a;try{a=await lstat(from);}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
 let b;try{b=await lstat(to);}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
 if(a){
  if(b&&(a.ino!==b.ino||a.dev!==b.dev))throw Error('Move destination already exists');
  if(!b)await link(from,to);
  await unlink(from);
 }else if(!b)throw Error('Move source and destination are missing');
 if(digest(await readFile(to))!==move.hash)throw Error('Move content changed during recovery');
 state.transaction(()=>{const tracked=state.get(root,'tracked',move.from);if(tracked){state.delete(root,'tracked',move.from);state.put(root,'tracked',move.to,tracked.value);}
  state.delete(root,'draft-identity',move.from);state.put(root,'draft-identity',move.to,{id:move.id});state.delete(root,'identity-move','current');});
}
export async function moveFile(workspace:Workspace,from:string,to:string):Promise<void>{
 await withLock(workspace.home,workspace.root,async()=>{
  await recoverMove(workspace);
  const state=await stateFor(workspace.home),root=workspace.root;
  from=relative(root,await confinedPath(root,resolve(workspace.cwd,from)));to=relative(root,await confinedPath(root,resolve(workspace.cwd,to)));
  const identity=state.get<{id:string}>(root,'draft-identity',from)?.value??state.get<{id:string}>(root,'tracked',from)?.value;if(!identity)throw Error('Source is not registered');
  if(from===to)return;
  if(await readOptional(await confinedPath(root,to)))throw Error('Move destination already exists');
  state.put(root,'identity-move','current',{from,to,id:identity.id,hash:digest(await readFile(await confinedPath(root,from)))});await recoverMove(workspace);
 });
}
