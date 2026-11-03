import type {ArtifactRow} from '@/lib/artifacts';
import {catalogOf, executeCatalog, loadDatasetRows} from '@/lib/datasets';
import type {DatasetGraphqlPort} from './types';
import {ID_COLUMN,rowIdsForObject,tableIdentity} from './model';
import {authorizedDatasetRead,resolveDatasetBinding,datasetBindingCatalog} from './authority';
import {canAggregate,datasetView,viewCatalog} from '@/lib/dataset-permissions';
import {hasuraNames,storedConfiguration} from './hasura-names';
const unavailable=()=>new Error('dataset_not_found');
/** Original dataset object store, executor and grants. */
interface RetainedReadOptions {
 retainReadFence?:(verify:()=>Promise<void>)=>void;
 /** The dataset's own GraphQL endpoint: the dataset's sharing alone decides the role (no page audience). */
 direct?:boolean;
 /** Through a page's generated API: the page (`X-Hasura-Page-Id`) the read's session names. */
 pageId?:string;
}
const authorityIdentity=(row:ArtifactRow)=>JSON.stringify([row.edit_id,row.policy_revision,row.sharing_revision,catalogOf(row)]);
/** The head's identity and the reader's role view (role, policy, session, rules): any change refuses a continuation. */
async function readIdentity(actor:import('@/lib/accounts').AccessActor,id:string,direct=false,pageId?:string){
 const read=await authorizedDatasetRead(actor,id,{throughPage:!direct,...(pageId?{pageId}:{})});
 return {...read,identity:JSON.stringify([authorityIdentity(read.row),read.decision.identity])};
}
export function retainedDatasetGraphqlPort(options:RetainedReadOptions={}):DatasetGraphqlPort {
 return {
  async snapshot(actor,binding,signal){
   signal.throwIfAborted();
   const {decision,identity:policyIdentity}=await readIdentity(actor,binding.datasetId,options.direct,options.pageId);
   const row=await resolveDatasetBinding(actor,binding,async(reader,id)=>(await authorizedDatasetRead(reader,id,{throughPage:!options.direct,...(options.pageId?{pageId:options.pageId}:{})})).row);
   // The reader's role view: tables they cannot select and hidden columns leave the schema; rows are filtered at execution.
   const declared=datasetBindingCatalog(row),view=datasetView(decision),catalog=viewCatalog(decision,declared);
   const verify=async()=>{signal.throwIfAborted();if((await readIdentity(actor,row.id,options.direct,options.pageId)).identity!==policyIdentity)throw new Error('dataset_changed');};
   options.retainReadFence?.(verify);
   const rowIds:Record<string,readonly string[]>={};
   const saved=(row.meta as {graphqlRowIds?:Record<string,{objectKey:string;ids:string[]}>}).graphqlRowIds;
   for(const table of catalog.tables){
    const tableId=tableIdentity(table),rows=await loadDatasetRows({meta:{objectKey:table.objectKey}}),prior=saved?.[tableId];
    // Row IDs are positions in the stored object (execution decorates before the view filters).
    rowIds[tableId]=rowIdsForObject(row.id,tableId,table.objectKey!,rows.length,prior);
   }
   // Schema metadata has no later execution fence; recheck readership after object loads too.
   await verify();
   const aggregatable=Object.fromEntries(catalog.tables.map(table=>[tableIdentity(table),canAggregate(decision,table)]));
   // Generated names come from every declared table and column, so they never depend on the role.
   const names=hasuraNames(declared.tables,{title:row.title,configuration:storedConfiguration(row.dataset_policy)});
   return {id:row.id,revision:String(row.version),policyIdentity,catalog,rowIds,view,aggregatable,role:decision.role,names:Object.fromEntries(declared.tables.map((table,i)=>[tableIdentity(table),names[i]!]))};
  },
  async execute(actor,snapshot,tableId,statement,window,signal){
   const table=snapshot.catalog.tables.find(t=>tableIdentity(t)===tableId);if(!table?.objectKey)throw unavailable();
   if(table.columns.some(c=>c.name===ID_COLUMN))throw new Error('dataset_reserved_column');
   const catalog={...snapshot.catalog,tables:snapshot.catalog.tables.map(t=>t===table?{...t,columns:[...t.columns,{name:ID_COLUMN,type:'string' as const}]}:t)};
   const authorize=async()=>{if(snapshot.policyIdentity!==(await readIdentity(actor,snapshot.id,options.direct,options.pageId)).identity)throw new Error('dataset_changed');};
   const result=await executeCatalog(catalog,statement.sql,statement.params,{...window,timeoutMs:5000,actor,datasetId:snapshot.id,signal,authorize,view:snapshot.view??null,
    rowIds:{table:snapshot.catalog.tables.indexOf(table),column:ID_COLUMN,ids:snapshot.rowIds[tableId]!}});
   await authorize();signal.throwIfAborted();
   return result.rows;
  },
 };
}
