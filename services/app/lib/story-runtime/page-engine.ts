/**
 * THE PAGE'S OWN ENGINE — the SQLite core (`@artifactbin/sql/core`, the same
 * wasm and functions the server runs) over the imports this reader holds, in
 * memory, on the main thread. The store (lib/story-runtime/store) sends it the
 * nodes placed in the browser (lib/story/placement) and the server the rest.
 *
 * It answers what the server would, by running the SAME code: the dataflow
 * evaluator (lib/sql/dataflow-core) for reads — over ONE database the page
 * keeps open (SqliteEngine.held), so a held dataset crosses into SQLite once,
 * not on every run — the write signature
 * (lib/story/mutation-request bindMutationRequest) and the local-table write
 * (lib/story/local-state) for writes, the same display window for what a run
 * returns. The only thing it owns is what it HOLDS:
 *
 *  - each held DATASET, fetched once (QueryTransport.hold, by the first import
 *    that reads it) and again only after it changed (`invalidate`); until the
 *    fetch lands, its queries are not ready here and run on the server;
 *  - the OPTIMISTIC OVERLAY: a dataset write applied to the held copy the
 *    moment it is made, and replayed over every fresh fetch until the server
 *    has decided. Refused, it is withdrawn and the overlay replayed without
 *    it (a later write keeps its effect); confirmed, it stays until the first
 *    fetch started after the confirmation, whose rows already include it.
 *    The rows here are the truth; the open database is loaded from them, and
 *    again whenever a table's rows are a different array (a fetch, a write
 *    applied or withdrawn), so it can never drift from them.
 *
 * Everything a run needs beside its rows — the viewer, the clock, the zone,
 * the reader's local tables — comes in with the call, so the engine can never
 * disagree with the store about them.
 */
import type { MutationInput, Row, Scalar } from '@artifactbin/contracts';
import { DISPLAY_ROWS, isQueryFailure } from '@artifactbin/contracts';
import type { HeldDatabase, SqliteEngine } from '@artifactbin/sql/core';
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
  load(): Promise<PageCore>;
  /** Every row of one held import, by its name in the document (QueryTransport.hold). */
  fetch(name: string): Promise<ImportTables[string]>;
}

/** What the page needs of the SQLite core. */
export type PageCore = Pick<SqliteEngine, 'held' | 'mutate'>;

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
  /** The document is gone: close its open database, whose memory the wasm heap never gives back otherwise. */
  close(): void;
}

interface Pending {
  flow: CompiledDataflow;
  m: CompiledMutation;
  /** The dataset it writes. */
  ref: string;
  input: Pick<MutationInput, 'sql' | 'params' | 'paramTypes' | 'expectedAffected'>;
  userId: string | null;
  /** The fetch generation current when the server confirmed it; absent while undecided. */
  confirmedAt?: number;
}

/** One dataset the page holds — by ref, however many imports read it. */
interface Held {
  /** The import it is fetched by: the door answers import names, never refs. */
  name: string;
  /** The server's rows, as last fetched. */
  base?: ImportTables[string];
  /** Bumped by every invalidation; a fetch that started under an older one is stale when it lands. */
  generation: number;
  loading?: number;
}

