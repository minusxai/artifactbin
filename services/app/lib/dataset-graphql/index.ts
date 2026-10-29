import {createHash} from 'node:crypto';
import {DATASET_GRAPHQL_MAX_PEOPLE} from '@artifactbin/contracts';
import type {DatasetGraphql,DatasetReadRequest,DatasetReadResult,DatasetWriteRequest,HtmlDatasetLink} from '@artifactbin/contracts';
import type { AccessActor } from '@/lib/accounts';
import {compileDatasetQuery,parameterizedFilters} from './query';
import {compileRead,compileChanges,columnIdentity,descriptors,tableIdentity,typedCell,ID_COLUMN} from './model';
import type {DatasetGraphqlPort,DatasetSnapshot} from './types';
export type {DatasetGraphqlPort,DatasetSnapshot} from './types';
const hash=(v:unknown)=>createHash('sha256').update(JSON.stringify(v)).digest('base64url');
function tableFor(snapshot:DatasetSnapshot,id:string){const table=snapshot.catalog.tables.find(t=>tableIdentity(t)===id);if(!table)throw new Error('dataset_table_not_found');return table;}
function datasetSource(snapshot:DatasetSnapshot,tableId:string){
 const source=snapshot.sources?.[tableId];if(source)return source;
 const count=snapshot.rowIds[tableId]?.length??null;
 return {truncated:false,totalRows:count,storedRows:count};
}
export function datasetSchema(snapshot:DatasetSnapshot){return {revision:snapshot.revision,tables:snapshot.catalog.tables.map(table=>({id:tableIdentity(table),label:table.name,columns:descriptors(table),source:datasetSource(snapshot,tableIdentity(table))}))};}
function cursorOffset(identity:string,after:string|undefined):number {
 if(!after)return 0;
 if(after.length>1024)throw new Error('invalid_cursor');
 let cursor:unknown;try{cursor=JSON.parse(Buffer.from(after,'base64url').toString('utf8'));}catch{throw new Error('invalid_cursor');}
 if(!Array.isArray(cursor)||cursor.length!==2||cursor[0]!==identity||!Number.isSafeInteger(cursor[1])||cursor[1]<0)throw new Error('stale_cursor');
 return cursor[1] as number;
}
/** Pure request orchestration. Every continuation first resolves current dataset ACL again. */
export function createDatasetGraphql(port:DatasetGraphqlPort):DatasetGraphql<AccessActor> {
 return {
  async people(actor,binding,ids,signal){
   signal.throwIfAborted();
   if(!Array.isArray(ids)||ids.length>DATASET_GRAPHQL_MAX_PEOPLE||ids.some(id=>typeof id!=='string'||!/^usr_[a-zA-Z0-9]+$/.test(id)))throw Error('invalid_people');
   const snapshot=await port.snapshot(actor,binding,signal);
   if(!port.people)throw Error('dataset_people_unavailable');
   return port.people(actor,snapshot,[...new Set(ids)],signal);
  },
  async schema(actor,binding,signal){signal.throwIfAborted();return datasetSchema(await port.snapshot(actor,binding,signal));},
  async read(actor:AccessActor,binding:HtmlDatasetLink,input:DatasetReadRequest,signal:AbortSignal):Promise<DatasetReadResult>{
   signal.throwIfAborted();
   const snapshot=await port.snapshot(actor,binding,signal),table=tableFor(snapshot,input.tableId),plan=compileRead(table,input);
   const identity=hash([binding,snapshot.revision,snapshot.policyIdentity,actor,input.tableId,input.columnIds,input.filters,input.order,input.first]);
   const offset=cursorOffset(identity,input.after);
   const rows=await port.execute(actor,snapshot,input.tableId,plan.statement,{limit:input.first+1,offset},signal);
   const visible=rows.slice(0,input.first),hasNextPage=rows.length>input.first;
   return {source:datasetSource(snapshot,input.tableId),revision:snapshot.revision,columns:descriptors(table).filter(c=>plan.columns.some(p=>columnIdentity(input.tableId,p.name)===c.id)),
    rows:visible.map(row=>{if(typeof row[ID_COLUMN]!=='string')throw new Error('dataset_row_identity_missing');return {id:row[ID_COLUMN] as string,cells:plan.columns.map(column=>({columnId:columnIdentity(input.tableId,column.name),value:typedCell(column,row[column.name])}))};}),
    pageInfo:{hasNextPage,endCursor:visible.length?Buffer.from(JSON.stringify([identity,offset+visible.length])).toString('base64url'):null}};
  },
  async query(actor,binding,input,signal){
   signal.throwIfAborted();
   const snapshot=await port.snapshot(actor,binding,signal),table=tableFor(snapshot,input.tableId),normalized=parameterizedFilters(input);
   if(!input.aggregates?.length&&input.groupBy?.length)throw new Error('dataset_aggregate_required');
   const base=input.aggregates?.length?undefined:compileRead(table,normalized);
   const plan=input.aggregates?.length?compileDatasetQuery(table,input):{
    statement:base!.statement,columns:descriptors(table).filter(c=>base!.columns.some(p=>columnIdentity(input.tableId,p.name)===c.id)),
    row:(row:Record<string,unknown>)=>{if(typeof row[ID_COLUMN]!=='string')throw new Error('dataset_row_identity_missing');return {id:row[ID_COLUMN] as string,cells:base!.columns.map(column=>({columnId:columnIdentity(input.tableId,column.name),value:typedCell(column,row[column.name])}))};},
   };
   const {after,...query}=input;
   const identity=hash([binding,snapshot.revision,snapshot.policyIdentity,actor,query]),offset=cursorOffset(identity,after);
   const rows=await port.execute(actor,snapshot,input.tableId,plan.statement,{limit:input.first+1,offset},signal),visible=rows.slice(0,input.first);
   return {source:datasetSource(snapshot,input.tableId),revision:snapshot.revision,columns:plan.columns,rows:visible.map(plan.row),pageInfo:{hasNextPage:rows.length>input.first,endCursor:visible.length?Buffer.from(JSON.stringify([identity,offset+visible.length])).toString('base64url'):null}};
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

export {authorizeDatasetBinding,DatasetBindingUnsupportedError} from './authority';
