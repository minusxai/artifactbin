/** Durable notification jobs. Authored SQL never runs inside this repository. */
import {createHash} from 'node:crypto';
import {NOTIFICATION_QUERY_LIMITS} from '@artifactbin/contracts';
import type {MutationInitiator,MutationNotificationClaim,MutationNotificationJobInput,MutationNotificationJobStore,MutationNotificationJobView,MutationNotificationPlan,Queryable} from '@artifactbin/contracts';
import type {Db} from './db';
import {envelope} from './events';
import {NotificationExecutionError} from './notification-error';
import {lockMutationNotificationAuthority} from './mutation-notifications';
import {notificationChannel} from './notifications';

export interface NotificationJobAuthority {
 validatePlan(tx:Queryable,input:MutationNotificationJobInput,plan:MutationNotificationPlan):Promise<void>;
 admitRecipients(tx:Queryable,input:MutationNotificationJobInput,plan:MutationNotificationPlan,ids:string[]):Promise<string[]>;
 canManage(tx:Queryable,principal:MutationInitiator['principal'],documentId:string):Promise<boolean>;
}
export interface NotificationJobStoreOptions {db:Db;authority:NotificationJobAuthority;clock?:()=>Date}
interface JobRow {id:string;input:MutationNotificationJobInput;generation:number;lease_until:string;status:string;attempts:number;error_code:string|null;next_attempt_at:string|null}
const LEASE_MS=60_000;
const MAX_ATTEMPTS=5;
const BATCH=100;
const identity=(...parts:(string|number)[])=>createHash('sha256').update(JSON.stringify(parts)).digest('hex');
const view=(row:JobRow):MutationNotificationJobView=>({id:row.id,mutation_run_id:row.input.origin.mutationRunId,notification_name:row.input.origin.ruleId,status:row.status as MutationNotificationJobView['status'],attempts:row.attempts,error_code:row.error_code,next_attempt_at:row.next_attempt_at});
const SAFE_CODES=new Set(['notification_capacity','notification_output_invalid','notification_query_invalid','notification_query_timeout','notification_context_unsupported','notification_context_invalid','notification_bindings_invalid','notification_access_revoked','notification_schema_changed','notification_authority_changed','notification_execution_failed','notification_retry_exhausted']);

