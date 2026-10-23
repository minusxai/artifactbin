import { artifactQuery } from '@/lib/artifacts/table';
import {beforeEach,expect,it,vi} from 'vitest';
overrideCatalogExecutor(vi.fn(async()=>({columns:[{name:'id',type:'number'}],rows:[{id:1}]})) as never);
overridePostgres({discover:vi.fn<PostgresDriver['discover']>(async()=>[{schema:'public',name:'rows',columns:[{name:'id',type:'number'}]}])});
import {overridePostgres,type PostgresDriver} from '@/lib/datasets/postgres';
import {overrideCatalogExecutor} from '@/lib/datasets/execute';
import {POST as create} from '@/app/api/artifacts/route';
import {POST as forkRoute} from '@/app/api/my/artifacts/[id]/fork/route';
import {POST as tables} from '@/app/a/[id]/tables/route';
import {type ArtifactRow} from '@/lib/artifacts';
import {forkDatasetPreview} from '@/lib/publish/publish';
import {createDatasetSecret} from '@/lib/datasets/secrets';
import { mintAccountToken as mintToken } from '@/__tests__/harness';
import { identityForUser, claimToken,createUser} from '@/lib/accounts';
import {request,setSession,useAppHarness} from './harness';
const harness=useAppHarness();const current={id:'',email:''};
const ctx=(id:string)=>({params:Promise.resolve({id})});
const target={host:'db.example',port:5432,database:'app',username:'reader',ssl:true};
beforeEach(()=>{current.id='';current.email='';});
beforeEach(()=>setSession(()=>current.id?{user:{id:current.id,email:current.email}}:null));
async function user(name:string){const account=await createUser({email:`mxmx_test_pg_fork_${name}@example.com`});const token=await mintToken(name, account.id);await claimToken(account.id,token.token);return {account,token};}
async function postgresDataset(owner:Awaited<ReturnType<typeof user>>){
 const secret=await createDatasetSecret(identityForUser(owner.account.id, owner.token.id),'fork-test-password',target);
 const definition={kind:'postgres',connection:{...target,passwordSecretId:secret.id},defaultSchema:'public',refreshSeconds:60,tables:[{schema:'public',name:'rows',source:{schema:'public',table:'rows'},columns:['id']}]};
 const made=await create(request('/api/artifacts',{method:'POST',token:owner.token.token,json:{dataset:definition,visibility:'public'}}));expect(made.status,await made.clone().text()).toBe(201);return {id:(await made.json()).id as string,definition};
}
it('refuses reader and owner forks after a live read; a new dataset requires its own replacement secret',async()=>{
 const owner=await user('owner'),reader=await user('reader'),{id,definition}=await postgresDataset(owner);
 const warm=await tables(request(`/a/${id}/tables`,{method:'POST',actor:{credential:'session',userId:reader.account.id,email:reader.account.email??'',emailVerified:true},json:{sql:'select * from rows'}}),ctx(id));expect(warm.status).toBe(200);
 const db=await harness.db();const before=Number((await artifactQuery<{n:string}>(db,'SELECT count(*) n FROM artifacts')).rows[0].n);
 for(const actor of [reader,owner]){
  current.id=actor.account.id;current.email=actor.account.email??'';
  const denied=await forkRoute(request(`/api/my/artifacts/${id}/fork`,{method:'POST'}),ctx(id));expect(denied.status).toBe(403);expect(await denied.json()).toMatchObject({error:'not_forkable',hint:expect.stringContaining('bound to the original dataset')});
  expect(Number((await artifactQuery<{n:string}>(db,'SELECT count(*) n FROM artifacts')).rows[0].n)).toBe(before);
 }
 const reused=await create(request('/api/artifacts',{method:'POST',token:owner.token.token,json:{dataset:definition,visibility:'public'}}));expect(reused.status).toBe(403);
 const secret=await createDatasetSecret(identityForUser(owner.account.id, owner.token.id),'replacement-fork-test-password',target);
 const configured=await create(request('/api/artifacts',{method:'POST',token:owner.token.token,json:{dataset:{...definition,connection:{...target,passwordSecretId:secret.id}},visibility:'public'}}));expect(configured.status,await configured.clone().text()).toBe(201);expect((await configured.json()).id).not.toBe(id);
 expect((await artifactQuery<{dataset_id:string}>(db,'SELECT dataset_id FROM dataset_secrets WHERE id=$1',[definition.connection.passwordSecretId])).rows[0].dataset_id).toBe(id);
});
it('refuses a shared editor fork and copying the dataset-bound secret into a new artifact',async()=>{
 const owner=await user('owner'),editor=await user('editor'),{id,definition}=await postgresDataset(owner),db=await harness.db();
 await artifactQuery(db,"INSERT INTO artifact_shares(artifact_id,email,role) VALUES($1,$2,'editor')",[id,editor.account.email]);
 current.id=editor.account.id;current.email=editor.account.email??'';
 const response=await forkRoute(request(`/api/my/artifacts/${id}/fork`,{method:'POST'}),ctx(id));expect(response.status).toBe(403);expect(await response.json()).toMatchObject({error:'not_forkable'});
 const copied=await create(request('/api/artifacts',{method:'POST',token:editor.token.token,json:{dataset:definition,visibility:'public'}}));expect(copied.status).toBe(403);
 expect(Number((await artifactQuery<{n:string}>(db,'SELECT count(*) n FROM artifacts')).rows[0].n)).toBe(1);
});
/** Native GraphQL bindings accept stored datasets only; refusal must not copy a credential-bound catalog. */
it('refuses an unsupported Postgres page binding without creating a page or copying its secret',async()=>{
 const owner=await user('pg-writer'),forker=await user('pg-forker'),{id,definition}=await postgresDataset(owner),db=await harness.db();
 const actor=identityForUser(forker.account.id, forker.token.id);
 const html=`<!doctype html><html><head><link rel="af-dataset" data-af-name="data" href="ref:${id}"></head><body>Live rows</body></html>`;
 expect(await forkDatasetPreview(actor,{format:'html',source:html} as ArtifactRow)).toEqual([]);
 const count=async()=>Number((await artifactQuery<{n:string}>(db,'SELECT count(*) n FROM artifacts')).rows[0].n);
 const before=await count();
 const page=await create(request('/api/artifacts',{method:'POST',token:owner.token.token,json:{visibility:'public',title:'Live rows',html}}));
 expect(page.status).toBe(400);expect(await page.json()).toMatchObject({error:'dataset_stable_identity_unavailable'});
 expect(await count()).toBe(before);
 expect((await artifactQuery<{dataset_id:string}>(db,'SELECT dataset_id FROM dataset_secrets WHERE id=$1',[definition.connection.passwordSecretId])).rows).toEqual([{dataset_id:id}]);
 expect(Number((await artifactQuery<{n:string}>(db,'SELECT count(*) n FROM dataset_secrets')).rows[0].n)).toBe(1);
});
