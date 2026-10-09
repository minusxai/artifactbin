import {accountMismatch} from './account-diagnostic';
import {randomUUID} from 'node:crypto';
import {AGENT_HEADER,MUTATION_REPLY_TIMEOUT_MS} from '@artifactbin/contracts';
import {CliError} from './errors';
import {digest} from './files';
import {withLock} from './state';
import {readState,stateFor} from './state-access';
import {readPendingRequest} from './pending-request';
import type {Workspace} from './workspace';
import type {HttpClient} from './http';
export interface Operation {version:3;identity:unknown;context?:unknown;agent?:string;key:string;server:string;account:string|null;intent:string;method:string;path:string;body:unknown;checksum:string;response?:Record<string,unknown>}
const CURRENT='current';
const checksum=(value:Omit<Operation,'checksum'>)=>digest(JSON.stringify(value));

/** One record coordinates native mutations without exposing transport details to callers. */
export async function recoverableOperation(workspace:Workspace,client:HttpClient,operation:{path:string;method:string;body:unknown;identity?:unknown;agent?:string;prepare:()=>Promise<void|{body:unknown;context?:unknown}>;finalize?:(response:Record<string,unknown>,context:unknown)=>Promise<void>}):Promise<Record<string,unknown>&{operation:string}>{
 const identity=operation.identity??(operation.agent?{body:operation.body,agent:operation.agent}:operation.body);const intent=digest(JSON.stringify([operation.method,operation.path,identity]));
 const state=await stateFor(workspace.home);
 return withLock(workspace.home,workspace.root,async()=>{
  if(await readPendingRequest(workspace.home,workspace.root))throw new CliError('pending_recovery','Finish the pending publication before starting another mutation.','Run afbin push to recover it.');
  const record=state.get<Operation>(workspace.root,'pending-operation',CURRENT);let saved:Operation;
  if(record){
   saved=record.value;
   const {checksum:claimed,...value}=saved;
   if(saved.version!==3)throw new CliError('pending_recovery','A different operation is pending.','Repeat its original command to recover it.');
   if(claimed!==checksum(value)||!saved.key||saved.intent!==digest(JSON.stringify([saved.method,saved.path,saved.identity])))throw new CliError('invalid_journal','The pending operation checksum or intent is invalid.');
   if(saved.intent!==intent||saved.server!==client.connection.server)throw new CliError('pending_recovery','A different operation is pending.','Repeat its original command and inputs to recover it.');
   if(saved.account&&client.account&&client.account!==saved.account)throw accountMismatch(saved.account,client.account,client.connection.server,workspace,{},true);
   if(saved.account)client.account=saved.account;
  }else{
   // The account is bound from the first confirmed response when no earlier read named it.
   const prepared=await operation.prepare();
   const value={version:3 as const,identity,...(operation.agent?{agent:operation.agent}:{}),...(prepared?.context!==undefined?{context:prepared.context}:{}),key:randomUUID(),server:client.connection.server,account:client.account??null,intent,method:operation.method,path:operation.path,body:prepared?prepared.body:operation.body};
   saved={...value,checksum:checksum(value)};
   if(!state.put(workspace.root,'pending-operation',CURRENT,saved,{exclusive:true}))throw new CliError('pending_recovery','A different operation is pending.','Repeat its original command and inputs to recover it.');
  }
  const archive=(value:unknown)=>state.transaction(()=>{state.put(workspace.root,'archive',`completed-operations/${saved.key}`,value);state.delete(workspace.root,'pending-operation',CURRENT);});
  if(!saved.response){
   let response:Record<string,unknown>;
   try{response=await client.request(saved.path,saved.method,saved.body,{...(saved.agent?{[AGENT_HEADER]:saved.agent}:{}),'Idempotency-Key':saved.key},{timeoutMs:MUTATION_REPLY_TIMEOUT_MS});}
   catch(error){
    const details=error instanceof CliError?error.details as {mutation_receipt?:unknown;admission_refused?:unknown;http_status?:unknown}|undefined:undefined;
    // A scope refusal precedes durable admission, so there is no mutation receipt.
    // Only the explicit definitive refusal may release this local intent; uncertain
    // transport/server failures retain the same recovery identity.
    if(details?.mutation_receipt===saved.key||details?.admission_refused===true&&details.http_status===403)archive({pending:saved,refusal:error instanceof CliError?error.details:undefined});
    throw error;
   }
   const {checksum:_old,...value}=saved;const next={...value,response,account:value.account??client.account??null};saved={...next,checksum:checksum(next)};state.put(workspace.root,'pending-operation',CURRENT,saved);
  }
  await operation.finalize?.(saved.response!,saved.context);
  archive(saved);return {...saved.response,operation:saved.key};
 });
}

/**
 * Is a durable operation already journalled here? Every pre-read is skipped
 * while one is, because the state a pre-read inspects is exactly the state the
 * pending operation has already changed.
 */
export async function pendingOperation(workspace:Workspace):Promise<Operation|null>{
 return (await readState(workspace.home))?.get<Operation>(workspace.root,'pending-operation',CURRENT)?.value??null;
}
