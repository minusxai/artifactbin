import {createHash} from 'node:crypto';
import {runQueries,isQueryFailure} from '@/lib/sql/engine';
import type {Scalar,TableResult} from '@/lib/story/dataflow';
import {compileDatasetSql} from './sql';
import {queryPostgres} from './postgres';
import {DatasetError} from './errors';
import {resolveDatasetConnection} from './secrets';
import type {TokenActor} from '@/lib/artifacts';
import {storedTables} from './catalog';
import type {DatasetCatalog} from './types';
export interface CatalogQueryOptions {limit?:number;offset?:number;refresh?:boolean;sort?:{col:string;dir:'asc'|'desc'};paramTypes?:Record<string,import('@/lib/story/dataset-shape').DatasetColumn['type']>;datasetId?:string;actor?:TokenActor}
export type CatalogResult=TableResult&{refreshedAt:string};
const MAX_CACHE_BYTES=32*1024*1024;
const MAX_CACHE_ENTRIES=100;
const cache=new Map<string,{until:number;result:CatalogResult;bytes:number}>();
let cacheBytes=0;
function removeCached(key:string):void {
 const previous=cache.get(key);if(!previous)return;
 cacheBytes-=previous.bytes;cache.delete(key);
}
function expireCached(now:number):void {
 for(const [key,entry] of cache)if(entry.until<=now)removeCached(key);
}
function remember(key:string,result:CatalogResult,refreshSeconds:number):void {
 removeCached(key);
 const bytes=Buffer.byteLength(JSON.stringify(result));
 if(bytes>MAX_CACHE_BYTES)return;
 while(cache.size>=MAX_CACHE_ENTRIES||cacheBytes+bytes>MAX_CACHE_BYTES)removeCached(cache.keys().next().value!);
 cache.set(key,{until:Date.now()+refreshSeconds*1000,result,bytes});cacheBytes+=bytes;
}
/** Callers authorize dataset access before entering this execution/cache boundary. */
export async function executeCatalog(catalog:DatasetCatalog,sql:string,params:Record<string,Scalar>={},opts:CatalogQueryOptions={}):Promise<CatalogResult> {
 const limit=Math.min(10000,Math.max(1,Math.floor(opts.limit??1000)));const offset=Math.max(0,Math.floor(opts.offset??0));
 if(!Number.isFinite(limit)||!Number.isSafeInteger(offset))throw new DatasetError('Invalid query window');
 const config=catalog.kind==='postgres'?(catalog.connection?await resolveDatasetConnection(catalog.connection,opts.actor,opts.datasetId):(()=>{throw new DatasetError('Postgres dataset credentials are unavailable')})()):null;
 const sorted=(query:string)=>opts.sort?`SELECT * FROM (${query}) AS dataset_sorted ORDER BY "${opts.sort.col.replaceAll('"','""')}" ${opts.sort.dir==='desc'?'DESC':'ASC'}`:query;
 const cacheKey=createHash('sha256').update(JSON.stringify([catalog,config,sql,params,opts.paramTypes,opts.sort,limit,offset])).digest('hex');
 expireCached(Date.now());
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
  remember(cacheKey,response,catalog.refreshSeconds);
 }
 return response;
}
