import {createHash} from 'node:crypto';
import type {DatasetGraphql,DatasetReadRequest,DatasetReadResult,DatasetWriteRequest,HtmlDatasetLink} from '@artifactbin/contracts';
import type {AccessActor} from '@/lib/accounts';
import {compileRead,compileChanges,columnIdentity,descriptors,tableIdentity,typedCell,ID_COLUMN} from './model';
import type {DatasetGraphqlPort,DatasetSnapshot} from './types';
export type {DatasetGraphqlPort,DatasetSnapshot} from './types';
export {tableIdentity,columnIdentity} from './model';
const hash=(v:unknown)=>createHash('sha256').update(JSON.stringify(v)).digest('base64url');
function tableFor(snapshot:DatasetSnapshot,id:string){const table=snapshot.catalog.tables.find(t=>tableIdentity(t)===id);if(!table)throw new Error('dataset_table_not_found');return table;}
export function datasetSchema(snapshot:DatasetSnapshot){return {revision:snapshot.revision,tables:snapshot.catalog.tables.map(table=>({id:tableIdentity(table),label:table.name,columns:descriptors(table)}))};}
/** Pure request orchestration. Every continuation first resolves current dataset ACL again. */
export function createDatasetGraphql(port:DatasetGraphqlPort):DatasetGraphql<AccessActor> {
 return {
  async schema(actor,binding,signal){signal.throwIfAborted();return datasetSchema(await port.snapshot(actor,binding,signal));},
  async read(actor:AccessActor,binding:HtmlDatasetLink,input:DatasetReadRequest,signal:AbortSignal):Promise<DatasetReadResult>{
   signal.throwIfAborted();
   const snapshot=await port.snapshot(actor,binding,signal),table=tableFor(snapshot,input.tableId),plan=compileRead(table,input);
   const identity=hash([binding,snapshot.revision,snapshot.policyIdentity,actor,input.tableId,input.columnIds,input.filters,input.order,input.first]);
   let offset=0;
   if(input.after){
    if(input.after.length>1024)throw new Error('invalid_cursor');
    let cursor:unknown;try{cursor=JSON.parse(Buffer.from(input.after,'base64url').toString('utf8'));}catch{throw new Error('invalid_cursor');}
    if(!Array.isArray(cursor)||cursor.length!==2||cursor[0]!==identity||!Number.isSafeInteger(cursor[1])||cursor[1]<0)throw new Error('stale_cursor');
    offset=cursor[1] as number;
   }
   const rows=await port.execute(actor,snapshot,input.tableId,plan.statement,{limit:input.first+1,offset},signal);
   const visible=rows.slice(0,input.first),hasNextPage=rows.length>input.first;
   return {revision:snapshot.revision,columns:descriptors(table).filter(c=>plan.columns.some(p=>columnIdentity(input.tableId,p.name)===c.id)),
    rows:visible.map(row=>{if(typeof row[ID_COLUMN]!=='string')throw new Error('dataset_row_identity_missing');return {id:row[ID_COLUMN] as string,cells:plan.columns.map(column=>({columnId:columnIdentity(input.tableId,column.name),value:typedCell(column,row[column.name])}))};}),
    pageInfo:{hasNextPage,endCursor:visible.length?Buffer.from(JSON.stringify([identity,offset+visible.length])).toString('base64url'):null}};
  },
  async write(actor:AccessActor,binding:HtmlDatasetLink,input:DatasetWriteRequest,signal:AbortSignal){
   signal.throwIfAborted();
   if(binding.mode==='pinned'||!input.expectedRevision||!input.requestId||!input.changes.length||input.changes.length>100)return {requestId:input.requestId,revision:null,outcome:'rejected',rowIds:[]};
   const snapshot=await port.snapshot(actor,binding,signal),table=tableFor(snapshot,input.tableId);
   // Receipt lookup and expected-revision validation live together in the retained commit port.
   return port.commit(actor,binding,snapshot,input,compileChanges(table,input.changes,hash([snapshot.id,actor,input.requestId])),signal);
  },
 };
}
export {datasetNamespaceSources,createDatasetNamespaceInvoker} from './namespace';

export {authorizeDatasetBinding} from './authority';
