/** Real gate HTTP setup/job/inbox contracts; only the external SQL adapter is deterministic. */
import {expect,it,vi} from 'vitest';
import type {Actor} from '@artifactbin/contracts';
import {request,useAppHarness} from './harness';
import {POST as create} from '@/app/api/my/artifacts/route';
import {POST as membership} from '@/app/api/my/artifacts/[id]/members/route';
import {PUT as sharing} from '@/app/api/my/artifacts/[id]/sharing/route';
import {POST as mutate} from '@/app/a/[id]/mutate/route';
import {GET as jobs} from '@/app/api/notification-runs/[runId]/jobs/route';
import {GET as inbox} from '@/app/api/my/people/route';
import {createUser} from '@/lib/users';
import {executeCatalog} from '@/lib/datasets/execute';
import {notificationJobStore} from '@/lib/notification-runtime';
import {evaluateNotificationQuery} from '@/lib/notification-query';
import {createNotificationWorker} from '@/lib/notification-worker';
import {notificationDocumentPayload,notificationMutationPayload,modelNoticeSql,physicalNoticeSql,invalidRecipientSql} from '../../../scripts/fixtures/postgres-notifications.mjs';
vi.mock('@/lib/datasets/execute',async importOriginal=>{
 const actual=await importOriginal<typeof import('@/lib/datasets/execute')>();
 return {...actual,executeCatalog:vi.fn(actual.executeCatalog)};
});
useAppHarness();
it('uses the gate create/join/approve/mutate/job/inbox payloads, including suppressed and failed runs',async()=>{
 const owner=await createUser({email:'mxmx_test_pg_fixture_owner@example.com'}),recipient=await createUser({email:'mxmx_test_pg_fixture_recipient@example.com'});
 const actor=(user:typeof owner):Actor=>({credential:'session',userId:user.id,email:user.email!,emailVerified:true});
 const ownerActor=actor(owner),recipientActor=actor(recipient);
 const body=async(response:Response,status=200)=>{expect(response.status,await response.clone().text()).toBe(status);return response.json();};
 const context=(id:string)=>({params:Promise.resolve({id})});
 const publish=async(json:unknown)=>body(await create(request('/api/my/artifacts',{method:'POST',origin:'same',actor:ownerActor,json})),201);
 const share=async(id:string,visibility:string)=>body(await sharing(request(`/api/my/artifacts/${id}/sharing`,{method:'PUT',origin:'same',actor:ownerActor,json:{visibility}}),context(id)));
 const trigger=await publish({access:'readwrite',dataset:'<Dataset kind="stored"><Table schema="public" name="rows" columns={[{"name":"id","type":"number"},{"name":"recipient","type":"string"}]} rows={[{"id":1,"recipient":"initial"}]} /></Dataset>'});
 const model=await publish({dataset:[{total:155}],visibility:'unlisted'}),physical=await publish({dataset:[{id:1}],visibility:'unlisted'});
 await share(trigger.id,'unlisted');
 vi.mocked(executeCatalog).mockImplementation(async(_catalog,sql,params)=>{
  expect([modelNoticeSql,physicalNoticeSql,invalidRecipientSql]).toContain(sql);
  const to=params?.recipient??recipient.id;
  return {refreshedAt:'2026-09-29T00:00:00Z',columns:[{name:'to',type:'string'},{name:'message',type:'string'}],rows:[{to:sql===modelNoticeSql?[to,to]:sql===invalidRecipientSql?JSON.stringify([to]):to,message:sql===physicalNoticeSql?'Order 1':sql===modelNoticeSql?'West total 155':'Invalid recipient representation'}]};
 });
 const join=async(id:string)=>{
  await body(await membership(request(`/api/my/artifacts/${id}/members`,{method:'POST',origin:'same',actor:recipientActor,json:{action:'join'}}),context(id)));
  await body(await membership(request(`/api/my/artifacts/${id}/members`,{method:'POST',origin:'same',actor:ownerActor,json:{action:'approve',userId:recipient.id}}),context(id)));
 };
 const fixture={triggerId:trigger.id,recipientId:recipient.id,modelDatasetId:model.id,datasetId:physical.id};
 const notice=await publish(notificationDocumentPayload(fixture));await join(notice.id);
 const worker=createNotificationWorker({store:await notificationJobStore(),evaluator:{evaluate:evaluateNotificationQuery}});
 const run=async(id:string)=>{
  const result=await body(await mutate(request(`/a/${id}/mutate`,{method:'POST',origin:'same',actor:ownerActor,json:notificationMutationPayload(recipient.id)}),context(id)));
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
 const invalid=await publish(notificationDocumentPayload({...fixture,invalid:true}));await join(invalid.id);
 const failed=await run(invalid.id);expect(failed.job.status).toBe('failed');expect(await received(failed.runId)).toEqual([]);
});
