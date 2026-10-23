import {createHash} from 'node:crypto';
import type {AccessActor} from '@/lib/accounts';
import {artifactState,canReadArtifact,durableMutation,getArtifactById,getVersionFor,type ArtifactRow} from '@/lib/artifacts';
import {catalogOf} from '@/lib/datasets/catalog';
import {executeCatalog} from '@/lib/datasets/execute';
import {loadDatasetRows} from '@/lib/datasets/dataset-store';
import {objectStore} from '@/lib/object-store';
import {canWriteDataset,canUseDataPolicy,isMutationRefused,mutateDataset} from '@/lib/document-data';
import type {DatasetGraphqlPort} from './types';
import {createDatasetGraphql} from './index';
import {ID_COLUMN,initialRowIds,tableIdentity} from './model';
import type {HtmlDatasetLink} from '@artifactbin/contracts';
const unavailable=()=>new Error('dataset_not_found');
async function authorized(actor:AccessActor,id:string){const row=await getArtifactById(id);if(!row||row.format!=='dataset'||!await canReadArtifact(row,actor))throw unavailable();return row;}
async function resolved(actor:AccessActor,binding:HtmlDatasetLink){
 const live=await authorized(actor,binding.datasetId);
 if(binding.mode==='live'||binding.revision===String(live.version))return live;
 if(!/^[1-9]\d*$/.test(binding.revision))throw unavailable();
 const version=await getVersionFor(actor,binding.datasetId,Number(binding.revision));
 if(!version||version.format!=='dataset')throw unavailable();
 return {...live,...version,version:Number(binding.revision)} as ArtifactRow;
}
/** Original dataset object store, executor, grants, version CAS and durable receipt ledger. */
export function retainedDatasetGraphqlPort():DatasetGraphqlPort {
 return {
  async snapshot(actor,binding,signal){
   signal.throwIfAborted();const row=await resolved(actor,binding),catalog=catalogOf(row);if(!catalog)throw unavailable();
   if(catalog.kind!=='stored')throw new Error('dataset_stable_identity_unavailable');
   const rowIds:Record<string,string[]>={};
   const saved=(row.meta as {graphqlRowIds?:Record<string,{objectKey:string;ids:string[]}>}).graphqlRowIds;
   for(const table of catalog.tables){
    if(!table.objectKey||table.sql)throw new Error('dataset_stable_identity_unavailable');
    const tableId=tableIdentity(table),rows=await loadDatasetRows({meta:{objectKey:table.objectKey}}),prior=saved?.[tableId];
    rowIds[tableId]=prior?.objectKey===table.objectKey&&prior.ids.length===rows.length&&new Set(prior.ids).size===rows.length&&prior.ids.every(id=>typeof id==='string')?prior.ids:initialRowIds(row.id,tableId,table.objectKey,rows.length);
   }
   return {id:row.id,revision:String(row.version),policyIdentity:JSON.stringify([row.edit_id,row.policy_revision,row.sharing_revision]),catalog,rowIds};
  },
  async execute(actor,snapshot,tableId,statement,window,signal){
   const table=snapshot.catalog.tables.find(t=>tableIdentity(t)===tableId);if(!table?.objectKey)throw unavailable();
   if(table.columns.some(c=>c.name===ID_COLUMN))throw new Error('dataset_reserved_column');
   const source=objectStore();
   const catalog={...snapshot.catalog,tables:snapshot.catalog.tables.map(t=>t===table?{...t,columns:[...t.columns,{name:ID_COLUMN,type:'string' as const}]}:t)};
   const authorize=async()=>{const row=await authorized(actor,snapshot.id);if(snapshot.policyIdentity!==JSON.stringify([row.edit_id,row.policy_revision,row.sharing_revision]))throw new Error('dataset_changed');};
   const result=await executeCatalog(catalog,statement.sql,statement.params,{...window,actor,datasetId:snapshot.id,signal,authorize,
    objects:{get:async key=>{
     const bytes=await source.get(key);if(key!==table.objectKey)return bytes;
     const rows=JSON.parse(bytes.toString('utf8')) as Record<string,unknown>[];
     return Buffer.from(JSON.stringify(rows.map((row,i)=>({...row,[ID_COLUMN]:snapshot.rowIds[tableId]![i]}))));
    }}});
   return result.rows;
  },
  async commit(actor,binding,snapshot,input,statements,signal){
   const current=await authorized(actor,binding.datasetId);
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
export const createRetainedDatasetGraphql=()=>createDatasetGraphql(retainedDatasetGraphqlPort());
