import {beforeEach,expect,it,vi} from 'vitest';
vi.mock('@/lib/datasets/execute',()=>({executeCatalog:vi.fn(async()=>({columns:[{name:'id',type:'number'}],rows:[{id:1}]}))}));
vi.mock('@/lib/datasets/postgres',()=>({discoverPostgres:vi.fn(async()=>[{schema:'public',name:'rows',columns:[{name:'id',type:'number'}]}])}));
import {POST as create} from '@/app/api/artifacts/route';
import {POST as forkRoute} from '@/app/api/my/artifacts/[id]/fork/route';
import {POST as tables} from '@/app/a/[id]/tables/route';
import {forkDatasetPreview,type ArtifactRow} from '@/lib/artifacts';
import {createDatasetSecret} from '@/lib/datasets/secrets';
import {mintToken} from '@/lib/tokens';
import {claimToken,createUser} from '@/lib/users';
import {request,useAppHarness} from './harness';
const harness=useAppHarness();const current={id:'',email:''};
vi.mock('@/auth',()=>({auth:async()=>current.id?{user:{id:current.id,email:current.email}}:null}));
const ctx=(id:string)=>({params:Promise.resolve({id})});
const target={host:'db.example',port:5432,database:'app',username:'reader',ssl:true};
beforeEach(()=>{current.id='';current.email='';});
async function user(name:string){const account=await createUser({email:`mxmx_test_pg_fork_${name}@example.com`});const token=await mintToken(name);await claimToken(account.id,token.token);return {account,token};}
async function postgresDataset(owner:Awaited<ReturnType<typeof user>>){
 const secret=await createDatasetSecret({userId:owner.account.id,tokenId:owner.token.id},'fork-test-password',target);
 const definition={kind:'postgres',connection:{...target,passwordSecretId:secret.id},defaultSchema:'public',refreshSeconds:60,tables:[{schema:'public',name:'rows',source:{schema:'public',table:'rows'},columns:['id']}]};
 const made=await create(request('/api/artifacts',{method:'POST',token:owner.token.token,json:{dataset:definition,visibility:'public'}}));expect(made.status,await made.clone().text()).toBe(201);return {id:(await made.json()).id as string,definition};
}
it('refuses reader and owner forks after a live read; a new dataset requires its own replacement secret',async()=>{
 const owner=await user('owner'),reader=await user('reader'),{id,definition}=await postgresDataset(owner);
 const warm=await tables(request(`/a/${id}/tables`,{method:'POST',actor:{credential:'session',userId:reader.account.id,email:reader.account.email??'',emailVerified:true},json:{sql:'select * from rows'}}),ctx(id));expect(warm.status).toBe(200);
 const db=await harness.db();const before=Number((await db.query<{n:string}>('SELECT count(*) n FROM artifacts')).rows[0].n);
 for(const actor of [reader,owner]){
  current.id=actor.account.id;current.email=actor.account.email??'';
  const denied=await forkRoute(request(`/api/my/artifacts/${id}/fork`,{method:'POST'}),ctx(id));expect(denied.status).toBe(403);expect(await denied.json()).toMatchObject({error:'not_forkable',hint:expect.stringContaining('bound to the original dataset')});
  expect(Number((await db.query<{n:string}>('SELECT count(*) n FROM artifacts')).rows[0].n)).toBe(before);
 }
 const reused=await create(request('/api/artifacts',{method:'POST',token:owner.token.token,json:{dataset:definition,visibility:'public'}}));expect(reused.status).toBe(403);
 const secret=await createDatasetSecret({userId:owner.account.id,tokenId:owner.token.id},'replacement-fork-test-password',target);
 const configured=await create(request('/api/artifacts',{method:'POST',token:owner.token.token,json:{dataset:{...definition,connection:{...target,passwordSecretId:secret.id}},visibility:'public'}}));expect(configured.status,await configured.clone().text()).toBe(201);expect((await configured.json()).id).not.toBe(id);
 expect((await db.query<{dataset_id:string}>('SELECT dataset_id FROM dataset_secrets WHERE id=$1',[definition.connection.passwordSecretId])).rows[0].dataset_id).toBe(id);
});
it('refuses a shared editor fork and copying the dataset-bound secret into a new artifact',async()=>{
 const owner=await user('owner'),editor=await user('editor'),{id,definition}=await postgresDataset(owner),db=await harness.db();
 await db.query("INSERT INTO artifact_shares(artifact_id,email,role) VALUES($1,$2,'editor')",[id,editor.account.email]);
 current.id=editor.account.id;current.email=editor.account.email??'';
 const response=await forkRoute(request(`/api/my/artifacts/${id}/fork`,{method:'POST'}),ctx(id));expect(response.status).toBe(403);expect(await response.json()).toMatchObject({error:'not_forkable'});
 const copied=await create(request('/api/artifacts',{method:'POST',token:editor.token.token,json:{dataset:definition,visibility:'public'}}));expect(copied.status).toBe(403);
 expect(Number((await db.query<{n:string}>('SELECT count(*) n FROM artifacts')).rows[0].n)).toBe(1);
});
/*
 * A POSTGRES dataset is the one target a deep fork never copies: the copy would
 * name a catalog whose password stays bound to the original
 * (`postgresForkRefusal`), so it could not answer a single query. The ref is
 * left exactly as it is, and whatever the publish door already said about it,
 * it keeps saying.
 *
 * A <Mutation> over a Postgres dataset is refused TWICE at publish — `access:
 * readwrite` is refused on the dataset itself (artifact-wire, "Postgres
 * datasets are read-only") and the stored mutation compiler refuses the
 * statement ("only stored datasets are writable") — so the page cannot be
 * published by anyone, its own owner included. The plan is asserted directly
 * for that reason: there is no door that builds the page the plan must skip.
 * What IS reachable is a page that READS one, and it forks with its ref intact.
 */
