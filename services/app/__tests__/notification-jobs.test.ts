import {expect,it} from 'vitest';
import type {MutationNotificationJobInput,MutationNotificationPlan} from '@artifactbin/contracts';
import {useAppHarness} from './harness';
import {eraseTestUser} from '@/lib/testusers';
import {getDb} from '@/lib/db';
import {notificationAuthority} from '@/lib/notification-authority';
import {seedOwnerJoin} from '@/lib/relation-state';
import {createNotificationJobStore,type NotificationJobAuthority} from '@/lib/notification-jobs';
useAppHarness();
const input:MutationNotificationJobInput={
 origin:{mutationRunId:'run1',documentId:'doc',documentEditId:'edit',documentVersion:1,mutationName:'change'},
 initiator:{principal:{kind:'user',id:'alice'},execution:'human',agentLabel:null},
 rules:[{name:'first',on:'change',sql:'SELECT 1'},{name:'second',on:'change',sql:'SELECT 2'}],
 bindings:{values:{},types:{},userId:'alice',now:'2026-01-01T00:00:00Z',tz:'UTC'},contextRevision:'context',contextSnapshot:{version:1}
};
const plan:MutationNotificationPlan={executionFence:{principalRevision:'p',documentRevision:'d',contextRevision:'context'},rules:[
 {ruleName:'first',rows:[{recipientIds:['bob','bob'],message:'Changed'},{recipientIds:['bob'],message:'Review requested'}],sources:[{artifactId:'source1',authorityRevision:'a',schemaRevision:'s'}]},
 {ruleName:'second',rows:[{recipientIds:['bob'],message:'Changed'}],sources:[{artifactId:'source2',authorityRevision:'b',schemaRevision:'s'}]}
]};
const authority:NotificationJobAuthority={validatePlan:async()=>{},admitRecipients:async(_tx,_input,_plan,ids)=>ids,canManage:async(_tx,p)=>p.kind==='user'&&p.id==='manager'};
async function fixture(){
 const db=await getDb();await db.query("INSERT INTO users(id) VALUES('alice'),('bob'),('manager'),('reader')");
 let now=new Date('2026-01-01T00:00:00Z');
 return {db,store:createNotificationJobStore({db,authority,clock:()=>now}),advance:()=>{now=new Date(now.getTime()+61_000);}};
}
it('enqueues one immutable job containing all rules per mutation run',async()=>{
 const {db,store}=await fixture();await db.transaction(async tx=>{await store.enqueue(tx,input);await store.enqueue(tx,input);});
 const claim=await store.claim();expect(claim?.input).toEqual(input);expect(await store.claim()).toBeNull();
 expect(await store.list(input.initiator.principal,'run1')).toHaveLength(1);
});
it('rolls scheduling back with the original mutation transaction',async()=>{
 const {db,store}=await fixture();await expect(db.transaction(async tx=>{await store.enqueue(tx,input);throw Error('write rolled back');})).rejects.toThrow('write rolled back');expect(await store.claim()).toBeNull();
});
it('combines all rows and rules into one item and one delivery event for a recipient',async()=>{
 const {db,store}=await fixture();await db.transaction(tx=>store.enqueue(tx,input));const claim=(await store.claim())!;expect(claim).not.toBeNull();
 expect(await store.complete(claim,plan)).toBe(true);expect(await store.complete(claim,plan)).toBe(false);
 expect((await db.query('SELECT mutation_run_id,recipient_id,messages,sources FROM mutation_notifications')).rows).toEqual([{mutation_run_id:'run1',recipient_id:'bob',messages:['Changed','Review requested'],sources:plan.rules.flatMap(rule=>rule.sources)}]);
 const events=(await db.query('SELECT envelope FROM event_outbox')).rows;expect(events).toHaveLength(1);expect(JSON.stringify(events)).not.toContain('Changed');
});
it('publishes nothing until all rules succeed and only once after a retry',async()=>{
 const {db,store}=await fixture();await db.transaction(tx=>store.enqueue(tx,input));const claim=(await store.claim())!;expect(claim).not.toBeNull();
 await expect(store.complete(claim,{...plan,rules:plan.rules.slice(0,1)})).rejects.toMatchObject({code:'notification_context_invalid'});
 await store.fail(claim,'notification_query_invalid',false);
 expect((await db.query('SELECT * FROM mutation_notifications')).rows).toEqual([]);expect((await db.query('SELECT * FROM event_outbox')).rows).toEqual([]);
 expect(await store.retry(input.initiator.principal,claim.jobId)).toBe(true);const retried=(await store.claim())!;expect(retried.input).toEqual(input);
 expect(await store.complete(retried,plan)).toBe(true);expect((await db.query('SELECT id FROM event_outbox')).rows).toHaveLength(1);
});
it('fences stale workers and keeps an intentional later run distinct',async()=>{
 const {db,store,advance}=await fixture();await db.transaction(tx=>store.enqueue(tx,input));const old=(await store.claim())!;expect(old).not.toBeNull();advance();
 const claim=(await store.claim())!;expect(claim.generation).toBe(old.generation+1);expect(await store.renew(old)).toBe(false);expect(await store.complete(old,plan)).toBe(false);expect(await store.fail(old,'notification_query_invalid',false)).toBe(false);
 expect(await store.complete(claim,plan)).toBe(true);await db.transaction(tx=>store.enqueue(tx,{...input,origin:{...input.origin,mutationRunId:'run2'}}));
 expect(await store.complete((await store.claim())!,plan)).toBe(true);expect((await db.query('SELECT id FROM mutation_notifications')).rows).toHaveLength(2);
});
it('completes a successful empty run without publication',async()=>{
 const {db,store}=await fixture();await db.transaction(tx=>store.enqueue(tx,input));const claim=(await store.claim())!;expect(claim).not.toBeNull();
 expect(await store.complete(claim,{...plan,rules:plan.rules.map(rule=>({...rule,rows:[]}))})).toBe(true);
 expect((await store.status(input.initiator.principal,claim.jobId))?.status).toBe('completed');expect(await store.claim()).toBeNull();
});
it('atomically rolls all inbox rows back if event insertion fails while retaining the run',async()=>{
 const {db,store}=await fixture();await db.transaction(tx=>store.enqueue(tx,input));const claim=(await store.claim())!;expect(claim).not.toBeNull();
 await db.query("ALTER TABLE event_outbox ADD CONSTRAINT reject_notification CHECK(envelope->>'verb'<>'notification_changed')");
 try{await expect(store.complete(claim,plan)).rejects.toThrow();expect((await db.query('SELECT * FROM mutation_notifications')).rows).toEqual([]);expect((await db.query('SELECT status,plan FROM notification_jobs')).rows).toEqual([{status:'running',plan:null}]);}
 finally{await db.query('ALTER TABLE event_outbox DROP CONSTRAINT reject_notification');}
 expect(await store.complete(claim,plan)).toBe(true);
});
it('preserves frozen initiating account status/retry authority after token reassignment',async()=>{
 const {db,store}=await fixture();await db.query("INSERT INTO tokens(id,token_hash,user_id) VALUES('token','hash','alice')");const tokenInput={...input,initiator:{...input.initiator,principal:{kind:'token' as const,id:'token'}}};
 await db.transaction(tx=>store.enqueue(tx,tokenInput));const claim=(await store.claim())!;expect(claim).not.toBeNull();await store.fail(claim,'notification_source_invalid',false);
 await db.query("UPDATE tokens SET user_id='reader' WHERE id='token'");expect(await store.status({kind:'user',id:'reader'},claim.jobId)).toBeNull();expect(await store.retry({kind:'user',id:'reader'},claim.jobId)).toBe(false);
 expect((await store.status({kind:'user',id:'alice'},claim.jobId))?.error_code).toBe('notification_source_invalid');expect(await store.retry({kind:'user',id:'alice'},claim.jobId)).toBe(true);expect((await store.claim())?.input).toEqual(tokenInput);
});
it('rechecks recipient authority against all source contributions even for duplicate messages',async()=>{
 const {db}=await fixture();let inspected=false;
 const store=createNotificationJobStore({db,authority:{...authority,admitRecipients:async(tx,_input,current,ids)=>{expect(current.rules.flatMap(rule=>rule.sources).map(source=>source.artifactId)).toEqual(['source1','source2']);expect((await tx.query('SELECT id FROM users WHERE id=ANY($1::text[])',[ids])).rows).toHaveLength(1);inspected=true;return [];}}});
 await db.transaction(tx=>store.enqueue(tx,input));const claim=(await store.claim())!;expect(claim).not.toBeNull();expect(await store.complete(claim,plan)).toBe(true);expect(inspected).toBe(true);expect((await db.query('SELECT id FROM mutation_notifications')).rows).toEqual([]);
});
it('refuses aggregate row and materialized-byte overflow across rules without partial output',async()=>{
 const {db,store}=await fixture();await db.transaction(tx=>store.enqueue(tx,input));const claim=(await store.claim())!;
 const row={recipientIds:['bob'],message:'Changed'};
 await expect(store.complete(claim,{...plan,rules:[{...plan.rules[0]!,rows:Array.from({length:600},()=>row)},{...plan.rules[1]!,rows:Array.from({length:401},()=>row)}]})).rejects.toMatchObject({code:'notification_capacity',retryable:false});
 const expanded={...plan,rules:[{...plan.rules[0]!,rows:Array.from({length:1000},(_,i)=>({recipientIds:Array.from({length:20},(_,n)=>`recipient${n}`),message:String(i).padEnd(500,'x')}))},{...plan.rules[1]!,rows:[]}]};
 await expect(store.complete(claim,expanded)).rejects.toMatchObject({code:'notification_capacity'});
 expect((await db.query('SELECT id FROM mutation_notifications')).rows).toEqual([]);
});
it('rechecks source-free authority using immutable stored input and completes no revoked run',async()=>{
 const {db}=await fixture();let checked=false;const store=createNotificationJobStore({db,authority:{...authority,validatePlan:async(tx,saved)=>{expect(saved.initiator.principal).toEqual(input.initiator.principal);checked=(await tx.query("SELECT id FROM users WHERE id='alice'")).rows.length===1;throw Error('authority revoked');}}});
 await db.transaction(tx=>store.enqueue(tx,input));const claim=(await store.claim())!;claim.input.initiator.principal={kind:'system'};
 await expect(store.complete(claim,{...plan,rules:plan.rules.map(rule=>({...rule,rows:[],sources:[]}))})).rejects.toThrow('authority revoked');expect(checked).toBe(true);
 expect((await db.query('SELECT status,plan FROM notification_jobs')).rows).toEqual([{status:'running',plan:null}]);
});
it('allows human-self recipients while suppressing blocked and expired recipients and isolates testuser-origin output',async()=>{
 const {db,store}=await fixture();await db.query("INSERT INTO users(id,expires_at) VALUES('blocked',NULL),('blocker',NULL),('expired','2025-01-01')");await db.query("INSERT INTO user_blocks VALUES('alice','blocked'),('blocker','alice')");
 await db.transaction(tx=>store.enqueue(tx,input));const claim=(await store.claim())!;const audience={...plan,rules:plan.rules.map(rule=>({...rule,rows:[{recipientIds:['alice','bob','blocked','blocker','expired','missing'],message:'Changed'}]}))};
 expect(await store.complete(claim,audience)).toBe(true);expect((await db.query('SELECT recipient_id FROM mutation_notifications ORDER BY recipient_id')).rows).toEqual([{recipient_id:'alice'},{recipient_id:'bob'}]);
 await db.query("UPDATE users SET kind='testuser' WHERE id='alice'");const agent={...input,origin:{...input.origin,mutationRunId:'run2'},initiator:{...input.initiator,execution:'agent' as const}};
 await db.transaction(tx=>store.enqueue(tx,agent));expect(await store.complete((await store.claim())!,audience)).toBe(true);
 expect((await db.query("SELECT recipient_id FROM mutation_notifications WHERE mutation_run_id='run2'")).rows).toEqual([{recipient_id:'alice'}]);
});
it('renews active leases, rejects expired transitions and bounds recovery with safe errors',async()=>{
 const {db,store,advance}=await fixture();await db.transaction(tx=>store.enqueue(tx,input));const claim=(await store.claim())!;expect(await store.renew(claim)).toBe(true);advance();expect(await store.complete(claim,plan)).toBe(false);expect(await store.fail(claim,'notification_query_invalid',false)).toBe(false);
 const next=(await store.claim())!;expect(await store.fail(next,'SELECT secret FROM private',true)).toBe(true);expect(await store.claim()).toBeNull();expect((await store.status(input.initiator.principal,next.jobId))?.error_code).toBe('notification_execution_failed');advance();expect((await store.claim())?.generation).toBe(next.generation+1);
});
it('allows only one competing worker and denies revoked token or expired initiating account status',async()=>{
 const {db,store}=await fixture();await db.query("INSERT INTO tokens(id,token_hash,user_id) VALUES('token','hash','alice')");const value={...input,initiator:{...input.initiator,principal:{kind:'token' as const,id:'token'}}};
 await db.transaction(tx=>store.enqueue(tx,value));const claims=await Promise.all([store.claim(),store.claim()]);expect(claims.filter(Boolean)).toHaveLength(1);const claim=claims.find(Boolean)!;
 await store.fail(claim,'notification_query_invalid',false);await db.query("UPDATE tokens SET deleted_at=now() WHERE id='token'");expect(await store.status(value.initiator.principal,claim.jobId)).toBeNull();expect(await store.retry(value.initiator.principal,claim.jobId)).toBe(false);
 await db.query("UPDATE users SET expires_at='2025-01-01' WHERE id='alice'");expect(await store.list({kind:'user',id:'alice'},'run1')).toEqual([]);expect(await store.retry({kind:'user',id:'alice'},claim.jobId)).toBe(false);
});
it('preserves an already frozen run when an inconsistent second enqueue is refused',async()=>{
 const {db,store}=await fixture();await db.transaction(tx=>store.enqueue(tx,input));await expect(db.transaction(tx=>store.enqueue(tx,{...input,rules:input.rules.slice(0,1)}))).rejects.toMatchObject({code:'notification_context_invalid'});expect((await store.claim())?.input).toEqual(input);
});
it('erases disposable origin runs, aggregated output and pending delivery with the account',async()=>{
 const {db,store}=await fixture();await db.query("UPDATE users SET kind='testuser' WHERE id IN ('alice','bob')");await db.transaction(tx=>store.enqueue(tx,input));await store.complete((await store.claim())!,plan);
 expect((await db.query('SELECT id FROM mutation_notifications')).rows).toHaveLength(1);await eraseTestUser('alice');
 expect((await db.query('SELECT id FROM notification_jobs')).rows).toEqual([]);expect((await db.query('SELECT id FROM mutation_notifications')).rows).toEqual([]);expect((await db.query('SELECT id FROM event_outbox')).rows).toEqual([]);
});
it('rolls earlier recipient batches back when the final batch cannot enqueue delivery',async()=>{
 const {db,store}=await fixture();const ids=Array.from({length:101},(_,i)=>`recipient${i}`);await db.query('INSERT INTO users(id) SELECT unnest($1::text[])',[ids]);
 await db.transaction(tx=>store.enqueue(tx,input));const claim=(await store.claim())!;
 const many={...plan,rules:[{...plan.rules[0]!,rows:ids.map(id=>({recipientIds:[id],message:'Changed'}))},{...plan.rules[1]!,rows:[]}]};
 await db.query("ALTER TABLE event_outbox ADD CONSTRAINT reject_last CHECK(envelope->>'object_id'<>'recipient100')");
 try{await expect(store.complete(claim,many)).rejects.toThrow();expect((await db.query('SELECT id FROM mutation_notifications')).rows).toEqual([]);expect((await db.query('SELECT id FROM event_outbox')).rows).toEqual([]);expect((await db.query('SELECT status,plan FROM notification_jobs')).rows).toEqual([{status:'running',plan:null}]);}
 finally{await db.query('ALTER TABLE event_outbox DROP CONSTRAINT reject_last');}
 expect(await store.complete(claim,many)).toBe(true);expect((await db.query('SELECT id FROM mutation_notifications')).rows).toHaveLength(101);
});
it('materializes the 2000-recipient run bound once per user across duplicate rule outputs',async()=>{
 const {db,store}=await fixture();const ids=Array.from({length:2000},(_,i)=>`recipient${i}`);await db.query('INSERT INTO users(id) SELECT unnest($1::text[])',[ids]);
 const rows=Array.from({length:100},(_,i)=>({recipientIds:ids.slice(i*20,(i+1)*20),message:'Changed'}));
 await db.transaction(tx=>store.enqueue(tx,input));expect(await store.complete((await store.claim())!,{...plan,rules:plan.rules.map(rule=>({...rule,rows}))})).toBe(true);
 expect((await db.query<{count:number}>('SELECT count(*)::int AS count FROM mutation_notifications')).rows[0]?.count).toBe(2000);
 expect((await db.query<{count:number}>('SELECT count(*)::int AS count FROM event_outbox')).rows[0]?.count).toBe(2000);
 expect((await db.query<{messages:string[]}>('SELECT messages FROM mutation_notifications LIMIT 1')).rows[0]?.messages).toEqual(['Changed']);
});

