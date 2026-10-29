/**
 * The durable notification job store through its public contract (createNotificationJobStore):
 * scheduling, leases, retry backoff and exhaustion, recipient admission and who may read or retry
 * a job. Time is the store's injected clock over a faked Date, so leases and token/account expiry
 * move without sleeping. Assertions read the store's answers, never its SQL. Principal liveness is the
 * store's own rule (accounts' token liveness), so token and account expiry are checked as production checks them.
 */
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import type {MutationNotificationJobInput,MutationNotificationPlan} from '@artifactbin/contracts';
import {useAppHarness} from '@/__tests__/harness';
import {getDb} from '@/lib/platform';
import {createNotificationJobStore,type NotificationJobAuthority} from '@/lib/notifications';

useAppHarness();
beforeEach(()=>{vi.useFakeTimers({toFake:['Date']});vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));});
afterEach(()=>vi.useRealTimers());

const input:MutationNotificationJobInput={
 origin:{mutationRunId:'run1',documentId:'doc',documentEditId:'edit',documentVersion:1,mutationName:'change'},
 initiator:{principal:{kind:'user',id:'alice'},execution:'human',agentLabel:null},
 rules:[{name:'only',on:'change',sql:'SELECT 1'}],
 bindings:{values:{},types:{},userId:'alice',now:'2026-01-01T00:00:00Z',tz:'UTC'},contextRevision:'context',contextSnapshot:{version:1},
};
const plan=(recipientIds:string[]):MutationNotificationPlan=>({executionFence:{principalRevision:'p',documentRevision:'d',contextRevision:'context'},rules:[{ruleName:'only',rows:[{recipientIds,message:'Changed'}],sources:[]}]});
const authority:NotificationJobAuthority={validatePlan:async()=>{},admitRecipients:async(_tx,_input,_plan,ids)=>ids,canManage:async(_tx,p)=>p.kind==='user'&&p.id==='manager'};
const tick=(ms:number)=>vi.setSystemTime(Date.now()+ms);

async function fixture(job=input){
 const db=await getDb();
 await db.query("INSERT INTO users(id) VALUES('alice'),('bob'),('carol'),('manager'),('other')");
 const store=createNotificationJobStore({db,authority,clock:()=>new Date()});
 await db.transaction(tx=>store.enqueue(tx,job));
 const row=async()=>(await db.query<{status:string;attempts:number;error_code:string|null;next_attempt_at:string|null}>('SELECT status,attempts,error_code,next_attempt_at FROM notification_jobs')).rows[0]!;
 return {db,store,row};
}

it('refuses an inconsistent job input before storing anything',async()=>{
 const db=await getDb(),store=createNotificationJobStore({db,authority});
 for(const bad of [
  {...input,rules:[]},
  {...input,rules:[input.rules[0]!,input.rules[0]!]},
  {...input,rules:[{...input.rules[0]!,on:'other'}]},
  {...input,contextSnapshot:undefined} as unknown as MutationNotificationJobInput,
 ])await expect(db.transaction(tx=>store.enqueue(tx,bad))).rejects.toMatchObject({code:'notification_context_invalid'});
 expect((await db.query('SELECT id FROM notification_jobs')).rows).toEqual([]);
});

it('is idempotent per mutation run: a replayed enqueue keeps one job and one id',async()=>{
 const {db,store}=await fixture();
 await db.transaction(tx=>store.enqueue(tx,input));
 const jobs=(await db.query<{id:string}>('SELECT id FROM notification_jobs')).rows;
 expect(jobs).toHaveLength(1);expect(jobs[0]!.id).toMatch(/^[0-9a-f]{64}$/);
 expect((await store.list({kind:'user',id:'alice'},'run1')).map(job=>job.id)).toEqual([jobs[0]!.id]);
});

it('backs off a retryable failure 1s, 2s, 4s, 8s and fails for good on the fifth attempt with the given code',async()=>{
 const {store,row}=await fixture();
 for(const delay of [1000,2000,4000,8000]){
  const claim=(await store.claim())!;
  expect(await store.fail(claim,'notification_query_timeout',true)).toBe(true);
  expect(await row()).toMatchObject({status:'retrying',error_code:'notification_query_timeout'});
  expect(Date.parse((await row()).next_attempt_at!)-Date.now()).toBe(delay);
  tick(delay-1);expect(await store.claim()).toBeNull();
  tick(1);
 }
 const last=(await store.claim())!;expect((await row()).attempts).toBe(5);
 expect(await store.fail(last,'notification_query_timeout',true)).toBe(true);
 expect(await row()).toMatchObject({status:'failed',error_code:'notification_query_timeout',next_attempt_at:null});
 tick(3_600_000);expect(await store.claim()).toBeNull();
});

it('fails a non-retryable error at once and maps an unknown code to a safe one',async()=>{
 const {store,row}=await fixture();
 expect(await store.fail((await store.claim())!,'relation "secret" does not exist',false)).toBe(true);
 expect(await row()).toMatchObject({status:'failed',attempts:1,error_code:'notification_execution_failed'});
});

it('counts expired leases as attempts and exhausts a job that keeps crashing',async()=>{
 const {store,row}=await fixture();
 for(let attempt=1;attempt<=5;attempt++){
  const claim=(await store.claim())!;expect(claim.generation).toBe(attempt);
  tick(30_000);expect(await store.claim()).toBeNull();
  tick(30_000);
 }
 expect(await store.claim()).toBeNull();
 expect(await row()).toMatchObject({status:'failed',attempts:5,error_code:'notification_retry_exhausted'});
});

