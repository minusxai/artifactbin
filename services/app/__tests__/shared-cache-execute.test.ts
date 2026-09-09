import {expect,it,vi,beforeEach} from 'vitest';
const upstream=vi.hoisted(()=>({query:vi.fn()}));
vi.mock('@/lib/datasets/postgres',()=>({queryPostgres:upstream.query}));
import {useAppHarness,request} from './harness';
import {getDb} from '@/lib/db';
import {mintToken} from '@/lib/tokens';
import {createArtifact,runDocumentDataflow,datasetResolverForActor} from '@/lib/artifacts';
import {createDatasetSecret} from '@/lib/datasets/secrets';
import {executeCatalog} from '@/lib/datasets/execute';
import type {DatasetCatalog} from '@/lib/datasets/types';
import {POST as tables} from '@/app/a/[id]/tables/route';
import {POST as draftQuery} from '@/app/api/query/route';
import {GET as documentQuery} from '@/app/a/[id]/query/route';
useAppHarness();
beforeEach(()=>{upstream.query.mockReset().mockResolvedValue({rows:[{n:1}],columns:[{name:'n',type:'number'}]});});
const target={host:'db.example',port:5432,database:'app',username:'reader',ssl:true};
async function setup(){
 const token=await mintToken('cache-execute'),actor={tokenId:token.id,userId:null};
 const secret=await createDatasetSecret(actor,'fixture-pass',target);
 const catalog:DatasetCatalog={kind:'postgres',connection:{...target,passwordSecretId:secret.id},refreshSeconds:60,defaultSchema:'public',tables:[{schema:'public',name:'rows',source:{schema:'public',table:'rows'},columns:[{name:'n',type:'number'}]}]};
 const row=await createArtifact(token.id,null,{format:'dataset',source:null,content:'',meta:{catalog},visibility:'public'});
 return {row,catalog,token,actor,secret};
}
it('executeCatalog persists shared results and separates dataset ids, params and windows',async()=>{
 const {row,catalog}=await setup(),opts={datasetId:row.id,authorize:async()=>{expect((await (await getDb()).query('SELECT id FROM artifacts WHERE id=$1',[row.id])).rows).toHaveLength(1);}};
 await executeCatalog(catalog,'select * from rows',{},opts);await executeCatalog(catalog,'select * from rows',{},opts);
 expect(upstream.query).toHaveBeenCalledTimes(1);expect((await (await getDb()).query('SELECT result FROM dataset_result_cache')).rows).toHaveLength(1);
 await executeCatalog(catalog,'select * from rows',{}, {...opts,offset:1});expect(upstream.query).toHaveBeenCalledTimes(2);
});
it('cached hits cannot survive credential removal',async()=>{
 const {row,catalog,secret}=await setup();const authorize=async()=>{expect((await (await getDb()).query('SELECT id FROM artifacts WHERE id=$1',[row.id])).rows).toHaveLength(1);};await executeCatalog(catalog,'select * from rows',{}, {datasetId:row.id,authorize});
 await (await getDb()).query('DELETE FROM dataset_secrets WHERE id=$1',[secret.id]);
 await expect(executeCatalog(catalog,'select * from rows',{}, {datasetId:row.id,authorize})).rejects.toThrow('credentials');expect(upstream.query).toHaveBeenCalledTimes(1);
});

