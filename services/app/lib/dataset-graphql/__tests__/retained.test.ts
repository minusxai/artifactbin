import {expect,it} from 'vitest';
import {setDatasetPolicy} from '@/lib/document-data/dataset-policy';
import {getDb} from '@/lib/platform';
import {useAppHarness,request,mintAccountToken} from '@/__tests__/harness';
import {POST as create} from '@/app/api/artifacts/route';
import {getArtifactById} from '@/lib/artifacts';
import {requestOrSessionActor} from '@/lib/accounts';
import {loadDatasetRows} from '@/lib/datasets/dataset-store';
import {createRetainedDatasetGraphql,retainedDatasetGraphqlPort} from '../retained';
import {datasetSchema} from '../index';
useAppHarness();
const signal=new AbortController().signal;
async function fixture(){
 const owner=await mintAccountToken('dataset_graphql_fixture');
 const req=request('/api/artifacts',{method:'POST',token:owner.token,json:{dataset:[{amount:1,label:'same'},{amount:1,label:'same'},{amount:3,label:null}],access:'readwrite'}});
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
