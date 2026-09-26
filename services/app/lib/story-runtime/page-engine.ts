/**
 * THE PAGE'S OWN ENGINE — the SQLite core (`@artifactbin/sql/core`, the same
 * wasm and functions the server runs) over the imports this reader holds, in
 * memory, on the main thread. The store (lib/story-runtime/store) sends it the
 * nodes placed in the browser (lib/story/placement) and the server the rest.
 *
 * It answers what the server would, by running the SAME code: the dataflow
 * evaluator (lib/sql/dataflow-core) for reads, the write signature
 * (lib/story/mutation-request bindMutationRequest) and the local-table write
 * (lib/story/local-state) for writes, the same display window for what a run
 * returns. The only thing it owns is what it HOLDS:
 *
 *  - each held import, fetched once (QueryTransport.hold) and again only after
 *    the dataset changed (`invalidate`); until the fetch lands, its queries
 *    are not ready here and run on the server;
 *  - the OPTIMISTIC OVERLAY: a dataset write applied to the held copy the
 *    moment it is made, and replayed over every fresh fetch until the server
 *    has decided. Refused, it is withdrawn and the overlay replayed without
 *    it (a later write keeps its effect); confirmed, it stays until the first
 *    fetch started after the confirmation, whose rows already include it.
 *
 * Everything a run needs beside its rows — the viewer, the clock, the zone,
 * the reader's local tables — comes in with the call, so the engine can never
 * disagree with the store about them.
 */
import type { MutationInput, Row, Scalar } from '@artifactbin/contracts';
import { DISPLAY_ROWS, isQueryFailure } from '@artifactbin/contracts';
import type { SqliteEngine } from '@artifactbin/sql/core';
import { evaluateDataflow } from '@/lib/sql/dataflow-core';
import type { CompiledDataflow, CompiledMutation } from '@/lib/story/compiled-dataflow';
import { importRef, mutationReads, type ImportTables } from '@/lib/story/compiled-flow';
import type { TableResult } from '@/lib/story/dataflow';
import { runLocalStateMutation, type LocalMutationResult } from '@/lib/story/local-state';
import { localTableOverrides } from '@/lib/story/local-tables';
import { bindMutationRequest, type MutationRequest } from '@/lib/story/mutation-request';
import type { RunAnswer } from './dataflow-core';

/** The one deadline and write cap every composition applies (services/sql caps). */
const TIMEOUT_MS = 5_000;
const WRITE_ROWS = 10_000;

/** What a run knows beside its rows: the reader's values and local tables, the viewer, the clock, the zone. */
export interface PageRunContext {
  values: Record<string, Scalar>;
  localTables?: Record<string, Row[]>;
  userId: string | null;
  now: string;
  tz: string;
}

/** The platform facts a write is bound with. */
export type PageWriteContext = Pick<PageRunContext, 'userId' | 'now' | 'tz'>;

export interface PageEngineSource {
  /** The SQLite core, loaded on first use (a lazy chunk and its wasm, or the offline file's embedded bytes). */
  load(): Promise<Pick<SqliteEngine, 'run' | 'mutate'>>;
  /** Every row of one held import, by its name in the document (QueryTransport.hold). */
  fetch(name: string): Promise<ImportTables[string]>;
}

/** A write applied to the held copy, until the server decides. */
export interface Optimistic { settle(confirmed: boolean): void }

export interface PageEngine {
  /** Start loading the core and these imports; a no-op for what is loaded or loading. */
  prepare(flow: CompiledDataflow, imports: readonly string[]): void;
  /** The core is loaded and every one of these imports is held and current. */
  ready(flow: CompiledDataflow, imports: readonly string[]): boolean;
  /** These datasets changed elsewhere: the imports reading them are fetched again before they answer here. */
  invalidate(refs: Iterable<string>): void;
  run(flow: CompiledDataflow, only: readonly string[], ctx: PageRunContext): Promise<RunAnswer>;
  page(flow: CompiledDataflow, name: string, page: { offset: number; limit: number; sort?: { col: string; dir: 'asc' | 'desc' } }, ctx: PageRunContext): Promise<TableResult>;
  /** A local-table write, computed here; rejects with the reason the server would give. */
  write(flow: CompiledDataflow, m: CompiledMutation, request: MutationRequest, ctx: PageWriteContext): Promise<LocalMutationResult>;
  /** Apply a dataset write to the held copy; null when it cannot be judged here (the server alone answers it). */
  apply(flow: CompiledDataflow, m: CompiledMutation, request: MutationRequest, ctx: PageWriteContext): Optimistic | null;
}

interface Pending {
  flow: CompiledDataflow;
  m: CompiledMutation;
  input: Pick<MutationInput, 'sql' | 'params' | 'paramTypes' | 'expectedAffected'>;
  userId: string | null;
  /** The fetch generation current when the server confirmed it; absent while undecided. */
  confirmedAt?: number;
}

interface Held {
  ref: string;
  /** The server's rows, as last fetched. */
  base?: ImportTables[string];
  /** Bumped by every invalidation; a fetch that started under an older one is stale when it lands. */
  generation: number;
  loading?: number;
}

