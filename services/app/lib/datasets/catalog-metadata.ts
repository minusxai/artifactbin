import type {DatasetCatalog,DatasetTable} from './types';

/** One read-only interpretation shared by execution and migration planning.
 * A null catalog is recoverable when an object key survives;
 * missing storage never becomes an invented empty table. */
export function catalogFromMetadata(value:unknown):DatasetCatalog|null {
  if(!value||typeof value!=='object'||Array.isArray(value))return null;
  const meta=value as Record<string,unknown>;
  if(meta.catalog)return meta.catalog as DatasetCatalog;
  const stored=typeof meta.objectKey==='string'&&meta.objectKey;
  if(!stored)return null;
  return {kind:'stored',defaultSchema:'public',refreshSeconds:0,tables:[{
    schema:'public',name:'rows',columns:(meta.columns??[]) as DatasetTable['columns'],objectKey:String(meta.objectKey),
  }]};
}
