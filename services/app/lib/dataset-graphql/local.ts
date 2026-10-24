import {createHash} from 'node:crypto';
import type {DatasetAggregateOperation,DatasetGraphqlRow,DatasetQueryRequest,DatasetReadRequest,DatasetRowFilter,DatasetWriteReceipt} from '@artifactbin/contracts';
import {compileChanges,compileRead,columnIdentity,descriptors,initialRowIds,tableIdentity,typedCell,ID_COLUMN} from './model';
import {compileDatasetQuery,parameterizedFilters} from './query';
import type {LocalDataset,LocalDatasetTable} from './local-types';
const hash=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('base64url');
// Retained SQL orders nulls last for ASC, first for DESC. Text uses UTF-8 byte order.
const compare=(a:unknown,b:unknown):number=>{
 if(a===b)return 0;
 if(a===null)return 1;
 if(b===null)return -1;
 if(typeof a==='string'&&typeof b==='string')return Buffer.compare(Buffer.from(a),Buffer.from(b));
 return a!<b!?-1:1;
};
const MAX_RECEIPTS=1024,MAX_ROWS=100_000,MAX_SESSION_BYTES=32*1024*1024;
function aggregateValue(operation:DatasetAggregateOperation,values:unknown[],rowCount:number,hasColumn:boolean):unknown {
 if(operation==='COUNT')return hasColumn?values.length:rowCount;
 if(!values.length)return null;
 if(operation==='SUM'||operation==='AVG'){
 const sum=values.reduce<number>((total,value)=>total+(value as number),0);
 return operation==='AVG'?sum/values.length:sum;
 }
 return values.reduce((best,value)=>compare(value,best)*(operation==='MIN'?1:-1)<0?value:best);
}
/** Node-only private preview adapter. No network, credential, or implicit filesystem effects. */
export function createLocalDataset(namespace:string,input:readonly LocalDatasetTable[]):LocalDataset {
 if(input.length>64||input.reduce((count,t)=>count+t.rows.length,0)>MAX_ROWS||Buffer.byteLength(JSON.stringify(input))>MAX_SESSION_BYTES)throw new Error('local_dataset_session_full');
 const tables=structuredClone(input).map(t=>({...t,rowIds:[...(t.rowIds??initialRowIds(namespace,tableIdentity(t),hash(t.rows),t.rows.length))]}));
 if(Buffer.byteLength(JSON.stringify(tables))>MAX_SESSION_BYTES)throw new Error('local_dataset_session_full');
 let revision=`local_${hash(tables)}`;
 const receipts=new Map<string,{identity:string;receipt:DatasetWriteReceipt}>();
 const tableFor=(id:string)=>{const table=tables.find(t=>tableIdentity(t)===id);if(!table)throw new Error('dataset_table_not_found');return table;};
 const source=(table:LocalDatasetTable)=>({truncated:false,totalRows:table.rows.length,storedRows:table.rows.length});
 for(const table of tables){descriptors(table);if(table.rowIds.length!==table.rows.length||new Set(table.rowIds).size!==table.rows.length||table.rowIds.some(id=>!id))throw new Error('dataset_row_identity_corrupt');for(const row of table.rows)for(const col of table.columns)typedCell(col,row[col.name]);}
 function rows(table:LocalDatasetTable,filters:readonly DatasetRowFilter[]|undefined){
 const cols=new Map(table.columns.map(c=>[columnIdentity(tableIdentity(table),c.name),c.name]));
 return table.rows.map((row,i):Record<string,unknown>&{[ID_COLUMN]:string}=>({...row,[ID_COLUMN]:table.rowIds![i]!})).filter(row=>(filters??[]).every(f=>{
 const value=row[cols.get(f.columnId)!]??null,target=f.value?.value;
 if(f.operator==='IS_NULL')return value===null;
 if(target===null)return f.operator==='EQ'?value===null:value!==null;
 if(value===null)return false;
 const c=compare(value,target);return ({EQ:c===0,NE:c!==0,LT:c<0,LTE:c<=0,GT:c>0,GTE:c>=0})[f.operator];
 }));
 }
 async function query(actor:unknown,binding:Parameters<LocalDataset['query']>[1],request:DatasetQueryRequest,signal:AbortSignal){
 signal.throwIfAborted();const table=tableFor(request.tableId),normalized=parameterizedFilters(request);
 if(request.groupBy?.length&&!request.aggregates?.length)throw new Error('dataset_aggregate_required');
 const aggregate=request.aggregates?.length?compileDatasetQuery(table,request):undefined;
 const base=aggregate?undefined:compileRead(table,normalized);
 let values:DatasetGraphqlRow[];
 if(aggregate){
 const names=new Map(table.columns.map(c=>[columnIdentity(request.tableId,c.name),c.name]));
 const groups=new Map<string,Record<string,unknown>[]>();
 for(const row of rows(table,normalized.filters)){const key=JSON.stringify((request.groupBy??[]).map(id=>row[names.get(id)!]??null));const group=groups.get(key)??[];group.push(row);groups.set(key,group);}
 if(!request.groupBy?.length&&!groups.size)groups.set('[]',[]);
 values=[...groups.values()].map(group=>{
 const output:Record<string,unknown>={};
 (request.groupBy??[]).forEach((id,i)=>{output[`__af_group_${i}`]=group[0]?.[names.get(id)!]??null;});
 request.aggregates!.forEach((a,i)=>{const present=a.columnId?group.map(r=>r[names.get(a.columnId!)!]??null).filter(v=>v!==null):[];
 output[`__af_metric_${i}`]=aggregateValue(a.operation,present,group.length,a.columnId!==undefined);
 });return aggregate.row(output);
 });
 }else values=rows(table,normalized.filters).map(row=>({id:row[ID_COLUMN],cells:base!.columns.map(c=>({columnId:columnIdentity(request.tableId,c.name),value:typedCell(c,row[c.name])}))}));
 const get=(r:DatasetGraphqlRow,id:string)=>{if(!aggregate){const column=table.columns.find(c=>columnIdentity(request.tableId,c.name)===id)!;return table.rows[table.rowIds.indexOf(r.id)]?.[column.name]??null;}return r.cells.find(c=>c.columnId===id)?.value.value??null;};
 values.sort((a,b)=>{for(const order of request.order??[]){const av=get(a,order.columnId),bv=get(b,order.columnId),c=compare(av,bv);if(c)return c*(order.direction==='DESC'?-1:1);}if(aggregate){for(const id of request.groupBy??[]){const c=compare(get(a,id),get(b,id));if(c)return c;}}return compare(a.id,b.id);});
 const {after,...shape}=request,identity=hash([namespace,binding,actor,revision,shape]);let offset=0;
 if(after){if(after.length>1024)throw new Error('invalid_cursor');let cursor:unknown;try{cursor=JSON.parse(Buffer.from(after,'base64url').toString());}catch{throw new Error('invalid_cursor');}if(!Array.isArray(cursor)||cursor.length!==2||cursor[0]!==identity||!Number.isSafeInteger(cursor[1])||cursor[1]<0)throw new Error('stale_cursor');offset=cursor[1] as number;}
 const visible=values.slice(offset,offset+request.first);
 return {revision,source:source(table),columns:aggregate?.columns??descriptors(table).filter(c=>base!.columns.some(p=>columnIdentity(request.tableId,p.name)===c.id)),rows:visible,pageInfo:{hasNextPage:values.length>offset+visible.length,endCursor:visible.length?Buffer.from(JSON.stringify([identity,offset+visible.length])).toString('base64url'):null}};
 }
 return {
 async people(){throw Error('dataset_people_unavailable_offline');},
 export:()=>structuredClone({revision,tables}),
 async schema(_actor,_binding,signal){signal.throwIfAborted();return {revision,tables:tables.map(t=>({id:tableIdentity(t),label:t.name,columns:descriptors(t),source:source(t)}))};},
 query,read:(actor,binding,request:DatasetReadRequest,signal)=>query(actor,binding,request,signal),
 async write(actor,binding,request,signal){
 signal.throwIfAborted();const key=hash([actor,request.requestId]),identity=hash([binding,request]),prior=receipts.get(key);
 if(prior){if(prior.identity!==identity)throw new Error('dataset_request_id_reused');return structuredClone(prior.receipt);}
 const reject=():DatasetWriteReceipt=>{
 const receipt:DatasetWriteReceipt={requestId:request.requestId,revision:null,outcome:'rejected',rowIds:[]};
 receipts.set(key,{identity,receipt});return structuredClone(receipt);
 };
 // Retain identities for this bounded session; never evict an ID and accidentally apply it twice.
 if(receipts.size>=MAX_RECEIPTS)throw new Error('local_dataset_session_full');
 if(binding.mode==='pinned'||!request.requestId||request.expectedRevision!==revision)return reject();
 const table=tableFor(request.tableId),statements=compileChanges(table,request.changes,hash([namespace,actor,request.requestId]));
 const next=structuredClone(table),affected:string[]=[];
 for(const [i,change] of request.changes.entries()){
 const id=change.kind==='INSERT'?statements[i]!.params.rowId as string:change.rowId,index=next.rowIds.indexOf(id);
 if(change.kind!=='INSERT'&&index<0)return reject();
 if(change.kind==='DELETE'){next.rows.splice(index,1);next.rowIds.splice(index,1);}else{
 const row=change.kind==='INSERT'?Object.fromEntries(table.columns.map(c=>[c.name,null])):next.rows[index]!;
 for(const cell of change.cells){const col=table.columns.find(c=>columnIdentity(request.tableId,c.name)===cell.columnId)!;row[col.name]=cell.value.value;}
 if(change.kind==='INSERT'){next.rows.push(row);next.rowIds.push(id);}
 }if(change.kind!=='DELETE')affected.push(id);
 }
 if(tables.reduce((count,t)=>count+(t===table?next.rows.length:t.rows.length),0)>MAX_ROWS||Buffer.byteLength(JSON.stringify(tables.map(t=>t===table?next:t)))>MAX_SESSION_BYTES)throw new Error('local_dataset_session_full');
 table.rows=next.rows;table.rowIds=next.rowIds;revision=`local_${hash([revision,request])}`;
 const receipt:DatasetWriteReceipt={requestId:request.requestId,revision,outcome:'committed',rowIds:affected};receipts.set(key,{identity,receipt});return structuredClone(receipt);
 }
 };
}
