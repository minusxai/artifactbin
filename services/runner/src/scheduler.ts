import {CronExpressionParser} from 'cron-parser';
import {createHash,randomUUID} from 'node:crypto';
import type {RunnerService,RunStart,RunSnapshot,ScheduleInput,ScheduleRecord,ScheduleResolver,ScheduleOccurrence,ScheduleAttempt,SchedulerService} from '@artifactbin/contracts';
import type {RunnerDatabase} from './store';
import {initializeSchedules} from './schedule-store';
export type {ScheduleInput} from '@artifactbin/contracts';
export interface TransactionalDatabase extends RunnerDatabase{transaction<T>(fn:(tx:RunnerDatabase)=>Promise<T>):Promise<T>}
interface ScheduleRow{id:string;owner:string;spec:ScheduleInput;next_due_at:Date;active_request:string|null;enabled:boolean;deleted:boolean}
interface AttemptRow{id:string;occurrence_id:string;attempt_number:number;request_id:string;run_id:string|null;status:ScheduleAttempt['status'];next_attempt_at:Date;error:string|null;result:RunSnapshot|null;envelope:RunStart|null;lease_token:string|null;lease_until:Date|null}
interface Claim extends AttemptRow{schedule_id:string;owner:string;spec:ScheduleInput;enabled:boolean;deleted:boolean}
const clock=async(db:RunnerDatabase)=>new Date((await db.query<{now:Date}>('SELECT clock_timestamp() AS now')).rows[0]!.now);
const iso=(value:Date|string)=>new Date(value).toISOString();
const key=(value:string)=>createHash('sha256').update(value).digest('hex');
function nextDue(cron:string,timezone:string,now:Date){if(typeof cron!=='string'||cron.trim().split(/\s+/).length!==5||typeof timezone!=='string'||timezone.length>128||!Number.isFinite(now.getTime()))throw Error('invalid_schedule');try{new Intl.DateTimeFormat('en',{timeZone:timezone}).format(now);return CronExpressionParser.parse(cron,{tz:timezone,currentDate:now}).next().toDate();}catch{throw Error('invalid_schedule')}}
function valid(spec:ScheduleInput,now:Date):ScheduleInput{
 if(!spec||typeof spec.userId!=='string'||!spec.userId||spec.userId.length>256||typeof spec.artifactId!=='string'||!spec.artifactId||spec.artifactId.length>256)throw Error('invalid_schedule');
 const maxAttempts=spec.maxAttempts??1,retryBackoffSeconds=spec.retryBackoffSeconds??60;
 if(!Number.isSafeInteger(maxAttempts)||maxAttempts<1||maxAttempts>10||!Number.isSafeInteger(retryBackoffSeconds)||retryBackoffSeconds<1||retryBackoffSeconds>86400)throw Error('invalid_schedule');
 nextDue(spec.cron,spec.timezone,now);let input;try{const serialized=JSON.stringify(spec.input);if(serialized===undefined||Buffer.byteLength(serialized)>1024*1024)throw Error();input=JSON.parse(serialized);}catch{throw Error('invalid_schedule_input')}
 return {userId:spec.userId,artifactId:spec.artifactId,cron:spec.cron,timezone:spec.timezone,input,maxAttempts,retryBackoffSeconds};
}
const record=(row:ScheduleRow):ScheduleRecord=>({id:row.id,owner:row.owner,artifactId:row.spec.artifactId,cron:row.spec.cron,timezone:row.spec.timezone,input:row.spec.input,enabled:row.enabled,nextDueAt:iso(row.next_due_at),maxAttempts:row.spec.maxAttempts??1,retryBackoffSeconds:row.spec.retryBackoffSeconds??60});
const attempt=(row:AttemptRow):ScheduleAttempt=>({id:row.id,occurrenceId:row.occurrence_id,attemptNumber:row.attempt_number,requestId:row.request_id,runId:row.run_id,status:row.status,nextAttemptAt:iso(row.next_attempt_at),error:row.error,result:row.result});
async function owned(db:RunnerDatabase,userId:string,id:string,includeDeleted=false){const row=(await db.query<ScheduleRow>('SELECT * FROM runner_schedules WHERE id=$1 AND owner=$2'+(includeDeleted?'':' AND deleted=false'),[id,userId])).rows[0];if(!row)throw Error('not_found');return row;}
async function addAttempt(tx:RunnerDatabase,occurrenceId:string,number:number,at:Date){await tx.query('INSERT INTO runner_schedule_attempts(id,occurrence_id,attempt_number,request_id,next_attempt_at) VALUES($1,$2,$3,$4,$5) ON CONFLICT(occurrence_id,attempt_number) DO NOTHING',[randomUUID(),occurrenceId,number,'schedule:'+occurrenceId+':'+number,at]);}
async function cancelPending(tx:RunnerDatabase,scheduleId:string){
 await tx.query("UPDATE runner_schedule_attempts SET status='cancelled',lease_token=NULL,lease_until=NULL WHERE status='pending' AND occurrence_id IN(SELECT request_id FROM runner_schedule_occurrences WHERE schedule_id=$1)",[scheduleId]);
 await tx.query("UPDATE runner_schedule_occurrences o SET status='cancelled' WHERE o.schedule_id=$1 AND o.status IN('pending','active') AND NOT EXISTS(SELECT 1 FROM runner_schedule_attempts a WHERE a.occurrence_id=o.request_id AND a.status='submitted')",[scheduleId]);
 await tx.query("UPDATE runner_schedules SET active_request=NULL WHERE id=$1 AND active_request IN(SELECT request_id FROM runner_schedule_occurrences WHERE status='cancelled')",[scheduleId]);
}
/** Durable, leased attempts fence DB writes; uncertain admission always reuses one persisted envelope. */
export async function createScheduler(db:TransactionalDatabase,runner:RunnerService,resolve:ScheduleResolver):Promise<SchedulerService>{
 if(typeof resolve!=='function')throw Error('schedule_resolver_required');await initializeSchedules(db);
 let ticking=false;
 async function finish(claim:Claim,status:'completed'|'failed',result:RunSnapshot|null,error:string|null,now:Date,retry=true){
  await db.transaction(async tx=>{
   const schedule=(await tx.query<ScheduleRow>('SELECT * FROM runner_schedules WHERE id=$1 FOR UPDATE',[claim.schedule_id])).rows[0]!;
   const rows=(await tx.query<AttemptRow>('SELECT * FROM runner_schedule_attempts WHERE id=$1 AND lease_token=$2 AND lease_until>clock_timestamp() FOR UPDATE',[claim.id,claim.lease_token])).rows;if(!rows.length)return;
   await tx.query('UPDATE runner_schedule_attempts SET status=$2,result=$3,error=$4,lease_token=NULL,lease_until=NULL WHERE id=$1',[claim.id,status,result?JSON.stringify(result):null,error?.slice(0,2048)??null]);
   if(!retry)await tx.query('UPDATE runner_schedules SET enabled=false WHERE id=$1',[schedule.id]);
   if(status==='failed'&&retry&&schedule.enabled&&!schedule.deleted&&claim.attempt_number<(schedule.spec.maxAttempts??1)){
    const delay=Math.min(86400,(schedule.spec.retryBackoffSeconds??60)*2**(claim.attempt_number-1));await addAttempt(tx,claim.occurrence_id,claim.attempt_number+1,new Date(now.getTime()+delay*1000));
    await tx.query("UPDATE runner_schedule_occurrences SET status='active' WHERE request_id=$1",[claim.occurrence_id]);
   }else{await tx.query('UPDATE runner_schedule_occurrences SET status=$2 WHERE request_id=$1',[claim.occurrence_id,status]);await tx.query('UPDATE runner_schedules SET active_request=NULL WHERE id=$1 AND active_request=$2',[schedule.id,claim.occurrence_id]);}
  });
 }
 async function release(claim:Claim,error:string|null=null){await db.query('UPDATE runner_schedule_attempts SET lease_token=NULL,lease_until=NULL,error=$3 WHERE id=$1 AND lease_token=$2',[claim.id,claim.lease_token,error]);}
 async function dispatch(claim:Claim,now:Date){
  const deadline=Date.now()+25000;
  async function external<T>(operation:()=>Promise<T>):Promise<T>{let timer:ReturnType<typeof setTimeout>|undefined;try{return await Promise.race([operation(),new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(Error('dispatch_timeout')),Math.max(1,deadline-Date.now()));})]);}finally{if(timer)clearTimeout(timer)}}
  try{
   if(claim.status==='pending'){
    let execution;try{execution=await external(()=>resolve(claim.spec));}catch(error){await finish(claim,'failed',null,error instanceof Error?error.message:'resolution_failed',now);return;}
    // The trusted app resolves an artifact to either an isolated handler or an owned native program.
    const native=Array.isArray(execution?.command)&&execution.command.length>0&&execution.command.every(arg=>typeof arg==='string'&&arg.length>0)&&execution.program?.source==='';
    if(!execution||execution.artifactId!==claim.spec.artifactId||(!execution.document&&!native)||(execution.document&&execution.command!==undefined)){await finish(claim,'failed',null,'invalid_artifact_execution',now);return;}
    const envelope:RunStart={...execution,userId:claim.owner,requestId:claim.request_id,input:claim.spec.input};
    const encoded=JSON.stringify(envelope);if(Buffer.byteLength(encoded)>16*1024*1024){await finish(claim,'failed',null,'execution_size_limit',now);return;}
    const accepted=await db.transaction(async tx=>{
     const schedule=(await tx.query<ScheduleRow>('SELECT * FROM runner_schedules WHERE id=$1 FOR UPDATE',[claim.schedule_id])).rows[0];if(!schedule?.enabled||schedule.deleted)return false;
     return (await tx.query("UPDATE runner_schedule_attempts SET envelope=$3,status='submitted' WHERE id=$1 AND lease_token=$2 AND lease_until>clock_timestamp() AND status='pending' RETURNING id",[claim.id,claim.lease_token,encoded])).rows.length>0;
    });if(!accepted){await release(claim);return;}claim.envelope=JSON.parse(encoded);claim.status='submitted';
   }
   if(!claim.run_id){
    if(!claim.envelope)throw Error('missing_execution_envelope');
    const envelope=claim.envelope;const admitted=await external(()=>runner.start(envelope));
    const rows=await db.query('UPDATE runner_schedule_attempts SET run_id=$3 WHERE id=$1 AND lease_token=$2 AND lease_until>clock_timestamp() RETURNING id',[claim.id,claim.lease_token,admitted.runId]);if(!rows.rows.length)return;claim.run_id=admitted.runId;
   }
   const runId=claim.run_id;const result=await external(()=>runner.getRun({userId:claim.owner,runId}));
   if(!result.receipt){await release(claim);return;}
   if(result.status==='completed'){await finish(claim,'completed',result,null,now);return;}
   if(['failed','interrupted'].includes(result.status)){await finish(claim,'failed',result,result.receipt.reason??result.status,now);return;}
   if(result.status==='cancelled'){await db.transaction(async tx=>{const updated=await tx.query("UPDATE runner_schedule_attempts SET status='cancelled',result=$3,lease_token=NULL,lease_until=NULL WHERE id=$1 AND lease_token=$2 AND lease_until>clock_timestamp() RETURNING id",[claim.id,claim.lease_token,JSON.stringify(result)]);if(updated.rows.length){await tx.query("UPDATE runner_schedule_occurrences SET status='cancelled' WHERE request_id=$1",[claim.occurrence_id]);await tx.query('UPDATE runner_schedules SET active_request=NULL WHERE id=$1 AND active_request=$2',[claim.schedule_id,claim.occurrence_id]);}});return;}
   await release(claim);
  }catch(error){const reason=(error instanceof Error?error.message:'dispatch_unavailable').slice(0,2048);
   // These contract rejections prove no invocation was admitted. Transport/resource errors do not.
   if(!claim.run_id&&(reason.includes('import_not_allowed')||/^(invalid_|not_executable$|not_found$|source_limit|size_limit|start_conflict$|request_conflict$)/.test(reason)))await finish(claim,'failed',null,reason,now,!['start_conflict','request_conflict'].includes(reason));else await release(claim,reason);
  }
 }
 return {
  async put(raw,now){now??=await clock(db);const spec=valid(raw,now),id=randomUUID();await db.query('INSERT INTO runner_schedules(id,owner,spec,next_due_at) VALUES($1,$2,$3,$4)',[id,spec.userId,JSON.stringify(spec),nextDue(spec.cron,spec.timezone,now)]);return record(await owned(db,spec.userId,id));},
  async get(userId,id){return record(await owned(db,userId,id));},
  async list(userId){return (await db.query<ScheduleRow>('SELECT * FROM runner_schedules WHERE owner=$1 AND deleted=false ORDER BY next_due_at LIMIT 100',[userId])).rows.map(record);},
  async update(userId,id,patch,selected){
   const now=selected??await clock(db);
   if(!patch||typeof patch!=='object'||Array.isArray(patch)||Object.keys(patch).some(key=>!['cron','timezone','input','maxAttempts','retryBackoffSeconds','enabled'].includes(key))||(patch.enabled!==undefined&&typeof patch.enabled!=='boolean'))throw Error('invalid_schedule');
   return db.transaction(async tx=>{await tx.query('SELECT id FROM runner_schedules WHERE id=$1 AND owner=$2 FOR UPDATE',[id,userId]);const row=await owned(tx,userId,id);const spec=valid({...row.spec,...patch,userId,artifactId:row.spec.artifactId},now);const changed=patch.cron!==undefined||patch.timezone!==undefined||(patch.enabled===true&&!row.enabled);await tx.query('UPDATE runner_schedules SET spec=$2,enabled=$3,next_due_at=$4 WHERE id=$1',[id,JSON.stringify(spec),patch.enabled??row.enabled,changed?nextDue(spec.cron,spec.timezone,now):row.next_due_at]);if(patch.enabled===false)await cancelPending(tx,id);return record(await owned(tx,userId,id));});
  },
  async remove(userId,id){await db.transaction(async tx=>{await tx.query('SELECT id FROM runner_schedules WHERE id=$1 AND owner=$2 FOR UPDATE',[id,userId]);await owned(tx,userId,id);await tx.query('UPDATE runner_schedules SET enabled=false,deleted=true WHERE id=$1',[id]);await cancelPending(tx,id);});},
  async runNow(userId,id,requestId,selected){
   const now=selected??await clock(db);
   if(typeof requestId!=='string'||!requestId||requestId.length>256||!Number.isFinite(now.getTime()))throw Error('invalid_request_id');
   const occurrenceId=key(userId+':'+id+':manual:'+requestId);
   return db.transaction(async tx=>{await tx.query('SELECT id FROM runner_schedules WHERE id=$1 AND owner=$2 FOR UPDATE',[id,userId]);const row=await owned(tx,userId,id);if((await tx.query('SELECT request_id FROM runner_schedule_occurrences WHERE request_id=$1 AND schedule_id=$2',[occurrenceId,id])).rows.length)return {occurrenceId};if(!row.enabled)throw Error('schedule_paused');if(row.active_request)throw Error('schedule_busy');const last=(await tx.query<{at:Date|null}>('SELECT MAX(scheduled_at) AS at FROM runner_schedule_occurrences WHERE schedule_id=$1',[id])).rows[0]?.at;const scheduledAt=new Date(Math.max(now.getTime(),last?new Date(last).getTime()+1:0));await tx.query("INSERT INTO runner_schedule_occurrences(request_id,schedule_id,scheduled_at,status) VALUES($1,$2,$3,'active')",[occurrenceId,id,scheduledAt]);await addAttempt(tx,occurrenceId,1,now);await tx.query('UPDATE runner_schedules SET active_request=$2 WHERE id=$1',[id,occurrenceId]);return {occurrenceId};});
  },
  async history(userId,id){await owned(db,userId,id,true);const occurrences=(await db.query<{request_id:string;schedule_id:string;scheduled_at:Date;status:ScheduleOccurrence['status']}>('SELECT * FROM runner_schedule_occurrences WHERE schedule_id=$1 ORDER BY scheduled_at DESC LIMIT 100',[id])).rows;const result:ScheduleOccurrence[]=[];for(const row of occurrences){const attempts=(await db.query<AttemptRow>('SELECT * FROM runner_schedule_attempts WHERE occurrence_id=$1 ORDER BY attempt_number',[row.request_id])).rows.map(attempt);result.push({id:row.request_id,scheduleId:row.schedule_id,scheduledFor:iso(row.scheduled_at),status:row.status,attempts});}return result;},
  async tick(selected){
   if(ticking)return;ticking=true;try{
    const now=selected??await clock(db);
    await db.transaction(async tx=>{
     const schedules=(await tx.query<ScheduleRow>('SELECT * FROM runner_schedules WHERE enabled=true AND deleted=false AND next_due_at<=$1 ORDER BY next_due_at LIMIT 100 FOR UPDATE SKIP LOCKED',[now])).rows;
     for(const row of schedules){
      if(!row.active_request){
       const proposed=key(row.id+':'+iso(row.next_due_at));await tx.query("INSERT INTO runner_schedule_occurrences(request_id,schedule_id,scheduled_at,status) VALUES($1,$2,$3,'active') ON CONFLICT DO NOTHING",[proposed,row.id,row.next_due_at]);
       // A concurrent/manual occurrence at the same instant owns the unique slot; never create an orphan attempt.
       const occurrence=(await tx.query<{request_id:string;status:string}>('SELECT request_id,status FROM runner_schedule_occurrences WHERE schedule_id=$1 AND scheduled_at=$2',[row.id,row.next_due_at])).rows[0]!;
       if(['active','pending'].includes(occurrence.status)){await addAttempt(tx,occurrence.request_id,1,now);await tx.query('UPDATE runner_schedules SET active_request=$2 WHERE id=$1',[row.id,occurrence.request_id]);}
      }
      // One coalesced occurrence, no catch-up storm or overlap with an outstanding attempt.
      await tx.query('UPDATE runner_schedules SET next_due_at=$2 WHERE id=$1',[row.id,nextDue(row.spec.cron,row.spec.timezone,now)]);
     }
    });
    // Claim individually: external RPCs never hold a database transaction or row lock.
    const visited:string[]=[],deadline=Date.now()+20000;let remaining=100;
    // Bounded workers keep a slow RPC from starving unrelated occurrences.
    await Promise.all(Array.from({length:8},async()=>{
    while(Date.now()<deadline&&remaining-->0){
     const claim=await db.transaction(async tx=>{
      const row=(await tx.query<Claim>("SELECT a.*,o.schedule_id,s.owner,s.spec,s.enabled,s.deleted FROM runner_schedule_attempts a JOIN runner_schedule_occurrences o ON o.request_id=a.occurrence_id JOIN runner_schedules s ON s.id=o.schedule_id WHERE a.status IN('pending','submitted') AND a.next_attempt_at<=$1 AND NOT(a.id=ANY($2::text[])) AND (a.lease_until IS NULL OR a.lease_until<=clock_timestamp()) AND s.active_request=o.request_id AND (a.status='submitted' OR (s.enabled=true AND s.deleted=false)) ORDER BY a.next_attempt_at,a.id LIMIT 1 FOR UPDATE OF a SKIP LOCKED",[now,visited])).rows[0];if(!row)return null;
      row.lease_token=randomUUID();await tx.query("UPDATE runner_schedule_attempts SET lease_token=$2,lease_until=clock_timestamp()+interval '30 seconds' WHERE id=$1",[row.id,row.lease_token]);return row;
     });if(!claim)break;visited.push(claim.id);await dispatch(claim,now);
    }
    }));
   }finally{ticking=false;}
  }
 };
}
