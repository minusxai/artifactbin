import {createHash} from 'node:crypto';
import type {ContentObjects} from '@/lib/object-store';
import {runQueries,isQueryFailure} from '@/lib/sql';
import type { Scalar, TableResult } from '@/lib/dataflow';
import { datasetSqlParams } from '@/lib/dataflow/server';
import {DatasetError} from './errors';
import type { AccessActor } from '@/lib/accounts';
import {storedTables} from './catalog';
import type {CatalogRowView,DatasetCatalog} from './types';
interface CatalogQueryOptions {/** The caller's role view (lib/dataset-permissions), or null: decided at every door, never defaulted. */view:CatalogRowView|null;/** Trusted host-owned SQL execution; never a request parameter. */execute?:typeof runQueries;timeoutMs?:number;objects?:Pick<ContentObjects,'get'>;limit?:number;offset?:number;refresh?:boolean;sort?:{col:string;dir:'asc'|'desc'};paramTypes?:Record<string,import('@/lib/dataflow').DatasetColumn['type']>;datasetId?:string;actor?:AccessActor;signal?:AbortSignal;authorize?:()=>Promise<void>;/** A door's row IDs for one stored table (`table`: its catalog index), by position in its stored object, added as `column` before the role view filters: the generated GraphQL's `_id`. */rowIds?:{table:number;column:string;ids:readonly string[]}}
type CatalogResult=TableResult&{refreshedAt:string};
const sha=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('base64url');
/** A row-ID list's digest, once per list: a snapshot hands the same list to every statement. */
const idDigests=new WeakMap<readonly string[],string>();
const idDigest=(ids:readonly string[])=>{let digest=idDigests.get(ids);if(!digest){digest=sha(ids);idDigests.set(ids,digest);}return digest;};
/**
 * The content address of stored table `i` as this read mounts it: the object (content-addressed), its declared
 * columns, the row IDs a door adds and the role view that filters it. The engine adds the catalog's own shape
 * (columns, models) to its database key, so a key only has to name the ROWS (services/sql/CONTRACT.md).
 */
function sourceKey(saved:DatasetCatalog,i:number,opts:CatalogQueryOptions):string {
 const table=saved.tables[i]!;
 return sha([table.objectKey??null,table.columns,opts.rowIds?.table===i?[opts.rowIds.column,idDigest(opts.rowIds.ids)]:null,opts.view?.identity??null]);
}
/** Callers authorize dataset access before entering this execution/cache boundary. */
async function executeCatalogDirect(saved:DatasetCatalog,sql:string,params:Record<string,Scalar>,opts:CatalogQueryOptions):Promise<CatalogResult> {
 // The role view first: hidden columns leave the catalog every statement is checked against.
 const catalog=opts.view?opts.view.catalog(saved):saved;
 const limit=Math.min(10000,Math.max(1,Math.floor(opts.limit??1000)));const offset=Math.max(0,Math.floor(opts.offset??0));
 if(!Number.isFinite(limit)||!Number.isSafeInteger(offset))throw new DatasetError('Invalid query window');
 if(catalog.kind!=='stored')throw new DatasetError('Only stored datasets can be queried');
 const authorize=async()=>{
  opts.signal?.throwIfAborted();
  await opts.authorize?.();
 };
 await authorize();
 // Every $name the statement reads must be supplied: SQLite would bind a missing one as NULL and answer quietly.
 const undeclared=datasetSqlParams(sql).find(name=>!Object.hasOwn(params,name));
 if(undeclared)throw new Error(`Dataset SQL: undeclared parameter $${undeclared}`);
 const readCatalog={defaultSchema:catalog.defaultSchema,tables:catalog.tables.map((table,i)=>({schema:table.schema,name:table.name,columns:table.columns,...(table.sql?{sql:table.sql}:{source:`dataset_table_${i}`,key:sourceKey(saved,i,opts)})})),paramTypes:opts.paramTypes};
 // Keys first: the SQL engine answers from the database it prepared for these keys; only a miss loads, filters and sends the rows.
 const read=(tables:Awaited<ReturnType<typeof storedTables>>)=>(opts.execute??runQueries)({tables,catalog:readCatalog,queries:[{name:'result',sql}],params,limit,timeoutMs:opts.timeoutMs,page:{name:'result',limit,offset,...(opts.sort?{sort:opts.sort}:{})}});
 let out=await read({});
 if(out.result&&isQueryFailure(out.result)&&out.result.rowsRequired){
  const stored=await storedTables(catalog,opts.objects);
  if(opts.rowIds){const loaded=stored[`dataset_table_${opts.rowIds.table}`],{column,ids}=opts.rowIds;if(loaded)loaded.rows=loaded.rows.map((row,k)=>({...row,[column]:ids[k]}));}
  if(opts.view)for(const i of catalog.tables.keys()){const loaded=stored[`dataset_table_${i}`];if(loaded)loaded.rows=opts.view.rows(saved.tables[i]!,loaded.rows);}
  out=await read(stored);
 }
 const table=out.result;if(!table||isQueryFailure(table))throw new DatasetError(table?.error??'Query failed');
 const response={...table,refreshedAt:new Date().toISOString()};
 await authorize();return response;
}

let executorOverride: typeof executeCatalogDirect | undefined;

/**
 * THE TEST OVERRIDE for dataset execution: every `executeCatalog` call goes to this function instead (a test that
 * counts or fails executions). The test harness clears it after every file; production code never sets it.
 */
export function overrideCatalogExecutor(executor: typeof executeCatalogDirect | undefined): void {
  executorOverride = executor;
}

export const executeCatalog: typeof executeCatalogDirect = (...args) => (executorOverride ?? executeCatalogDirect)(...args);
