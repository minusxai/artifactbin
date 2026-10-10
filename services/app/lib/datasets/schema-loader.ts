/**
 * THE SERVER'S REF LOADER, as the data compiler sees it. A reference the server resolves is the data
 * language's `ResolvedRef` plus the dataset's catalog, which only the publish checks read (to compile an
 * import against its tables). Kept here, above lib/dataflow, so the data language never depends on the
 * dataset module; the publish checks (lib/publish/data/data-checks) and the write path (lib/artifacts)
 * both speak it.
 */
import { importedTables } from '@/lib/datasets/catalog';
import type { DatasetCatalog } from '@/lib/datasets/types';
import { type ResolvedRef, type ImportSource, type SchemaLoader, datasetSqlParams } from '@/lib/dataflow/server';

export type ServerRef = ResolvedRef & { catalog?: DatasetCatalog };
/** What the server's ref loaders answer; one is also a dataflow `RefLoader`. */
export type ServerRefLoader = (id: string) => Promise<ServerRef | null>;

/** What an artifact is to the compiler: a dataset's tables, a folder's listing, or a database to run inside. */
function schemaSourceOf(r: ServerRef | null): ImportSource | null {
  if (!r) return null;
  if (r.format === 'folder') return { kind: 'folder', tables: [{ name: 'rows', columns: r.columns ?? [] }] };
  if (r.format !== 'dataset') return null;
  if (r.catalog?.kind === 'postgres') {
    const query = r.query;
    return { kind: 'postgres', tables: [], ...(query ? { probe: async (sql, params, types) => ({ columns: (await query(sql, params, types)).columns, params: datasetSqlParams(sql) }) } : {}) };
  }
  const query = r.query;
  return { kind: 'dataset', ...(query ? { probe: async (sql, params, types) => ({ columns: (await query(sql, params, types)).columns, params: datasetSqlParams(sql) }) } : {}), tables: r.catalog ? importedTables(r.catalog).map((t) => ({ name: t.name, columns: t.columns })) : [{ name: 'rows', columns: r.columns ?? [] }] };
}

/** The compiler's loader over a ref loader. */
export const schemaLoaderFor = (load: ServerRefLoader): SchemaLoader => async (ref) => schemaSourceOf(await load(ref));
