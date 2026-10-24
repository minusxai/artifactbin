import {describe,it,expect} from 'vitest';
import {createLocalDataset} from '../local';
import {columnIdentity,tableIdentity} from '../model';
import type {HtmlDatasetLink} from '@artifactbin/contracts';
const binding={mode:'live'} as HtmlDatasetLink, signal=new AbortController().signal;
const table={schema:'main',name:'sales',columns:[{name:'team',type:'string' as const},{name:'amount',type:'number' as const}],rows:[{team:'A',amount:2},{team:'A',amount:null},{team:'B',amount:5}]};
const id=tableIdentity(table),amount=columnIdentity(id,'amount'),team=columnIdentity(id,'team');
describe('local dataset contract',()=>{
 it('keeps IDs, filters, groups, cursor revisions and explicit export',async()=>{
 const local=createLocalDataset('sales',[table]);
 const schema=await local.schema(null,binding,signal);
 const first=await local.read(null,binding,{tableId:id,first:1},signal);
 expect(first.pageInfo.hasNextPage).toBe(true);
 const result=await local.query(null,binding,{tableId:id,first:10,groupBy:[team],aggregates:[{id:'total',operation:'SUM',columnId:amount}]},signal);
 expect(result.rows.map(r=>r.cells.map(c=>c.value.value))).toEqual([['A',2],['B',5]]);
 const request={tableId:id,requestId:'edit',expectedRevision:schema.revision,changes:[{kind:'UPDATE' as const,rowId:first.rows[0]!.id,cells:[{columnId:amount,value:{type:'NUMBER' as const,value:9}}]}]};
 const receipt=await local.write(null,binding,request,signal);
 expect(receipt.outcome).toBe('committed');
 expect(await local.write(null,binding,request,signal)).toEqual(receipt);
 await expect(local.read(null,binding,{tableId:id,first:1,after:first.pageInfo.endCursor!},signal)).rejects.toThrow('stale_cursor');
 expect(table.rows[0]!.amount).toBe(2);
 expect(local.export().tables[0]!.rowIds).toContain(first.rows[0]!.id);
 });
 it('rejects missing rows atomically and excludes deleted IDs from receipts',async()=>{
 const local=createLocalDataset('sales',[table]);const schema=await local.schema(null,binding,signal);
 const invalid=await local.write(null,binding,{tableId:id,requestId:'missing',expectedRevision:schema.revision,changes:[{kind:'INSERT',cells:[{columnId:amount,value:{type:'NUMBER',value:8}}]},{kind:'DELETE',rowId:'absent'}]},signal);
 expect(invalid.outcome).toBe('rejected');expect(local.export().tables[0]!.rows).toHaveLength(3);
 const row=(await local.read(null,binding,{tableId:id,first:1},signal)).rows[0]!;
 const deleted=await local.write(null,binding,{tableId:id,requestId:'delete',expectedRevision:schema.revision,changes:[{kind:'DELETE',rowId:row.id}]},signal);
 expect(deleted.outcome).toBe('committed');expect(deleted.rowIds).toEqual([]);
 });
 it('rolls back invalid writes and rejects reused receipt identities',async()=>{
 const local=createLocalDataset('sales',[table]);const schema=await local.schema(null,binding,signal);
 const request={tableId:id,requestId:'insert',expectedRevision:schema.revision,changes:[{kind:'INSERT' as const,cells:[{columnId:amount,value:{type:'NUMBER' as const,value:7}}]}]};
 await local.write(null,binding,request,signal);
 await expect(local.write(null,binding,{...request,changes:[{kind:'DELETE',rowId:'missing'}]},signal)).rejects.toThrow('dataset_request_id_reused');
 expect((await local.read(null,binding,{tableId:id,first:10,filters:[{columnId:amount,operator:'EQ',value:{type:'NUMBER',value:null}}]},signal)).rows).toHaveLength(1);
 });
});
