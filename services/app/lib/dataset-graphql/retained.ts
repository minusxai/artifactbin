import {createHash} from 'node:crypto';
import type {DatasetSourceInfo} from '@artifactbin/contracts';
import {artifactState,durableMutation,type ArtifactRow} from '@/lib/artifacts';
import {catalogOf, executeCatalog, loadDatasetRows, people} from '@/lib/datasets';
import {getDb} from '@/lib/platform';
import {readDatasetPeople} from './people';
import {objectStore} from '@/lib/object-store';
import {canWriteDataset,canUseDataPolicy,isMutationRefused,mutateDataset} from '@/lib/document-data';
import type {DatasetGraphqlPort} from './types';
import {createDatasetGraphql} from './index';
import {ID_COLUMN,rowIdsForObject,tableIdentity} from './model';
import {authorizedDataset,resolveDatasetBinding,datasetBindingCatalog} from './authority';
const unavailable=()=>new Error('dataset_not_found');
/** Original dataset object store, executor, grants, version CAS and durable receipt ledger. */
interface RetainedReadOptions { retainReadFence?:(verify:()=>Promise<void>)=>void }
const authorityIdentity=(row:ArtifactRow)=>JSON.stringify([row.edit_id,row.policy_revision,row.sharing_revision,catalogOf(row)]);
export function retainedDatasetGraphqlPort(options:RetainedReadOptions={}):DatasetGraphqlPort {
 return {
  async people(actor,snapshot,ids,signal){
   const verify=async()=>{signal.throwIfAborted();if(authorityIdentity(await authorizedDataset(actor,snapshot.id))!==snapshot.policyIdentity)throw Error('dataset_changed');};
   options.retainReadFence?.(verify);
   return readDatasetPeople(snapshot,ids,{verify,rows:async table=>{if(!table.objectKey)throw unavailable();return loadDatasetRows({meta:{objectKey:table.objectKey}});},cards:async ids=>people(await getDb(),ids)},signal);
  },
  async snapshot(actor,binding,signal){
   signal.throwIfAborted();
   const admitted=await authorizedDataset(actor,binding.datasetId),policyIdentity=authorityIdentity(admitted);
   const row=await resolveDatasetBinding(actor,binding),catalog=datasetBindingCatalog(row);
   const verify=async()=>{signal.throwIfAborted();if(authorityIdentity(await authorizedDataset(actor,row.id))!==policyIdentity)throw new Error('dataset_changed');};
   options.retainReadFence?.(verify);
   const rowIds:Record<string,readonly string[]>={},sources:Record<string,DatasetSourceInfo>={};
   const saved=(row.meta as {graphqlRowIds?:Record<string,{objectKey:string;ids:string[]}>}).graphqlRowIds;
   for(const table of catalog.tables){
    const tableId=tableIdentity(table),rows=await loadDatasetRows({meta:{objectKey:table.objectKey}}),prior=saved?.[tableId];
    rowIds[tableId]=rowIdsForObject(row.id,tableId,table.objectKey!,rows.length,prior);
    const metadata=row.meta as {truncated?:unknown;totalRows?:unknown};
    const truncated=table.schema==='public'&&table.name==='rows'&&metadata.truncated===true;
    sources[tableId]={truncated,storedRows:rows.length,totalRows:truncated?(typeof metadata.totalRows==='number'&&Number.isSafeInteger(metadata.totalRows)&&metadata.totalRows>=rows.length?metadata.totalRows:null):rows.length};
   }
   // Schema/source metadata has no later execution fence; recheck readership after object loads too.
   await verify();
   return {id:row.id,revision:String(row.version),policyIdentity,catalog,rowIds,sources};
  },
  async execute(actor,snapshot,tableId,statement,window,signal){
   const table=snapshot.catalog.tables.find(t=>tableIdentity(t)===tableId);if(!table?.objectKey)throw unavailable();
   if(table.columns.some(c=>c.name===ID_COLUMN))throw new Error('dataset_reserved_column');
   const source=objectStore();
   const catalog={...snapshot.catalog,tables:snapshot.catalog.tables.map(t=>t===table?{...t,columns:[...t.columns,{name:ID_COLUMN,type:'string' as const}]}:t)};
   const authorize=async()=>{const row=await authorizedDataset(actor,snapshot.id);if(snapshot.policyIdentity!==authorityIdentity(row))throw new Error('dataset_changed');};
   const result=await executeCatalog(catalog,statement.sql,statement.params,{...window,timeoutMs:5000,actor,datasetId:snapshot.id,signal,authorize,
    objects:{get:async key=>{
     const bytes=await source.get(key);if(key!==table.objectKey)return bytes;
     const rows=JSON.parse(bytes.toString('utf8')) as Record<string,unknown>[];
     return Buffer.from(JSON.stringify(rows.map((row,i)=>({...row,[ID_COLUMN]:snapshot.rowIds[tableId]![i]}))));
    }}});
   await authorize();signal.throwIfAborted();
   return result.rows;
  },
  async commit(actor,binding,snapshot,input,statements,signal){
   const current=await authorizedDataset(actor,binding.datasetId);
   // A page link never supplies edit permission. Repeat before ledger lookup and in mutateDataset's CAS.
   const nativePolicy=await canUseDataPolicy(current,actor);
   if(await canWriteDataset(current,actor,nativePolicy))return {requestId:input.requestId,revision:null,outcome:'rejected',rowIds:[]};
   const table=snapshot.catalog.tables.find(t=>tableIdentity(t)===input.tableId);if(!table)throw unavailable();
   const reply=await durableMutation(actor,'https://dataset.invalid',createHash('sha256').update(input.requestId).digest('base64url'),{datasetId:binding.datasetId,...input},async receipt=>{
    signal.throwIfAborted();
    if(snapshot.revision!==input.expectedRevision||String(current.version)!==input.expectedRevision)return {status:409,body:{outcome:'rejected'}};
    const first=statements[0]!;
    const result=await mutateDataset(current,actor,first.sql,first.params,{target:{schema:table.schema,table:table.name},expectedState:artifactState(current),receipt,expectedAffected:1,
     statements,nativePolicy,rowIdentity:{column:ID_COLUMN,ids:snapshot.rowIds[input.tableId]!,tableId:input.tableId}});
    return isMutationRefused(result)?{status:409,body:{outcome:'rejected'}}:{status:200,body:{id:result.row.id,version:result.row.version,affected:result.affected,rowCount:result.rowCount}};
   });
   const outcome=reply.status===200?'committed':reply.body.error==='operation_pending'||reply.body.error==='outcome_unknown'?'unknown':'rejected';
   // Stable IDs are available in the committed dataset; receipt reports touched extant IDs.
   const rowIds=input.changes.flatMap((change,i)=>change.kind==='DELETE'?[]:[String(change.kind==='INSERT'?statements[i]!.params.rowId:change.rowId)]);
   return {requestId:input.requestId,revision:reply.status===200?String(reply.body.version):null,outcome,rowIds:outcome==='committed'?rowIds:[]};
  },
 };
}
export const createRetainedDatasetGraphql=(options:RetainedReadOptions={})=>createDatasetGraphql(retainedDatasetGraphqlPort(options));
