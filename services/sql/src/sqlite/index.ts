/**
 * THE SQLITE ENGINE, browser-safe (`@artifactbin/sql/core`). No Node imports:
 * the server wraps it as a `SqlService` (`createSqliteSql`, `@artifactbin/sql/sqlite`), and the
 * runtime bundle and the offline file call it directly, on the main thread,
 * with in-memory databases. Every method is synchronous once the module is
 * loaded, and every call opens its own throwaway database — isolation is
 * structural — except a `held` database, which the page keeps open over the
 * imports it holds.
 */
import type { DryRunInput, DryRunMutationsInput, DryRunMutationsResult, DryRunResult, MutationInput, MutationOutcome, QueryOutcome, RunInput, RunManyInput, StatementAnalysis } from '@artifactbin/contracts';
import { SqliteDatabase, type Relation } from './database';
import type { PreparedCache } from './prepared';
import { dryRunQueries, heldDatabase, runManyQueries, runQueries, type HeldDatabase, type ReadBounds } from './reads';
import { dryRunMutations, runMutation, type WriteBounds } from './writes';
import { loadSqliteModule, type Sqlite3 } from './wasm';
import type { SqlExtensions } from '../extensions';

export { SqliteDatabase, TimedOut, type Relation } from './database';
export { PreparedCache, preparedKey } from './prepared';
export type { ReadBounds } from './reads';
export type { WriteBounds } from './writes';
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
  /** A catalog read keyed on every source is answered from (and kept in) `prepared` (./prepared). */
  run(input: RunInput, bounds: ReadBounds, prepared?: PreparedCache): Record<string, QueryOutcome>;
  /** `run` once per entry of `input.runs`, the imports loaded once for all of them; `bounds` per run. */
  runMany(input: RunManyInput, bounds: (run: RunManyInput['runs'][number], index: number) => ReadBounds): Array<Record<string, QueryOutcome>>;
  /**
   * `run`, many times over the same imports: a database kept open, each
   * import table loaded once (and again when given different rows), with the
   * imports' `schemas` attached in the order a `run` attaches them.
   */
  held(schemas: readonly string[]): HeldDatabase;
  /** A keyed write (`input.mounted`) is answered over the database `prepared` keeps for its keys, never changing it. */
  mutate(input: MutationInput, bounds: WriteBounds, extensions?: SqlExtensions, prepared?: PreparedCache): MutationOutcome;
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
    run: (input, bounds, prepared) => runQueries(sqlite3, input, bounds, prepared),
    runMany: (input, bounds) => runManyQueries(sqlite3, input, bounds),
    held: (schemas) => heldDatabase(sqlite3, schemas),
    mutate: (input, bounds, extensions, prepared) => runMutation(sqlite3, input, bounds, extensions, prepared),
    dryRun: (input) => dryRunQueries(sqlite3, input),
    dryRunMutations: (input, extensions) => dryRunMutations(sqlite3, input, extensions),
    open: () => new SqliteDatabase(sqlite3),
    libraryFunctions: () => withDatabase((db) => db.registeredFunctions()),
  };
}

/** `analyze` on the package's own engine, for a caller that only judges statements (the app's write analysis). */
export async function analyzeSql(sql: string, schema: Relation[], options?: { mode: 'write'; extensions?: SqlExtensions }): Promise<StatementAnalysis> {
  return (await loadSqlite()).analyze(sql, schema, options);
}

/** SQLite identifiers fold ASCII only (Unicode-distinct identifiers remain distinct). */
const identifier = (name: string): string => name.replace(/[A-Z]/g, (c) => c.toLowerCase());

/**
 * THE RELATIONS ONE READ READS, by SQLite's own analysis over their shapes (no rows): `sql` must be a single SELECT,
 * and it is then prepared and stepped once over the empty tables it reads with every parameter NULL (the guarded
 * path `dryRun` takes), so a statement that could not run is refused here too. Throws `TimedOut` past `timeoutMs`
 * (and past `deadline`, when given) and an Error for anything else; `check`, the caller's cancellation, runs before
 * each step and may throw.
 */
export async function readsOf<R extends Relation>(sql: string, relations: readonly R[], paramNames: readonly string[], bounds: { rows: number; timeoutMs: number; deadline?: number; check?: () => void }): Promise<R[]> {
  const check = bounds.check ?? (() => undefined);
  check();
  const engine = await loadSqlite();
  check();
  const analysis = engine.analyze(sql, [...relations]);
  if (analysis.kind !== 'select' || analysis.writes.length) throw new Error('SQL requires a SELECT statement');
  const read = relations.filter((r) => analysis.reads.some((x) => identifier(x.schema) === identifier(r.schema) && identifier(x.table) === identifier(r.table)));
  const db = engine.open();
  try {
    for (const relation of read) db.createTable(relation);
    const prepared = db.prepare(sql, 'read');
    try {
      check();
      const timeoutMs = Math.min(bounds.timeoutMs, bounds.deadline === undefined ? bounds.timeoutMs : Math.max(1, bounds.deadline - performance.now()));
      prepared.bind(Object.fromEntries(paramNames.map((name) => [name, null]))).rows(bounds.rows, timeoutMs);
    } finally { prepared.finalize(); }
  } finally { db.close(); }
  return read;
}

/** The engine over the package's own wasm (loaded once), or over supplied wasm bytes. */
export async function loadSqlite(wasm?: ArrayBuffer | Uint8Array): Promise<SqliteEngine> {
  return engine(await loadSqliteModule(wasm));
}