export function createPageEngine(source: PageEngineSource): PageEngine {
  let core: PageCore | null = null;
  /** The open database, for the import names (in declaration order) it was attached with. */
  let database: { schemas: string; db: HeldDatabase } | null = null;
  let loadingCore: Promise<unknown> | null = null;
  const held = new Map<string, Held>();
  let pending: Pending[] = [];
  /** Each held dataset with every pending write replayed over it; rebuilt when either changes. */
  let view: Map<string, ImportTables[string]> | null = null;

  const fetch = (entry: Held) => {
    const generation = entry.generation;
    entry.loading = generation;
    source.fetch(entry.name).then((tables) => {
      if (entry.generation !== generation) return;
      entry.base = tables;
      // Confirmed before this fetch began: its rows are these rows now.
      pending = pending.filter((p) => p.confirmedAt === undefined || p.confirmedAt >= generation);
      view = null;
    }, () => { /* unheld: its queries keep running on the server */ }).finally(() => {
      if (entry.loading === generation) delete entry.loading;
    });
  };

  /** A document's imports, by its own names, over the held datasets. */
  const importsOf = (flow: CompiledDataflow, byRef: Map<string, ImportTables[string]>): ImportTables =>
    Object.fromEntries(flow.imports.flatMap((i) => (byRef.has(i.ref) ? [[i.name, byRef.get(i.ref)!]] : [])));

  const views = (): Map<string, ImportTables[string]> => {
    if (view) return view;
    const out = new Map<string, ImportTables[string]>();
    for (const [ref, entry] of held) if (entry.base) out.set(ref, entry.base);
    for (const p of pending) {
      const target = p.m.target as { import: string; table: string };
      const table = out.get(p.ref)?.[target.table];
      const decl = p.flow.imports.find((i) => i.name === target.import)?.tables.find((t) => t.name === target.table);
      if (!core || !table || !decl) continue;
      const result = core.mutate({
        ...p.input,
        table: { schema: target.import, name: target.table, rows: table.rows, columns: decl.columns },
        reads: mutationReads(p.flow, p.m, { imports: importsOf(p.flow, out), userId: p.userId }),
      }, { limit: WRITE_ROWS, timeoutMs: TIMEOUT_MS });
      // A write that no longer applies to these rows is the server's to answer.
      if (isQueryFailure(result)) continue;
      out.set(p.ref, { ...out.get(p.ref), [target.table]: { rows: result.rows, columns: decl.columns } });
    }
    return (view = out);
  };
  const current = (flow: CompiledDataflow): ImportTables => importsOf(flow, views());

  let closed = false;
  const engine = () => {
    if (closed) throw new Error('the page engine is closed');
    if (!core) throw new Error('the page engine is not loaded');
    return core;
  };
  /** The open database for this document; a rewrite that changes its imports starts a new one. */
  const databaseFor = (flow: CompiledDataflow): HeldDatabase => {
    const names = flow.imports.map((i) => i.name);
    const schemas = JSON.stringify(names);
    if (database?.schemas !== schemas) {
      database?.db.close();
      database = { schemas, db: engine().held(names) };
    }
    return database.db;
  };

  const runDataflow = (flow: CompiledDataflow, ctx: PageRunContext, selection: { only?: readonly string[]; page?: { name: string; offset: number; limit: number; sort?: { col: string; dir: 'asc' | 'desc' } } }) =>
    evaluateDataflow({
      run: async (input) => databaseFor(flow).run(input, {
        limit: input.limit ?? DISPLAY_ROWS,
        pageLimit: input.page?.limit ?? input.limit ?? DISPLAY_ROWS,
        timeoutMs: TIMEOUT_MS,
      }),
    }, flow, current(flow), {
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
    close() {
      closed = true;
      database?.db.close();
      database = null;
    },
    prepare(flow, imports) {
      if (closed) return;
      // A core that will not load is final for this document: its queries run on the server.
      loadingCore ??= source.load().then((loaded) => { core = loaded; view = null; }, () => {});
      for (const name of imports) {
        const ref = importRef(flow, name);
        if (!ref) continue;
        let entry = held.get(ref);
        if (!entry) held.set(ref, entry = { name, generation: 1 });
        if (!entry.base && entry.loading === undefined) fetch(entry);
      }
    },
    ready(flow, imports) {
      return !closed && !!core && imports.every((name) => {
        const ref = importRef(flow, name);
        return !!ref && !!held.get(ref)?.base;
      });
    },
    invalidate(refs) {
      for (const ref of new Set(refs)) {
        const entry = held.get(ref);
        if (!entry) continue;
        entry.generation++;
        delete entry.base;
        view = null;
        fetch(entry);
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
      }, { params, paramTypes, reads: mutationReads(flow, m, { imports: current(flow), tables, userId: ctx.userId }) });
    },
    apply(flow, m, request, ctx) {
      const ref = 'import' in m.target ? importRef(flow, m.target.import) : undefined;
      if (closed || !core || !ref) return null;
      const bound = bindMutationRequest(flow, m, request, ctx);
      if (!bound.ok) return null;
      const entry: Pending = {
        flow, m, ref, userId: ctx.userId,
        input: { sql: m.sql, params: bound.params, paramTypes: bound.paramTypes, ...(m.expectedAffected === undefined ? {} : { expectedAffected: m.expectedAffected }) },
      };
      const before = views().get(ref);
      pending = [...pending, entry];
      view = null;
      if (views().get(ref) === before) {
        // It changed nothing here (refused by its own guard): not ours to show.
        pending = pending.filter((p) => p !== entry);
        view = null;
        return null;
      }
      return {
        settle(confirmed) {
          if (!pending.includes(entry)) return;
          if (confirmed) entry.confirmedAt = held.get(ref)?.generation ?? 0;
          else { pending = pending.filter((p) => p !== entry); view = null; }
        },
      };
    },
  };
}
