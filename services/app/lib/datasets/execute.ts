import {createHash} from 'node:crypto';
import {runQueries,isQueryFailure} from '@/lib/sql/engine';
import type {Scalar,TableResult} from '@/lib/story/dataflow';
import {compileDatasetSql} from './sql';
import {queryPostgres} from './postgres';
import {connectionConfig,DatasetError} from './connections';
import {storedTables} from './catalog';
import type {DatasetCatalog} from './types';
export interface CatalogQueryOptions {limit?:number;offset?:number;refresh?:boolean;sort?:{col:string;dir:'asc'|'desc'};paramTypes?:Record<string,import('@/lib/story/dataset-shape').DatasetColumn['type']>}
export type CatalogResult=TableResult&{refreshedAt:string};
const cache=new Map<string,{until:number;result:CatalogResult}>();
/** Callers authorize dataset access before entering this execution/cache boundary. */
export async function executeCatalog(catalog:DatasetCatalog,sql:string,params:Record<string,Scalar>={},opts:CatalogQueryOptions={}):Promise<CatalogResult> {
 const limit=Math.min(10000,Math.max(1,Math.floor(opts.limit??1000)));const offset=Math.max(0,Math.floor(opts.offset??0));
 if(!Number.isFinite(limit)||!Number.isSafeInteger(offset))throw new DatasetError('Invalid query window');
 const config=catalog.kind==='postgres'?await connectionConfig(catalog.connectionId!):null;
 const sorted=(query:string)=>opts.sort?`SELECT * FROM (${query}) AS dataset_sorted ORDER BY "${opts.sort.col.replaceAll('"','""')}" ${opts.sort.dir==='desc'?'DESC':'ASC'}`:query;
 const cacheKey=createHash('sha256').update(JSON.stringify([catalog,config,sql,params,opts.paramTypes,opts.sort,limit,offset])).digest('hex');
 const cached=cache.get(cacheKey);if(!opts.refresh&&cached&&cached.until>Date.now())return cached.result;
 let result:TableResult;
 if(config){
  const compiled=compileDatasetSql(catalog,sql,params,opts.paramTypes);
  result=await queryPostgres(config,sorted(compiled.sql),compiled.values,{limit,offset});
 }else{
  const local={...catalog,tables:catalog.tables.map((t,i)=>t.sql?t:{...t,source:{schema:'main',table:`dataset_table_${i}`}})};
  const compiled=compileDatasetSql(local,sql,params);
  const values=Object.fromEntries(compiled.values.map((v,i)=>[String(i+1),v]));
  const out=await runQueries({tables:await storedTables(catalog),queries:[{name:'result',sql:`SELECT * FROM (${sorted(compiled.sql)}) AS dataset_window LIMIT ${limit+1} OFFSET ${offset}`}],params:values,limit:Math.min(10000,limit+1)});
  const table=out.result;if(!table||isQueryFailure(table))throw new DatasetError(table?.error??'Query failed');
  result={...table,rows:table.rows.slice(0,limit),...(table.rows.length>limit||table.truncated?{truncated:true}:{})};
 }
 const response={...result,refreshedAt:new Date().toISOString()};
 if(catalog.kind==='postgres'&&catalog.refreshSeconds>0){
  cache.delete(cacheKey);cache.set(cacheKey,{until:Date.now()+catalog.refreshSeconds*1000,result:response});
  while(cache.size>100)cache.delete(cache.keys().next().value!);
 }
 return response;
}
