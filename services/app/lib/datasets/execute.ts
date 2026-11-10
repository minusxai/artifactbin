import {createHash} from 'node:crypto';
import type {ContentObjects} from '@/lib/object-store';
import {runMutation,runQueries,isQueryFailure} from '@/lib/sql';
import type { Scalar, TableResult } from '@/lib/dataflow';
import { datasetSqlParams } from '@/lib/dataflow/server';
import {DatasetError} from './errors';
import type { AccessActor } from '@/lib/accounts';
import {storedTables} from './catalog';
import {loadDatasetRows} from './dataset-store';
import {createSharedReads} from './shared-reads';
import type {CatalogRowView,DatasetCatalog,DatasetTable} from './types';
import type {MutationInput,MutationOutcome,Row} from '@artifactbin/contracts';
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
type ReadCatalog=NonNullable<Parameters<typeof runQueries>[0]['catalog']>;
type ReadTables=Parameters<typeof runQueries>[0]['tables'];
interface KeyedRead {catalog:ReadCatalog;sql:string;params:Record<string,Scalar>;limit:number;timeoutMs?:number;outputBytes?:number;execute?:typeof runQueries;page?:{name:string;limit:number;offset:number;sort?:{col:string;dir:'asc'|'desc'}}}
/**
 * ONE KEYED CATALOG READ: every stored source names its content (`key`), so the SQL engine answers from the database it
 * prepared for these keys; only a miss loads, filters and sends the rows (`load`) and asks again (services/sql/CONTRACT.md).
 */
async function keyedRead(read:KeyedRead,load:()=>Promise<ReadTables>):Promise<CatalogResult>{
 const run=(tables:ReadTables)=>(read.execute??runQueries)({tables,catalog:read.catalog,queries:[{name:'result',sql:read.sql}],params:read.params,limit:read.limit,timeoutMs:read.timeoutMs,...(read.outputBytes!==undefined?{outputBytes:read.outputBytes}:{}),...(read.page?{page:read.page}:{})});
 let out=await run({});
 if(out.result&&isQueryFailure(out.result)&&out.result.rowsRequired)out=await run(await load());
 const table=out.result;
 if(!table)throw new DatasetError('Query failed');
 if(isQueryFailure(table))throw new CatalogQueryFailure(table.error,table.timedOut===true,table.tooLarge===true);
 return {...table,refreshedAt:new Date().toISOString()};
}
/** The engine refused or interrupted the statement: its message is about the caller's SQL. */
export class CatalogQueryFailure extends DatasetError {
 constructor(message:string,readonly timedOut:boolean,readonly tooLarge=false){super(message);}
}
/** Every $name the statement reads must be supplied: SQLite would bind a missing one as NULL and answer quietly. */
function requireParams(sql:string,params:Record<string,Scalar>):void{
 const undeclared=datasetSqlParams(sql).find(name=>!Object.hasOwn(params,name));
 if(undeclared)throw new Error(`Dataset SQL: undeclared parameter $${undeclared}`);
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
 requireParams(sql,params);
 const readCatalog={defaultSchema:catalog.defaultSchema,tables:catalog.tables.map((table,i)=>({schema:table.schema,name:table.name,columns:table.columns,...(table.sql?{sql:table.sql}:{source:`dataset_table_${i}`,key:sourceKey(saved,i,opts)})})),paramTypes:opts.paramTypes};
 const response=await keyedRead({catalog:readCatalog,sql,params,limit,timeoutMs:opts.timeoutMs,execute:opts.execute,page:{name:'result',limit,offset,...(opts.sort?{sort:opts.sort}:{})}},async()=>{
  const stored=await storedTables(catalog,opts.objects);
  if(opts.rowIds){const loaded=stored[`dataset_table_${opts.rowIds.table}`],{column,ids}=opts.rowIds;if(loaded)loaded.rows=loaded.rows.map((row,k)=>({...row,[column]:ids[k]}));}
  if(opts.view)for(const i of catalog.tables.keys()){const loaded=stored[`dataset_table_${i}`];if(loaded)loaded.rows=opts.view.rows(saved.tables[i]!,loaded.rows);}
  return stored;
 });
 await authorize();return response;
}

/**
 * One stored table a multi-dataset read mounts (a page's `_sql`): the logical `schema`.`name` it is read as, the
 * columns the reader may name, the stored table its rows come from, the role view that filters them and the row IDs
 * a door adds before the view (`column`), shown to SQL as `as` when given.
 */
