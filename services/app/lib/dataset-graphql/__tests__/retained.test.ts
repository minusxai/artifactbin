import {expect,it} from 'vitest';
import {createHash} from 'node:crypto';
import { setDatasetPolicy } from '@/__tests__/harness';
import {getDb} from '@/lib/platform';
import {useAppHarness,request,mintAccountToken} from '@/__tests__/harness';
import {POST as create} from '@/app/api/artifacts/route';
import {getArtifactById,durableMutation} from '@/lib/artifacts';
import { requestOrSessionActor } from '@/lib/authentication';
import {loadDatasetRows} from '@/lib/datasets';
import {createRetainedDatasetGraphql,retainedDatasetGraphqlPort} from '../retained';
import {datasetSchema} from '../index';
useAppHarness();
const signal=new AbortController().signal;
async function fixture(dataset:Record<string,unknown>[]|string=[{amount:1,label:'same'},{amount:1,label:'same'},{amount:3,label:null}]){
 const owner=await mintAccountToken('dataset_graphql_fixture');
 const req=request('/api/artifacts',{method:'POST',token:owner.token,json:{dataset,access:'readwrite'}});
 const actor=await requestOrSessionActor(req),response=await create(req);expect(response.status,await response.clone().text()).toBe(201);
 const {id}=await response.json(),binding={kind:'dataset' as const,name:'data',datasetId:id,mode:'live' as const};
 const api=createRetainedDatasetGraphql(),snapshot=await retainedDatasetGraphqlPort().snapshot(actor,binding,signal),schema=datasetSchema(snapshot),table=schema.tables[0]!;
 return {actor,binding,api,table,id};
}
it('uses retained executor and commits a mixed batch with stable duplicate-row identities',async()=>{
 const f=await fixture(),read=await f.api.read(f.actor,f.binding,{tableId:f.table.id,first:100},signal),column=f.table.columns.find(c=>c.label==='amount')!;
 expect(read.rows).toHaveLength(3);expect(new Set(read.rows.map(r=>r.id)).size).toBe(3);
 const target=read.rows[0]!.id,removed=read.rows[1]!.id;
 const input={tableId:f.table.id,expectedRevision:read.revision,requestId:'atomic-batch',changes:[{kind:'UPDATE' as const,rowId:target,cells:[{columnId:column.id,value:{type:'NUMBER' as const,value:9.25}}]},{kind:'DELETE' as const,rowId:removed},{kind:'INSERT' as const,cells:[{columnId:column.id,value:{type:'NUMBER' as const,value:0}}]}]};
 const receipt=await f.api.write(f.actor,f.binding,input,signal);expect(receipt.outcome).toBe('committed');
 const next=await f.api.read(f.actor,f.binding,{tableId:f.table.id,first:100},signal);
 expect(next.rows.find(r=>r.id===target)!.cells.find(c=>c.columnId===column.id)!.value.value).toBe(9.25);
 expect(next.rows.some(r=>r.id===removed)).toBe(false);
 expect(next.rows.some(r=>r.id===receipt.rowIds[1])).toBe(true);
 expect(await f.api.write(f.actor,f.binding,input,signal)).toEqual(receipt);
 expect((await getArtifactById(f.id))!.version).toBe(2);
 const row=await getArtifactById(f.id),raw=await loadDatasetRows(row!);
 expect(raw.every(r=>!Object.keys(r).some(k=>k.startsWith('__af_')))).toBe(true);
});
it('rolls back all earlier batch changes when a later row is missing',async()=>{
 const f=await fixture(),read=await f.api.read(f.actor,f.binding,{tableId:f.table.id,first:100},signal),column=f.table.columns[0]!;
 const receipt=await f.api.write(f.actor,f.binding,{tableId:f.table.id,expectedRevision:read.revision,requestId:'reject-whole-batch',changes:[{kind:'UPDATE',rowId:read.rows[0]!.id,cells:[{columnId:column.id,value:{type:'NUMBER',value:99}}]},{kind:'DELETE',rowId:'missing'}]},signal);
 expect(receipt.outcome).toBe('rejected');expect((await getArtifactById(f.id))!.version).toBe(1);
 expect((await f.api.read(f.actor,f.binding,{tableId:f.table.id,first:100},signal)).rows).toEqual(read.rows);
});
it('competing batches at one expected revision commit exactly once',async()=>{
 const f=await fixture(),read=await f.api.read(f.actor,f.binding,{tableId:f.table.id,first:100},signal),column=f.table.columns.find(c=>c.label==='amount')!;
 const changes=[{kind:'UPDATE' as const,rowId:read.rows[0]!.id,cells:[{columnId:column.id,value:{type:'NUMBER' as const,value:12}}]}];
 const results=await Promise.all(['contender-a','contender-b'].map(requestId=>f.api.write(f.actor,f.binding,{tableId:f.table.id,expectedRevision:read.revision,requestId,changes},signal)));
 expect(results.map(r=>r.outcome).sort()).toEqual(['committed','rejected']);expect((await getArtifactById(f.id))!.version).toBe(2);
});

