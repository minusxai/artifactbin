/**
 * THE SQLITE ENGINE, browser-safe (`@artifactbin/sql/core`). No Node imports:
 * the server wraps it as a `SqlService` (`createSqliteSql`, `@artifactbin/sql/sqlite`), and the
 * runtime bundle and the offline file call it directly, on the main thread,
 * with in-memory databases. Every method is synchronous once the module is
 * loaded, and every call opens its own throwaway database — isolation is
 * structural — except a `held` database, which the page keeps open over the
 * imports it holds.
 */
import type { DryRunInput, DryRunMutationsInput, DryRunMutationsResult, DryRunResult, MutationInput, MutationOutcome, QueryOutcome, RunInput, StatementAnalysis } from '@artifactbin/contracts';
import { SqliteDatabase, type Relation } from './database';
import { dryRunQueries, heldDatabase, runQueries, type HeldDatabase, type ReadBounds } from './reads';
import { dryRunMutations, runMutation, type WriteBounds } from './writes';
import { loadSqliteModule, type Sqlite3 } from './wasm';
import type { SqlExtensions } from '../extensions';
export { provideSqliteWasm } from './wasm';
export { DEFAULT_CAPS, type SqlCaps } from '../caps';

export { SqliteDatabase, Refused, TimedOut, type Prepared, type Relation, type StatementMode, type TableData } from './database';
export type { HeldDatabase, ReadBounds } from './reads';
export type { WriteBounds } from './writes';
export type { Sqlite3 } from './wasm';
export type { SqlExtensions } from '../extensions';

export interface SqliteEngine {
  /**
   * What `sql` touches over these relations (views carry `sql`); throws the
   * guard's reason when it is refused. `mode: 'write'` analyzes it as the
   * <Mutation> it will run as: the composition's extension functions are
   * installed first (`setupMutation`, as a dry run), so a statement the engine
   * would run is not refused for calling one. Only which functions exist
   * changes — whether the statement is a read or a write is the caller's to judge.
   */
  analyze(sql: string, schema: Relation[], options?: { mode: 'write'; extensions?: SqlExtensions }): StatementAnalysis;
  run(input: RunInput, bounds: ReadBounds): Record<string, QueryOutcome>;
  /**
   * `run`, many times over the same imports: a database kept open, each
   * import table loaded once (and again when given different rows), with the
   * imports' `schemas` attached in the order a `run` attaches them.
   */
  held(schemas: readonly string[]): HeldDatabase;
  mutate(input: MutationInput, bounds: WriteBounds, extensions?: SqlExtensions): MutationOutcome;
  dryRun(input: DryRunInput): DryRunResult;
  dryRunMutations(input: DryRunMutationsInput, extensions?: SqlExtensions): DryRunMutationsResult;
  /** A fresh guarded database with the function library, for callers that orchestrate their own statements. */
  open(): SqliteDatabase;
  /** The functions registered beyond SQLite's built-ins, as SQLite lists them. */
  libraryFunctions(): Array<{ name: string; arity: number; kind: 'scalar' | 'aggregate' | 'window' }>;
}

function engine(sqlite3: Sqlite3): SqliteEngine {
  const withDatabase = <T>(fn: (db: SqliteDatabase) => T): T => {
    const db = new SqliteDatabase(sqlite3);
    try { return fn(db); } finally { db.close(); }
  };
  return {
    analyze: (sql, schema, options) => withDatabase((db) => {
      if (options?.mode === 'write') options.extensions?.setupMutation?.(db, { dryRun: true });
      for (const relation of schema) if (relation.sql === undefined) db.createTable(relation);
      db.createViews(schema.flatMap((r) => (r.sql === undefined ? [] : [{ ...r, sql: r.sql }])));
      const prepared = db.prepare(sql, 'any');
      prepared.finalize();
      return prepared.analysis;
    }),
    run: (input, bounds) => runQueries(sqlite3, input, bounds),
    held: (schemas) => heldDatabase(sqlite3, schemas),
    mutate: (input, bounds, extensions) => runMutation(sqlite3, input, bounds, extensions),
    dryRun: (input) => dryRunQueries(sqlite3, input),
    dryRunMutations: (input, extensions) => dryRunMutations(sqlite3, input, extensions),
    open: () => new SqliteDatabase(sqlite3),
    libraryFunctions: () => withDatabase((db) => db.registeredFunctions()),
  };
}

/** The engine over the package's own wasm (loaded once), or over supplied wasm bytes. */
export async function loadSqlite(wasm?: ArrayBuffer | Uint8Array): Promise<SqliteEngine> {
  return engine(await loadSqliteModule(wasm));
}
