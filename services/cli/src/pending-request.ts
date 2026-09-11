import {randomUUID} from 'node:crypto';
import {join} from 'node:path';
import {unlink} from 'node:fs/promises';
import {atomicWrite,digest,isMissing,privateDirectory,readOptional,syncDirectory} from './files';
import {confinedPath} from './journal';
import {normalizeServer} from './config';
import {CliError} from './commands';
import type {TrackedFile} from './workspace';
export interface RequestIntent {
 server:string;account?:string;credential:string;
 request:{path:string;method:string;body:Record<string,unknown>};
 file:{path:string;bytes:string;tracked?:TrackedFile;paths?:Record<string,string>;renamedFrom?:string};
}
export interface PendingRequest extends RequestIntent {version:1;key:string;checksum:string;response?:Record<string,unknown>;responseAccount?:string;responseChecksum?:string}
const fileOf=(root:string)=>join(root,'.artifactbin','pending-request.json');
const checksum=(intent:RequestIntent)=>digest(JSON.stringify({server:intent.server,account:intent.account,credential:intent.credential,request:intent.request,file:intent.file}));
export async function stageRequest(root:string,intent:RequestIntent):Promise<PendingRequest>{
 await confinedPath(root,intent.file.path);normalizeServer(intent.server);
 const pending:PendingRequest=JSON.parse(JSON.stringify({...intent,version:1,key:randomUUID(),checksum:checksum(intent)}));
 await privateDirectory(join(root,'.artifactbin'));
 try{await atomicWrite(fileOf(root),JSON.stringify(pending),{exclusive:true});}
 catch(error){if((error as NodeJS.ErrnoException).code==='EEXIST')throw new CliError('pending_recovery','A pending request must be recovered before another write.');throw error;}
 return pending;
}
export async function readPendingRequest(root:string):Promise<PendingRequest|null>{
 const raw=await readOptional(fileOf(root));if(!raw)return null;
 const value=JSON.parse(raw.toString()) as PendingRequest;
 if(value?.version!==1||typeof value.key!=='string'||!/^[A-Za-z0-9_-]{16,128}$/.test(value.key)||!value.file||typeof value.file.path!=='string'||typeof value.file.bytes!=='string'||!value.request||typeof value.request.path!=='string'||typeof value.request.method!=='string')throw new CliError('invalid_journal','The pending request journal is invalid.');
 if(checksum(value)!==value.checksum||Buffer.from(value.file.bytes,'base64').toString('base64')!==value.file.bytes)throw new CliError('invalid_journal','Pending request checksum mismatch.');
 if(value.response!==undefined&&value.responseChecksum!==digest(JSON.stringify({response:value.response,account:value.responseAccount})))throw new CliError('invalid_journal','Pending response checksum mismatch.');
 await confinedPath(root,value.file.path);normalizeServer(value.server);return value;
}
export async function savePendingResponse(root:string,pending:PendingRequest,response:Record<string,unknown>,account?:string):Promise<PendingRequest>{
 const saved={...pending,response,responseAccount:account,responseChecksum:digest(JSON.stringify({response,account}))};
 await atomicWrite(fileOf(root),JSON.stringify(saved));return saved;
}
export async function clearPendingRequest(root:string):Promise<void>{
 try{await unlink(fileOf(root));await syncDirectory(join(root,'.artifactbin'));}catch(error){if(!isMissing(error))throw error;}
}

/** A forced pull preserves both the frozen operation and the later working file. */
export async function archivePendingRequest(root:string,pending:PendingRequest,local:Buffer|null):Promise<string>{
 const directory=join(root,'.artifactbin','recovered-requests');await privateDirectory(directory);
 const path=join(directory,`${pending.key}.json`);
 try{await atomicWrite(path,JSON.stringify({pending,local:local?.toString('base64')??null}),{exclusive:true});}
 catch(error){if((error as NodeJS.ErrnoException).code!=='EEXIST')throw error;const existing=await readOptional(path);if(existing?.toString()!==JSON.stringify({pending,local:local?.toString('base64')??null}))throw new CliError('invalid_journal','The recovery archive already contains a different proposal.','Keep both the pending request and the existing archive; move the archive aside before retrying forced pull.');}
 return path;
}

interface RetiredCreate {id:string;path:string;server:string;key:string}
const retiredFile=(root:string,path:string)=>join(root,'.artifactbin','retired-creates',`${digest(path)}.json`);
export async function retireDeletedCreate(root:string,pending:PendingRequest,id:string):Promise<void>{
 if(!/^[A-Za-z0-9]{6,12}$/.test(id))throw new CliError('invalid_response','Deleted creation recovery did not identify its artifact.');
 await archivePendingRequest(root,pending,await readOptional(await confinedPath(root,pending.file.path)));
 await privateDirectory(join(root,'.artifactbin','retired-creates'));
 const record:RetiredCreate={id,path:pending.file.path,server:pending.server,key:pending.key};
 await atomicWrite(retiredFile(root,pending.file.path),JSON.stringify(record));
 await clearPendingRequest(root);
}
export async function checkRetiredCreate(root:string,path:string,id?:string):Promise<void>{
 const raw=await readOptional(retiredFile(root,path));if(!raw)return;
 let record:RetiredCreate;try{record=JSON.parse(raw.toString());}catch{throw new CliError('invalid_journal','Deleted creation recovery is invalid.');}
 if(record.path!==path||!/^[A-Za-z0-9]{6,12}$/.test(record.id))throw new CliError('invalid_journal','Deleted creation recovery is invalid.');
 if(id)return; // An explicit fence or tracked identity makes this an update, never a create.
 throw new CliError('result_deleted',`The original creation of ${path} (${record.id}) was deleted.`,`Restore that artifact and run afbin pull ${record.id} ${path}, or publish a new file to create a different artifact.`,{id:record.id,pending_key:record.key});
}
