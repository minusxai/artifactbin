/** Explicit local account transition. A portable intent rolls all pins forward;
 * no remote write, permission grant, ownership transfer or implicit fork. */
import {readdir} from 'node:fs/promises';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {CliError} from './errors';
import {atomicWrite,digest,readOptional} from './files';
import {confinedPath} from './journal';
import {withPrivateStateHome} from './config';
import {stateFor,readState} from './state-access';
import {HOME_SCOPE,withLock,type State,type StateKind} from './state';
import {loadWorkspace,type Workspace} from './workspace';
import {localWorkspaceState,readLocalWorkspaceState,withLocalLock,LOCAL_WORKSPACE_SCOPE} from './local-workspace';
import {parseDocument} from './document';
import {parseResourceFile} from './resource-file';
import {extname} from 'node:path';
import type {PublicationManifest} from './publication-binding';
import type {HttpClient} from './http';
interface Copy {directory:string;home:string;manifestPath:string;manifest:PublicationManifest}
interface Transition {id:string;root:string;server:string;previous:string|null;account:string;copies:Copy[]}
const transitionKey='workspace-rebind/current';
const blockedKinds:StateKind[]=['pending-request','pending-operation','staged-file','identity-move'];
export async function publicationCopies(workspace:Workspace,client?:HttpClient):Promise<Copy[]>{
 const directory=join(workspace.root,'.artifactbin','publications');let names:string[];
 try{names=await readdir(directory);}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return [];throw error;}
 const copies:Copy[]=[];
 for(const name of names.sort()){
  const path=await confinedPath(workspace.root,join(directory,name,'manifest.json')),bytes=await readOptional(path);if(!bytes)continue;
  const manifest=JSON.parse(bytes.toString()) as PublicationManifest;
  if(manifest.format!==1||typeof manifest.account!=='string'||typeof manifest.server!=='string')throw new CliError('invalid_journal','Invalid publication manifest.');
  if(client&&!client.sameServer(manifest.server))continue;
  copies.push({directory:join(directory,name),home:join(directory,name,'private'),manifestPath:path,manifest});
 }
 return copies;
}
function assertIdle(store:State|null,scope:string):void{
 if(store?.list(scope,'archive').some(row=>row.key.startsWith('publication-finalize/')||row.key==='tracking-to-home/current'))throw new CliError('pending_recovery','A local tracking finalization is pending.','Finish the original push or pull before rebinding.',undefined,3);
 for(const kind of blockedKinds)if(store?.list(scope,kind).length)throw new CliError('pending_recovery',`Cannot rebind: ${kind} is pending in ${store.path} (${scope}).`,'Recover the original operation with its original account first.',{store:store.path,scope,kind},3);
 if(store?.list<{pending?:string}>(HOME_SCOPE,'identity-pool').some(row=>!!row.value.pending))throw new CliError('pending_recovery','An identity reservation is still pending.','Recover the original registration before rebinding.',undefined,3);
}
function archiveOwned(store:State,scope:string,intent:Transition,portable=false):void{
 store.transaction(()=>{
  for(const kind of ['account','identity-pool','retired-create','conflict'] as StateKind[]){
   const selectedScope=kind==='identity-pool'?HOME_SCOPE:scope;
   for(const row of store.list(selectedScope,kind)){
    // Pools already use (origin,account) namespaces; preserve other owners.
    if(kind==='identity-pool'&&row.key!==JSON.stringify([intent.server,intent.previous]))continue;
    store.put(scope,'archive',`rebind/${intent.id}/${kind}/${row.key}`,row.value,{data:row.data});store.delete(selectedScope,kind,row.key);
   }
  }
  store.put(scope,'workspace',scope,{server:intent.server,account:intent.account});
  if(portable)store.put(scope,'archive',`rebind/${intent.id}/ownership`,{previous:intent.previous,current:intent.account});
 });
}
async function replay(workspace:Workspace,intent:Transition,portable:State,onProgress?:(phase:string)=>void):Promise<void>{
 for(const copy of intent.copies){
  await withPrivateStateHome(copy.home,join(copy.home,'.artifactbin'),async()=>{
   const store=await readState(copy.home);
   if(store)store.transaction(()=>{
    for(const kind of ['workspace','tracked','draft-identity','retired-create','conflict','identity-pool'] as StateKind[]){
     const scope=kind==='identity-pool'?HOME_SCOPE:copy.manifest.root;
     for(const row of store.list(scope,kind)){store.put(copy.manifest.root,'archive',`rebind/${intent.id}/${kind}/${row.key}`,row.value,{data:row.data});store.delete(scope,kind,row.key);}
    }
    for(const row of store.list(copy.manifest.root,'archive').filter(row=>row.key.startsWith('local-comments/'))){store.put(copy.manifest.root,'archive',`rebind/${intent.id}/${row.key}`,row.value,{data:row.data});store.delete(copy.manifest.root,'archive',row.key);}
   });
  });
  for(const [path,input] of Object.entries(copy.manifest.inputs)){
   const remote=input.localId&&copy.manifest.ids[input.localId];if(!remote)continue;
   const bytes=Buffer.from(input.bytes,'base64').toString(),extension=extname(path).toLowerCase();
   const identity=extension==='.jsx'?parseDocument(bytes).metadata:['.yaml','.yml'].includes(extension)?parseResourceFile(bytes):undefined;
   if(identity?.edit_id||workspace.tracking?.files[path]?.id===remote||portable.get(LOCAL_WORKSPACE_SCOPE,'archive','import-baseline/'+path))continue;
   portable.put(LOCAL_WORKSPACE_SCOPE,'archive','rebind-target/'+digest(intent.server).slice(0,24)+'/'+path,{server:intent.server,account:copy.manifest.account,target:remote,localId:input.localId});
  }
  await atomicWrite(join(copy.directory,`manifest-rebind-${intent.id}.json`),JSON.stringify(copy.manifest)+'\n');
  await atomicWrite(copy.manifestPath,JSON.stringify({...copy.manifest,account:intent.account,inputs:{},ids:{}})+'\n');
  onProgress?.('publication');
 }
 archiveOwned(await stateFor(workspace.home),workspace.root,intent);onProgress?.('home');
 archiveOwned(portable,LOCAL_WORKSPACE_SCOPE,intent,true);onProgress?.('portable');
 portable.transaction(()=>{portable.put(LOCAL_WORKSPACE_SCOPE,'archive',`rebind/${intent.id}/complete`,intent);portable.delete(LOCAL_WORKSPACE_SCOPE,'archive',transitionKey);});
}
async function withCopyLocks<T>(copies:Copy[],index:number,run:()=>Promise<T>):Promise<T>{
 const copy=copies[index];return copy?withPrivateStateHome(copy.home,join(copy.home,'.artifactbin'),()=>withLock(copy.home,copy.directory,()=>withCopyLocks(copies,index+1,run))):run();
}
export async function rebindWorkspace(workspace:Workspace,client:HttpClient,options:{dryRun?:boolean;onProgress?:(phase:string)=>void}={}):Promise<Record<string,unknown>>{
 const run=async()=>{
  workspace=await loadWorkspace(workspace.cwd,workspace.home);
  if(workspace.tracking&&!client.sameServer(workspace.tracking.server))throw new CliError('wrong_server',`Workspace rebind keeps its original server ${workspace.tracking.server}; selected ${client.connection.server}.`,'Select the original server. Account rebind does not migrate origins.');
  const portable=await readLocalWorkspaceState(workspace.root),saved=portable?.get<Transition>(LOCAL_WORKSPACE_SCOPE,'archive',transitionKey)?.value;
  const copies=saved?await Promise.all(saved.copies.map(async copy=>{
   const name=copy.directory.split(/[\\/]/).at(-1);if(!name||! /^[a-f0-9]{24}$/.test(name))throw new CliError('invalid_journal','Invalid saved publication path.');
   const directory=await confinedPath(workspace.root,join('.artifactbin','publications',name));
   return{...copy,directory,home:join(directory,'private'),manifestPath:join(directory,'manifest.json')};
  })):await publicationCopies(workspace,client);
  const inspect=async()=>{
   const home=await readState(workspace.home);assertIdle(home,workspace.root);assertIdle(portable,LOCAL_WORKSPACE_SCOPE);
   for(const copy of copies)await withPrivateStateHome(copy.home,join(copy.home,'.artifactbin'),async()=>assertIdle(await readState(copy.home),copy.manifest.root));
   const previous=saved?.previous??workspace.tracking?.account??copies[0]?.manifest.account??null;
   const oldPin=client.account;client.account=undefined;
   try{await client.request('/artifacts?limit=1');}catch(error){client.account=oldPin;throw error;}
   const account=client.account;if(!account||account==='anonymous')throw new CliError('account_required','Rebind requires an authenticated account.');
   if(saved&&saved.account!==account)throw new CliError('pending_recovery','The interrupted rebind belongs to different credentials.','Select the account that started it, then retry.',undefined,3);
   if(!saved&&previous){
    client.account=previous;
    try{await client.request('/artifacts?limit=1');return{status:'compatible_account',server:client.connection.server,account,workspace_account:previous,mappings_preserved:true,...(options.dryRun?{dry_run:true}:{})};}
    catch(error){if(!(error instanceof CliError)||!['workspace_account_mismatch','account_mismatch'].includes(error.code))throw error;}
    finally{client.account=account;}
   }
   const intent=saved?{...saved,root:workspace.root,copies}:{id:randomUUID(),root:workspace.root,server:client.connection.server,previous,account,copies};
   if(options.dryRun)return{dry_run:true,status:'would_rebind',server:intent.server,previous_account:previous,account,publication_copies:copies.length};
   const store=portable??await localWorkspaceState(workspace.root);
   if(!saved)store.put(LOCAL_WORKSPACE_SCOPE,'archive',transitionKey,intent);options.onProgress?.('intent');
   await replay(workspace,intent,store,options.onProgress);
   return{status:'rebound',server:intent.server,previous_account:previous,account,remote_ownership_changed:false};
  };
  return options.dryRun?inspect():withCopyLocks(copies,0,inspect);
 };
 if(options.dryRun)return run();
 return withLocalLock(workspace.root,()=>withLock(workspace.home,workspace.root,()=>withLock(workspace.home,HOME_SCOPE,run)));
}