it('requires dataset permission separately from page readability and enforces viewer policy',async()=>{
 const f=await fixture();
 await (await getDb()).query("UPDATE artifacts SET visibility='public' WHERE id=$1",[f.id]);
 const viewer={userId:null,tokenId:null,email:null,documentEditor:false};
 const read=await f.api.read(viewer,f.binding,{tableId:f.table.id,first:100},signal),column=f.table.columns.find(c=>c.label==='amount')!;
 const input={tableId:f.table.id,expectedRevision:read.revision,requestId:'viewer-denied',changes:[{kind:'INSERT' as const,cells:[{columnId:column.id,value:{type:'NUMBER' as const,value:2}}]}]};
 expect((await f.api.write(viewer,f.binding,input,signal)).outcome).toBe('rejected');
 await setDatasetPolicy(f.actor,f.id,{version:1,enforcement:'enabled',tables:[{table:{schema:'public',name:'rows'},insert_permissions:[{role:'viewer',permission:{columns:['amount'],check:{amount:{_gt:0}}}}]}]},0);
 expect((await f.api.write(viewer,f.binding,{...input,requestId:'viewer-allowed'},signal)).outcome).toBe('committed');
 const current=await f.api.read(viewer,f.binding,{tableId:f.table.id,first:100},signal);
 expect((await f.api.write(viewer,f.binding,{...input,expectedRevision:current.revision,requestId:'viewer-check-fails',changes:[{kind:'INSERT',cells:[{columnId:column.id,value:{type:'NUMBER',value:-1}}]}]},signal)).outcome).toBe('rejected');
 await (await getDb()).query("UPDATE artifacts SET visibility='private' WHERE id=$1",[f.id]);
 await expect(f.api.read(viewer,f.binding,{tableId:f.table.id,first:100},signal)).rejects.toThrow('dataset_not_found');
});
it('executes constant GraphQL schema discovery, typed reads and writes over retained storage',async()=>{
 const {buildSchema,graphql}=await import('graphql');
 const {DATASET_GRAPHQL_SDL}=await import('@artifactbin/contracts');
 const {createDatasetNamespaceInvoker}=await import('../index');
 const f=await fixture(),invoke=createDatasetNamespaceInvoker(f.actor,[f.binding],f.api),schema=buildSchema(DATASET_GRAPHQL_SDL);
 const field=(name:string,operation:'query'|'mutation')=>(args:Record<string,unknown>)=>invoke({namespace:'data',fileId:f.id,version:'live',operation,field:name,args:args as never,principal:{tenant:'page',subject:'viewer'},signal});
 const rootValue={schema:field('schema','query'),rows:field('rows','query'),writeRows:field('writeRows','mutation')};
 const discovery=await graphql({schema,rootValue,source:'{ schema { revision tables { id label columns { id type sourceType } } } }'});
 expect(discovery.errors).toBeUndefined();expect(discovery.data).toHaveProperty('schema');
 const read=await graphql({schema,rootValue,source:'query($table:ID!){ rows(tableId:$table,first:1) { revision rows { id cells { columnId value { type number string } } } pageInfo { hasNextPage endCursor } } }',variableValues:{table:f.table.id}});
 expect(read.errors).toBeUndefined();expect(read.data).toMatchObject({rows:{revision:'1',pageInfo:{hasNextPage:true}}});
 const column=f.table.columns.find(c=>c.label==='amount')!;
 const mutation=await graphql({schema,rootValue,source:'mutation($table:ID!,$column:ID!){ writeRows(tableId:$table,expectedRevision:"1",requestId:"graphql-insert",changes:[{kind:INSERT,cells:[{columnId:$column,value:{type:NUMBER,number:4.25}}]}]) { outcome revision rowIds } }',variableValues:{table:f.table.id,column:column.id}});
 expect(mutation.errors).toBeUndefined();expect(mutation.data).toMatchObject({writeRows:{outcome:'committed',revision:'2'}});
});

