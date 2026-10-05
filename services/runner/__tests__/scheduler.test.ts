import {expect,it} from 'vitest';
import {PGlite} from '@electric-sql/pglite';
import type {RunStart,RunSnapshot,RunnerService,ScheduleInput} from '@artifactbin/contracts';
import {createScheduler} from '../src/scheduler';
const instant=new Date('2026-10-05T00:00:00Z');
const spec:ScheduleInput={userId:'alice',artifactId:'artifact',cron:'* * * * *',timezone:'UTC',input:{value:1},maxAttempts:2,retryBackoffSeconds:1};
function fixture(){const starts:RunStart[]=[],runs=new Map<string,RunSnapshot>();const runner:RunnerService={async start(input){starts.push(input);const runId=input.requestId;runs.set(runId,runs.get(runId)??{runId,status:'running',output:null,receipt:null});return {runId}},async getRun({runId}){const result=runs.get(runId);if(!result)throw Error('not_found');return result},async events(){return {events:[],nextSequence:0,hasMore:false}},async cancel(){}};return {starts,runs,runner};}
it('resolves live artifacts for each retry, keeps attempts durable, and scopes operations to owners',async()=>{
 const db=new PGlite(),f=fixture();let version=1;const scheduler=await createScheduler(db,f.runner,async()=>({artifactId:'artifact',artifactVersion:String(version),document:{source:'live'+version,editId:String(version)},program:{source:'export default()=>'+version,language:'javascript'}}));
 try{const schedule=await scheduler.put(spec,instant);expect(schedule.artifactId).toBe('artifact');await expect(scheduler.get('bob',schedule.id)).rejects.toThrow('not_found');const occurrence=await scheduler.runNow('alice',schedule.id,'manual',instant);expect(await scheduler.runNow('alice',schedule.id,'manual',instant)).toEqual(occurrence);await scheduler.tick(instant);expect(f.starts).toHaveLength(1);expect(f.starts[0]?.artifactVersion).toBe('1');
 const runId=f.starts[0]!.requestId;f.runs.set(runId,{runId,status:'failed',output:null,receipt:{status:'failed'} as NonNullable<RunSnapshot['receipt']>});version=2;await scheduler.tick(instant);await scheduler.tick(new Date(instant.getTime()+2000));expect(f.starts).toHaveLength(2);expect(f.starts[1]?.artifactVersion).toBe('2');expect(f.starts[1]?.requestId).not.toBe(runId);expect((await scheduler.history('alice',schedule.id))[0]?.attempts).toHaveLength(2);
 }finally{await db.close()}
});
it('keeps uncertain admission pinned despite live changes and pauses only unsubmitted work',async()=>{
 const db=new PGlite(),f=fixture();let version=1,uncertain=true,resolves=0;const realStart=f.runner.start;f.runner.start=async input=>{const admitted=await realStart(input);if(uncertain){uncertain=false;throw Error('lost_response')}return admitted};
 const scheduler=await createScheduler(db,f.runner,async()=>{resolves++;return {artifactId:'artifact',artifactVersion:String(version),document:{source:'live'+version,editId:String(version)},program:{source:'export default()=>'+version,language:'javascript'}}});
 try{const schedule=await scheduler.put(spec,instant);await scheduler.runNow('alice',schedule.id,'one',instant);await scheduler.tick(instant);version=2;await scheduler.update('alice',schedule.id,{enabled:false},instant);await scheduler.tick(instant);expect(f.starts).toHaveLength(2);expect(f.starts[0]).toEqual(f.starts[1]);expect(resolves).toBe(1);expect((await scheduler.history('alice',schedule.id))[0]?.attempts).toHaveLength(1);
 const second=await scheduler.put({...spec,artifactId:'other'},instant);await scheduler.runNow('alice',second.id,'two',instant);await scheduler.update('alice',second.id,{enabled:false},instant);await scheduler.tick(instant);expect(f.starts).toHaveLength(2);expect((await scheduler.history('alice',second.id))[0]?.status).toBe('cancelled');await scheduler.remove('alice',second.id);await expect(scheduler.get('alice',second.id)).rejects.toThrow('not_found');expect(await scheduler.history('alice',second.id)).toHaveLength(1);
 }finally{await db.close()}
});
it('coalesces missed ticks without overlap and enforces five-field timezone cron',async()=>{
 const db=new PGlite(),f=fixture(),scheduler=await createScheduler(db,f.runner,async s=>({artifactId:s.artifactId,artifactVersion:'live',document:{source:'live',editId:'edit'},program:{source:'export default()=>1',language:'javascript'}}));
 try{await expect(scheduler.put({...spec,cron:'* * * * * *'},instant)).rejects.toThrow('invalid_schedule');await expect(scheduler.put({...spec,timezone:'wrong'},instant)).rejects.toThrow('invalid_schedule');const schedule=await scheduler.put({...spec,cron:'*/5 * * * *'},instant);await scheduler.tick(new Date('2026-10-05T00:17:00Z'));await scheduler.tick(new Date('2026-10-05T00:35:00Z'));expect(await scheduler.history('alice',schedule.id)).toHaveLength(1);expect(f.starts).toHaveLength(1);expect((await scheduler.get('alice',schedule.id)).nextDueAt).toBe('2026-10-05T00:40:00.000Z');
 const spring=await scheduler.put({...spec,cron:'30 2 * * *',timezone:'America/New_York'},new Date('2026-03-08T05:00:00Z'));expect(spring.nextDueAt).toBe('2026-03-08T07:30:00.000Z');const fall=await scheduler.put({...spec,cron:'30 1 * * *',timezone:'America/New_York'},new Date('2026-11-01T04:00:00Z'));expect(fall.nextDueAt).toBe('2026-11-01T05:30:00.000Z');
 }finally{await db.close()}
});
it('migrates legacy accepted executions without replay or retained schedule snapshots',async()=>{
 const db=new PGlite(),f=fixture(),old={...spec,version:'old',program:{source:'export default()=>1',language:'javascript'},document:{source:'old snapshot',editId:'old-edit'}};
 try{
 await db.exec("CREATE TABLE runner_schedules(id TEXT PRIMARY KEY,owner TEXT NOT NULL,spec JSONB NOT NULL,next_due_at TIMESTAMPTZ NOT NULL,active_request TEXT,enabled BOOLEAN NOT NULL DEFAULT true); CREATE TABLE runner_schedule_occurrences(request_id TEXT PRIMARY KEY,schedule_id TEXT NOT NULL,scheduled_at TIMESTAMPTZ NOT NULL,spec JSONB NOT NULL,run_id TEXT,status TEXT NOT NULL DEFAULT 'pending')");
 await db.query('INSERT INTO runner_schedules VALUES($1,$2,$3,$4,$5,true)',['legacy','alice',JSON.stringify(old),new Date(instant.getTime()+60000),'legacy-occurrence']);await db.query('INSERT INTO runner_schedule_occurrences VALUES($1,$2,$3,$4,$5,$6)',['legacy-occurrence','legacy',instant,JSON.stringify(old),'accepted-before-upgrade','running']);f.runs.set('accepted-before-upgrade',{runId:'accepted-before-upgrade',status:'completed',output:42,receipt:{status:'completed'} as NonNullable<RunSnapshot['receipt']>});
 await db.query('INSERT INTO runner_schedules VALUES($1,$2,$3,$4,$5,true)',['legacy-unknown','alice',JSON.stringify(old),new Date(instant.getTime()+60000),'uncertain-occurrence']);await db.query('INSERT INTO runner_schedule_occurrences VALUES($1,$2,$3,$4,$5,$6)',['uncertain-occurrence','legacy-unknown',instant,JSON.stringify(old),null,'pending']);f.runs.set('cron:uncertain-occurrence',{runId:'cron:uncertain-occurrence',status:'completed',output:43,receipt:{status:'completed'} as NonNullable<RunSnapshot['receipt']>});
 let resolutions=0;const scheduler=await createScheduler(db,f.runner,async()=>{resolutions++;throw Error('must_not_resolve_accepted')});await scheduler.tick(instant);expect(f.starts).toHaveLength(1);expect(f.starts[0]).toMatchObject({requestId:'cron:uncertain-occurrence',artifactVersion:'old'});expect(resolutions).toBe(0);const history=await scheduler.history('alice','legacy');expect(history[0]?.status).toBe('completed');expect(history[0]?.attempts[0]?.runId).toBe('accepted-before-upgrade');expect((await db.query<{spec:Record<string,unknown>}>('SELECT spec FROM runner_schedules')).rows[0]?.spec).not.toHaveProperty('program');expect((await db.query<{column_name:string}>("SELECT column_name FROM information_schema.columns WHERE table_name='runner_schedule_occurrences'")).rows.map(row=>row.column_name)).not.toContain('spec');
 }finally{await db.close()}
});
it('bounds confirmed failures and permanent admission rejections without duplicating unknown work',async()=>{
 const db=new PGlite(),f=fixture();f.runner.start=async input=>{f.starts.push(input);throw Error('not_executable')};const scheduler=await createScheduler(db,f.runner,async s=>({artifactId:s.artifactId,artifactVersion:'live',document:{source:'live',editId:'edit'},program:{source:'export default()=>1',language:'javascript'}}));
 try{const schedule=await scheduler.put(spec,instant);await scheduler.runNow('alice',schedule.id,'bounded',instant);await scheduler.tick(instant);await scheduler.tick(new Date(instant.getTime()+2000));await scheduler.tick(new Date(instant.getTime()+4000));expect(f.starts).toHaveLength(2);const history=await scheduler.history('alice',schedule.id);expect(history[0]?.status).toBe('failed');expect(history[0]?.attempts).toHaveLength(2);expect(history[0]?.attempts.every(item=>item.error==='not_executable')).toBe(true);
 }finally{await db.close()}
});
it('executes live native program definitions and retries with their current command, compute and environment',async()=>{
 const db=new PGlite(),f=fixture();let version=1;const scheduler=await createScheduler(db,f.runner,async s=>({artifactId:s.artifactId,artifactVersion:String(version),program:{source:'',language:'javascript'},command:['node','job'+version+'.mjs'],env:{MODE:'version'+version},compute:{vcpu:1,memoryMiB:2048,ttlSeconds:600}}));
 try{const schedule=await scheduler.put(spec,instant);await scheduler.runNow('alice',schedule.id,'native',instant);await scheduler.tick(instant);const first=f.starts[0]!;expect(first.document).toBeUndefined();expect(first).toMatchObject({command:['node','job1.mjs'],env:{MODE:'version1'},compute:{vcpu:1,memoryMiB:2048,ttlSeconds:600}});f.runs.set(first.requestId,{runId:first.requestId,status:'failed',output:null,receipt:{status:'failed'} as NonNullable<RunSnapshot['receipt']>});version=2;await scheduler.tick(instant);await scheduler.tick(new Date(instant.getTime()+2000));const second=f.starts[1]!;expect(second.document).toBeUndefined();expect(second).toMatchObject({command:['node','job2.mjs'],env:{MODE:'version2'},compute:{vcpu:1,memoryMiB:2048,ttlSeconds:600}});f.runs.set(second.requestId,{runId:second.requestId,status:'completed',output:42,receipt:{status:'completed'} as NonNullable<RunSnapshot['receipt']>});await scheduler.tick(new Date(instant.getTime()+2000));expect((await scheduler.history('alice',schedule.id))[0]?.status).toBe('completed');
 }finally{await db.close()}
});
it('never creates a second attempt for conflicting uncertain invocation identity',async()=>{
 const db=new PGlite(),f=fixture();f.runner.start=async input=>{f.starts.push(input);throw Error('request_conflict')};const scheduler=await createScheduler(db,f.runner,async s=>({artifactId:s.artifactId,artifactVersion:'live',document:{source:'live',editId:'edit'},program:{source:'export default()=>1',language:'javascript'}}));
 try{const schedule=await scheduler.put(spec,instant);await scheduler.runNow('alice',schedule.id,'conflict',instant);await scheduler.tick(instant);await scheduler.tick(new Date(instant.getTime()+5000));expect(f.starts).toHaveLength(1);expect((await scheduler.history('alice',schedule.id))[0]?.attempts).toHaveLength(1);expect((await scheduler.history('alice',schedule.id))[0]?.status).toBe('failed');expect((await scheduler.get('alice',schedule.id)).enabled).toBe(false);await scheduler.tick(new Date(instant.getTime()+120000));expect(f.starts).toHaveLength(1);expect((await scheduler.history('alice',schedule.id))[0]?.attempts[0]?.error).toBe('request_conflict');
 }finally{await db.close()}
});

