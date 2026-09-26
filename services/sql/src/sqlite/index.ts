/**
 * THE SQLITE ENGINE, browser-safe (`@artifactbin/sql/core`). No Node imports:
 * the server wraps it as a `SqlService` (`createSqliteSql`, `@artifactbin/sql/sqlite`), and the
 * runtime bundle and the offline file call it directly, on the main thread,
 * with in-memory databases. Every method is synchronous once the module is
 * loaded, and every call opens its own throwaway database — isolation is
 * structural, exactly as with the DuckDB engine it replaces.
 */
import type { DryRunInput, DryRunMutationsInput, DryRunMutationsResult, DryRunResult, MutationInput, MutationOutcome, QueryOutcome, RunInput, StatementAnalysis } from '@artifactbin/contracts';
import { SqliteDatabase, type Relation } from './database';
import { dryRunQueries, runQueries, type ReadBounds } from './reads';
import { dryRunMutations, runMutation, type WriteBounds } from './writes';
import { loadSqliteModule, type Sqlite3 } from './wasm';

export { SqliteDatabase, Refused, TimedOut, type Prepared, type Relation, type StatementMode, type TableData } from './database';
export type { ReadBounds } from './reads';
export type { WriteBounds } from './writes';
export type { Sqlite3 } from './wasm';

export interface SqliteEngine {
  /** What `sql` touches over these relations (views carry `sql`); throws the guard's reason when it is refused. */
  analyze(sql: string, schema: Relation[]): StatementAnalysis;
  run(input: RunInput, bounds: ReadBounds): Record<string, QueryOutcome>;
  mutate(input: MutationInput, bounds: WriteBounds): MutationOutcome;
  dryRun(input: DryRunInput): DryRunResult;
  dryRunMutations(input: DryRunMutationsInput): DryRunMutationsResult;
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
    analyze: (sql, schema) => withDatabase((db) => {
      for (const relation of schema) if (relation.sql === undefined) db.createTable(relation);
      db.createViews(schema.flatMap((r) => (r.sql === undefined ? [] : [{ ...r, sql: r.sql }])));
      const prepared = db.prepare(sql, 'any');
      prepared.finalize();
      return prepared.analysis;
    }),
    run: (input, bounds) => runQueries(sqlite3, input, bounds),
    mutate: (input, bounds) => runMutation(sqlite3, input, bounds),
    dryRun: (input) => dryRunQueries(sqlite3, input),
    dryRunMutations: (input) => dryRunMutations(sqlite3, input),
    open: () => new SqliteDatabase(sqlite3),
    libraryFunctions: () => withDatabase((db) => db.registeredFunctions()),
  };
}

/** The engine over the package's own wasm (loaded once), or over supplied wasm bytes. */
export async function loadSqlite(wasm?: ArrayBuffer | Uint8Array): Promise<SqliteEngine> {
  return engine(await loadSqliteModule(wasm));
}
