import { expect, it, vi } from 'vitest';
const pg=vi.hoisted(()=>({hold:null as null|(()=>Promise<{rows:Array<{n:number}>,columns:Array<{name:string,type:'number'}>}>) }));
vi.mock('@/lib/datasets/postgres',()=>({
  discoverPostgres:async()=>[{schema:'source',name:'numbers',columns:[{name:'n',type:'number'}]}],
  queryPostgres:async()=>pg.hold?pg.hold():{rows:[{n:314159265}],columns:[{name:'n',type:'number'}]},
}));
import {useAppHarness,request} from './harness';
import {POST as create} from '@/app/api/artifacts/route';
import {GET as queryDocument} from '@/app/a/[id]/query/route';
import {createDatasetSecret} from '@/lib/datasets/secrets';
import {mintToken} from '@/lib/tokens';
import {createUser,claimToken} from '@/lib/users';
const harness=useAppHarness();
const deferred=<T,>()=>{let resolve!:(x:T)=>void;const promise=new Promise<T>(r=>{resolve=r;});return {resolve,promise};};

async function fixture(){
  pg.hold=null;
  const user=await createUser({email:'mxmx_test_speedup_access@example.com'}),token=await mintToken('source-owner');
  await claimToken(user.id,token.token);
  const target={host:'db.example',port:5432,database:'app',username:'reader',ssl:true};
  const secret=await createDatasetSecret({userId:user.id,tokenId:token.id},'test-only-password',target);
  const ds=await create(request('/api/artifacts',{method:'POST',token:token.token,json:{visibility:'private',dataset:{kind:'postgres',connection:{...target,passwordSecretId:secret.id},defaultSchema:'public',refreshSeconds:60,tables:[{schema:'public',name:'numbers',source:{schema:'source',table:'numbers'},columns:['n']}]}}}));
  expect(ds.status,await ds.clone().text()).toBe(201);const dataset=(await ds.json()).id;
  const made=await create(request('/api/artifacts',{method:'POST',token:token.token,json:{visibility:'public',markup:`<Helmet><Query name="q" source="${dataset}">{\`select n from numbers\`}</Query></Helmet><DataTable data="$q"/>`}}));
  expect(made.status,await made.clone().text()).toBe(201);const id=(await made.json()).id;
  return {id,dataset};
}
it('keeps public-document access to owner-private source queries',async()=>{
  const {id}=await fixture();
  const response=await queryDocument(request(`/a/${id}/query?q=%7B%7D`),{params:Promise.resolve({id})});
  expect(response.status).toBe(200);expect((await response.json()).tables.q.rows).toEqual([{n:314159265}]);
});
it('does not return source rows when a public document becomes private during a fill',async()=>{
  const {id}=await fixture();const db=await harness.db();
  // The implementation cache may have been populated during publish. Empty only
  // its disposable result table to force this request through the held SQL.
  if((await db.query("SELECT to_regclass('dataset_result_cache') AS table_name")).rows[0].table_name)await db.query('DELETE FROM dataset_result_cache');
  const started=deferred<void>(),release=deferred<{rows:Array<{n:number}>,columns:Array<{name:string,type:'number'}>}>();
  pg.hold=()=>{started.resolve();return release.promise;};
  const pending=queryDocument(request(`/a/${id}/query?q=%7B%7D`),{params:Promise.resolve({id})});
  await started.promise;
  await db.query("UPDATE artifacts SET visibility='private' WHERE id=$1",[id]);
  release.resolve({rows:[{n:314159265}],columns:[{name:'n',type:'number'}]});
  const response=await pending;
  expect(await response.text()).not.toContain('314159265');pg.hold=null;
});
