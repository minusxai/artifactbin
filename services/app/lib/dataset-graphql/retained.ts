import type {ArtifactRow} from '@/lib/artifacts';
import {catalogOf, executeCatalog, loadDatasetRows} from '@/lib/datasets';
import type {DatasetGraphqlPort} from './types';
import {ID_COLUMN,rowIdsForObject,tableIdentity} from './model';
import {authorizedDatasetRead,resolveDatasetBinding,datasetBindingCatalog} from './authority';
import {canAggregate,datasetView,viewCatalog} from '@/lib/dataset-permissions';
import {hasuraNames,storedConfiguration} from './hasura-names';
import {liveAccessFacts,memoAccessFacts,type AccessFacts} from '@/lib/artifact-access';
import type {AccessActor} from '@/lib/accounts';
const unavailable=()=>new Error('dataset_not_found');
/** Original dataset object store, executor and grants. */
interface RetainedReadOptions {
 retainReadFence?:(verify:()=>Promise<void>)=>void;
 /** The dataset's own GraphQL endpoint: the dataset's sharing alone decides the role (no page audience). */
 direct?:boolean;
 /** Through a page's generated API: the page (`X-Hasura-Page-Id`) the read's session names. */
 pageId?:string;
 /**
  * The caller checks every retained fence before anything read leaves (a query's reply, a resolver's tables): the
  * snapshot and each statement are then authorized once, by the snapshot, and not again. Without it (a page's
  * schema, a mutation's load) the snapshot checks its fence after loading and every statement checks around itself.
  */
 fenced?:boolean;
 /** The request's memo of the caller's access facts: the one authorization reads each fact once. Fences never use it. */
 facts?:AccessFacts;
}
const authorityIdentity=(row:ArtifactRow)=>JSON.stringify([row.edit_id,row.policy_revision,row.sharing_revision,catalogOf(row)]);
/** The head's identity and the reader's role view (role, policy, session, rules): any change refuses a continuation. */
async function readIdentity(actor:AccessActor,id:string,options:RetainedReadOptions,facts:AccessFacts|undefined){
 const read=await authorizedDatasetRead(actor,id,{throughPage:!options.direct,...(options.pageId?{pageId:options.pageId}:{}),...(facts?{facts}:{})});
 return {...read,identity:JSON.stringify([authorityIdentity(read.row),read.decision.identity])};
}
/** A fence asks afresh: the head and the caller's facts as they are now, never the request's memo. */
const freshIdentity=(actor:AccessActor,id:string,options:RetainedReadOptions)=>readIdentity(actor,id,options,memoAccessFacts(liveAccessFacts(actor)));
export function retainedDatasetGraphqlPort(options:RetainedReadOptions={}):DatasetGraphqlPort {
 return {
  async snapshot(actor,binding,signal){
   signal.throwIfAborted();
   const {decision,identity:policyIdentity,row:head}=await readIdentity(actor,binding.datasetId,options,options.facts);
   // The head just authorized answers the binding's first authorization; a pinned revision asks again after its archive loads.
   let authorized:ArtifactRow|undefined=head;
   const row=await resolveDatasetBinding(actor,binding,async(reader,id)=>{
    if(authorized&&reader===actor&&id===head.id){const once=authorized;authorized=undefined;return once;}
    return (await readIdentity(reader,id,options,options.facts)).row;
   });
   // The reader's role view: tables they cannot select and hidden columns leave the schema; rows are filtered at execution.
   const declared=datasetBindingCatalog(row),view=datasetView(decision),catalog=viewCatalog(decision,declared);
   const verify=async()=>{signal.throwIfAborted();if((await freshIdentity(actor,row.id,options)).identity!==policyIdentity)throw new Error('dataset_changed');};
   options.retainReadFence?.(verify);
   const rowIds:Record<string,readonly string[]>={};
   const saved=(row.meta as {graphqlRowIds?:Record<string,{objectKey:string;ids:string[]}>}).graphqlRowIds;
   for(const table of catalog.tables){
    const tableId=tableIdentity(table),rows=await loadDatasetRows({meta:{objectKey:table.objectKey}}),prior=saved?.[tableId];
    // Row IDs are positions in the stored object (execution decorates before the view filters).
    rowIds[tableId]=rowIdsForObject(row.id,tableId,table.objectKey!,rows.length,prior);
   }
   // Schema metadata a caller does not fence has no later check: recheck readership after object loads.
   if(!options.fenced)await verify();
   const aggregatable=Object.fromEntries(catalog.tables.map(table=>[tableIdentity(table),canAggregate(decision,table)]));
   // Generated names come from every declared table and column, so they never depend on the role.
   const names=hasuraNames(declared.tables,{title:row.title,configuration:storedConfiguration(row.dataset_policy)});
   return {id:row.id,revision:String(row.version),policyIdentity,catalog,rowIds,view,aggregatable,role:decision.role,head,names:Object.fromEntries(declared.tables.map((table,i)=>[tableIdentity(table),names[i]!]))};
  },
  async execute(actor,snapshot,tableId,statement,window,signal){
   const table=snapshot.catalog.tables.find(t=>tableIdentity(t)===tableId);if(!table?.objectKey)throw unavailable();
   if(table.columns.some(c=>c.name===ID_COLUMN))throw new Error('dataset_reserved_column');
   const catalog={...snapshot.catalog,tables:snapshot.catalog.tables.map(t=>t===table?{...t,columns:[...t.columns,{name:ID_COLUMN,type:'string' as const}]}:t)};
   // Fenced, the snapshot's authorization holds until the caller's fence; otherwise each statement checks around itself.
   const authorize=options.fenced?undefined:async()=>{if(snapshot.policyIdentity!==(await freshIdentity(actor,snapshot.id,options)).identity)throw new Error('dataset_changed');};
   const result=await executeCatalog(catalog,statement.sql,statement.params,{...window,timeoutMs:5000,actor,datasetId:snapshot.id,signal,...(authorize?{authorize}:{}),view:snapshot.view??null,
    rowIds:{table:snapshot.catalog.tables.indexOf(table),column:ID_COLUMN,ids:snapshot.rowIds[tableId]!}});
   signal.throwIfAborted();
   return result.rows;
  },
 };
}
