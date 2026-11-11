import type {DatasetCatalog} from './types';
import type {ConnectionSummary} from '@artifactbin/contracts';

/** One read-only interpretation shared by execution and migration planning:
 * the stored `meta.catalog`, or null when the row carries none. */
export function catalogFromMetadata(value:unknown):DatasetCatalog|null {
  if(!value||typeof value!=='object'||Array.isArray(value))return null;
  const catalog=(value as Record<string,unknown>).catalog;
  return catalog?catalog as DatasetCatalog:null;
}

/**
 * A LIVE DATASET's connection as its row shows it (lib/live-datasets writes it): the connector and its shown fields,
 * never a secret. A live dataset has no catalog and no stored rows; every stored-dataset door asks this first and
 * refuses it by name, or treats it as the connection it is.
 */
export function liveConnectionOf(meta:unknown):ConnectionSummary|null {
  if(!meta||typeof meta!=='object'||Array.isArray(meta))return null;
  const connection=(meta as Record<string,unknown>).connection;
  return connection&&typeof connection==='object'&&typeof (connection as {connector?:unknown}).connector==='string'?connection as ConnectionSummary:null;
}
/** The one refusal a stored-dataset door answers for a live dataset: what it is, and where to go instead. */
export const LIVE_DATASET_REFUSAL='This is a live dataset: its rows stay in its database. Query it with SQL (owners and editors) or through a page\'s declared queries; it has no stored rows to download, write, pin or copy.';