it('coalesces a due slot already occupied by a completed manual occurrence without orphan attempts',async()=>{
 const db=new PGlite(),f=fixture(),scheduler=await createScheduler(db,f.runner,async s=>({artifactId:s.artifactId,artifactVersion:'live',document:{source:'live',editId:'edit'},program:{source:'export default()=>1',language:'javascript'}}));
 try{const schedule=await scheduler.put(spec,instant);const due=new Date(instant.getTime()+60000);await scheduler.runNow('alice',schedule.id,'same-slot',due);await scheduler.tick(due);const started=f.starts[0]!;f.runs.set(started.requestId,{runId:started.requestId,status:'completed',output:42,receipt:{status:'completed'} as NonNullable<RunSnapshot['receipt']>});await scheduler.tick(due);await db.query('UPDATE runner_schedules SET next_due_at=$2 WHERE id=$1',[schedule.id,due]);await scheduler.tick(due);expect(f.starts).toHaveLength(1);expect((await db.query('SELECT * FROM runner_schedule_attempts')).rows).toHaveLength(1);expect((await db.query<{active_request:string|null}>('SELECT active_request FROM runner_schedules')).rows[0]?.active_request).toBeNull();
 }finally{await db.close()}
});
it('dispatches unrelated schedules while another admission is waiting',async()=>{
 const db=new PGlite(),f=fixture();let unblock!:()=>void,healthy!:()=>void;
 const blocked=new Promise<void>(resolve=>{unblock=resolve}),seen=new Promise<void>(resolve=>{healthy=resolve});
 const start=f.runner.start;f.runner.start=async input=>{if(input.artifactId==='slow')await blocked;else healthy();return start(input);};
 const scheduler=await createScheduler(db,f.runner,async s=>({artifactId:s.artifactId,document:{source:'live',editId:'edit'},program:{source:'export default()=>1',language:'javascript'}}));
 let tick:Promise<void>|undefined;
 try{
  const first=await scheduler.put({...spec,artifactId:'slow'},instant);await scheduler.runNow('alice',first.id,'slow',instant);
  const second=await scheduler.put({...spec,artifactId:'healthy'},instant);await scheduler.runNow('alice',second.id,'healthy',new Date(instant.getTime()+1));
  tick=scheduler.tick(new Date(instant.getTime()+2));
  const progressed=await Promise.race([seen.then(()=>true),new Promise<boolean>(resolve=>setTimeout(()=>resolve(false),1000))]);
  expect(progressed).toBe(true);
 }finally{unblock();await tick;await db.close();}
});