it('renews a live lease from the clock and refuses to renew a lapsed one',async()=>{
 const {store}=await fixture(),claim=(await store.claim())!;
 tick(50_000);expect(await store.renew(claim)).toBe(true);
 tick(50_000);expect(await store.claim()).toBeNull();
 expect(await store.complete(claim,plan([]))).toBe(true);
 const second=createNotificationJobStore({db:await getDb(),authority,clock:()=>new Date()});
 expect(await second.renew(claim)).toBe(false);
});

it('resets a failed job on retry, keeps its input, and refuses to retry one that is not failed',async()=>{
 const {store,row}=await fixture(),claim=(await store.claim())!;
 expect(await store.retry({kind:'user',id:'alice'},claim.jobId)).toBe(false);
 await store.fail(claim,'notification_query_invalid',false);
 expect(await store.retry({kind:'user',id:'other'},claim.jobId)).toBe(false);
 expect(await store.retry({kind:'user',id:'manager'},claim.jobId)).toBe(true);
 expect(await row()).toMatchObject({status:'pending',attempts:0,error_code:null});
 const again=(await store.claim())!;expect(again.input).toEqual(input);expect(again.generation).toBe(claim.generation+2);
 expect(await store.complete(again,plan(['bob']))).toBe(true);
 expect(await store.complete(again,plan(['bob']))).toBe(false);
 expect(await store.status({kind:'user',id:'alice'},claim.jobId)).toMatchObject({status:'completed',attempts:1,error_code:null,notification_names:['only'],mutation_run_id:'run1'});
});

it('lets only a live initiator, its frozen account or a manager read and retry a job',async()=>{
 const tokenInput={...input,initiator:{...input.initiator,principal:{kind:'token' as const,id:'tok'}}};
 const db=await getDb();await db.query("INSERT INTO tokens(id,token_hash,user_id,expires_at) VALUES('tok','hash','alice','2026-01-01T01:00:00Z')");
 const {store}=await fixture(tokenInput),claim=(await store.claim())!;await store.fail(claim,'notification_query_invalid',false);
 const token={kind:'token' as const,id:'tok'};
 expect((await store.status(token,claim.jobId))?.status).toBe('failed');
 expect(await store.status({kind:'user',id:'alice'},claim.jobId)).not.toBeNull();
 expect(await store.status({kind:'user',id:'other'},claim.jobId)).toBeNull();
 expect(await store.status({kind:'anonymous'},claim.jobId)).toBeNull();
 expect(await store.status({kind:'system'},claim.jobId)).toBeNull();
 // Token expiry is read against the store's clock: an hour later the same token reads nothing.
 tick(3_600_000);
 expect(await store.status(token,claim.jobId)).toBeNull();expect(await store.list(token,'run1')).toEqual([]);expect(await store.retry(token,claim.jobId)).toBe(false);
 expect(await store.status({kind:'user',id:'manager'},claim.jobId)).not.toBeNull();
 // A merged or expired account loses its own job.
 await db.query("UPDATE users SET merged_into_user_id='other' WHERE id='alice'");
 expect(await store.status({kind:'user',id:'alice'},claim.jobId)).toBeNull();
 await db.query("UPDATE users SET merged_into_user_id=NULL,expires_at='2026-01-01T02:00:00Z' WHERE id='alice'");
 expect(await store.status({kind:'user',id:'alice'},claim.jobId)).not.toBeNull();
 tick(3_600_000);expect(await store.retry({kind:'user',id:'alice'},claim.jobId)).toBe(false);
 await db.query("UPDATE tokens SET expires_at=NULL,deleted_at=now() WHERE id='tok'");
 expect(await store.status(token,claim.jobId)).toBeNull();
});

it('admits only live, unmerged, unblocked recipients at the clock time and records the admitted plan',async()=>{
 const {db,store}=await fixture();
 await db.query("INSERT INTO users(id,expires_at) VALUES('leaving','2026-01-01T00:00:30Z'),('merged',NULL)");
 await db.query("UPDATE users SET merged_into_user_id='bob' WHERE id='merged'");
 await db.query("INSERT INTO user_blocks(user_id,blocked_user_id) VALUES('carol','alice')");
 const claim=(await store.claim())!;tick(31_000);
 expect(await store.complete(claim,plan(['bob','carol','leaving','merged','ghost','bob']))).toBe(true);
 expect((await db.query('SELECT recipient_id,messages FROM mutation_notifications')).rows).toEqual([{recipient_id:'bob',messages:['Changed']}]);
 expect((await db.query<{plan:MutationNotificationPlan}>('SELECT plan FROM notification_jobs')).rows[0]!.plan.rules[0]!.rows[0]!.recipientIds).toEqual(['bob']);
 expect((await db.query("SELECT envelope->>'object_id' AS id FROM event_outbox WHERE envelope->>'verb'='notification_changed'")).rows).toEqual([{id:'bob'}]);
});

it('refuses plan output that breaks the row contract before writing anything',async()=>{
 const {db,store}=await fixture(),claim=(await store.claim())!;
 const rows=(row:object)=>({...plan([]),rules:[{ruleName:'only',rows:[row],sources:[]}]}) as MutationNotificationPlan;
 await expect(store.complete(claim,rows({recipientIds:['bob'],message:'  '}))).rejects.toMatchObject({code:'notification_output_invalid'});
 await expect(store.complete(claim,rows({recipientIds:[''],message:'x'}))).rejects.toMatchObject({code:'notification_output_invalid'});
 await expect(store.complete(claim,{...plan(['bob']),rules:[{...plan(['bob']).rules[0]!,ruleName:'renamed'}]})).rejects.toMatchObject({code:'notification_context_invalid'});
 expect((await db.query('SELECT id FROM mutation_notifications')).rows).toEqual([]);
 expect(await store.complete(claim,plan(['bob']))).toBe(true);
});
