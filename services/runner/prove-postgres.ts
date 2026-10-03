/** CI-only: production table/transaction behavior on independent PostgreSQL connections. */
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {Pool} from 'pg';
import {createRunner} from './src/local';
import {createAgentCoordinator,type TransactionalDatabase} from './src/coordinator';
import {createScheduler} from './src/scheduler';
const url=process.env.RUNNER_TEST_DATABASE;
if(!url)throw Error('RUNNER_TEST_DATABASE required');
const root=new Pool({connectionString:url});const schema='runner_'+randomUUID().replaceAll('-','');await root.query(`CREATE SCHEMA ${schema}`);
const pool=new Pool({connectionString:url,options:`-c search_path=${schema}`,max:12});
const db:TransactionalDatabase={query:async<T>(sql:string,params?:unknown[])=>({rows:(await pool.query(sql,params)).rows as T[]}),transaction:async fn=>{const client=await pool.connect();try{await client.query('BEGIN');const result=await fn({query:async<T>(sql:string,params?:unknown[])=>({rows:(await client.query(sql,params)).rows as T[]})});await client.query('COMMIT');return result;}catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}}};
const runner=await createRunner({db,dockerImage:process.env.RUNNER_TEST_IMAGE,capabilities:async()=>null});
try{
 const request={userId:'alice',requestId:'same',program:{language:'typescript' as const,source:'export default()=>42'},input:null};
 const admissions=await Promise.all(Array.from({length:16},()=>runner.start(request)));assert.equal(new Set(admissions.map(r=>r.runId)).size,1);
 const source='export default async(i,c)=>{const messages=[{role:"user",content:i.message}];await c.emit({type:"checkpoint",messages});return {messages}}';
 const coordinators=[await createAgentCoordinator(db,runner,source),await createAgentCoordinator(db,runner,source)];
 const dispatch={userId:'alice',artifactId:'abc123',requestId:'comment',message:'hello',model:'fixture'};
 const branches=await Promise.all(Array.from({length:16},(_,i)=>coordinators[i%2]!.dispatch(dispatch)));assert.equal(new Set(branches.map(b=>b.branchId)).size,1);
 for(let n=0;n<1000;n++){await Promise.all(coordinators.map(c=>c.tick()));const rows=await coordinators[0]!.branches('alice','abc123');if(rows[0]?.status==='completed')break;await new Promise(r=>setTimeout(r,20));}
 await Promise.all(Array.from({length:20},(_,i)=>coordinators[i%2]!.tick()));assert.equal((await db.query<{revision:number}>('SELECT revision FROM hosted_conversations')).rows[0]!.revision,1);
 assert.equal((await coordinators[0]!.branches('alice','abc123'))[0]!.status,'completed');
 const schedulers=[await createScheduler(db,runner),await createScheduler(db,runner)];const now=new Date('2026-10-03T00:00:00Z');await schedulers[0]!.put({userId:'alice',artifactId:'abc123',version:'1',cron:'*/5 * * * *',timezone:'UTC',program:request.program,input:null},now);
 await Promise.all(schedulers.map(s=>s.tick(new Date('2026-10-03T00:17:00Z'))));assert.equal((await db.query('SELECT * FROM runner_schedule_occurrences')).rows.length,1);
 console.log('Product PostgreSQL: 16 admissions → one run; 16 dispatches → one branch; competing finalizers → one revision; concurrent schedules → one occurrence.');
}finally{await runner.close();await pool.end();await root.query(`DROP SCHEMA ${schema} CASCADE`);await root.end();}
