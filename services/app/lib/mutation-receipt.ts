import {createHash} from 'node:crypto';
import type {Queryable} from '@artifactbin/contracts';
import {MUTATION_REPLY_TIMEOUT_MS} from '@artifactbin/contracts';
import type {TokenActor} from './artifacts';
import {getDb} from './db';

export interface MutationReply {status:number;body:Record<string,unknown>}
export interface MutationReceipt {scope:string;key:string;fingerprint:string}
const ordered=(value:unknown):unknown=>Array.isArray(value)?value.map(ordered):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,ordered((value as Record<string,unknown>)[key])])):value;
const hash=(value:unknown)=>createHash('sha256').update(JSON.stringify(ordered(value))).digest('hex');

/** The caller authorizes before lookup. A claimed operation never expires into permission to execute again. */
export async function durableMutation(actor:TokenActor,origin:string,key:string,payload:unknown,work:(receipt:MutationReceipt)=>Promise<MutationReply>):Promise<MutationReply>{
 if(!/^[A-Za-z0-9_-]{16,128}$/.test(key))return {status:400,body:{error:'invalid_idempotency_key'}};
 const receipt={scope:hash([new URL(origin).origin,actor.userId??actor.tokenId]),key,fingerprint:hash(payload)};
 const db=await getDb();
 const inserted=await db.query(`INSERT INTO mutation_receipts(scope,operation_key,request_hash) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING RETURNING operation_key`,[receipt.scope,key,receipt.fingerprint]);
 if(!inserted.rows.length){
  const row=(await db.query<{request_hash:string;response:MutationReply|null;created_at:string}>('SELECT request_hash,response,created_at FROM mutation_receipts WHERE scope=$1 AND operation_key=$2',[receipt.scope,key])).rows[0];
  if(!row||row.request_hash!==receipt.fingerprint)return {status:409,body:{error:'idempotency_mismatch'}};
  if(row.response)return row.response;
  const expired=Date.now()-new Date(row.created_at).getTime()>MUTATION_REPLY_TIMEOUT_MS;
  return {status:409,body:{error:expired?'outcome_unknown':'operation_pending',hint:expired?'The operation has no confirmed receipt. Preserve its identity and inspect the dataset; do not submit it under a new identity.':'This operation is already running. Retry the same saved operation to retrieve its receipt.'}};
 }
 const result=await work(receipt);
 // Successful writes also save this response in their content transaction. This completes refusals.
 await completeMutationReceipt(db,receipt,result);
 return result;
}

/** Must share the transaction that commits the dataset pointer; a lost response remains recoverable. */
export async function completeMutationReceipt(db:Queryable,receipt:MutationReceipt,result:MutationReply):Promise<void>{
 await db.query('UPDATE mutation_receipts SET response=$3::jsonb WHERE scope=$1 AND operation_key=$2 AND response IS NULL',[receipt.scope,receipt.key,JSON.stringify(result)]);
}
