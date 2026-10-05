import {SCHEDULE_TABLES,ensureRunnerTables} from './schema';
import type {RunStart,ScheduleInput} from '@artifactbin/contracts';
import type {TransactionalDatabase} from './scheduler';
/** Additive migration preserves accepted legacy invocations; snapshots survive only on their attempts. */
export async function initializeSchedules(db:TransactionalDatabase){
 await db.transaction(async tx=>{
 // Database-scoped migration fence also supports multiple controllers starting together.
 await tx.query("SELECT pg_advisory_xact_lock(hashtext('artifactbin.schedule.schema'))");
 const columns=async(table:string)=>(await tx.query<{column_name:string}>('SELECT column_name FROM information_schema.columns WHERE table_schema=current_schema() AND table_name=$1',[table])).rows.map(row=>row.column_name);
 const scheduleColumns=await columns('runner_schedules');
 if(scheduleColumns.length)await tx.query('ALTER TABLE runner_schedules ADD COLUMN IF NOT EXISTS deleted BOOLEAN NOT NULL DEFAULT false');
 const occurrenceColumns=await columns('runner_schedule_occurrences');
 await ensureRunnerTables(tx,SCHEDULE_TABLES);
 if(!occurrenceColumns.includes('spec'))return;
  const rows=(await tx.query<{request_id:string;schedule_id:string;scheduled_at:Date;spec:ScheduleInput & {version:string;program:RunStart['program'];document?:RunStart['document']};run_id:string|null;status:string}>('SELECT * FROM runner_schedule_occurrences FOR UPDATE')).rows;
  for(const row of rows){
   const active=row.status==='pending'||row.status==='running';
   const status=active?'submitted':row.status==='completed'?'completed':row.status==='cancelled'?'cancelled':'failed';
   const envelope=active?{requestId:'cron:'+row.request_id,userId:row.spec.userId,artifactId:row.spec.artifactId,artifactVersion:row.spec.version,program:row.spec.program,...(row.spec.document?{document:row.spec.document}:{}),input:row.spec.input}:null;
   await tx.query('INSERT INTO runner_schedule_attempts(id,occurrence_id,attempt_number,request_id,run_id,status,next_attempt_at,envelope) VALUES($1,$1,1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING',[row.request_id,'cron:'+row.request_id,row.run_id,status,row.scheduled_at,envelope?JSON.stringify(envelope):null]);
   await tx.query('UPDATE runner_schedule_occurrences SET status=$2 WHERE request_id=$1',[row.request_id,active?'active':status]);
  }
  // Legacy pending admission may already have succeeded remotely. Preserve its exact envelope once; new attempts resolve live code.
  await tx.query("UPDATE runner_schedules SET spec=(spec-'version'-'program'-'document') || jsonb_build_object('maxAttempts',COALESCE(spec->'maxAttempts','1'::jsonb),'retryBackoffSeconds',COALESCE(spec->'retryBackoffSeconds','60'::jsonb))");
  await tx.query('ALTER TABLE runner_schedule_occurrences DROP COLUMN spec,DROP COLUMN run_id');
 });
}
