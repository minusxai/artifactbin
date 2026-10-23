/** Retained commit-engine run identities; the author-facing Notify syntax is retired. */
import {expect,it} from 'vitest';
import type {MutationNotificationJobInput} from '@artifactbin/contracts';
import {request,useAppHarness} from './harness';
import {POST as create} from '@/app/api/artifacts/route';
import {notificationMutationFixture} from './notification-mutation-fixture';
import {nativeHtml} from './native-html-fixture';
import {getArtifactById} from '@/lib/artifacts';
import {getDb} from '@/lib/platform';
import { mintAccountToken as mintToken } from '@/__tests__/harness';
import {services,setServices} from '@/lib/platform';
import {loadDatasetRows} from '@/lib/datasets/dataset-store';
import {newEditId} from '@/lib/document/splice';

useAppHarness();
async function fixture(predicate=''){
 const token=await mintToken('mxmx_test_notification_run_replay');
 const datasetResponse=await create(request('/api/artifacts',{method:'POST',token:token.token,json:{dataset:[{n:0}],access:'readwrite'}}));
 expect(datasetResponse.status,await datasetResponse.clone().text()).toBe(201);const dataset=await datasetResponse.json();
 const documentResponse=await create(request('/api/artifacts',{method:'POST',token:token.token,json:{html:nativeHtml('<p>Counter</p>')}}));
 expect(documentResponse.status,await documentResponse.clone().text()).toBe(201);const document=await documentResponse.json();
 const context={params:Promise.resolve({id:document.id})};
 const send=notificationMutationFixture(token,document,dataset,`update tasks.rows set n=n+$amount ${predicate}`,[{name:'first_status',sql:`select null as "to", 'Changed' as message from tasks.rows`},{name:'second_status',sql:`select null as "to", 'Reviewed' as message`}]);
 const api=(key:string)=>send(key,'api'),browser=(key:string)=>send(key,'browser');
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

// Bootstrap secrecy is now exercised by native-html-serving.test.ts and native-html-core.test.ts;
// compiled dataflow/Notify runtime projections are retired with that authoring protocol.
