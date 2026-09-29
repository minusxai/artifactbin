/** Shared execution boundary for rendered, headless and durable document queries. */
import { executeCatalog } from '@/lib/datasets/execute';
import { DatasetError } from '@/lib/datasets/errors';
import type { DatasetCatalog } from '@/lib/datasets/types';
import type { RoleActor } from '@/lib/artifacts';
import type { CompiledDataflow } from '@/lib/story/compiled-dataflow';
import { importRef, selectQueries, type ImportTables } from '@/lib/story/compiled-flow';
import { runDataflow, type RunDataflowOptions } from './run-dataflow';
export type DocumentQuerySource = { tables: ImportTables[string]; catalog?: DatasetCatalog };
export type DocumentQuerySourceMode = 'import' | 'catalog' | 'verify';
export interface DocumentQueryOptions extends RunDataflowOptions {
  actor?: RoleActor;
  signal?: AbortSignal;
  refresh?: boolean;
  /** An authority-aware caller supplies its own schema fence; ordinary reads also pin catalog definitions. */
  sourceFence?: boolean;
  authorize?: () => Promise<void>;
}
export async function executeDocumentQueries(flow: CompiledDataflow, resolve: (ref: string, mode?: DocumentQuerySourceMode) => Promise<DocumentQuerySource | null>, options: DocumentQueryOptions = {}) {
  const opts = { ...options, ...(options.only ? { only: [...options.only] } : {}) };
  const selected = selectQueries(flow, opts);
  const resolved = new Map<string, DocumentQuerySource | null>();
  const data = async (ref: string, mode:DocumentQuerySourceMode) => { if (!resolved.has(ref)) resolved.set(ref, await resolve(ref,mode)); return resolved.get(ref) ?? null; };
  const imports: ImportTables = {};
  const usedSources = new Set<string>();
  for (const name of new Set(selected.flatMap((q) => q.reads.imports))) {
    const ref = importRef(flow, name);
    const found = ref ? await data(ref,'import') : null;
    if (!found) continue;
    imports[name] = found.tables;
    usedSources.add(ref!);
  }
  const state = await runDataflow(flow, imports, { ...opts, sourceQuery: async (query, params, paramTypes, page, timeoutMs) => {
    const catalog = (await data(query.source!,'catalog'))?.catalog;
    if (!catalog) throw new DatasetError('Dataset source is unavailable', 404);
    usedSources.add(query.source!);
    return executeCatalog(catalog, query.sql, params, { actor:opts.actor, datasetId:query.source!, limit:page?.limit ?? opts.limit, offset:page?.offset, sort:page?.sort, signal:opts.signal, refresh:opts.refresh, timeoutMs:timeoutMs ?? opts.timeoutMs, paramTypes, authorize:async()=>{
      await opts.authorize?.();
      const current=await resolve(query.source!,'verify');
      if (!current || (!opts.sourceFence && JSON.stringify(current.catalog)!==JSON.stringify(catalog))) throw new DatasetError('Dataset source is unavailable',404);
    }});
  }});
  // A resolver rechecks authority, independently of the rows' content revision.
  for (const ref of usedSources) {
    const current=await resolve(ref,'verify');
    if (!current || (!opts.sourceFence && JSON.stringify(current.catalog ?? null)!==JSON.stringify(resolved.get(ref)?.catalog ?? null))) throw new DatasetError('Dataset source is unavailable',404);
  }
  await opts.authorize?.();
  return { state, sourceIds:[...usedSources] };
}