it('keeps an unfinished durable request unknown without executing it again',async()=>{
 const f=await fixture(),column=f.table.columns.find(c=>c.label==='amount')!;
 const input={tableId:f.table.id,expectedRevision:'1',requestId:'unfinished-request',changes:[{kind:'INSERT' as const,cells:[{columnId:column.id,value:{type:'NUMBER' as const,value:3}}]}]};
 await expect(durableMutation(f.actor,'https://dataset.invalid',createHash('sha256').update(input.requestId).digest('base64url'),{datasetId:f.id,...input},async()=>{throw new Error('interrupted');})).rejects.toThrow('interrupted');
 expect((await f.api.write(f.actor,f.binding,input,signal)).outcome).toBe('unknown');
 expect((await f.api.write(f.actor,f.binding,input,signal)).outcome).toBe('unknown');
 expect((await getArtifactById(f.id))!.version).toBe(1);
});

it('runs named-parameter whole-source aggregates through real GraphQL beyond source and display page limits',async()=>{
 const {buildSchema,graphql}=await import('graphql');
 const {DATASET_GRAPHQL_SDL}=await import('@artifactbin/contracts');
 const {createDatasetNamespaceInvoker}=await import('../index');
 const f=await fixture(Array.from({length:10005},(_,i)=>({amount:i+1,label:'all'}))),amount=f.table.columns.find(c=>c.label==='amount')!;
 const invoke=createDatasetNamespaceInvoker(f.actor,[f.binding],f.api),schema=buildSchema(DATASET_GRAPHQL_SDL);
 const result=await graphql({schema,rootValue:{query:(args:Record<string,unknown>)=>invoke({namespace:'data',fileId:f.id,version:'live',operation:'query',field:'query',args:args as never,principal:{tenant:'page',subject:'viewer'},signal})},source:'query($table:ID!,$amount:ID!){ query(tableId:$table,first:1,filters:[{columnId:$amount,operator:GT,parameter:"minimum"}],parameters:[{name:"minimum",value:{type:NUMBER,number:0}}],aggregates:[{id:"count",operation:COUNT},{id:"total",operation:SUM,columnId:$amount},{id:"average",operation:AVG,columnId:$amount}]) { revision columns { id type } rows { cells { columnId value { type number } } } pageInfo { hasNextPage } } }',variableValues:{table:f.table.id,amount:amount.id}});
 expect(result.errors).toBeUndefined();expect(result.data).toMatchObject({query:{rows:[{cells:[{columnId:'count',value:{type:'NUMBER',number:10005}},{columnId:'total',value:{type:'NUMBER',number:50055015}},{columnId:'average',value:{type:'NUMBER',number:5003}}]}],pageInfo:{hasNextPage:false}}});
});
it('paginates complete groups and rejects cursors when named parameter inputs change',async()=>{
 const f=await fixture(),amount=f.table.columns.find(c=>c.label==='amount')!,label=f.table.columns.find(c=>c.label==='label')!;
 const input={tableId:f.table.id,first:1,filters:[{columnId:amount.id,operator:'GT' as const,parameter:'minimum'}],parameters:[{name:'minimum',value:{type:'NUMBER' as const,value:0}}],groupBy:[label.id],aggregates:[{id:'total',operation:'SUM' as const,columnId:amount.id}],order:[{columnId:'total',direction:'DESC' as const}]};
 const first=await f.api.query(f.actor,f.binding,input,signal);expect(first.rows[0]!.cells.map(c=>c.value.value)).toEqual([null,3]);expect(first.pageInfo.hasNextPage).toBe(true);
 const next=await f.api.query(f.actor,f.binding,{...input,after:first.pageInfo.endCursor!},signal);expect(next.rows[0]!.cells.map(c=>c.value.value)).toEqual(['same',2]);expect(next.pageInfo.hasNextPage).toBe(false);
 await expect(f.api.query(f.actor,f.binding,{...input,after:first.pageInfo.endCursor!,parameters:[{name:'minimum',value:{type:'NUMBER',value:1}}]},signal)).rejects.toThrow('stale_cursor');
 const injected=await f.api.query(f.actor,f.binding,{tableId:f.table.id,first:100,filters:[{columnId:label.id,operator:'EQ',parameter:'label'}],parameters:[{name:'label',value:{type:'STRING',value:"same' OR 1=1"}}]},signal);expect(injected.rows).toHaveLength(0);
});
it('preserves COUNT zero and nullable aggregate values for an empty filtered source',async()=>{
 const f=await fixture(),amount=f.table.columns.find(c=>c.label==='amount')!,label=f.table.columns.find(c=>c.label==='label')!;
 const result=await f.api.query(f.actor,f.binding,{tableId:f.table.id,first:1,filters:[{columnId:amount.id,operator:'GT',value:{type:'NUMBER',value:100}}],aggregates:[{id:'count',operation:'COUNT'},{id:'total',operation:'SUM',columnId:amount.id},{id:'firstLabel',operation:'MIN',columnId:label.id}]},signal);
 expect(result.rows[0]!.cells.map(c=>c.value)).toEqual([{type:'NUMBER',value:0},{type:'NUMBER',value:null},{type:'STRING',value:null}]);
});

