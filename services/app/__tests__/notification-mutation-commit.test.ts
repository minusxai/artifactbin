import {createUser} from '@/lib/users';
import {changeMembership} from '@/lib/membership';
import {membershipInbox} from '@/lib/membership-inbox';
import type {MutationNotificationJobInput,MutationNotificationPlan} from '@artifactbin/contracts';
import {expect,it} from 'vitest';
import {useAppHarness,request} from './harness';
import {POST as create} from '@/app/api/artifacts/route';
import {POST as mutate} from '@/app/api/artifacts/[id]/mutate/route';
import {getArtifactById} from '@/lib/artifacts';
import {getDb} from '@/lib/db';
import {services,setServices} from '@/lib/services';
import {mintToken} from '@/lib/tokens';
import {notificationJobStore} from '@/lib/notification-runtime';
import {evaluateNotificationQuery} from '@/lib/notification-query';
import {createNotificationWorker} from '@/lib/notification-worker';
import {loadDatasetRows} from '@/lib/story/datasets/dataset-store';

useAppHarness();

async function fixture(notificationSql=`select null as "to", 'Counter is ' || cast(n as integer) as message from tasks.rows`,userId?:string,secondSql=`select null as "to", 'Second status' as message`){
 const token=await mintToken('mxmx_test_notify_commit',userId);
 const created=await create(request('/api/artifacts',{method:'POST',token:token.token,json:{dataset:[{n:0}],access:'readwrite'}}));
 expect(created.status).toBe(201);const dataset=await created.json();
 const declarations=`<Import name="tasks" src="ref:${dataset.id}" /><Mutation name="increment">{\`update tasks.rows set n=n+$amount\`}</Mutation>`;
 const docResponse=await create(request('/api/artifacts',{method:'POST',token:token.token,json:{markup:`<Helmet>${declarations}<Notify name="counter_status" on="increment">{\`${notificationSql}\`}</Notify><Notify name="second_status" on="increment">{\`${secondSql}\`}</Notify></Helmet><p>Counter</p>`}}));
 expect(docResponse.status,await docResponse.clone().text()).toBe(201);const doc=await docResponse.json();
 const db=await getDb();
 const send=(key:string)=>mutate(request(`/api/artifacts/${doc.id}/mutate`,{method:'POST',token:token.token,headers:{'Idempotency-Key':key},json:{name:'increment',args:{amount:1}}}),{params:Promise.resolve({id:doc.id})});
 return {db,dataset,doc,send,token};
}

it('commits a discoverable run and one durable run job for all linked rules; request replay never increments twice',async()=>{
 const {db,dataset,send}=await fixture();
 const first=await send('mxmx_test_notification_once');expect(first.status,await first.clone().text()).toBe(200);
 const result=await first.json();expect(result.mutationRunId).toEqual(expect.any(String));
 const replay=await send('mxmx_test_notification_once');expect(replay.status).toBe(200);expect(await replay.json()).toEqual(result);
 expect(await loadDatasetRows((await getArtifactById(dataset.id))!)).toEqual([{n:1}]);
 const jobs=await db.query('SELECT mutation_run_id,input FROM notification_jobs WHERE mutation_run_id=$1',[result.mutationRunId]);
 expect(jobs.rows).toHaveLength(1);
 expect(jobs.rows[0]).toMatchObject({mutation_run_id:result.mutationRunId,input:{rules:[{name:'counter_status'},{name:'second_status'}]}});
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
 await db.query("ALTER TABLE notification_jobs ADD CONSTRAINT mxmx_test_notification_enqueue CHECK (mutation_run_id = 'cannot_match')");
 try {
  try {await send('mxmx_test_notification_enqueue');} catch {/* injected job insert failure */}
  expect(await loadDatasetRows((await getArtifactById(dataset.id))!)).toEqual([{n:0}]);
  expect((await db.query('SELECT id FROM notification_jobs')).rows).toEqual([]);
  expect((await db.query('SELECT response FROM mutation_receipts')).rows.every(row=>row.response===null)).toBe(true);
 } finally {await db.query('ALTER TABLE notification_jobs DROP CONSTRAINT mxmx_test_notification_enqueue');}
});

it('evaluates current data after commit and durably completes an empty-recipient result once',async()=>{
 const {db,send}=await fixture();
 const first=await send('mxmx_test_notification_current');expect(first.status).toBe(200);const result=await first.json();
 const second=await send('mxmx_test_notification_later');expect(second.status).toBe(200);
 const store=await notificationJobStore();
 const worker=createNotificationWorker({store,evaluator:{evaluate:evaluateNotificationQuery}});
 expect(await worker.drainOnce()).toBe(true);
 expect(await worker.drainOnce()).toBe(true);
 expect(await worker.drainOnce()).toBe(false);
 const jobs=await db.query('SELECT status,plan FROM notification_jobs WHERE mutation_run_id=$1',[result.mutationRunId]);
 expect(jobs.rows).toEqual([{status:'completed',plan:expect.objectContaining({rules:[expect.objectContaining({rows:[{recipientIds:[],message:'Counter is 2'}]}),expect.objectContaining({ruleName:'second_status'})]})}]);
 expect((await db.query('SELECT id FROM mutation_notifications')).rows).toEqual([]);
});

