import {describe,it,expect} from 'vitest';
import {useAppHarness,request} from './harness';
import {POST as createArtifactRoute} from '@/app/api/artifacts/route';
import {createUser} from '@/lib/users';
import {mintToken} from '@/lib/tokens';
import {getDb} from '@/lib/db';
import {notificationExecutionFence,notificationSourcesReadable,canManageNotificationDocument,validateNotificationPlan} from '@/lib/notification-authority';
import {compiledOf} from '@/test/helpers/compiled';
import {notificationContextSnapshot,evaluateNotificationQuery} from '@/lib/notification-query';
import type {MutationNotificationJobInput} from '@artifactbin/contracts';
useAppHarness();
const setup=async()=>{
 const owner=await createUser({email:'notification-owner@example.com'}),other=await createUser({email:'notification-other@example.com'}),token=await mintToken('notify',owner.id);
 const create=async(body:Record<string,unknown>)=>(await createArtifactRoute(request('/api/artifacts',{method:'POST',token:token.token,json:body}))).json();
 const document=await create({markup:'<p>Notifications</p>',visibility:'unlisted'}),dataset=await create({dataset:[{n:1}],visibility:'private'});
 const input:MutationNotificationJobInput={origin:{mutationRunId:'run',documentId:document.id,documentEditId:'edit',documentVersion:1,mutationName:'change',ruleId:'notice'},initiator:{principal:{kind:'token',id:token.id},execution:'agent',agentLabel:null},rule:{name:'notice',on:'change',sql:'select 1'},bindings:{values:{},types:{},userId:owner.id,now:'2026-09-01T00:00:00.000Z',tz:'UTC'},contextRevision:'context',contextSnapshot:{}};
 return {owner,other,token,document,dataset,input,db:await getDb()};
};
describe('transaction-only notification authority',()=>{
 it('fences live principal and document even when the SQL has no sources',async()=>{const f=await setup();const before=await notificationExecutionFence(f.db,f.input);expect(before.principalRevision).not.toBe('');await f.db.query('UPDATE tokens SET deleted_at=now() WHERE id=$1',[f.token.id]);await expect(notificationExecutionFence(f.db,f.input)).rejects.toMatchObject({code:'notification_access_revoked'});});
 it('requires every source, not just public document access',async()=>{const f=await setup();const sources=[{artifactId:f.dataset.id,schema:'public',table:'rows',authorityRevision:'',schemaRevision:''}];expect(await notificationSourcesReadable(f.db,f.document.id,f.other.id,sources)).toBe(false);expect(await notificationSourcesReadable(f.db,f.document.id,f.owner.id,sources)).toBe(true);});
 it('admits current managers but not ordinary readers',async()=>{const f=await setup();expect(await canManageNotificationDocument(f.db,{kind:'user',id:f.owner.id},f.document.id)).toBe(true);expect(await canManageNotificationDocument(f.db,{kind:'user',id:f.other.id},f.document.id)).toBe(false);});

 it('executes a retained compilation after live declaration removal; source-free plans still validate',async()=>{
  const f=await setup(),flow=await compiledOf('<Mutation name="change">{`UPDATE tasks.rows SET n=n+1`}</Mutation><Import name="tasks" src="ref:'+f.dataset.id+'" /><Notify name="notice" on="change">{`SELECT $_me.id AS "to", \'saved\' AS message`}</Notify>',{[f.dataset.id]:[{name:'n',type:'number'}]});
  const input={...f.input,...notificationContextSnapshot(flow),rule:flow.notifications![0]!};
  await f.db.query("UPDATE artifacts SET meta='{}'::jsonb WHERE id=$1",[f.document.id]);
  const plan=await evaluateNotificationQuery(input);
  expect(plan.rows).toEqual([{recipientIds:[f.owner.id],message:'saved'}]);
  await expect(validateNotificationPlan(f.db,input,plan)).resolves.toBeUndefined();
  await f.db.query("UPDATE artifacts SET visibility='private',user_id=$2 WHERE id=$1",[f.document.id,f.other.id]);
  await expect(validateNotificationPlan(f.db,input,plan)).rejects.toMatchObject({code:'notification_access_revoked'});
 });
 it('loads exact current relations and includes predicate-only sources in disclosure',async()=>{
  const f=await setup(),filter=(await createArtifactRoute(request('/api/artifacts',{method:'POST',token:f.token.token,json:{dataset:[{ok:1}],visibility:'private'}}))).json();
  const other=await filter;
  const flow=await compiledOf('<Import name="tasks" src="ref:'+f.dataset.id+'" /><Import name="filter_data" src="ref:'+other.id+'" /><Mutation name="change">{`UPDATE tasks.rows SET n=n+1`}</Mutation><Notify name="notice" on="change">{`SELECT $_me.id AS "to", CAST(n AS TEXT) AS message FROM tasks.rows WHERE EXISTS(SELECT 1 FROM filter_data.rows)`}</Notify>',{[f.dataset.id]:[{name:'n',type:'number'}],[other.id]:[{name:'ok',type:'number'}]});
  const input={...f.input,...notificationContextSnapshot(flow),rule:flow.notifications![0]!},plan=await evaluateNotificationQuery(input);
  expect(plan.sources.map(source=>source.artifactId).sort()).toEqual([f.dataset.id,other.id].sort());
  expect(plan.rows).toEqual([{recipientIds:[f.owner.id],message:'1.0'}]);
  await expect(validateNotificationPlan(f.db,input,plan)).resolves.toBeUndefined();
  await expect(validateNotificationPlan(f.db,input,{...plan,sources:plan.sources.slice(0,1)})).rejects.toMatchObject({code:'notification_context_invalid'});
  await f.db.query("UPDATE artifacts SET dataset_policy=$2::jsonb,policy_revision=policy_revision+1 WHERE id=$1",[other.id,JSON.stringify({version:2,allow:[]})]);
  await expect(validateNotificationPlan(f.db,input,plan)).rejects.toThrow();
 });
 it('rejects expired/foreign-scope tokens and deleted current documents',async()=>{
  const f=await setup();
  await f.db.query("UPDATE tokens SET audience='https://elsewhere.invalid/api',scope='artifacts' WHERE id=$1",[f.token.id]);
  await expect(notificationExecutionFence(f.db,f.input)).rejects.toMatchObject({code:'notification_access_revoked'});
  await f.db.query("UPDATE tokens SET audience=NULL,expires_at=now()-interval '1 second' WHERE id=$1",[f.token.id]);
  await expect(notificationExecutionFence(f.db,f.input)).rejects.toMatchObject({code:'notification_access_revoked'});
 });
});
