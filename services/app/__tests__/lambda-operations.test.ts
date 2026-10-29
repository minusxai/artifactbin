/** The retained internal compatibility helper cannot execute native pages as JSX declarations. */
import {expect,it} from 'vitest';
import {useAppHarness,request,mintAccountToken} from './harness';
import { identityForUser, createUser } from '@/lib/accounts';
import { claimToken } from '@/lib/authentication';
import {POST as publish} from '@/app/api/artifacts/route';
import {getArtifactById} from '@/lib/artifacts';
import {loadDatasetRows} from '@/lib/datasets';
import {setDatasetPolicy} from '@/lib/document-data/dataset-policy';
import {lambdaOperation} from '@/lib/runner/operations';
import {runnerIdentity} from '@artifactbin/runner/capabilities';
import {defaultDatasetGrants,signActor,verifyActor} from '@artifactbin/utils';
const harness=useAppHarness();
it('requires signed pinned authority and refuses native files without executing legacy SQL',async()=>{
 const owner=await createUser({email:'mxmx_test_lambda_ops@example.com'}),token=await mintAccountToken('lambda',owner.id);await claimToken(owner.id,token.token);
 const create=async(json:unknown)=>{const response=await publish(request('/api/artifacts',{method:'POST',token:token.token,json}));expect(response.status).toBe(201);return (await response.json()).id as string;};
 const dataset=await create({dataset:[{n:1}],access:'readwrite'});expect(await setDatasetPolicy(identityForUser(owner.id,token.id),dataset,defaultDatasetGrants(),0)).toMatchObject({revision:1});
 const source=`<!doctype html><html><head><link rel="af-dataset" data-af-name="data" href="ref:${dataset}"></head><body>Native page</body></html>`;
 const id=await create({html:source}),row=(await getArtifactById(id))!;
 const identity=runnerIdentity({runId:'run-a',callId:1,request:{userId:owner.id,requestId:'test',artifactId:id,artifactVersion:String(row.version),document:{source,editId:row.edit_id},program:{source:'export default()=>null',language:'javascript'},input:null},signal:new AbortController().signal,requests:[],usage:[]});
 const secret='test-actor-signing-secret-long-enough';expect(verifyActor(signActor(identity,secret),secret)).toEqual(identity);
 expect((await lambdaOperation(request('/api/runner/operations',{actor:{userId:owner.id,credential:'session'}}),'lambda_query',{values:{},only:['rows']},source)).status).toBe(403);
 expect((await lambdaOperation(request('/internal',{actor:identity}),'lambda_query',{values:{},only:['rows']},source+'x')).status).toBe(403);
 for(const operation of ['lambda_query','lambda_mutate']){
  const response=await lambdaOperation(request('/internal',{actor:identity}),operation,{values:{},only:['rows']},source);
  expect(response.status).toBe(400);expect(await response.json()).toMatchObject({error:'not_executable'});
 }
 expect((await getArtifactById(dataset))!.version).toBe(1);expect(await loadDatasetRows((await getArtifactById(dataset))!)).toEqual([{n:1}]);
 const other=await createUser({email:'mxmx_test_lambda_other@example.com'});
 expect((await lambdaOperation(request('/internal',{actor:{...identity,userId:other.id}}),'lambda_query',{values:{},only:['rows']},source)).status).toBe(404);
 await (await harness.db()).query('UPDATE artifacts SET deleted_at=now() WHERE id=$1',[id]);expect((await lambdaOperation(request('/internal',{actor:identity}),'lambda_mutate',{mutation:'add',args:{}},source)).status).toBe(404);
});