it('keeps native CSV precision, BOM, duplicate headers, date strings and distinct empty/missing-cell semantics',async()=>{
 const f=await fixture('\uFEFFamount,amount,when,note,exact,precise,blank\r\n1.25,2,2026-10-23,"",9007199254740993,123456789012345.12,\r\n3.5,4,2026-10-24,x,9007199254740995,123456789012345.13,');
 expect(f.table.columns.map(c=>c.label)).toEqual(['amount','amount_2','when','note','exact','precise','blank']);
 expect(f.table.columns.find(c=>c.label==='exact')!.type).toBe('STRING');expect(f.table.columns.find(c=>c.label==='precise')!.type).toBe('STRING');
 const read=await f.api.read(f.actor,f.binding,{tableId:f.table.id,first:100},signal),labels=new Map(f.table.columns.map(c=>[c.id,c.label]));
 const rows=read.rows.map(row=>Object.fromEntries(row.cells.map(cell=>[labels.get(cell.columnId),cell.value.value]))).sort((a,b)=>Number(a.amount)-Number(b.amount));
 expect(rows).toEqual([{amount:1.25,amount_2:2,when:'2026-10-23',note:'',exact:'9007199254740993',precise:'123456789012345.12',blank:null},{amount:3.5,amount_2:4,when:'2026-10-24',note:'x',exact:'9007199254740995',precise:'123456789012345.13',blank:null}]);
});
it('keeps the original header-only CSV rejection instead of inventing data rows',async()=>{
 const owner=await mintAccountToken('empty_csv_fixture');
 const response=await create(request('/api/artifacts',{method:'POST',token:owner.token,json:{dataset:'amount,label'}}));
 expect(response.status).toBe(400);expect(await response.json()).toMatchObject({error:'invalid_dataset',code:'empty'});
});
it('refuses remote PostgreSQL catalogs before executing native dataset reads or writes',async()=>{
 const f=await fixture();const db=await getDb();
 await db.query(`UPDATE artifacts SET meta=jsonb_set(meta,'{catalog,kind}','"postgres"'::jsonb) WHERE id=$1`,[f.id]);
 await expect(f.api.schema(f.actor,f.binding,signal)).rejects.toThrow('dataset_stable_identity_unavailable');
 await expect(f.api.read(f.actor,f.binding,{tableId:f.table.id,first:1},signal)).rejects.toThrow('dataset_stable_identity_unavailable');
 await expect(f.api.write(f.actor,f.binding,{tableId:f.table.id,expectedRevision:'1',requestId:'remote-not-supported',changes:[{kind:'DELETE',rowId:'row'}]},signal)).rejects.toThrow('dataset_stable_identity_unavailable');
 expect((await getArtifactById(f.id))?.version).toBe(1);
});
