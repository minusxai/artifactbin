/** Shared execution boundary for rendered, headless and durable document queries. */
import { executeCatalog } from '@/lib/datasets/execute';
import { DatasetError } from '@/lib/datasets/errors';
import type { DatasetCatalog } from '@/lib/datasets/types';
import type { RoleActor } from '@/lib/accounts/actors';
import type { CompiledDataflow } from '@/lib/dataflow';
import { importRef, selectQueries, type ImportTables } from '@/lib/dataflow/compiled-flow';
import { runDataflow, runDataflowMany, type RunDataflowOptions } from '../sql/run-dataflow';
import type { Scalar } from '@/lib/dataflow';
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
  return withDocumentSources(flow, resolve, opts, [opts], (imports, sourceQuery) => runDataflow(flow, imports, { ...opts, sourceQuery }));
}

/**
 * The document once per entry of `runs` (each its own values and `only`), under ONE resolution of
 * its sources: every import any run reads is resolved and loaded once, and the engine runs them all
 * in one call (`runDataflowMany`). The authority checks are the single run's, once for the batch.
 */
export async function executeDocumentQueriesMany(flow: CompiledDataflow, resolve: (ref: string, mode?: DocumentQuerySourceMode) => Promise<DocumentQuerySource | null>, options: Omit<DocumentQueryOptions, 'values' | 'only' | 'page' | 'completeResults'>, runs: ReadonlyArray<{ values?: Record<string, Scalar>; only?: Iterable<string> }>) {
  const each = runs.map((run) => ({ ...(run.values ? { values: run.values } : {}), ...(run.only ? { only: [...run.only] } : {}) }));
  return withDocumentSources(flow, resolve, options, each, (imports, sourceQuery) => runDataflowMany(flow, imports, { ...options, sourceQuery }, each));
}

/** Resolve what `runs` read, run them through `execute`, then recheck every source's authority once. */
async function withDocumentSources<T>(flow: CompiledDataflow, resolve: (ref: string, mode?: DocumentQuerySourceMode) => Promise<DocumentQuerySource | null>, opts: DocumentQueryOptions, runs: ReadonlyArray<Pick<DocumentQueryOptions, 'values' | 'only' | 'page'>>, execute: (imports: ImportTables, sourceQuery: NonNullable<DocumentQueryOptions['sourceQuery']>) => Promise<T>): Promise<{ state: T; sourceIds: string[] }> {
  const selected = runs.flatMap((run) => selectQueries(flow, { ...opts, ...run }));
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
  const state = await execute(imports, async (query, params, paramTypes, page, timeoutMs) => {
    const catalog = (await data(query.source!,'catalog'))?.catalog;
    if (!catalog) throw new DatasetError('Dataset source is unavailable', 404);
    usedSources.add(query.source!);
    return executeCatalog(catalog, query.sql, params, { actor:opts.actor, datasetId:query.source!, limit:page?.limit ?? opts.limit, offset:page?.offset, sort:page?.sort, signal:opts.signal, refresh:opts.refresh, timeoutMs:timeoutMs ?? opts.timeoutMs, paramTypes, authorize:async()=>{
      await opts.authorize?.();
      const current=await resolve(query.source!,'verify');
      if (!current || (!opts.sourceFence && JSON.stringify(current.catalog)!==JSON.stringify(catalog))) throw new DatasetError('Dataset source is unavailable',404);
    }});
  });
  // A resolver rechecks authority, independently of the rows' content revision.
  for (const ref of usedSources) {
    const current=await resolve(ref,'verify');
    if (!current || (!opts.sourceFence && JSON.stringify(current.catalog ?? null)!==JSON.stringify(resolved.get(ref)?.catalog ?? null))) throw new DatasetError('Dataset source is unavailable',404);
  }
  await opts.authorize?.();
  return { state, sourceIds:[...usedSources] };
}
