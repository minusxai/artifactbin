import type {DatasetCatalog,DatasetTable} from './types';

/** One read-only interpretation shared by execution and migration planning.
 * A null catalog is recoverable only when a real stored object key survives;
 * missing storage never becomes an invented empty table. */
export function catalogFromMetadata(value:unknown):DatasetCatalog|null {
  if(!value||typeof value!=='object'||Array.isArray(value))return null;
  const meta=value as Record<string,unknown>;
  if(meta.catalog)return meta.catalog as DatasetCatalog;
  if(typeof meta.objectKey!=='string'||!meta.objectKey)return null;
  return {kind:'stored',defaultSchema:'public',refreshSeconds:0,tables:[{
    schema:'public',name:'rows',columns:(meta.columns??[]) as DatasetTable['columns'],objectKey:meta.objectKey,
  }]};
}
