/** CI-only: production table/transaction behavior on independent PostgreSQL connections. */
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {Pool} from 'pg';
import {createRunner} from './src/local';
import {proveSchedulerPostgres} from './src/scheduler-proof';
import {createScheduler,type TransactionalDatabase} from './src/scheduler';
const url=process.env.RUNNER_TEST_DATABASE;
if(!url)throw Error('RUNNER_TEST_DATABASE required');
const root=new Pool({connectionString:url});const schema='runner_'+randomUUID().replaceAll('-','');await root.query(`CREATE SCHEMA ${schema}`);
const pool=new Pool({connectionString:url,options:`-c search_path=${schema}`,max:12});
const db:TransactionalDatabase={query:async<T>(sql:string,params?:unknown[])=>({rows:(await pool.query(sql,params)).rows as T[]}),transaction:async fn=>{const client=await pool.connect();try{await client.query('BEGIN');const result=await fn({query:async<T>(sql:string,params?:unknown[])=>({rows:(await client.query(sql,params)).rows as T[]})});await client.query('COMMIT');return result;}catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}}};
const runner=await createRunner({db,dockerImage:process.env.RUNNER_TEST_IMAGE,capabilities:async()=>null});
try{
 const request={userId:'alice',requestId:'same',program:{language:'typescript' as const,source:'export default()=>42'},input:null};
 const admissions=await Promise.all(Array.from({length:16},()=>runner.start(request)));assert.equal(new Set(admissions.map(r=>r.runId)).size,1);
 const schedulers=[await createScheduler(db,runner,async()=>({artifactId:'abc123',artifactVersion:'1',document:{source:'live',editId:'edit'},program:request.program})),await createScheduler(db,runner,async()=>({artifactId:'abc123',artifactVersion:'1',document:{source:'live',editId:'edit'},program:request.program}))];const now=new Date('2026-10-03T00:00:00Z');await schedulers[0]!.put({userId:'alice',artifactId:'abc123',cron:'*/5 * * * *',timezone:'UTC',input:null},now);
 await Promise.all(schedulers.map(s=>s.tick(new Date('2026-10-03T00:17:00Z'))));assert.equal((await db.query('SELECT * FROM runner_schedule_occurrences')).rows.length,1);
 await proveSchedulerPostgres(url);
 console.log('Product PostgreSQL: 16 admissions → one run; concurrent schedules → one occurrence.');
}finally{await runner.close();await pool.end();await root.query(`DROP SCHEMA ${schema} CASCADE`);await root.end();}
