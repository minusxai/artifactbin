import {randomUUID} from 'node:crypto';
import {unlink} from 'node:fs/promises';
import {join} from 'node:path';
import {MUTATION_REPLY_TIMEOUT_MS} from '@artifactbin/contracts';
import {CliError} from './errors';
import {atomicWrite,digest,privateDirectory,readOptional,syncDirectory} from './files';
import {withProcessLock} from './process-lock';
import {readPendingRequest} from './pending-request';
import type {Workspace} from './workspace';
import type {HttpClient} from './http';
interface Operation {version:3;identity:unknown;context?:unknown;key:string;server:string;account:string|null;intent:string;method:string;path:string;body:unknown;checksum:string;response?:Record<string,unknown>}
const checksum=(value:Omit<Operation,'checksum'>)=>digest(JSON.stringify(value));

/** One journal coordinates native mutations without exposing transport details to callers. */
export async function recoverableOperation(workspace:Workspace,client:HttpClient,operation:{path:string;method:string;body:unknown;identity?:unknown;prepare:()=>Promise<void|{body:unknown;context?:unknown}>;finalize?:(response:Record<string,unknown>,context:unknown)=>Promise<void>}):Promise<Record<string,unknown>&{operation:string}>{
 const identity=operation.identity??operation.body;const intent=digest(JSON.stringify([operation.method,operation.path,identity]));
 return withProcessLock(workspace.root,async()=>{
  if(await readPendingRequest(workspace.root))throw new CliError('pending_recovery','Finish the pending publication before starting another mutation.','Run afbin push to recover it.');
  const directory=join(workspace.root,'.artifactbin'),path=join(directory,'pending-operation.json');const bytes=await readOptional(path);let saved:Operation;
  if(bytes){
   try{saved=JSON.parse(bytes.toString());}catch{throw new CliError('invalid_journal','The pending operation cannot be read.');}
   const {checksum:claimed,...value}=saved;
   if(saved.version!==3)throw new CliError('pending_recovery','A different operation is pending.','Repeat its original command to recover it.');
   if(claimed!==checksum(value)||!saved.key||saved.intent!==digest(JSON.stringify([saved.method,saved.path,saved.identity])))throw new CliError('invalid_journal','The pending operation checksum or intent is invalid.');
   if(saved.intent!==intent||saved.server!==client.connection.server)throw new CliError('pending_recovery','A different operation is pending.','Repeat its original command and inputs to recover it.');
   if(saved.account&&client.account&&client.account!==saved.account)throw new CliError('account_mismatch','The pending operation belongs to another account.');
   if(saved.account)client.account=saved.account;
  }else{
   // The account is bound from the first confirmed response when no earlier read named it.
   const prepared=await operation.prepare();
   const value={version:3 as const,identity,...(prepared?.context!==undefined?{context:prepared.context}:{}),key:randomUUID(),server:client.connection.server,account:client.account??null,intent,method:operation.method,path:operation.path,body:prepared?prepared.body:operation.body};
   saved={...value,checksum:checksum(value)};await privateDirectory(directory);await atomicWrite(path,JSON.stringify(saved),{exclusive:true});
  }
  const archive=async(value:unknown)=>{const target=join(directory,'completed-operations');await privateDirectory(target);await atomicWrite(join(target,`${saved.key}.json`),JSON.stringify(value));await unlink(path);await syncDirectory(directory);};
  if(!saved.response){
   let response:Record<string,unknown>;
   try{response=await client.request(saved.path,saved.method,saved.body,{'Idempotency-Key':saved.key},{timeoutMs:MUTATION_REPLY_TIMEOUT_MS});}
   catch(error){if(error instanceof CliError&&(error.details as {mutation_receipt?:unknown}|undefined)?.mutation_receipt===saved.key)await archive({pending:saved,refusal:error.details});throw error;}
   const {checksum:_old,...value}=saved;const next={...value,response,account:value.account??client.account??null};saved={...next,checksum:checksum(next)};await atomicWrite(path,JSON.stringify(saved));
  }
  await operation.finalize?.(saved.response!,saved.context);
  await archive(saved);return {...saved.response,operation:saved.key};
 });
}
