/** Run identity proofs through real HTTP handlers and isolated persistence. */
import {expect,it} from 'vitest';
import type {MutationNotificationJobInput} from '@artifactbin/contracts';
import {request,useAppHarness} from './harness';
import {documentPublicationWithResources} from './prepared-document';
import {POST as create} from '@/app/api/artifacts/route';
import {GET as read,PUT as replace} from '@/app/api/artifacts/[id]/route';
import {POST as apiMutate} from '@/app/api/artifacts/[id]/mutate/route';
import {POST as browserMutate} from '@/app/a/[id]/mutate/route';
import {getArtifactById,declarationsForRow} from '@/lib/artifacts';
import {liveFrameFor} from '@/lib/story/data/frame';
import {readerIslandData} from '@/lib/story/prepared/prepare-runtime.server';
import {getDb} from '@/lib/platform';
import { mintAccountToken as mintToken } from '@/__tests__/harness';
import {services,setServices} from '@/lib/platform';
import {loadDatasetRows} from '@/lib/story/datasets/dataset-store';
import {newEditId} from '@/lib/story/document/splice';

useAppHarness();
async function fixture(predicate='',readerQuery=false){
 const token=await mintToken('mxmx_test_notification_run_replay');
 const datasetResponse=await create(request('/api/artifacts',{method:'POST',token:token.token,json:{dataset:[{n:0}],access:'readwrite'}}));
 expect(datasetResponse.status,await datasetResponse.clone().text()).toBe(201);const dataset=await datasetResponse.json();
 const markup=`<Helmet><Import name="tasks" src="ref:${dataset.id}" /><Mutation name="increment">{\`update tasks.rows set n=n+$amount ${predicate}\`}</Mutation>${readerQuery ? '<Query name="current">{`select n from tasks.rows`}</Query>' : ''}<Notify name="first_status" on="increment">{\`select null as "to", 'Changed' as message from tasks.rows\`}</Notify><Notify name="second_status" on="increment">{\`select null as "to", 'Reviewed' as message\`}</Notify></Helmet><p>Counter</p>`;
 const documentResponse=await create(request('/api/artifacts',{method:'POST',token:token.token,json:{markup}}));
 expect(documentResponse.status,await documentResponse.clone().text()).toBe(201);const document=await documentResponse.json();
 const context={params:Promise.resolve({id:document.id})};
 const api=(key:string)=>apiMutate(request(`/api/artifacts/${document.id}/mutate`,{method:'POST',token:token.token,headers:{'Idempotency-Key':key},json:{name:'increment',args:{amount:1}}}),context);
 const browser=(key:string)=>browserMutate(request(`/a/${document.id}/mutate`,{method:'POST',token:token.token,json:{mutation:'increment',args:{amount:1},operationKey:key}}),context);
 const rows=async()=>loadDatasetRows((await getArtifactById(dataset.id))!);
 return {token,dataset,document,context,api,browser,rows,db:await getDb()};
}

it('schedules exactly one run job for successful zero-affected SQL and replays that same success',async()=>{
 const {api,rows,db}=await fixture('where n<0');const key='mxmx_test_notification_zero_affected';
 const first=await api(key);expect(first.status,await first.clone().text()).toBe(200);const result=await first.json();
 expect(result).toMatchObject({affected:0,mutationRunId:expect.any(String)});expect(await rows()).toEqual([{n:0}]);
 const scheduled=(await db.query<{mutation_run_id:string;input:MutationNotificationJobInput}>('SELECT mutation_run_id,input FROM notification_jobs')).rows;
 expect(scheduled).toHaveLength(1);expect(scheduled[0]).toMatchObject({mutation_run_id:result.mutationRunId,input:{rules:[{name:'first_status'},{name:'second_status'}]}});
 const replay=await api(key);expect(replay.status).toBe(200);expect(await replay.json()).toEqual(result);
 expect((await db.query('SELECT id FROM notification_jobs')).rows).toHaveLength(1);expect(await rows()).toEqual([{n:0}]);
});

