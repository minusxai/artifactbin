import type {ContentObjects} from '@/lib/object-store';
import {runQueries,isQueryFailure} from '@/lib/sql';
import type { Scalar, TableResult } from '@/lib/dataflow';
import { datasetSqlParams } from '@/lib/dataflow/server';
import {DatasetError} from './errors';
import type { AccessActor } from '@/lib/accounts';
import {storedTables} from './catalog';
import type {CatalogRowView,DatasetCatalog} from './types';
interface CatalogQueryOptions {/** The caller's role view (lib/dataset-permissions), or null: decided at every door, never defaulted. */view:CatalogRowView|null;/** Trusted host-owned SQL execution; never a request parameter. */execute?:typeof runQueries;timeoutMs?:number;objects?:Pick<ContentObjects,'get'>;limit?:number;offset?:number;refresh?:boolean;sort?:{col:string;dir:'asc'|'desc'};paramTypes?:Record<string,import('@/lib/dataflow').DatasetColumn['type']>;datasetId?:string;actor?:AccessActor;signal?:AbortSignal;authorize?:()=>Promise<void>}
type CatalogResult=TableResult&{refreshedAt:string};
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
 const readCatalog={defaultSchema:catalog.defaultSchema,tables:catalog.tables.map((table,i)=>({schema:table.schema,name:table.name,columns:table.columns,...(table.sql?{sql:table.sql}:{source:`dataset_table_${i}`})})),paramTypes:opts.paramTypes};
 const stored=await storedTables(catalog,opts.objects);
 if(opts.view)for(const i of catalog.tables.keys()){const loaded=stored[`dataset_table_${i}`];if(loaded)loaded.rows=opts.view.rows(saved.tables[i]!,loaded.rows);}
 const out=await (opts.execute??runQueries)({tables:stored,catalog:readCatalog,queries:[{name:'result',sql}],params,limit,timeoutMs:opts.timeoutMs,page:{name:'result',limit,offset,...(opts.sort?{sort:opts.sort}:{})}});
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