/** Snapshot retention is intrinsic: each durable input contains its frozen compilation context. */
export function createNotificationJobStore({db,authority,clock}:NotificationJobStoreOptions):MutationNotificationJobStore {
 const time=()=>clock?.().toISOString()??null;
 const current=async(tx:Queryable)=>String((await tx.query<{at:string}>('SELECT coalesce($1::timestamptz,clock_timestamp()) AS at',[time()])).rows[0]!.at);
 const locked=async(tx:Queryable,claim:MutationNotificationClaim)=>{
  const row=(await tx.query<JobRow>("SELECT * FROM notification_jobs WHERE id=$1 AND generation=$2 AND status='running' AND lease_until>coalesce($3::timestamptz,clock_timestamp()) FOR UPDATE",[claim.jobId,claim.generation,time()])).rows[0];
  return row??null;
 };
 const authorized=async(tx:Queryable,principal:MutationInitiator['principal'],row:JobRow)=>{
  if(principal.kind!=='user'&&principal.kind!=='token')return false;
  const alive=principal.kind==='user'
   ?await tx.query('SELECT id FROM users WHERE id=$1 AND merged_into_user_id IS NULL AND (expires_at IS NULL OR expires_at>coalesce($2::timestamptz,clock_timestamp()))',[principal.id,time()])
   :await tx.query('SELECT id FROM tokens WHERE id=$1 AND deleted_at IS NULL AND (expires_at IS NULL OR expires_at>coalesce($2::timestamptz,clock_timestamp()))',[principal.id,time()]);
  if(!alive.rows.length)return false;
  const original=row.input.initiator.principal;
  return (original.kind===principal.kind&&'id' in original&&original.id===principal.id)||authority.canManage(tx,principal,row.input.origin.documentId);
 };
 return {
  async enqueue(tx,inputs){
   for(const input of inputs){
    if(input.origin.ruleId!==input.rule.name||input.origin.mutationName!==input.rule.on||!input.contextSnapshot)throw new NotificationExecutionError('notification_context_invalid');
    await tx.query('INSERT INTO notification_jobs(id,mutation_run_id,rule_id,document_id,input) VALUES($1,$2,$3,$4,$5::jsonb) ON CONFLICT(mutation_run_id,rule_id) DO NOTHING',[identity(input.origin.mutationRunId,input.origin.ruleId),input.origin.mutationRunId,input.origin.ruleId,input.origin.documentId,JSON.stringify(input)]);
   }
  },
  async claim(){
   return db.transaction(async tx=>{
    const at=await current(tx);
    // Expired leases count as attempts too: a repeatedly crashing query cannot spin forever.
    await tx.query("UPDATE notification_jobs SET status='failed',error_code='notification_retry_exhausted',lease_until=NULL,next_attempt_at=NULL WHERE attempts >= $1 AND ((status='running' AND lease_until<=$2::timestamptz) OR status='retrying')",[MAX_ATTEMPTS,at]);
    const row=(await tx.query<JobRow>(`UPDATE notification_jobs SET status='running',generation=generation+1,attempts=attempts+1,lease_until=$2::timestamptz,next_attempt_at=NULL
      WHERE id=(SELECT id FROM notification_jobs WHERE (status IN ('pending','retrying') AND (next_attempt_at IS NULL OR next_attempt_at<=$1::timestamptz)) OR (status='running' AND lease_until<=$1::timestamptz) ORDER BY created_at,id FOR UPDATE SKIP LOCKED LIMIT 1) RETURNING *`,[at,new Date(Date.parse(at)+LEASE_MS).toISOString()])).rows[0];
    return row?{jobId:row.id,generation:row.generation,leaseUntil:row.lease_until,input:row.input}:null;
   });
  },
  async renew(claim){
   const result=await db.query("UPDATE notification_jobs SET lease_until=coalesce($3::timestamptz,clock_timestamp())+interval '60 seconds' WHERE id=$1 AND generation=$2 AND status='running' AND lease_until>coalesce($3::timestamptz,clock_timestamp()) RETURNING id",[claim.jobId,claim.generation,time()]);return result.rows.length===1;
  },
  async complete(claim,plan){
   return db.transaction(async tx=>{
    // ACL writers do not share one row lock (new shares/blocks have no existing row).
    // Short SHARE locks close that phantom-read race on PostgreSQL as well as PGLite.
    // Stable ordering and no prior artifact row locks avoid lock upgrade deadlocks.
    await lockMutationNotificationAuthority(tx);
    const job=await locked(tx,claim);if(!job)return false;
    validatePlanBounds(plan);
    await authority.validatePlan(tx,job.input,plan);
    const ids=[...new Set(plan.rows.flatMap(row=>row.recipientIds))];
    const eligible=await admitAccounts(tx,job.input,ids,time());
    const admitted=new Set(await authority.admitRecipients(tx,job.input,plan,eligible));
    const rows=plan.rows.flatMap((row,ordinal)=>[...new Set(row.recipientIds)].filter(id=>admitted.has(id)&&eligible.includes(id)).map(recipient=>({id:identity(job.id,ordinal,recipient),job_id:job.id,output_ordinal:ordinal,recipient_id:recipient,artifact_id:job.input.origin.documentId,initiator:job.input.initiator,message:row.message,sources:plan.sources})));
    for(let start=0;start<rows.length;start+=BATCH){
     const batch=rows.slice(start,start+BATCH);
     await tx.query(`INSERT INTO mutation_notifications(id,job_id,output_ordinal,recipient_id,artifact_id,initiator,message,sources)
       SELECT id,job_id,output_ordinal,recipient_id,artifact_id,initiator,message,sources FROM jsonb_to_recordset($1::jsonb) AS x(id text,job_id text,output_ordinal int,recipient_id text,artifact_id text,initiator jsonb,message text,sources jsonb)`,[JSON.stringify(batch)]);
     const events=batch.map(row=>envelope({kind:'user',id:row.recipient_id},'notification_changed',{kind:'user',id:row.recipient_id},{notification_id:row.id,revision:1,change:'updated'}));
     await tx.query('INSERT INTO event_outbox(id,envelope) SELECT value->>\'id\',value FROM jsonb_array_elements($1::jsonb)',[JSON.stringify(events)]);
    }
    // A transaction that exceeded its lease cannot publish even if no replacement claimed yet.
    const done=await tx.query("UPDATE notification_jobs SET status='completed',plan=$3::jsonb,completed_at=coalesce($4::timestamptz,clock_timestamp()),lease_until=NULL,error_code=NULL WHERE id=$1 AND generation=$2 AND status='running' AND lease_until>coalesce($4::timestamptz,clock_timestamp()) RETURNING id",[job.id,job.generation,JSON.stringify({...plan,rows:plan.rows.map(row=>({...row,recipientIds:[...new Set(row.recipientIds)].filter(id=>admitted.has(id)&&eligible.includes(id))}))}),time()]);
    if(!done.rows.length)throw new NotificationExecutionError('lease_lost');
    for(const recipient of new Set(rows.map(row=>row.recipient_id)))await tx.query('SELECT pg_notify($1,$2)',[notificationChannel(recipient),job.id]);
    return true;
   }).catch(error=>{if(error instanceof NotificationExecutionError&&error.code==='lease_lost')return false;throw error;});
  },
  async fail(claim,code,retryable){return db.transaction(async tx=>{
   const job=await locked(tx,claim);if(!job)return false;
   const retry=retryable&&job.attempts<MAX_ATTEMPTS;
   const at=await current(tx),next=retry?new Date(Date.parse(at)+Math.min(60_000,1000*2**(job.attempts-1))).toISOString():null;
   const changed=await tx.query("UPDATE notification_jobs SET status=$3,error_code=$4,next_attempt_at=$5::timestamptz,lease_until=NULL WHERE id=$1 AND generation=$2 AND status='running' AND lease_until>coalesce($6::timestamptz,clock_timestamp()) RETURNING id",[job.id,job.generation,retry?'retrying':'failed',SAFE_CODES.has(code)?code:'notification_execution_failed',next,time()]);return changed.rows.length===1;
  });},
  async list(principal,run){return db.transaction(async tx=>{const rows=(await tx.query<JobRow>('SELECT * FROM notification_jobs WHERE mutation_run_id=$1 ORDER BY rule_id',[run])).rows;const result:MutationNotificationJobView[]=[];for(const row of rows)if(await authorized(tx,principal,row))result.push(view(row));return result;});},
  async status(principal,id){return db.transaction(async tx=>{const row=(await tx.query<JobRow>('SELECT * FROM notification_jobs WHERE id=$1',[id])).rows[0];return row&&await authorized(tx,principal,row)?view(row):null;});},
  async retry(principal,id){return db.transaction(async tx=>{const row=(await tx.query<JobRow>("SELECT * FROM notification_jobs WHERE id=$1 AND status='failed' FOR UPDATE",[id])).rows[0];if(!row||!await authorized(tx,principal,row))return false;await tx.query("UPDATE notification_jobs SET status='pending',generation=generation+1,attempts=0,error_code=NULL,next_attempt_at=NULL,lease_until=NULL,retry_requested_by=$2::jsonb WHERE id=$1",[id,JSON.stringify(principal)]);return true;});},
 };
}

