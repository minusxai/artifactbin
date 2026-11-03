/** CI-only: production table/transaction behavior on independent PostgreSQL connections. */
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {Pool} from 'pg';
import {createRunner} from './src/local';
import type {RunnerDatabase} from './src/store';
const url=process.env.RUNNER_TEST_DATABASE;
if(!url)throw Error('RUNNER_TEST_DATABASE required');
const root=new Pool({connectionString:url});const schema='runner_'+randomUUID().replaceAll('-','');await root.query(`CREATE SCHEMA ${schema}`);
const pool=new Pool({connectionString:url,options:`-c search_path=${schema}`,max:12});
const db:RunnerDatabase={query:async<T>(sql:string,params?:unknown[])=>({rows:(await pool.query(sql,params)).rows as T[]})};
const runner=await createRunner({db,dockerImage:process.env.RUNNER_TEST_IMAGE,capabilities:async()=>null});
try{
 const request={userId:'alice',requestId:'same',program:{language:'typescript' as const,source:'export default()=>42'},input:null};
 const admissions=await Promise.all(Array.from({length:16},()=>runner.start(request)));assert.equal(new Set(admissions.map(r=>r.runId)).size,1);
 console.log('Product PostgreSQL: 16 admissions → one run.');
}finally{await runner.close();await pool.end();await root.query(`DROP SCHEMA ${schema} CASCADE`);await root.end();}
