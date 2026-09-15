import type {DatasetCatalog,DatasetTable} from './types';
import type {Row} from '@artifactbin/contracts';

/** Only a surviving flat JSON table is recoverable; absent/corrupt bytes stay unavailable. */
export function legacyDatasetRows(content: unknown): Row[] | null {
  if (typeof content !== 'string' || !content.trim()) return null;
  try {
    const rows: unknown = JSON.parse(content);
    return Array.isArray(rows) && rows.every(row => row && typeof row === 'object' && !Array.isArray(row) && Object.values(row).every(value => value === null || ['string','number','boolean'].includes(typeof value))) ? rows : null;
  } catch { return null; }
}

/** One read-only interpretation shared by execution and migration planning.
 * A null catalog is recoverable when an object key or valid inline table survives;
 * missing storage never becomes an invented empty table. */
export function catalogFromMetadata(value:unknown,content?:unknown):DatasetCatalog|null {
  if(!value||typeof value!=='object'||Array.isArray(value))return null;
  const meta=value as Record<string,unknown>;
  if(meta.catalog)return meta.catalog as DatasetCatalog;
  const stored=typeof meta.objectKey==='string'&&meta.objectKey;
  if(!stored&&!legacyDatasetRows(content))return null;
  return {kind:'stored',defaultSchema:'public',refreshSeconds:0,tables:[{
    schema:'public',name:'rows',columns:(meta.columns??[]) as DatasetTable['columns'],...(stored?{objectKey:String(meta.objectKey)}:{legacyContent:String(content)}),
  }]};
}
