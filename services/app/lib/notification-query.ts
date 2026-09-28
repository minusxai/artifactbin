import {isQueryFailure,NOTIFICATION_QUERY_LIMITS,type MutationNotificationJobInput,type MutationNotificationPlan,type SqlService,type TableResult} from '@artifactbin/contracts';
import {NotificationExecutionError} from './notification-error';
import {bindParams,bindTypes,selectQueries,typedResult} from './story/compiled-flow';
import {platformValues,BUILTIN_TABLES} from './story/builtins';
import {QUERY_TIMEOUT_MS} from './config';
import {getDb} from './db';
import {runQueries} from './sql/engine';
import {catalogOf,importedRows,importedTables} from './datasets/catalog';
import {notificationQueryContext,notificationRevision} from './notification-context';
import {notificationExecutionFence,notificationExecutionSource,notificationSourceSchema} from './notification-authority';
export {notificationContextSnapshot} from './notification-context';
export {notificationAuthority,notificationExecutionFence,notificationSourcesReadable,validateNotificationPlan,canManageNotificationDocument} from './notification-authority';
import type { CompiledDataflow, CompiledNotify } from './story/compiled-dataflow';
import type { ImportTables } from './story/compiled-flow';

export interface NotificationQueryContext {
 flow:CompiledDataflow;rule:CompiledNotify;imports:ImportTables;
 executionFence:MutationNotificationPlan['executionFence'];sources:MutationNotificationPlan['sources'];
}
export interface NotificationQueryDependencies {
 load(input:MutationNotificationJobInput):Promise<NotificationQueryContext>;
 run:SqlService['run'];
}
/** Validate the entire result before returning any candidate; SQL row ordinals remain distinct. */
export function normalizeNotificationResult(table:TableResult):MutationNotificationPlan['rows'] {
 const limits=NOTIFICATION_QUERY_LIMITS;
 if(table.truncated||table.rows.length>limits.rows||(table.totalRows!==undefined&&table.totalRows>table.rows.length))throw new NotificationExecutionError('notification_capacity');
 if(table.columns.length!==2||!table.columns.some(c=>c.name==='to')||!table.columns.some(c=>c.name==='message'))throw new NotificationExecutionError('notification_output_invalid');
 if(Buffer.byteLength(JSON.stringify(table.rows),'utf8')>limits.resultBytes)throw new NotificationExecutionError('notification_capacity');
 let recipients=0;
 return table.rows.map(row=>{
  if(typeof row.message!=='string'||!row.message.trim())throw new NotificationExecutionError('notification_output_invalid');
  if([...row.message].length>limits.messageCodePoints)throw new NotificationExecutionError('notification_capacity');
  const to=row.to===null?[]:Array.isArray(row.to)?row.to:[row.to];
  if(to.length>limits.recipientsPerRow)throw new NotificationExecutionError('notification_capacity');
  if(to.some(id=>id!==null&&(typeof id!=='string'||!/^usr_[a-z0-9]+$/.test(id))))throw new NotificationExecutionError('notification_output_invalid');
  const recipientIds=[...new Set(to.filter((id):id is string=>id!==null))];
  recipients+=recipientIds.length;if(recipients>limits.recipients)throw new NotificationExecutionError('notification_capacity');
  return {recipientIds,message:row.message};
 });
}
export async function evaluateNotificationQuery(input:MutationNotificationJobInput,dependencies:NotificationQueryDependencies={load:loadNotificationQuery,run:runQueries}):Promise<MutationNotificationPlan>{
 const context=await dependencies.load(input),{flow,rule}=context;
 const upstream=selectQueries(flow,{only:rule.reads.queries});
 if(upstream.some(query=>query.engine!=='sqlite')||rule.engine!=='sqlite')throw new NotificationExecutionError('notification_context_unsupported');
 const names=[...new Set([...rule.params,...upstream.flatMap(query=>query.params)])];
 const logical={...input.bindings.values,...platformValues(input.bindings)};
 if(names.some(name=>!Object.hasOwn(logical,name)))throw new NotificationExecutionError('notification_bindings_invalid');
 const tables:import('@artifactbin/contracts').RunInput['tables']={_me:{columns:BUILTIN_TABLES._me.columns,rows:[{id:input.bindings.userId}]}};
 const started=performance.now(),timeout=Math.min(QUERY_TIMEOUT_MS,NOTIFICATION_QUERY_LIMITS.timeoutMs);
 let bytes=0,result:TableResult|undefined;
 for(const query of [...upstream,rule]){
  const remaining=Math.floor(timeout-(performance.now()-started));
  if(remaining<1)throw new NotificationExecutionError('notification_query_timeout');
  // A multi-query engine run deliberately materializes whole dependencies. Jobs instead
  // bound each intermediate result, refusing overflow before it can feed the next query.
  const output=await dependencies.run({tables,imports:context.imports,queries:[{name:query.name,sql:query.sql}],
   params:bindParams(names,logical),paramTypes:bindTypes(names,input.bindings.types),limit:NOTIFICATION_QUERY_LIMITS.rows+1,timeoutMs:remaining});
  const table=output[query.name];
  if(!table)throw new NotificationExecutionError('notification_query_invalid');
  if(isQueryFailure(table))throw new NotificationExecutionError(table.timedOut?'notification_query_timeout':'notification_query_invalid');
  if(table.truncated||table.rows.length>NOTIFICATION_QUERY_LIMITS.rows||(table.totalRows!==undefined&&table.totalRows>table.rows.length))throw new NotificationExecutionError('notification_capacity');
  bytes+=Buffer.byteLength(JSON.stringify(table.rows),'utf8');
  if(bytes>NOTIFICATION_QUERY_LIMITS.resultBytes)throw new NotificationExecutionError('notification_capacity');
  result='columns' in query?typedResult(query.columns,table):table;
  tables[query.name]=result;
 }
 if(!result)throw new NotificationExecutionError('notification_query_invalid');
 return {executionFence:context.executionFence,sources:context.sources,rows:normalizeNotificationResult(result)};
}