export interface CatalogMount {
 schema:string;name:string;columns:DatasetTable['columns'];
 stored:DatasetTable;view:CatalogRowView|null;
 rowIds?:{column:string;ids:readonly string[];as?:string};
}
interface MountedQueryOptions {limit:number;timeoutMs:number;outputBytes?:number;signal?:AbortSignal;objects?:Pick<ContentObjects,'get'>;execute?:typeof runQueries}
/** A mount's rows as its key names them: the stored object, the door's row IDs, the role view, the `as` rename. */
async function loadMount(m:CatalogMount,objects?:Pick<ContentObjects,'get'>):Promise<Row[]>{
 let rows:Record<string,unknown>[]=m.stored.objectKey?(objects?JSON.parse((await objects.get(m.stored.objectKey)).toString('utf8')):await loadDatasetRows({meta:{objectKey:m.stored.objectKey}})):[];
 const ids=m.rowIds;
 if(ids)rows=rows.map((row,k)=>({...row,[ids.column]:ids.ids[k]}));
 if(m.view)rows=m.view.rows(m.stored,rows);
 if(ids?.as)rows=rows.map(row=>{const {[ids.column]:id,...rest}=row;return {...rest,[ids.as!]:id};});
 return rows as Row[];
}
const mountRows=createSharedReads<Row[]>();
/** A mount's content address: its object, stored and shown columns, row IDs and role view (as `sourceKey`). */
const mountKey=(m:CatalogMount)=>sha([m.stored.objectKey??null,m.stored.columns,m.columns,m.rowIds?[m.rowIds.column,m.rowIds.as??null,idDigest(m.rowIds.ids)]:null,m.view?.identity??null]);
/**
 * ONE READ OVER STORED TABLES OF SEVERAL DATASETS, each under its own logical name and role view, as one keyed catalog:
 * repeated reads of unchanged rows under the same views answer from the engine's prepared database. The caller has
 * authorized every mount (and checks its fences after); the answer is at most `limit` rows (`truncated` past it).
 */
export async function executeMounted(mounts:readonly CatalogMount[],sql:string,params:Record<string,Scalar>,opts:MountedQueryOptions):Promise<CatalogResult>{
 opts.signal?.throwIfAborted();
 requireParams(sql,params);
 const keys=mounts.map(mountKey);
 const catalog:ReadCatalog={defaultSchema:'main',tables:mounts.map((m,i)=>({schema:m.schema,name:m.name,columns:m.columns,source:`mount_${i}`,key:keys[i]!}))};
 const signal=opts.signal??new AbortController().signal;
 const result=await keyedRead({catalog,sql,params,limit:opts.limit,timeoutMs:opts.timeoutMs,...(opts.outputBytes!==undefined?{outputBytes:opts.outputBytes}:{}),...(opts.execute?{execute:opts.execute}:{})},async()=>Object.fromEntries(await Promise.all(mounts.map(async(m,i)=>
  // Readers missing the same mount at once (a live refetch after a write) load, filter and send its rows once.
  [`mount_${i}`,{rows:await mountRows(keys[i]!,signal,()=>loadMount(m,opts.objects)),columns:m.columns}] as const,
 ))));
 opts.signal?.throwIfAborted();
 return result;
}

/**
 * ONE WRITE OVER KEYED MOUNTS (MutationInput.mounted, services/sql/CONTRACT.md): every table the statement may read,
 * and its target when it is mounted, is the SQL service's prepared database for exactly these mounts (the keys
 * `executeMounted` uses), so a repeated write neither loads nor ships its rows; only a miss loads them (shared with
 * concurrent readers) and resends. The engine writes a copy inside a rolled-back transaction: the kept database
 * never changes. Callers authorize every mount, and decide again at commit, as for any read.
 */
export async function mutateMounted(mounts:readonly CatalogMount[],input:Omit<MutationInput,'mounted'|'reads'>,opts:{signal?:AbortSignal;objects?:Pick<ContentObjects,'get'>}={}):Promise<MutationOutcome>{
 opts.signal?.throwIfAborted();
 const keys=mounts.map(mountKey);
 const catalog={defaultSchema:'main',tables:mounts.map((m,i)=>({schema:m.schema,name:m.name,columns:m.columns,source:`mount_${i}`,key:keys[i]!}))};
 const signal=opts.signal??new AbortController().signal;
 const send=(tables:ReadTables)=>runMutation({...input,mounted:{catalog,tables}});
 let out=await send({});
 if(isQueryFailure(out)&&out.rowsRequired)out=await send(Object.fromEntries(await Promise.all(mounts.map(async(m,i)=>[`mount_${i}`,{rows:await mountRows(keys[i]!,signal,()=>loadMount(m,opts.objects)),columns:m.columns}] as const))));
 opts.signal?.throwIfAborted();
 return out;
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
