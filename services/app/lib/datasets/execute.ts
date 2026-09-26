import type {ContentObjects} from '@/lib/story/prepared-objects';
import {createHash} from 'node:crypto';
import {runQueries,isQueryFailure} from '@/lib/sql/engine';
import type {Scalar,TableResult} from '@/lib/story/dataflow';
import {compileDatasetSql,datasetSqlParams} from './sql';
import {queryPostgres} from './postgres';
import {DatasetError} from './errors';
import {resolveDatasetConnection} from './secrets';
import type {TokenActor} from '@/lib/artifacts';
import {storedTables} from './catalog';
import type {DatasetCatalog} from './types';
import {getDb} from '@/lib/db';
import {createDatasetResultCache} from './result-cache';
interface CatalogQueryOptions {objects?:Pick<ContentObjects,'get'>;limit?:number;offset?:number;refresh?:boolean;sort?:{col:string;dir:'asc'|'desc'};paramTypes?:Record<string,import('@/lib/story/dataset-shape').DatasetColumn['type']>;datasetId?:string;actor?:TokenActor;signal?:AbortSignal;authorize?:()=>Promise<void>}
export type CatalogResult=TableResult&{refreshedAt:string};
/** Callers authorize dataset access before entering this execution/cache boundary. */
export async function executeCatalog(catalog:DatasetCatalog,sql:string,params:Record<string,Scalar>={},opts:CatalogQueryOptions={}):Promise<CatalogResult> {
 const limit=Math.min(10000,Math.max(1,Math.floor(opts.limit??1000)));const offset=Math.max(0,Math.floor(opts.offset??0));
 if(!Number.isFinite(limit)||!Number.isSafeInteger(offset))throw new DatasetError('Invalid query window');
 const config=catalog.kind==='postgres'?(catalog.connection?await resolveDatasetConnection(catalog.connection,opts.actor,opts.datasetId):(()=>{throw new DatasetError('Postgres dataset credentials are unavailable')})()):null;
 const sorted=(query:string)=>opts.sort?`SELECT * FROM (${query}) AS dataset_sorted ORDER BY "${opts.sort.col.replaceAll('"','""')}" ${opts.sort.dir==='desc'?'DESC':'ASC'}`:query;
 const cacheKey=createHash('sha256').update(JSON.stringify([opts.datasetId,opts.actor,catalog,config,sql,params,opts.paramTypes,opts.sort,limit,offset])).digest('hex');
 const load=async():Promise<CatalogResult>=>{
 let result:TableResult;
 if(config){
  const compiled=compileDatasetSql(catalog,sql,params,opts.paramTypes);
  result=await queryPostgres(config,sorted(compiled.sql),compiled.values,{limit,offset});
 }else{
  // Every $name the statement reads must be supplied: SQLite would bind a missing one as NULL and answer quietly.
  const undeclared=datasetSqlParams(sql).find(name=>!Object.hasOwn(params,name));
  if(undeclared)throw new Error(`Dataset SQL: undeclared parameter $${undeclared}`);
  const readCatalog={defaultSchema:catalog.defaultSchema,tables:catalog.tables.map((table,i)=>({schema:table.schema,name:table.name,columns:table.columns,...(table.sql?{sql:table.sql}:{source:`dataset_table_${i}`})})),paramTypes:opts.paramTypes};
  const out=await runQueries({tables:await storedTables(catalog,opts.objects),catalog:readCatalog,queries:[{name:'result',sql}],params,limit,page:{name:'result',limit,offset,...(opts.sort?{sort:opts.sort}:{})}});
  const table=out.result;if(!table||isQueryFailure(table))throw new DatasetError(table?.error??'Query failed');
  result=table;
 }
 return {...result,refreshedAt:new Date().toISOString()};
 };
 const authorize=async()=>{
  opts.signal?.throwIfAborted();
  await opts.authorize?.();
  if(config&&catalog.connection){
   const current=await resolveDatasetConnection(catalog.connection,opts.actor,opts.datasetId);
   if(JSON.stringify(current)!==JSON.stringify(config))throw new DatasetError('Dataset credentials changed; retry the query',403);
  }
 };
 // Call-site authorization is rechecked by the cache before hits/after waits;
 // credential binding is always live, including preview/publish callers.
 await authorize();
 if(catalog.kind==='postgres'&&catalog.refreshSeconds>0&&opts.authorize)
  return createDatasetResultCache(await getDb()).run(cacheKey,load,{ttlSeconds:catalog.refreshSeconds,refresh:opts.refresh,signal:opts.signal,authorize});
 const response=await load();await authorize();return response;
}
