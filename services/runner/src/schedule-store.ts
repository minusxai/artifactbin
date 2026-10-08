import {SCHEDULE_TABLES,ensureRunnerTables} from './schema';
import type {TransactionalDatabase} from './scheduler';
/** Creates the schedule tables; snapshots live only on their attempts. */
export async function initializeSchedules(db:TransactionalDatabase){
 await db.transaction(async tx=>{
 // Database-scoped migration fence also supports multiple controllers starting together.
 await tx.query("SELECT pg_advisory_xact_lock(hashtext('artifactbin.schedule.schema'))");
 const columns=async(table:string)=>(await tx.query<{column_name:string}>('SELECT column_name FROM information_schema.columns WHERE table_schema=current_schema() AND table_name=$1',[table])).rows.map(row=>row.column_name);
 const scheduleColumns=await columns('runner_schedules');
 if(scheduleColumns.length)await tx.query('ALTER TABLE runner_schedules ADD COLUMN IF NOT EXISTS deleted BOOLEAN NOT NULL DEFAULT false');
 await ensureRunnerTables(tx,SCHEDULE_TABLES);
 });
}