function validatePlanBounds(plan:MutationNotificationPlan):void {
 const limits=NOTIFICATION_QUERY_LIMITS;
 if(plan.rows.length>limits.rows||Buffer.byteLength(JSON.stringify(plan))>limits.resultBytes)throw new NotificationExecutionError('notification_capacity');
 let recipients=0;
 for(const row of plan.rows){
  if(typeof row.message!=='string'||!row.message.trim()||[...row.message].length>limits.messageCodePoints||!Array.isArray(row.recipientIds)||row.recipientIds.some(id=>typeof id!=='string'||!id))throw new NotificationExecutionError('notification_output_invalid');
  const count=new Set(row.recipientIds).size;recipients+=count;
  if(count>limits.recipientsPerRow||recipients>limits.recipients)throw new NotificationExecutionError('notification_capacity');
 }
}
async function admitAccounts(tx:Queryable,input:MutationNotificationJobInput,ids:string[],at:string|null):Promise<string[]>{
 let sender:string|null=null;
 if(input.initiator.principal.kind==='user')sender=input.initiator.principal.id;
 else if(input.initiator.principal.kind==='token')sender=(await tx.query<{user_id:string|null}>('SELECT user_id FROM tokens WHERE id=$1',[input.initiator.principal.id])).rows[0]?.user_id??null;
 const senderKind=sender?(await tx.query<{kind:string}>('SELECT kind FROM users WHERE id=$1',[sender])).rows[0]?.kind:null;
 const users=(await tx.query<{id:string}>(`SELECT u.id FROM users u WHERE u.id=ANY($1::text[]) AND u.merged_into_user_id IS NULL AND (u.expires_at IS NULL OR u.expires_at>coalesce($2::timestamptz,clock_timestamp()))
   AND ($3::text IS DISTINCT FROM 'testuser' OR u.kind='testuser') AND NOT ($4::boolean AND u.id=$5::text)
   AND NOT EXISTS(SELECT 1 FROM user_blocks b WHERE (b.user_id=u.id AND b.blocked_user_id=$5) OR (b.user_id=$5 AND b.blocked_user_id=u.id))`,[ids,at,senderKind,input.initiator.execution==='human',sender])).rows;
 return users.map(user=>user.id);
}
