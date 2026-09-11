import {randomUUID} from 'node:crypto';
import {join} from 'node:path';
import {unlink} from 'node:fs/promises';
import {MUTATION_REPLY_TIMEOUT_MS} from '@artifactbin/contracts';
import {CliError,type ParsedCommand} from './commands';
import {queryParameters} from './local-query';
import {artifactReference} from './read-commands';
import {atomicWrite,digest,privateDirectory,readOptional,syncDirectory} from './files';
import {withProcessLock} from './process-lock';
import {readPendingRequest} from './pending-request';
import type {Workspace,Snapshot} from './workspace';
import type {HttpClient} from './http';
interface SavedMutation {version:1;key:string;server:string;account:string;intent:string;body:Record<string,unknown>;path:string;checksum:string;response?:Record<string,unknown>}
const checksum=(value:Omit<SavedMutation,'checksum'>)=>digest(JSON.stringify(value));

/** One frozen domain operation survives a transport failure. No credential is stored in the workspace. */
export async function queryMutation(workspace:Workspace,parsed:ParsedCommand,sql:string|undefined,client:HttpClient){
 if(!sql?.trim())throw new CliError('invalid_query','A dataset mutation requires SQL supplied with --input.');
 const ref=await artifactReference(workspace,parsed.positionals[0],client.connection.server,true);
 const values=queryParameters(parsed.flags.param as string[]|undefined);
 const intent=digest(JSON.stringify({id:ref.id,sql,values}));
 return withProcessLock(workspace.root,async()=>{
  if(await readPendingRequest(workspace.root))throw new CliError('pending_recovery','Finish the pending publication with afbin push before changing dataset rows.');
  const directory=join(workspace.root,'.artifactbin'),path=join(directory,'pending-operation.json');
  const raw=await readOptional(path);let saved:SavedMutation;
  if(raw){
   try{saved=JSON.parse(raw.toString());}catch{throw new CliError('invalid_journal','The pending operation is not valid JSON.');}
   const {checksum:claimed,...value}=saved;
   if(saved.version!==1||claimed!==checksum(value)||!saved.account||!saved.key)throw new CliError('invalid_journal','The pending operation checksum is invalid.');
   if(saved.path!==`/artifacts/${ref.id}/mutate`||digest(JSON.stringify({id:ref.id,sql:saved.body?.sql,values:saved.body?.values}))!==saved.intent||typeof saved.body.expectedState!=='string'||!/^[a-f0-9]{64}$/.test(saved.body.expectedState))throw new CliError('invalid_journal','The saved request does not match its declared mutation intent.');
   if(saved.intent!==intent||saved.server!==client.connection.server)throw new CliError('pending_recovery','A different operation is still pending.','Restore its original SQL and arguments, then repeat the same command to recover it.');
   if(client.account&&client.account!==saved.account)throw new CliError('account_mismatch','The pending mutation belongs to another account.');
   client.account=saved.account;
  }else{
   const head=await client.request<Snapshot>(`/artifacts/${ref.id}`);
   if(head.format!=='dataset')throw new CliError('invalid_query','SQL input requires one dataset.');
   if(!(head.capabilities as {mutation_receipts?:boolean}|undefined)?.mutation_receipts)throw new CliError('unsupported_server','This server does not support recoverable dataset mutations.');
   if(!client.account)throw new CliError('unsupported_server','The server did not return the mutation account identity.');
   const value={version:1 as const,key:randomUUID(),server:client.connection.server,account:client.account,intent,path:`/artifacts/${ref.id}/mutate`,body:{sql,values,expectedState:head.state}};
   saved={...value,checksum:checksum(value)};await privateDirectory(directory);await atomicWrite(path,JSON.stringify(saved),{exclusive:true});
  }
  if(!saved.response){
   let response:Record<string,unknown>;
   try{response=await client.request(saved.path,'POST',saved.body,{'Idempotency-Key':saved.key},{timeoutMs:MUTATION_REPLY_TIMEOUT_MS});}
   catch(error){
    if(error instanceof CliError&&(error.details as {mutation_receipt?:unknown}|undefined)?.mutation_receipt===saved.key){
     const archive=join(directory,'completed-operations');await privateDirectory(archive);
     await atomicWrite(join(archive,`${saved.key}.json`),JSON.stringify({pending:saved,refusal:error.details}));
     await unlink(path);await syncDirectory(directory);
    }
    throw error;
   }
   const {checksum:_prior,...value}=saved;const next={...value,response};saved={...next,checksum:checksum(next)};await atomicWrite(path,JSON.stringify(saved));
  }
  // Archive the confirmed receipt before removing pending state.
  const archive=join(directory,'completed-operations');await privateDirectory(archive);
  await atomicWrite(join(archive,`${saved.key}.json`),JSON.stringify(saved));
  await unlink(path);await syncDirectory(directory);
  return {...saved.response,operation:saved.key};
 });
}
