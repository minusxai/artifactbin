import {expect,it} from 'vitest';
import {useAppHarness,request} from './harness';
import {POST as create} from '@/app/api/artifacts/route';
import {POST as mutate} from '@/app/api/artifacts/[id]/mutate/route';
import {getArtifactById} from '@/lib/artifacts';
import {getDb} from '@/lib/db';
import {mintToken} from '@/lib/tokens';
import {loadDatasetRows} from '@/lib/story/dataset-store';

useAppHarness();

async function fixture(){
 const token=await mintToken('mxmx_test_notify_commit');
 const created=await create(request('/api/artifacts',{method:'POST',token:token.token,json:{dataset:[{n:0}],access:'readwrite'}}));
 expect(created.status).toBe(201);const dataset=await created.json();
 const declarations=`<Import name="tasks" src="ref:${dataset.id}" /><Mutation name="increment">{\`update tasks.rows set n=n+$amount\`}</Mutation>`;
 const docResponse=await create(request('/api/artifacts',{method:'POST',token:token.token,json:{markup:`<Helmet>${declarations}</Helmet><p>Counter</p>`}}));
 expect(docResponse.status).toBe(201);const doc=await docResponse.json();
 // Install the future declaration through isolated state so this integration seed
 // reaches the real write/receipt path before publish grammar is implemented.
 const db=await getDb();
 await db.query('UPDATE artifacts SET source=$2 WHERE id=$1',[doc.id,`<Helmet>${declarations}<Notify name="counter_status" on="increment">{\`select null as "to", 'Counter is current' as message from tasks.rows\`}</Notify></Helmet><p>Counter</p>`]);
 const send=(key:string)=>mutate(request(`/api/artifacts/${doc.id}/mutate`,{method:'POST',token:token.token,headers:{'Idempotency-Key':key},json:{name:'increment',args:{amount:1}}}),{params:Promise.resolve({id:doc.id})});
 return {db,dataset,doc,send};
}

it('commits a discoverable run and one durable rule job; request replay never increments twice',async()=>{
 const {db,dataset,send}=await fixture();
 const first=await send('mxmx_test_notification_once');expect(first.status,await first.clone().text()).toBe(200);
 const result=await first.json();expect(result.mutationRunId).toEqual(expect.any(String));
 const replay=await send('mxmx_test_notification_once');expect(replay.status).toBe(200);expect(await replay.json()).toEqual(result);
 expect(await loadDatasetRows((await getArtifactById(dataset.id))!)).toEqual([{n:1}]);
 const jobs=await db.query('SELECT mutation_run_id,rule_id FROM notification_jobs WHERE mutation_run_id=$1',[result.mutationRunId]);
 expect(jobs.rows).toEqual([{mutation_run_id:result.mutationRunId,rule_id:'counter_status'}]);
});

it('distinguishes intentional runs without coalescing their notification jobs',async()=>{
 const {db,dataset,send}=await fixture();
 const first=await send('mxmx_test_notification_first');expect(first.status).toBe(200);const a=await first.json();
 expect(a.mutationRunId).toEqual(expect.any(String));
 const second=await send('mxmx_test_notification_second');expect(second.status).toBe(200);const b=await second.json();
 expect(b.mutationRunId).toEqual(expect.any(String));expect(b.mutationRunId).not.toBe(a.mutationRunId);
 expect(await loadDatasetRows((await getArtifactById(dataset.id))!)).toEqual([{n:2}]);
 expect((await db.query('SELECT id FROM notification_jobs WHERE mutation_run_id=ANY($1::text[])',[[a.mutationRunId,b.mutationRunId]])).rows).toHaveLength(2);
});

it('rolls back dataset and scheduled jobs when receipt persistence fails',async()=>{
 const {db,dataset,send}=await fixture();
 await db.query('ALTER TABLE mutation_receipts ADD CONSTRAINT mxmx_test_notification_receipt CHECK (response IS NULL)');
 try {
  try {await send('mxmx_test_notification_receipt');} catch {/* direct handler exposes the injected DB refusal */}
  expect(await loadDatasetRows((await getArtifactById(dataset.id))!)).toEqual([{n:0}]);
  expect((await db.query('SELECT id FROM notification_jobs')).rows).toEqual([]);
 } finally {await db.query('ALTER TABLE mutation_receipts DROP CONSTRAINT mxmx_test_notification_receipt');}
});

it('refuses to commit the mutation if its durable trigger cannot be stored',async()=>{
 const {db,dataset,send}=await fixture();
 await db.query("ALTER TABLE notification_jobs ADD CONSTRAINT mxmx_test_notification_enqueue CHECK (rule_id <> 'counter_status')");
 try {
  try {await send('mxmx_test_notification_enqueue');} catch {/* injected job insert failure */}
  expect(await loadDatasetRows((await getArtifactById(dataset.id))!)).toEqual([{n:0}]);
  expect((await db.query('SELECT id FROM notification_jobs')).rows).toEqual([]);
  expect((await db.query('SELECT response FROM mutation_receipts')).rows.every(row=>row.response===null)).toBe(true);
 } finally {await db.query('ALTER TABLE notification_jobs DROP CONSTRAINT mxmx_test_notification_enqueue');}
});