it('delivers human self notifications only while explicitly joined',async()=>{
 const {db}=await fixture();
 await db.query("INSERT INTO tokens(id,token_hash,user_id) VALUES('self-token','self-hash','alice')");
 await db.query("INSERT INTO artifacts(id,token_id,user_id,format,visibility) VALUES('doc','self-token','alice','markup','public')");
 const store=createNotificationJobStore({db,authority:{...authority,admitRecipients:notificationAuthority.admitRecipients}});
 const selfPlan={...plan,rules:plan.rules.map(rule=>({...rule,sources:[],rows:[{recipientIds:['alice'],message:'You changed your task'}]}))};
 await db.transaction(tx=>store.enqueue(tx,input));await store.complete((await store.claim())!,selfPlan);
 expect((await db.query('SELECT id FROM mutation_notifications')).rows).toEqual([]);
 await seedOwnerJoin(db,'doc','alice');
 await db.transaction(tx=>store.enqueue(tx,{...input,origin:{...input.origin,mutationRunId:'joined'}}));await store.complete((await store.claim())!,selfPlan);
 expect((await db.query('SELECT mutation_run_id,recipient_id,messages FROM mutation_notifications')).rows).toEqual([{mutation_run_id:'joined',recipient_id:'alice',messages:['You changed your task']}]);
 expect((await db.query('SELECT id FROM event_outbox')).rows).toHaveLength(1);
 await db.query("UPDATE relations SET status='left',deleted_at=now() WHERE subject_id='alice'");
 await db.transaction(tx=>store.enqueue(tx,{...input,origin:{...input.origin,mutationRunId:'left'}}));await store.complete((await store.claim())!,selfPlan);
 expect((await db.query('SELECT id FROM mutation_notifications')).rows).toHaveLength(1);
});
