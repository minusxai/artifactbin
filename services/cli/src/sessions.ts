import {stringify} from 'yaml';
import {parseAccountResource} from '@artifactbin/utils/account-resource';
import type {SessionResource} from '@artifactbin/contracts';
import {CliError} from './errors';
import {recoverableOperation} from './recoverable-operation';
import {pendingOperation} from './restore';
import type {Workspace} from './workspace';
import type {HttpClient} from './http';

/**
 * Remote sessions as a read-only resource kind. A session is relayed state, not
 * an editable document: it is listed, pulled as YAML, and terminated. Nothing
 * here holds session bytes or credentials — the runner key never leaves the
 * machine that created it.
 */
const SESSION_ID=/^[A-Za-z0-9_-]{1,128}$/;

export function sessionIdentity(value:string):string{
 if(!SESSION_ID.test(value))throw new CliError('invalid_session','Use a session id from afbin list --type session.');
 return value;
}

/**
 * The shared account-resource vocabulary validates every session field except
 * the id, whose contract pattern (`tok_`) matches no id the relay mints. See
 * the contract request in .agent/REPORT.md; the id is checked here meanwhile.
 */
export function parseSessionResource(input:unknown):SessionResource{
 if(!input||typeof input!=='object'||Array.isArray(input))throw new CliError('invalid_resource','A session resource must be a mapping.');
 let value;try{value=parseAccountResource({...(input as Record<string,unknown>),type:'session'});}catch(error){throw new CliError('invalid_resource',error instanceof Error?error.message:String(error));}
 if(value.type!=='session')throw new CliError('invalid_resource','Expected a session resource.');
 return value;
}

export function writeSessionResource(resource:SessionResource):string{return stringify(resource,{lineWidth:0});}

/** A default destination that cannot collide with another session's file. */
export function sessionFileName(id:string):string{return `session-${id}.yaml`;}

export async function listSessions(client:HttpClient,limit?:number):Promise<{sessions:SessionResource[]}>{
 const response=await client.request<{sessions?:unknown}>('/sessions');
 if(!Array.isArray(response.sessions))throw new CliError('invalid_response','The server did not return a session collection.');
 const sessions=response.sessions.map(parseSessionResource);
 return {sessions:limit===undefined?sessions:sessions.slice(0,limit)};
}

export async function readSession(client:HttpClient,id:string):Promise<SessionResource>{
 const response=await client.request<{session?:unknown}>(`/sessions/${sessionIdentity(id)}`);
 if(response.session===undefined)throw new CliError('invalid_response','The server did not return a session.');
 return parseSessionResource(response.session);
}

/**
 * Terminate once. The pre-read authorizes and identifies the account before the
 * durable record is written, so an interrupted terminate is resumed under the
 * same operation identity rather than removing a replacement session.
 */
export async function terminateSession(workspace:Workspace,client:HttpClient,input:string):Promise<Record<string,unknown>>{
 const id=sessionIdentity(input);
 // A terminated session is a tombstone, so the pre-read only runs when there is
 // no journalled operation to resume; repeating it would answer 410 and strand
 // the very retry the record exists to finish.
 const session=await pendingOperation(workspace)?undefined:await readSession(client,id);
 const result=await recoverableOperation(workspace,client,{
  path:`/sessions/${id}`,method:'DELETE',body:undefined,identity:{type:'session',id},prepare:async()=>{},
 });
 return {id,...(session?{name:session.name??null}:{}),status:'terminated',operation:result.operation};
}
