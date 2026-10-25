import {nativeLocalTable} from './local-table.ts';
import type {NativeRegisteredQueryPlan,NativeRegisteredQueryPlanInput,NativeQueryColumnType} from './query-plan-contracts.ts';
/** Pure conversion only: catalog selection remains immutable host configuration, never a runner argument. */
export function registeredNativeQueryPlan({flow,datasets}:NativeRegisteredQueryPlanInput):NativeRegisteredQueryPlan {
 const identifier=(value:string)=>/^[A-Za-z_]\w*$/.test(value)&&!['__proto__','prototype','constructor'].includes(value);
 const reference=(value:unknown):value is string=>typeof value==='string'&&value.length>0&&value.length<=512;
 const mapping=new Map<string,string>();
 for(const item of datasets){if(!reference(item.sourceRef)||!reference(item.targetDatasetId)||item.targetDatasetId.startsWith('ref:')||mapping.has(item.sourceRef))throw Error('query_dataset_mapping_invalid');mapping.set(item.sourceRef,item.targetDatasetId);}
 const target=(source:string)=>{const resolved=mapping.get(source);if(!resolved)throw Error('query_dataset_mapping_missing');return resolved;};
 const scalars:NativeRegisteredQueryPlan['scalars']=Object.create(null);
 const localTables:NonNullable<NativeRegisteredQueryPlan['localTables']>[number][]=[];
 for(const value of flow.values){
  if(value.kind==='table'){localTables.push(nativeLocalTable(value));continue;}
  if(value.kind!=='scalar')throw Error('query_local_table_invalid');
  const initial=value.default??null;
  if(!identifier(value.name)||Object.hasOwn(scalars,value.name)||!['string','number','boolean','date','timestamp','user'].includes(value.type)||initial!==null&&typeof initial!==(value.type==='number'?'number':value.type==='boolean'?'boolean':'string')||typeof initial==='number'&&!Number.isFinite(initial))throw Error('query_scalar_invalid');
  scalars[value.name]={type:value.type as NativeQueryColumnType,default:initial as string|number|boolean|null};
 }
 const tableNames=new Set(localTables.map(t=>t.name.toLowerCase()));
 if(tableNames.size!==localTables.length||Object.keys(scalars).some(s=>tableNames.has(s.toLowerCase()))||localTables.reduce((n,t)=>n+t.rows.length,0)>10000||localTables.length+flow.imports.reduce((n,i)=>n+i.tables.length,0)>64)throw Error('query_local_table_invalid');
 const names=new Set<string>();
 const queries=flow.queries.map(query=>{
  if(!identifier(query.name)||names.has(query.name)||tableNames.has(query.name.toLowerCase())||Object.hasOwn(scalars,query.name)||typeof query.sql!=='string'||!query.sql||Buffer.byteLength(query.sql)>64000||query.reads.values.some(name=>!Object.hasOwn(scalars,name)&&!localTables.some(t=>t.name===name))||query.reads.builtins.some(name=>!['_me','_me.id','_now','_tz'].includes(name)))throw Error('query_plan_invalid');
  const dependencies=[...query.reads.queries];
  if(query.source!==undefined){
   if(!reference(query.source)||query.engine!=='postgres'||dependencies.length||query.reads.imports.length)throw Error('query_source_invalid');
   names.add(query.name);
   return {name:query.name,sql:query.sql,dependencies,source:target(query.source)};
  }
  if(query.engine!=='sqlite'||dependencies.some(name=>!names.has(name))||query.reads.imports.some(name=>!flow.imports.some(item=>item.name===name)))throw Error('query_local_engine_invalid');
  names.add(query.name);return {name:query.name,sql:query.sql,dependencies};
 });
 const imports=flow.imports.flatMap(item=>{
  if(!identifier(item.name)||tableNames.has(item.name.toLowerCase())||!reference(item.ref))throw Error('query_import_invalid');
  const binding=target(item.ref);
  return item.tables.map(table=>({alias:item.name,binding,table:table.name}));
 });
 return {scalars,queries,imports,...(localTables.length?{localTables}:{})};
}