it('a POSTGRES dataset is never a fork copy: a written one is skipped by the plan, a read one keeps its ref',async()=>{
 const owner=await user('pg-writer'),forker=await user('pg-forker'),{id}=await postgresDataset(owner),db=await harness.db();
 const actor={tokenId:forker.token.id,userId:forker.account.id};
 const writes=`<Helmet><Mutation name="add" source="ref:${id}">{\`insert into public.rows (id) select 2\`}</Mutation></Helmet><div><Button run="$add">Add</Button></div>`;
 expect(await forkDatasetPreview(actor,{format:'markup',source:writes} as ArtifactRow)).toEqual([]);
 const page=await create(request('/api/artifacts',{method:'POST',token:owner.token.token,json:{visibility:'public',title:'Live rows',
  markup:`<Helmet><Query name="rows" source="ref:${id}">{\`select * from public.rows\`}</Query></Helmet><div><DataTable data="$rows" /></div>`}}));
 expect(page.status,await page.clone().text()).toBe(201);
 const before=Number((await db.query<{n:string}>('SELECT count(*) n FROM artifacts')).rows[0].n);
 current.id=forker.account.id;current.email=forker.account.email??'';
 const pageId=(await page.json()).id as string;
 const preview=await forkRoute(request(`/api/my/artifacts/${pageId}/fork`,{method:'POST',json:{dry_run:true}}),ctx(pageId));
 expect(preview.status,await preview.clone().text()).toBe(200);
 expect(await preview.json()).toEqual({datasets:[]});
 expect(Number((await db.query<{n:string}>('SELECT count(*) n FROM artifacts')).rows[0].n)).toBe(before);
 const forked=await forkRoute(request(`/api/my/artifacts/${pageId}/fork`,{method:'POST'}),ctx(pageId));
 expect(forked.status,await forked.clone().text()).toBe(201);
 const copy=(await db.query<{source:string}>('SELECT source FROM artifacts WHERE id=$1',[(await forked.json()).id])).rows[0]!;
 expect(copy.source).toContain(`ref:${id}`);
});