it('schedules nothing for a forced CAS loser and only one run job when the retry wins',async()=>{
 const {api,rows,db,dataset}=await fixture();const sql=services().sql;let attempts=0;
 setServices({sql:{...sql,async mutate(input){
  attempts++;
  // Advance the actual guarded edit head after the first engine read, forcing its swap to lose.
  if(attempts===2)expect((await db.query('SELECT id FROM notification_jobs')).rows).toEqual([]);
  const outcome=await sql.mutate(input);
  if(attempts===1)await db.query('UPDATE artifacts SET edit_id=$2 WHERE id=$1',[dataset.id,newEditId()]);
  return outcome;
 }}});
 try{
  const response=await api('mxmx_test_notification_cas_once');expect(response.status,await response.clone().text()).toBe(200);const result=await response.json();
  expect(attempts).toBe(2);expect(await rows()).toEqual([{n:1}]);
  expect((await db.query('SELECT mutation_run_id FROM notification_jobs')).rows).toEqual([{mutation_run_id:result.mutationRunId}]);
  expect((await db.query('SELECT response FROM mutation_receipts WHERE response IS NOT NULL')).rows).toHaveLength(1);
 }finally{setServices({sql});}
});

it('recovers the canonical result and original run job after the mutation and notification names change',async()=>{
 const {api,rows,db,token,document,context}=await fixture();const key='mxmx_test_notification_renamed_replay';
 const response=await api(key);expect(response.status).toBe(200);const result=await response.json();
 const original=(await db.query<{id:string;input:MutationNotificationJobInput}>('SELECT id,input FROM notification_jobs')).rows;
 const headResponse=await read(request(`/api/artifacts/${document.id}`,{token:token.token}),context);expect(headResponse.status).toBe(200);const head=await headResponse.json();
 expect(head.markup).toEqual(expect.any(String));
 const markup=(head.markup as string).replaceAll('increment','advance').replaceAll('first_status','renamed_first').replaceAll('second_status','renamed_second');
 const update=await documentPublicationWithResources((await getArtifactById(document.id))!,{markup},true);
 const edited=await replace(request(`/api/artifacts/${document.id}`,{method:'PUT',token:token.token,json:update}),context);
 expect(edited.status,await edited.clone().text()).toBe(200);
 const renamed=(await getArtifactById(document.id))!;
 expect(renamed.source).toContain('name="advance"');expect(renamed.source).toContain('name="renamed_first"');expect(renamed.source).not.toContain('name="increment"');
 const replay=await api(key);expect(replay.status,await replay.clone().text()).toBe(200);expect(await replay.json()).toEqual(result);
 expect((await db.query('SELECT id,input FROM notification_jobs')).rows).toEqual(original);expect(await rows()).toEqual([{n:1}]);
});

it.each(['api','browser'] as const)('shares one canonical receipt across %s-first API/browser replay without a second write',async(firstRoute)=>{
 const {api,browser,rows,db,dataset}=await fixture();const key=`mxmx_test_notification_cross_${firstRoute}`;
 const first=await (firstRoute==='api'?api:browser)(key);expect(first.status,await first.clone().text()).toBe(200);const firstBody=await first.json();
 const second=await (firstRoute==='api'?browser:api)(key);expect(second.status,await second.clone().text()).toBe(200);const secondBody=await second.json();
 const apiBody=firstRoute==='api'?firstBody:secondBody,browserBody=firstRoute==='browser'?firstBody:secondBody;
 expect(apiBody.id).toBe(dataset.id);expect(browserBody).toEqual({ok:true,dataset:dataset.id,version:apiBody.version,affected:apiBody.affected,rowCount:apiBody.rowCount,mutationRunId:apiBody.mutationRunId});
 expect(apiBody.mutationRunId).toEqual(expect.any(String));expect(await rows()).toEqual([{n:1}]);
 expect((await db.query('SELECT mutation_run_id FROM notification_jobs')).rows).toEqual([{mutation_run_id:apiBody.mutationRunId}]);
 expect((await db.query('SELECT response FROM mutation_receipts WHERE response IS NOT NULL')).rows).toHaveLength(1);
});

it('projects notification rules out of page bootstrap and live-frame runtime data',async()=>{
 const {document}=await fixture('',true);const row=(await getArtifactById(document.id))!;
 const declared=(await declarationsForRow(row))!;
 expect(declared.flow.notifications).toHaveLength(2);
 const runtime=readerIslandData({refData:{},dataflow:{flow:declared.flow}});
 const frame=await liveFrameFor(row);
 for(const flow of [runtime.dataflow?.flow,frame.dataflow?.flow]){
  expect(flow).toBeDefined();expect(flow!.notifications).toBeUndefined();
  expect(flow!.mutations[0]?.notifies).toBe(true);
  expect(JSON.stringify(flow)).not.toContain('first_status');
 }
 expect(declared.flow.notifications).toHaveLength(2);
});
