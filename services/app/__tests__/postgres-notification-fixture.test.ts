/** Retained internal notification jobs with native page authority and real membership/inbox HTTP.
 * Native author notification declarations are not exposed; only the external SQL adapter is deterministic. */
import {expect,it} from 'vitest';
import type {Actor} from '@artifactbin/contracts';
import {request,useAppHarness} from './harness';
import {POST as create} from '@/app/api/my/artifacts/route';
import {POST as membership} from '@/app/api/my/artifacts/[id]/members/route';
import {PUT as sharing} from '@/app/api/my/artifacts/[id]/sharing/route';
import {notificationMutationFixture} from './notification-mutation-fixture';
import {mintAccountToken} from './harness';
import {GET as jobs} from '@/app/api/notification-runs/[runId]/jobs/route';
import {GET as inbox} from '@/app/api/my/people/route';
import { getArtifactById } from '@/lib/artifacts';
import { notificationJobStore, evaluateNotificationQuery } from '@/lib/document-data';
import {loadDatasetRows} from '@/lib/datasets/dataset-store';
import {createUser} from '@/lib/accounts';
import {overrideCatalogExecutor} from '@/lib/datasets/execute';
import {createNotificationWorker} from '@/lib/notifications';
import {modelNoticeSql,physicalNoticeSql,invalidRecipientSql} from '../../../scripts/fixtures/postgres-notifications.mjs';
useAppHarness();
it('retains create/join/approve/job/inbox authority, including suppressed and failed internal runs',async()=>{
 const owner=await createUser({email:'mxmx_test_pg_fixture_owner@example.com'}),recipient=await createUser({email:'mxmx_test_pg_fixture_recipient@example.com'});
 const actor=(user:typeof owner):Actor=>({credential:'session',userId:user.id,email:user.email!,emailVerified:true});
 const ownerActor=actor(owner),recipientActor=actor(recipient);
 const body=async(response:Response,status=200)=>{expect(response.status,await response.clone().text()).toBe(status);return response.json();};
 const context=(id:string)=>({params:Promise.resolve({id})});
 const publish=async(json:unknown)=>body(await create(request('/api/my/artifacts',{method:'POST',origin:'same',actor:ownerActor,json})),201);
 const share=async(id:string,visibility:string)=>body(await sharing(request(`/api/my/artifacts/${id}/sharing`,{method:'PUT',origin:'same',actor:ownerActor,json:{visibility}}),context(id)));
 const token=await mintAccountToken('pg-notification-internal',owner.id);
 const trigger=await publish({access:'readwrite',dataset:[{n:0}]});
 const model=await publish({dataset:[{total:155}],visibility:'unlisted'}),physical=await publish({dataset:[{id:1}],visibility:'unlisted'});
 await share(trigger.id,'unlisted');
 overrideCatalogExecutor(async(_catalog,sql,params)=>{
  expect([modelNoticeSql,physicalNoticeSql,invalidRecipientSql]).toContain(sql);
  const to=params?.recipient??recipient.id;
  return {refreshedAt:'2026-09-29T00:00:00Z',columns:[{name:'to',type:'string'},{name:'message',type:'string'}],rows:[{to:sql===modelNoticeSql?[to,to]:sql===invalidRecipientSql?JSON.stringify([to]):to,message:sql===physicalNoticeSql?'Order 1':sql===modelNoticeSql?'West total 155':'Invalid recipient representation'}]};
 });
 const join=async(id:string)=>{
  await body(await membership(request(`/api/my/artifacts/${id}/members`,{method:'POST',origin:'same',actor:recipientActor,json:{action:'join'}}),context(id)));
  await body(await membership(request(`/api/my/artifacts/${id}/members`,{method:'POST',origin:'same',actor:ownerActor,json:{action:'approve',userId:recipient.id}}),context(id)));
 };
 const nativePage={html:'<!doctype html><html><body>Notification contract</body></html>',visibility:'unlisted'};
 const notice=await publish(nativePage);await join(notice.id);
 const send=async(id:string,invalid=false)=>{
  const doc=(await getArtifactById(id))!;
  const rules=[{name:'model_notice',sql:modelNoticeSql,source:model.id},{name:'duplicate_notice',sql:modelNoticeSql,source:model.id},{name:'physical_notice',sql:physicalNoticeSql,source:physical.id},...(invalid?[{name:'invalid_notice',sql:invalidRecipientSql,source:model.id}]:[])];
  return notificationMutationFixture(token,doc,trigger,'update tasks.rows set n=n+$amount',rules,{values:{recipient:recipient.id},types:{recipient:'string'}})(crypto.randomUUID(),'browser');
 };
 const worker=createNotificationWorker({store:await notificationJobStore(),evaluator:{evaluate:evaluateNotificationQuery}});
 const run=async(id:string,invalid=false)=>{
  const result=await body(await send(id,invalid));
  expect(result).toMatchObject({affected:1,mutationRunId:expect.any(String)});
  expect(await worker.drainOnce()).toBe(true);
  const listed=await body(await jobs(request(`/api/notification-runs/${result.mutationRunId}/jobs`,{actor:ownerActor}),{params:Promise.resolve({runId:result.mutationRunId})}));
  expect(listed.jobs).toHaveLength(1);return {runId:result.mutationRunId,job:listed.jobs[0]};
 };
 const received=async(runId:string)=>{
  const result=await body(await inbox(request('/api/my/people',{actor:recipientActor})));
  return result.notifications.filter((n:{kind:string;mutation_run_id?:string})=>n.kind==='mutation'&&n.mutation_run_id===runId);
 };
 const first=await run(notice.id);expect(first.job.status).toBe('completed');
 expect([...first.job.notification_names].sort()).toEqual(['duplicate_notice','model_notice','physical_notice']);
 const delivered=await received(first.runId);expect(delivered).toHaveLength(1);expect([...delivered[0].messages].sort()).toEqual(['Order 1','West total 155']);
 await share(model.id,'private');expect(await received(first.runId)).toEqual([]);
 const suppressed=await run(notice.id);expect(suppressed.runId).not.toBe(first.runId);expect(suppressed.job.status).toBe('completed');expect(await received(suppressed.runId)).toEqual([]);
 await share(model.id,'unlisted');expect(await received(suppressed.runId)).toEqual([]);
 const invalid=await publish(nativePage);await join(invalid.id);
 const failed=await run(invalid.id,true);expect(failed.job.status).toBe('failed');expect(await received(failed.runId)).toEqual([]);
});

