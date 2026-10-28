import type { DatasetCatalog, DatasetTable } from '@/lib/datasets/types';
/** Execution keeps the full saved catalog: SQL models can depend on other tables. */
export interface RegisteredSourceCatalog {
 catalog: DatasetCatalog;
 selected: DatasetTable;
 storedObjects: readonly {key:string;columns:number}[];
}
export function registeredSourceCatalog(catalog:DatasetCatalog,tableName:string,truncated:unknown):RegisteredSourceCatalog {
 if(truncated===true||!['stored','postgres'].includes(catalog.kind))throw Error('query_source_unsupported');
 const matches=catalog.tables.filter(t=>t.schema===catalog.defaultSchema&&t.name===tableName);
 if(matches.length!==1)throw Error('query_source_unsupported');
 const selected=matches[0]!;
 if(catalog.kind==='postgres'){
  if(!catalog.connection)throw Error('query_source_unsupported');
 }else if(catalog.tables.some(t=>Number(typeof t.objectKey==='string')+Number(typeof t.sql==='string')!==1))throw Error('query_source_unsupported');
 return {catalog,selected,storedObjects:catalog.kind==='stored'?catalog.tables.filter(t=>t.objectKey).map(t=>({key:t.objectKey!,columns:t.columns.length})):[]};
}