export function createPageEngine(source: PageEngineSource): PageEngine {
  let core: Pick<SqliteEngine, 'run' | 'mutate'> | null = null;
  let loadingCore: Promise<unknown> | null = null;
  const held = new Map<string, Held>();
  let pending: Pending[] = [];
  /** The held rows with every pending write replayed over them; rebuilt when either changes. */
  let view: ImportTables | null = null;

  const fetch = (name: string, entry: Held) => {
    const generation = entry.generation;
    entry.loading = generation;
    source.fetch(name).then((tables) => {
      if (entry.generation !== generation) return;
      entry.base = tables;
      // Confirmed before this fetch began: its rows are these rows now.
      pending = pending.filter((p) => p.confirmedAt === undefined || p.confirmedAt >= generation);
      view = null;
    }, () => { /* unheld: its queries keep running on the server */ }).finally(() => {
      if (entry.loading === generation) delete entry.loading;
    });
  };

  const current = (): ImportTables => {
    if (view) return view;
    const out: ImportTables = {};
    for (const [name, entry] of held) if (entry.base) out[name] = entry.base;
    for (const p of pending) {
      const target = p.m.target as { import: string; table: string };
      const table = out[target.import]?.[target.table];
      const decl = p.flow.imports.find((i) => i.name === target.import)?.tables.find((t) => t.name === target.table);
      if (!core || !table || !decl) continue;
      const result = core.mutate({
        ...p.input,
        table: { schema: target.import, name: target.table, rows: table.rows, columns: decl.columns },
        reads: mutationReads(p.flow, p.m, { imports: out, userId: p.userId }),
      }, { limit: WRITE_ROWS, timeoutMs: TIMEOUT_MS });
      // A write that no longer applies to these rows is the server's to answer.
      if (isQueryFailure(result)) continue;
      out[target.import] = { ...out[target.import], [target.table]: { rows: result.rows, columns: decl.columns } };
    }
    return (view = out);
  };

  const engine = () => {
    if (!core) throw new Error('the page engine is not loaded');
    return core;
  };

  const runDataflow = (flow: CompiledDataflow, ctx: PageRunContext, selection: { only?: readonly string[]; page?: { name: string; offset: number; limit: number; sort?: { col: string; dir: 'asc' | 'desc' } } }) =>
    evaluateDataflow({
      run: async (input) => engine().run(input, {
        limit: input.limit ?? DISPLAY_ROWS,
        pageLimit: input.page?.limit ?? input.limit ?? DISPLAY_ROWS,
        timeoutMs: TIMEOUT_MS,
      }),
    }, flow, current(), {
      userId: ctx.userId, now: ctx.now, tz: ctx.tz, values: ctx.values,
      ...(selection.only ? { only: selection.only } : {}),
      ...(selection.page ? { page: selection.page } : {}),
      ...(ctx.localTables ? { localTables: ctx.localTables } : {}),
    });

  const bind = (flow: CompiledDataflow, m: CompiledMutation, request: MutationRequest, ctx: PageWriteContext) => {
    const bound = bindMutationRequest(flow, m, request, ctx);
    if (!bound.ok) throw new Error(bound.detail);
    return bound;
  };

  return {
    prepare(flow, imports) {
      // A core that will not load is final for this document: its queries run on the server.
      loadingCore ??= source.load().then((loaded) => { core = loaded; view = null; }, () => {});
      for (const name of imports) {
        const ref = importRef(flow, name);
        if (!ref) continue;
        let entry = held.get(name);
        if (!entry || entry.ref !== ref) {
          entry = { ref, generation: (entry?.generation ?? 0) + 1 };
          held.set(name, entry);
          view = null;
        }
        if (!entry.base && entry.loading === undefined) fetch(name, entry);
      }
    },
    ready(flow, imports) {
      return !!core && imports.every((name) => {
        const entry = held.get(name);
        return !!entry?.base && entry.ref === importRef(flow, name);
      });
    },
    invalidate(refs) {
      const changed = new Set(refs);
      for (const [name, entry] of held) {
        if (!changed.has(entry.ref)) continue;
        entry.generation++;
        delete entry.base;
        view = null;
        fetch(name, entry);
      }
    },
    async run(flow, only, ctx) {
      const state = await runDataflow(flow, ctx, { only });
      return { tables: state.tables, errors: state.errors };
    },
    async page(flow, name, page, ctx) {
      const state = await runDataflow(flow, ctx, { page: { name, ...page } });
      const table = state.tables[name];
      if (!table) throw new Error(state.errors[name] ?? `no rows for "${name}"`);
      return table;
    },
    async write(flow, m, request, ctx) {
      const { params, paramTypes } = bind(flow, m, request, ctx);
      const tables = localTableOverrides(flow, request.localTables);
      return runLocalStateMutation(flow, m, { tables }, {
        mutate: async (input) => engine().mutate(input, { limit: WRITE_ROWS, timeoutMs: TIMEOUT_MS }),
      }, { params, paramTypes, reads: mutationReads(flow, m, { imports: current(), tables, userId: ctx.userId }) });
    },
    apply(flow, m, request, ctx) {
      if (!core || !('import' in m.target)) return null;
      const bound = bindMutationRequest(flow, m, request, ctx);
      if (!bound.ok) return null;
      const entry: Pending = {
        flow, m, userId: ctx.userId,
        input: { sql: m.sql, params: bound.params, paramTypes: bound.paramTypes, ...(m.expectedAffected === undefined ? {} : { expectedAffected: m.expectedAffected }) },
      };
      const target = m.target.import;
      const before = current()[target];
      pending = [...pending, entry];
      view = null;
      if (current()[target] === before) {
        // It changed nothing here (refused by its own guard): not ours to show.
        pending = pending.filter((p) => p !== entry);
        view = null;
        return null;
      }
      return {
        settle(confirmed) {
          if (!pending.includes(entry)) return;
          if (confirmed) entry.confirmedAt = held.get(target)?.generation ?? 0;
          else { pending = pending.filter((p) => p !== entry); view = null; }
        },
      };
    },
  };
}