/** Current source rows, pinned import identity/schema, actual initiating caller. No page reconstruction. */
async function loadNotificationQuery(input:MutationNotificationJobInput):Promise<NotificationQueryContext>{
 const {flow,rule}=notificationQueryContext(input),db=await getDb();
 const executionFence=await notificationExecutionFence(db,input),imports:ImportTables={},sources:MutationNotificationPlan['sources']=[];
 const upstream=selectQueries(flow,{only:rule.reads.queries});
 if(rule.reads.queries.some(name=>!upstream.some(query=>query.name===name)))throw new NotificationExecutionError('notification_context_invalid');
 if(upstream.some(query=>query.engine!=='sqlite')||[...upstream,rule].some(query=>query.reads.values.some(name=>flow.values.find(value=>value.name===name)?.kind==='table')||query.reads.builtins.some(name=>!['_me','_me.id','_now','_tz'].includes(name))))throw new NotificationExecutionError('notification_context_unsupported');
 for(const name of new Set(rule.relations.map(relation=>relation.schema))){
  if(name==='main')continue;
  const binding=flow.imports.find(item=>item.name===name);
  if(!binding)throw new NotificationExecutionError('notification_context_invalid');
  const authority=await notificationExecutionSource(db,input,binding.ref),catalog=catalogOf(authority.row);
  if(catalog?.kind!=='stored')throw new NotificationExecutionError('notification_context_unsupported');
  const tables=importedTables(catalog),needed=rule.relations.filter(relation=>relation.schema===name);
  for(const relation of needed){
   const pinned=binding.tables.find(table=>table.name===relation.table),current=tables.find(table=>table.name===relation.table);
   if(!pinned||!current||notificationRevision(pinned.columns)!==notificationRevision(current.columns))throw new NotificationExecutionError('notification_schema_changed');
   sources.push({artifactId:binding.ref,schema:catalog.defaultSchema,table:relation.table,authorityRevision:authority.revision,schemaRevision:notificationSourceSchema(authority,catalog.defaultSchema,relation.table)});
  }
  // Read only participating tables; a huge unrelated table must not enter the query worker.
  imports[name]=await importedRows({...catalog,tables:tables.filter(table=>needed.some(relation=>relation.table===table.name))});
 }
 const expectedImports=new Set([...upstream,rule].flatMap(query=>query.reads.imports));
 if([...expectedImports].some(name=>!Object.hasOwn(imports,name)))throw new NotificationExecutionError('notification_context_invalid');
 return {flow,rule,imports,executionFence,sources};
}