it('a joined shared editor receives one aggregated notification per retained internal completion',async()=>{
 overrideCatalogExecutor(undefined);
 const owner=await createUser({email:'mxmx_test_demo_owner@example.com'}),reader=await createUser({email:'mxmx_test_demo_reader@example.com'});
 const actor=(user:typeof owner):Actor=>({credential:'session',userId:user.id,email:user.email!,emailVerified:true});
 const ownerActor=actor(owner),readerActor=actor(reader),token=await mintAccountToken('notification-shared-editor',reader.id);
 const body=async(response:Response,status=200)=>{expect(response.status,await response.clone().text()).toBe(status);return response.json();};
 const context=(id:string)=>({params:Promise.resolve({id})});
 const publish=async(json:unknown)=>body(await create(request('/api/my/artifacts',{method:'POST',origin:'same',actor:ownerActor,json})),201);
 const dataset=await publish({access:'readwrite',dataset:[{n:0}]});
 await body(await sharing(request(`/api/my/artifacts/${dataset.id}/sharing`,{method:'PUT',origin:'same',actor:ownerActor,json:{visibility:'unlisted',shares:[{email:reader.email,role:'editor'}]}}),context(dataset.id)));
 const document=await publish({html:'<!doctype html><html><body>Tasks</body></html>',visibility:'unlisted'});
 await body(await membership(request(`/api/my/artifacts/${document.id}/members`,{method:'POST',origin:'same',actor:readerActor,json:{action:'join'}}),context(document.id)));
 await body(await membership(request(`/api/my/artifacts/${document.id}/members`,{method:'POST',origin:'same',actor:ownerActor,json:{action:'approve',userId:reader.id}}),context(document.id)));
 const worker=createNotificationWorker({store:await notificationJobStore(),evaluator:{evaluate:evaluateNotificationQuery}});
 const send=notificationMutationFixture(token,(await getArtifactById(document.id))!,dataset,'update tasks.rows set n=n+$amount',[{name:'completed',sql:`select '${reader.id}' as "to", 'Task Review pricing is now Done' as message`},{name:'review',sql:`select '${reader.id}' as "to", 'Please review Review pricing' as message`}]);
 for(let i=1;i<=2;i++){
  const completed=await body(await send(crypto.randomUUID(),'browser'));expect(completed).toMatchObject({affected:1,mutationRunId:expect.any(String)});
  expect(await loadDatasetRows((await getArtifactById(dataset.id))!)).toEqual([{n:i}]);
  expect(await worker.drainOnce()).toBe(true);
  const result=await body(await inbox(request('/api/my/people',{actor:readerActor})));
  const received=result.notifications.filter((n:{kind:string;mutation_run_id?:string})=>n.kind==='mutation'&&n.mutation_run_id===completed.mutationRunId);
  expect(received).toHaveLength(1);expect([...received[0].messages].sort()).toEqual(['Please review Review pricing','Task Review pricing is now Done']);expect(await worker.drainOnce()).toBe(false);
 }
});