it('callback-less internal probes bypass shared retention',async()=>{
 const {row,catalog}=await setup();
 for(let i=0;i<2;i++)await executeCatalog(catalog,'select * from rows',{}, {datasetId:row.id});
 expect(upstream.query).toHaveBeenCalledTimes(2);expect((await (await getDb()).query('SELECT result FROM dataset_result_cache')).rows).toHaveLength(0);
});
it('credential changes fence both the filling owner and joined waiter',async()=>{
 const {row,catalog,secret}=await setup();let done!:(r:unknown)=>void,started!:()=>void;
 const begun=new Promise<void>(resolve=>{started=resolve;});upstream.query.mockImplementation(()=>{started();return new Promise(resolve=>{done=resolve;});});
 const authorize=async()=>{expect((await (await getDb()).query('SELECT id FROM artifacts WHERE id=$1',[row.id])).rows).toHaveLength(1);};
 const first=executeCatalog(catalog,'select * from rows',{}, {datasetId:row.id,authorize}),rejected=expect(first).rejects.toThrow('credentials');await begun;
 const second=executeCatalog(catalog,'select * from rows',{}, {datasetId:row.id,authorize}),waitRejected=expect(second).rejects.toThrow('credentials');
 await (await getDb()).query('DELETE FROM dataset_secrets WHERE id=$1',[secret.id]);done({rows:[{n:1}],columns:[{name:'n',type:'number'}]});
 await rejected;await waitRejected;
 expect((await (await getDb()).query('SELECT result FROM dataset_result_cache WHERE result IS NOT NULL')).rows).toHaveLength(0);
});
it('tables endpoint rechecks public visibility after a joined cache wait',async()=>{
 const {row}=await setup();let done!:(r:unknown)=>void,started!:()=>void;
 const begun=new Promise<void>(resolve=>{started=resolve;});upstream.query.mockImplementation(()=>{started();return new Promise(resolve=>{done=resolve;});});
 const invoke=()=>tables(request(`/a/${row.id}/tables`,{method:'POST',json:{sql:'select * from rows'}}),{params:Promise.resolve({id:row.id})});
 const first=invoke();await begun;const second=invoke();
 await (await getDb()).query("UPDATE artifacts SET visibility='private' WHERE id=$1",[row.id]);done({rows:[{n:1}],columns:[{name:'n',type:'number'}]});
 expect((await first).status).toBe(404);expect((await second).status).toBe(404);
});
it('public document queries still use the authorized owner-bound source',async()=>{
 const {row,actor}=await setup();
 const source=`<Helmet><Query name="rows" source="${row.id}">{\`select * from rows\`}</Query></Helmet><p>Hello</p>`;
 for(let i=0;i<2;i++)expect((await runDocumentDataflow(source,datasetResolverForActor(actor)))?.state.tables.rows.rows).toEqual([{n:1}]);
 expect(upstream.query).toHaveBeenCalledTimes(1);
});

it('draft queries recheck bearer revocation after SQL starts',async()=>{
 const {row,token}=await setup();let finish!:(r:unknown)=>void,started!:()=>void;const begun=new Promise<void>(r=>{started=r;});
 upstream.query.mockImplementation(()=>{started();return new Promise(r=>{finish=r;});});
 const pending=draftQuery(request('/api/query',{method:'POST',token:token.token,json:{markup:`<Helmet><Query name="q" source="${row.id}">{\`select n from rows\`}</Query></Helmet><p>Test</p>`}}));
 await begun;await (await getDb()).query('UPDATE tokens SET deleted_at=now() WHERE id=$1',[token.id]);finish({rows:[{n:991991}],columns:[{name:'n',type:'number'}]});
 expect(await (await pending).text()).not.toContain('991991');
});

it('direct queries reject narrowed catalog exposure during SQL',async()=>{
 const {row}=await setup();let finish!:(r:unknown)=>void,started!:()=>void;const begun=new Promise<void>(r=>{started=r;});
 upstream.query.mockImplementation(()=>{started();return new Promise(r=>{finish=r;});});
 const pending=tables(request(`/a/${row.id}/tables`,{method:'POST',json:{sql:'select n from rows'}}),{params:Promise.resolve({id:row.id})});
 await begun;await (await getDb()).query(`UPDATE artifacts SET meta=jsonb_set(meta,'{catalog,tables,0,columns}','[]'::jsonb) WHERE id=$1`,[row.id]);finish({rows:[{n:991991}],columns:[{name:'n',type:'number'}]});
 const response=await pending;expect(response.status).toBe(404);expect(await response.text()).not.toContain('991991');
});

it('source queries cannot return data after their document is deleted',async()=>{
 const {row,token}=await setup();
 const doc=await createArtifact(token.id,null,{format:'markup',source:`<Helmet><Query name="q" source="${row.id}">{\`select n from rows\`}</Query></Helmet><p>Test</p>`,content:'',meta:{},visibility:'public'});
 let finish!:(r:unknown)=>void,started!:()=>void;const begun=new Promise<void>(r=>{started=r;});
 upstream.query.mockImplementation(()=>{started();return new Promise(r=>{finish=r;});});
 const pending=documentQuery(request(`/a/${doc.id}/query?q=%7B%7D`),{params:Promise.resolve({id:doc.id})});
 await begun;await (await getDb()).query('UPDATE artifacts SET deleted_at=now() WHERE id=$1',[doc.id]);finish({rows:[{n:991991}],columns:[{name:'n',type:'number'}]});
 expect(await (await pending).text()).not.toContain('991991');
});
