import {join} from 'node:path';
import {CliError} from './errors';
import {readOptional} from './files';
import {artifactReference} from './read-commands';
import {recoverableOperation} from './recoverable-operation';
import type {Workspace} from './workspace';
import type {HttpClient} from './http';

/**
 * `push --restore` and `push --refresh`: the two remote-only pushes. Both
 * require explicit targets — no reference never means "every deleted thing" or
 * "every asset" — and both report each target on its own, because one refusal
 * says nothing about the next target's outcome.
 */
interface Outcome {operations:Array<Record<string,unknown>>}

/** One target at a time, keeping what already committed when a later one fails. */
async function eachTarget(refs:string[],run:(ref:string)=>Promise<Record<string,unknown>>):Promise<Outcome>{
 const operations:Array<Record<string,unknown>>=[];
 for(const ref of refs){
  try{operations.push(await run(ref));}
  catch(error){
   if(error instanceof CliError&&operations.length)throw new CliError(error.code,error.message,error.fix,{...(error.details&&typeof error.details==='object'&&!Array.isArray(error.details)?error.details:{}),completed_operations:operations},error.exitCode);
   throw error;
  }
 }
 return {operations};
}

/**
 * Is a durable operation already journalled here? Every pre-read in this
 * workstream is skipped while one is, because the state a pre-read inspects is
 * exactly the state the pending operation has already changed: after a delete
 * the row is invisible to the live read gate, and after a terminate the session
 * is a tombstone. Re-reading on the resume path would refuse the retry the
 * journal exists to complete, and strand it forever.
 */
export const pendingOperation=(workspace:Workspace)=>readOptional(join(workspace.root,'.artifactbin','pending-operation.json'));
const missing=(error:unknown)=>error instanceof CliError&&(error.details as {http_status?:number}|undefined)?.http_status===404;

/**
 * The pre-read separates the two answers a restore route cannot: a live row and
 * a row that never existed both refuse with the same 404, so reading the row
 * first is the only way to report "already restored" as the success it is. A
 * row in the trash is invisible to that read, which is the case that proceeds.
 */
export async function pushRestore(workspace:Workspace,refs:string[],client:HttpClient):Promise<Outcome>{
 return eachTarget(refs,async ref=>{
  const target=await artifactReference(workspace,ref,client.connection.server,true);
  if(!await pendingOperation(workspace)){
   const head=await client.request<Record<string,unknown>>(`/artifacts/${target.id}`).catch(error=>{if(missing(error))return null;throw error;});
   if(head){
    if(head.deleted_at===null||head.deleted_at===undefined)return {id:target.id,status:'already_restored'};
    if((head.capabilities as {restore?:boolean}|undefined)?.restore===false)throw new CliError('not_permitted',`Only the owner can restore ${target.id}.`,'Ask the owner to restore it.');
   }
  }
  const result=await recoverableOperation(workspace,client,{path:`/artifacts/${target.id}/restore`,method:'POST',body:{},identity:{type:'restore',id:target.id},prepare:async()=>{}});
  return {...result,id:target.id,status:'restored'};
 });
}

/**
 * Refresh re-fetches a document's imported external assets. The server reports
 * each url as refreshed, unchanged or failed inside one success, so a rate
 * limit on one picture never hides the picture that did update.
 */
export async function pushRefresh(workspace:Workspace,refs:string[],client:HttpClient):Promise<Outcome>{
 return eachTarget(refs,async ref=>{
  const target=await artifactReference(workspace,ref,client.connection.server,true);
  const result=await recoverableOperation(workspace,client,{path:'/artifacts/assets/refresh',method:'POST',body:{id:target.id},identity:{type:'refresh',id:target.id},prepare:async()=>{}});
  const failed=Array.isArray(result.failed)?result.failed:[];
  const refreshed=Array.isArray(result.refreshed)?result.refreshed:[];
  return {...result,id:target.id,status:failed.length?refreshed.length?'partial':'failed':refreshed.length?'refreshed':'unchanged'};
 });
}
