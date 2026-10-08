import type {DatasetCatalog} from './types';

/** One read-only interpretation shared by execution and migration planning:
 * the stored `meta.catalog`, or null when the row carries none. */
export function catalogFromMetadata(value:unknown):DatasetCatalog|null {
  if(!value||typeof value!=='object'||Array.isArray(value))return null;
  const catalog=(value as Record<string,unknown>).catalog;
  return catalog?catalog as DatasetCatalog:null;
}
