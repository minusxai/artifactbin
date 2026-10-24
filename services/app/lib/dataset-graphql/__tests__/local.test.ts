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
it('binds cursors to actors and shape, aborts, and retains rejected request identities',async()=>{
 const local=createLocalDataset('sales',[table]);
 const first=await local.read('viewer',binding,{tableId:id,first:1},signal);
 for(const [actor,request] of [['other',{tableId:id,first:1}],['viewer',{tableId:id,first:2}]] as const){await expect(local.read(actor,binding,{...request,after:first.pageInfo.endCursor!},signal)).rejects.toThrow('stale_cursor');}
 const aborted=AbortSignal.abort();await expect(local.schema(null,binding,aborted)).rejects.toThrow();
 await expect(local.read(null,binding,{tableId:id,first:1,filters:[{columnId:amount,operator:'EQ',value:{type:'STRING',value:'2'}}]},signal)).rejects.toThrow('dataset_cell_type_mismatch');
 const request={tableId:id,requestId:'reject',expectedRevision:'wrong',changes:[{kind:'DELETE' as const,rowId:'missing'}]};
 const rejected=await local.write(null,binding,request,signal);expect(await local.write(null,binding,request,signal)).toEqual(rejected);
 await expect(local.write(null,binding,{...request,expectedRevision:first.revision},signal)).rejects.toThrow('dataset_request_id_reused');
 await expect(local.read(null,binding,{tableId:id,first:1,after:'x'.repeat(1025)},signal)).rejects.toThrow('invalid_cursor');
});
it('orders nulls in both directions, uses numeric comparison, and paginates aggregate ties',async()=>{
 const local=createLocalDataset('sales',[table]);
 for(const direction of ['ASC','DESC'] as const){const result=await local.read(null,binding,{tableId:id,first:10,order:[{columnId:amount,direction}]},signal);expect(result.rows.map(r=>r.cells[1]!.value.value)).toEqual(direction==='ASC'?[2,5,null]:[null,5,2]);}
 const request={tableId:id,first:1,groupBy:[team],aggregates:[{id:'count',operation:'COUNT' as const,columnId:amount}],order:[{columnId:'count',direction:'ASC' as const}]};
 const first=await local.query(null,binding,request,signal),second=await local.query(null,binding,{...request,after:first.pageInfo.endCursor!},signal);
 expect(first.rows[0]!.cells[0]!.value.value).toBe('A');expect(second.rows[0]!.cells[0]!.value.value).toBe('B');expect(first.rows[0]!.id).not.toBe(second.rows[0]!.id);
});
it('never reuses deleted row IDs for a new request',async()=>{
 const local=createLocalDataset('sales',[table]);let revision=(await local.schema(null,binding,signal)).revision;
 const inserted=await local.write(null,binding,{tableId:id,requestId:'i1',expectedRevision:revision,changes:[{kind:'INSERT',cells:[{columnId:amount,value:{type:'NUMBER',value:7}}]}]},signal);revision=inserted.revision!;
 const deleted=await local.write(null,binding,{tableId:id,requestId:'d1',expectedRevision:revision,changes:[{kind:'DELETE',rowId:inserted.rowIds[0]!}]},signal);
 const again=await local.write(null,binding,{tableId:id,requestId:'i2',expectedRevision:deleted.revision!,changes:[{kind:'INSERT',cells:[{columnId:amount,value:{type:'NUMBER',value:7}}]}]},signal);expect(again.rowIds[0]).not.toBe(inserted.rowIds[0]);
});
it('bounds receipts without forgetting prior committed or rejected IDs',async()=>{
 const local=createLocalDataset('sales',[table]);
 const rejected={tableId:id,expectedRevision:'wrong',changes:[{kind:'DELETE' as const,rowId:'missing'}]};
 for(let i=0;i<1024;i++)await local.write(null,binding,{...rejected,requestId:`reject${i}`},signal);
 await expect(local.write(null,binding,{...rejected,requestId:'overflow'},signal)).rejects.toThrow('local_dataset_session_full');
 expect((await local.write(null,binding,{...rejected,requestId:'reject0'},signal)).outcome).toBe('rejected');
});
it('orders ISO dates and text by retained byte ordering',async()=>{
 const source={schema:'main',name:'text',columns:[{name:'date',type:'date' as const},{name:'text',type:'string' as const}],rows:[{date:'2026-10-01',text:'𐀀'},{date:'2026-09-30',text:'\ue000'}]};
 const local=createLocalDataset('text',[source]),tableId=tableIdentity(source);
 for(const [name,expected] of [['date',['2026-09-30','2026-10-01']],['text',['\ue000','𐀀']]] as const){const col=columnIdentity(tableId,name),result=await local.read(null,binding,{tableId,first:10,columnIds:[col],order:[{columnId:col,direction:'ASC'}]},signal);expect(result.rows.map(r=>r.cells[0]!.value.value)).toEqual(expected);}
});