it('keeps a successful write when output fails, then retries the original job against repaired current data',async()=>{
 const {db,dataset,send}=await fixture(`select null as "to", case when n=1 then '' else 'Repaired' end as message from tasks.rows`);
 const first=await send('mxmx_test_notification_repair');expect(first.status).toBe(200);const result=await first.json();
 const store=await notificationJobStore();
 const worker=createNotificationWorker({store,evaluator:{evaluate:evaluateNotificationQuery}});
 await worker.drainOnce();
 expect(await loadDatasetRows((await getArtifactById(dataset.id))!)).toEqual([{n:1}]);
 const failed=(await db.query<{id:string;status:string;error_code:string|null;input:MutationNotificationJobInput}>('SELECT id,status,error_code,input FROM notification_jobs WHERE mutation_run_id=$1',[result.mutationRunId])).rows[0]!;
 expect(failed).toMatchObject({status:'failed',error_code:'notification_output_invalid'});
 const repaired=await send('mxmx_test_notification_repair_current');expect(repaired.status).toBe(200);
 expect(await store.retry(failed.input.initiator.principal,failed.id)).toBe(true);
 while(await worker.drainOnce()) { /* Drain the two bounded pending jobs. */ }
 const completed=(await db.query<{status:string;plan:MutationNotificationPlan;input:MutationNotificationJobInput}>('SELECT status,plan,input FROM notification_jobs WHERE id=$1',[failed.id])).rows[0]!;
 expect(completed.status).toBe('completed');
 expect(completed.plan.rules[0]?.rows).toEqual([{recipientIds:[],message:'Repaired'}]);
 expect(completed.input).toEqual(failed.input);
 expect(await loadDatasetRows((await getArtifactById(dataset.id))!)).toEqual([{n:2}]);
});

it('refuses the winning commit if the initiating credential was revoked during SQL execution',async()=>{
 const {db,dataset,send,token}=await fixture();
 const sql=services().sql;
 setServices({sql:{...sql,async mutate(input){const result=await sql.mutate(input);await db.query('UPDATE tokens SET deleted_at=now() WHERE id=$1',[token.id]);return result;}}});
 try {
  const refused=await send('mxmx_test_notification_revoked_during_write');
  expect(refused.status).toBe(403);
  expect(await refused.json()).toMatchObject({error:'policy_denied'});
  expect(await loadDatasetRows((await getArtifactById(dataset.id))!)).toEqual([{n:0}]);
  expect((await db.query('SELECT id FROM notification_jobs')).rows).toEqual([]);
 } finally {setServices({sql});}
});

it('accepts an evaluated current-state message after a later data write without treating content as revoked authority',async()=>{
 const {db,send}=await fixture();
 expect((await send('mxmx_test_notification_plan_before_later_write')).status).toBe(200);
 const store=await notificationJobStore(),claim=await store.claim();expect(claim).not.toBeNull();
 const plan=await evaluateNotificationQuery(claim!.input);
 expect((await send('mxmx_test_notification_write_after_evaluation')).status).toBe(200);
 expect(await store.complete(claim!,plan)).toBe(true);
 const row=(await db.query<{status:string;plan:MutationNotificationPlan}>('SELECT status,plan FROM notification_jobs WHERE id=$1',[claim!.jobId])).rows[0]!;
 expect(row.status).toBe('completed');
 expect(row.plan.rules[0]?.rows).toEqual([{recipientIds:[],message:'Counter is 1'}]);
});

it('publishes one combined item for an explicitly joined recipient, excludes readable nonmembers, and hides it after leave',async()=>{
 const owner=await createUser({email:'mxmx_test_notify_owner@example.com'});
 const recipient=await createUser({email:'mxmx_test_notify_recipient@example.com'});
 const reader=await createUser({email:'mxmx_test_notify_reader@example.com'});
 const firstSql=`select '${recipient.id}' as "to", 'Counter is ' || cast(n as integer) as message from tasks.rows union all select '${reader.id}', 'Not a member' from tasks.rows`;
 const secondSql=`select '${recipient.id}' as "to", 'Counter is 1' as message union all select '${recipient.id}', 'Second message'`;
 const {db,dataset,doc,send}=await fixture(firstSql,owner.id,secondSql);
 await db.query("UPDATE artifacts SET visibility='public',link_role='commenter' WHERE id=ANY($1::text[])",[[dataset.id,doc.id]]);
 await changeMembership({userId:recipient.id,tokenId:null},doc.id,{action:'join'});
 await changeMembership({userId:owner.id,tokenId:null},doc.id,{action:'approve',userId:recipient.id});
 const response=await send('mxmx_test_notification_combined_join');expect(response.status).toBe(200);
 const run=(await response.json()).mutationRunId;
 const store=await notificationJobStore(),worker=createNotificationWorker({store,evaluator:{evaluate:evaluateNotificationQuery}});
 expect(await worker.drainOnce()).toBe(true);
 const rows=(await db.query<{recipient_id:string;messages:string[]}>('SELECT recipient_id,messages FROM mutation_notifications WHERE mutation_run_id=$1',[run])).rows;
 expect(rows).toEqual([{recipient_id:recipient.id,messages:['Counter is 1','Second message']}]);
 const replay=await send('mxmx_test_notification_combined_join');expect(replay.status).toBe(200);
 expect(await worker.drainOnce()).toBe(false);
 expect((await db.query('SELECT id FROM mutation_notifications WHERE mutation_run_id=$1',[run])).rows).toHaveLength(1);
 expect((await membershipInbox({userId:recipient.id,tokenId:null})).notifications.filter(item=>item.kind==='mutation')).toHaveLength(1);
 await changeMembership({userId:recipient.id,tokenId:null},doc.id,{action:'leave'});
 expect((await membershipInbox({userId:recipient.id,tokenId:null})).notifications.filter(item=>item.kind==='mutation')).toHaveLength(0);
});
