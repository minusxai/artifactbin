import {randomUUID} from 'node:crypto';
import {digest,readOptional} from './files';
import {confinedPath} from './journal';
import {stateFor} from './state-access';
import {normalizeServer} from './config';
import {CliError} from './commands';
import type {TrackedFile} from './workspace';
import type {ResourceSource} from './resource-file';
export interface RequestIntent {
 server:string;account?:string;credential:string;
 request:{path:string;method:string;body:Record<string,unknown>};
 file:{source?:ResourceSource;path:string;bytes:string;tracked?:TrackedFile;paths?:Record<string,string>;renamedFrom?:string};
}
export interface PendingRequest extends RequestIntent {version:1;key:string;checksum:string;response?:Record<string,unknown>;responseAccount?:string;responseChecksum?:string}
const CURRENT='current';
const checksum=(intent:RequestIntent)=>digest(JSON.stringify({server:intent.server,account:intent.account,credential:intent.credential,request:intent.request,file:intent.file}));
export async function stageRequest(home:string,root:string,intent:RequestIntent):Promise<PendingRequest>{
 await confinedPath(root,intent.file.path);normalizeServer(intent.server);
 const pending:PendingRequest=JSON.parse(JSON.stringify({...intent,version:1,key:randomUUID(),checksum:checksum(intent)}));
 const state=await stateFor(home);
 if(!state.put(root,'pending-request',CURRENT,pending,{exclusive:true}))throw new CliError('pending_recovery','A pending request must be recovered before another write.');
 return pending;
}
export async function readPendingRequest(home:string,root:string):Promise<PendingRequest|null>{
 const record=(await stateFor(home)).get<PendingRequest>(root,'pending-request',CURRENT);if(!record)return null;
 const value=record.value;
 if(value?.version!==1||typeof value.key!=='string'||!/^[A-Za-z0-9_-]{16,128}$/.test(value.key)||!value.file||typeof value.file.path!=='string'||typeof value.file.bytes!=='string'||!value.request||typeof value.request.path!=='string'||typeof value.request.method!=='string')throw new CliError('invalid_journal','The pending request record is invalid.');
 if(checksum(value)!==value.checksum||Buffer.from(value.file.bytes,'base64').toString('base64')!==value.file.bytes)throw new CliError('invalid_journal','Pending request checksum mismatch.');
 if(value.response!==undefined&&value.responseChecksum!==digest(JSON.stringify({response:value.response,account:value.responseAccount})))throw new CliError('invalid_journal','Pending response checksum mismatch.');
 await confinedPath(root,value.file.path);normalizeServer(value.server);return value;
}
export async function savePendingResponse(home:string,root:string,pending:PendingRequest,response:Record<string,unknown>,account?:string):Promise<PendingRequest>{
 const saved={...pending,response,responseAccount:account,responseChecksum:digest(JSON.stringify({response,account}))};
 (await stateFor(home)).put(root,'pending-request',CURRENT,saved);return saved;
}
export async function clearPendingRequest(home:string,root:string):Promise<void>{
 (await stateFor(home)).delete(root,'pending-request',CURRENT);
}

/** A forced pull preserves both the frozen operation and the later working file. */
export async function archivePendingRequest(home:string,root:string,pending:PendingRequest,local:Buffer|null):Promise<string>{
 const key=`recovered-requests/${pending.key}`;
 const state=await stateFor(home);
 const value={pending,local:local?.toString('base64')??null};
 if(!state.put(root,'archive',key,value,{exclusive:true})){
  const existing=state.get(root,'archive',key);
  if(JSON.stringify(existing?.value)!==JSON.stringify(value))throw new CliError('invalid_journal','The recovery archive already contains a different proposal.','Keep both the pending request and the existing archive; move the archive aside before retrying forced pull.');
 }
 return key;
}

interface RetiredCreate {id:string;path:string;server:string;key:string}
export async function retireDeletedCreate(home:string,root:string,pending:PendingRequest,id:string):Promise<void>{
 if(!/^[A-Za-z0-9]{6,12}$/.test(id))throw new CliError('invalid_response','Deleted creation recovery did not identify its artifact.');
 await archivePendingRequest(home,root,pending,await readOptional(await confinedPath(root,pending.file.path)));
 const record:RetiredCreate={id,path:pending.file.path,server:pending.server,key:pending.key};
 const state=await stateFor(home);
 state.transaction(()=>{state.put(root,'retired-create',pending.file.path,record);state.delete(root,'pending-request',CURRENT);});
}
export async function checkRetiredCreate(home:string,root:string,path:string,id?:string):Promise<void>{
 const record=(await stateFor(home)).get<RetiredCreate>(root,'retired-create',path);if(!record)return;
 const value=record.value;
 if(value?.path!==path||!/^[A-Za-z0-9]{6,12}$/.test(value.id))throw new CliError('invalid_journal','Deleted creation recovery is invalid.');
 if(id)return; // An explicit fence or tracked identity makes this an update, never a create.
 throw new CliError('result_deleted',`The original creation of ${path} (${value.id}) was deleted.`,`Restore that artifact and run afbin pull ${value.id} --output ${path}, or publish a new file to create a different artifact.`,{id:value.id,pending_key:value.key});
}
