/**
 * THE SQL SERVICE — SQLite (wasm) in a process of its own, or in this one. Stateless
 * by construction: every call carries the tables BY VALUE and answers rows;
 * nothing persists between calls, so a document's dependent queries travel in
 * ONE `run` (a later query may read an earlier one's result by name).
 *
 * The two dry-runs are the publish-time check that refuses a bad query with a
 * 400 instead of a blank chart at render, and they cross the same wire as the
 * reads and writes, so no caller needs the engine in its own process.
 *
 * WHAT THE SERVICE ENFORCES, whatever the caller says: one statement per query, admitted by type (reads on
 * `run`, one write on `mutate`), params bound and never spliced, a row cap and a per-query interrupt (`limit` and
 * `timeoutMs` may lower the caps, never raise them) and a 64 MiB body. The engine has no credentials, storage,
 * request identity or network: run it on a private network, with `INTERNAL__SERVICE_SECRET` on the service and
 * its callers (production refuses to start without it).
 *
 * ERRORS. A query that cannot run is a `QueryFailure` for that query; a malformed body is 400 `bad_request`, the
 * detail in the operator log only. An unreachable service is a `QueryFailure` on EVERY query at the client's
 * deadline, the dry runs included: an empty `errors` there would admit an unchecked document and move the
 * author's error from publish time to render time. Paged reads keep `totalRows` (the count before the window);
 * `truncated` is set only when the returned rows omit part of that result, never merely for asking for a page.
 *
 * Mutations bind a row action's fields as ordinary named parameters (`$_row.<column>` as `$_row__<column>`,
 * `paramSqlName`); binding a row's values does not establish its identity, and the caller owns the row schema and
 * authorization. Keyed catalog reads and writes (`RunInput.catalog`, `MutationInput.mounted`) are answered from a
 * prepared database when the engine has one (services/sql/src/sqlite/prepared.ts). One conformance suite runs every
 * engine in this thread, in worker threads and over HTTP (services/sql/__tests__/contract.test.ts).
 */
import type { DatasetMutationPolicy, MutationAnalysis } from './dataset-policy';

export type Scalar = string | number | boolean | null;
export type Row = Record<string, unknown>;
export type ColumnType = 'string' | 'number' | 'boolean' | 'date' | 'timestamp' | 'user';
export interface UserConstraints { memberOf?: string[]; self?: boolean }
export interface UserOption { value: string; label: string }
/**
 * A PERSON AS A DOCUMENT MAY SHOW THEM: the display name (name, else handle,
 * else the id), the public handle for /@handle, and the public picture URL —
 * or null when the person has not uploaded one (the client draws a generated
 * initial). Computed on the server under the same visibility rules a DataTable
 * user cell has always had (lib/datasets/user-fields); never an email.
 */
export interface PersonCard { name: string; handle: string | null; image: string | null }
export interface DatasetColumn { name: string; type: ColumnType; /** Suggested scalar choices for typed authoring controls; not an access restriction. */ choices?: Scalar[]; constraints?: UserConstraints }

export interface TableResult {
  rows: Row[];
  columns: DatasetColumn[];
  /** Present only when the result was cut at the row cap. */
  truncated?: boolean;
  /** The real row count when known (before the cap). */
  totalRows?: number;
}

/** A query that could not run: the engine's own message, for the author. */
export interface QueryFailure {
  error: string;
  /** A suspended mutation; no rows are returned or persisted until resolved. */
  continuation?: {kind:string;payload:unknown};
  /** Stable machine-readable reason for a guarded edit cardinality failure. */
  code?: 'row_changed' | 'row_not_unique' | 'policy_denied';
  /** Set when the result outgrew the caller's `outputBytes` while it was collected. */
  tooLarge?: boolean;
  /** Set when the failure was our timeout rather than the author's SQL. */
  timedOut?: boolean;
  /** Set when a WRITE would have taken the table past the row cap (nothing was stored). */
  full?: boolean;
  /** Set when a keyed catalog read left its rows out and the engine has no database prepared for its keys: resend with the rows. */
  rowsRequired?: boolean;
}
export type QueryOutcome = TableResult | QueryFailure;
export const isQueryFailure = (o: QueryOutcome): o is QueryFailure => 'error' in o;

/** The engine needs a name and the SQL; a document's richer declaration satisfies this structurally. */
export interface SqlQuery { name: string; sql: string }

/** A WINDOW of one query's result — how a table reads past the row cap. */
export interface QueryPage {
  offset: number;
  limit: number;
  sort?: { col: string; dir: 'asc' | 'desc' };
}

/** An isolated SQLite catalog. Only these logical tables and columns are exposed.
 * Models are native read SQL, bound lazily so unused drafts cannot break a read. */
interface SqlReadCatalog {
  defaultSchema: string;
  /**
   * `key`: the content address of the rows `source` carries — the same key always travels with the same
   * rows. When every source has one, the engine may answer from a database it prepared for this catalog
   * and these keys, and the rows may be left out; a miss is a `rowsRequired` failure, resent with them.
   */
  tables: Array<{ schema: string; name: string; columns: DatasetColumn[]; source?: string; key?: string; sql?: string }>;
  paramTypes?: Record<string, ColumnType>;
}

export interface RunInput {
  paramTypes?: Record<string,ColumnType>;
  /** One catalog query; table keys are transport identities, never SQL names. */
  catalog?: SqlReadCatalog;
  /** Tables in `main` by SQL name: a document's table Values, its built-in tables, an earlier result. */
  tables: Record<string, { rows: Row[]; columns: DatasetColumn[] }>;
  /** Imported artifacts, each attached as a schema of its own: `imports.bookings.rows` is `bookings.rows` in SQL. */
  imports?: Record<string, Record<string, { rows: Row[]; columns: DatasetColumn[] }>>;
  /** Queries in RUN ORDER (dependencies first). */
  queries: SqlQuery[];
  /** Current scalar values, bound by name. Missing/undefined binds NULL. */
  params: Record<string, Scalar>;
  /** Row cap per result — clamped by the service, never raised. */
  limit?: number;
  /** Per-query interrupt — clamped by the service, never raised. */
  timeoutMs?: number;
  /** Serialized size a result may reach while it is collected; past it the query fails `tooLarge`, read no further. */
  outputBytes?: number;
  /** Read only a window of ONE query's result (its dependencies still run whole). */
  page?: { name: string } & QueryPage;
}

/**
 * `run`, many times over ONE set of imports: the imports travel and are loaded once, then `shared`
 * runs once — its tables and every result loaded WHOLE and kept, for every run to read by name —
 * then each run is an ordinary `run` of its own tables, queries and values over all of that (a
 * filter's variants: only the values change, and what reads no value is computed once). A run's own
 * tables and results are gone when it returns. Answers one outcome map per run, in order, each with
 * the `shared` outcomes beside its own.
 */
export interface RunManyInput {
  imports?: RunInput['imports'];
  shared?: Omit<RunInput, 'imports' | 'catalog' | 'page'>;
  runs: Array<Omit<RunInput, 'imports' | 'catalog' | 'page'>>;
}

export interface MutationInput {
  policy?: DatasetMutationPolicy;
  /** Internal capability preview: analyze only, never execute effects. */
  policyPreview?: boolean;
  /** Opaque downstream execution context. Never contains credentials. */
  extensions?: Record<string,unknown>;
  /** The ONE table the statement may write, as SQL names it: `schema.name` (`bookings.rows`), `main` when absent. */
  table: { name: string; schema?: string; rows: Row[]; columns: DatasetColumn[] };
  /** Every other relation the statement may READ (the document's other imports, table Values, built-in tables), never write. */
  reads?: Array<{ schema: string; table: string; rows: Row[]; columns: DatasetColumn[] }>;
  sql: string;
  params: Record<string, Scalar>;
  /** Declared types of scalar params. Policy analysis and binding use these instead of guessing from the JS value. */
  paramTypes?: Record<string, ColumnType>;
  /** Required changed-row count for server-controlled writes such as cell edits. */
  expectedAffected?: number;
  /** A row-identity column of the table: the result then names the rows the statement wrote (`written`). */
  identity?: string;
  /** The most rows the table may hold AFTER the write. */
  limit?: number;
  timeoutMs?: number;
  /**
   * KEYED MOUNTS (RunInput.catalog's protocol, services/sql/src/sqlite/prepared.ts): the tables the statement reads, and the
   * target when it is one of them, come from the database the engine prepared for these keys; the target is
   * swapped for its writable copy inside a transaction that is always rolled back, so the kept database never
   * changes. A miss answers `rowsRequired` and the caller resends with `tables`. `table.rows` and `reads` are then
   * unused; `table.columns` may add columns the catalog's target lacks (NULL in every row).
   */
  mounted?: { catalog: SqlReadCatalog; tables: Record<string, { rows: Row[]; columns: DatasetColumn[] }> };
  /** `written`: `rows` holds only the rows the statement inserted or updated (after it), never the whole table. */
  answer?: 'table' | 'written';
}
/** A write that ran: the table's new rows and how many rows the statement touched. */
export interface MutationResult extends TableResult {
  affected: number;
  analysis?: MutationAnalysis;
  /** Actual assigned user fields, after expressions/presets. App validates before commit. */
  userWrites?: Row[];
  /** With `identity`: that column's value on every row the statement inserted, updated or deleted, in rowid order. */
  written?: Scalar[];
}
export type MutationOutcome = MutationResult | QueryFailure;

export interface DryRunInput {
  paramTypes?: Record<string,ColumnType>;
  tables: Record<string, { columns: DatasetColumn[] }>;
  /** Imported artifacts' shapes, attached as their own schemas (see RunInput.imports). */
  imports?: Record<string, Record<string, { columns: DatasetColumn[] }>>;
  queries: SqlQuery[];
  /** An ARRAY on the wire — a Set serialises to `{}` and binds nothing. */
  paramNames: string[];
}
export interface DryRunResult {
  errors: Array<{ name: string; error: string }>;
  /** The columns each query would produce, for the ones that prepared. */
  columns: Record<string, DatasetColumn[]>;
}
export interface DryRunMutationsInput {
  tables: Record<string, { columns: DatasetColumn[] }>;
  mutations: Array<{
    name: string;
    sql: string;
    target: string;
    /** Explicit local table name; absent preserves the existing ref_<target> convention. */
    tableName?: string;
    /** Shape of `$_row`; dry runs bind a typed STRUCT whose fields are NULL. */
    row?: { columns: DatasetColumn[] };
    /** Types that hold for this mutation alone (`_value` is typed by the cell it edits); merged over the shared `paramTypes`. */
    paramTypes?: Record<string, ColumnType>;
  }>;
  paramNames: string[];
  /** Declared types of scalar params; a dry run binds typed NULLs for these. */
  paramTypes?: Record<string, ColumnType>;
}
export interface DryRunMutationsResult { errors: Array<{ name: string; error: string }> }

export interface SqlService {
  run(input: RunInput): Promise<Record<string, QueryOutcome>>;
  runMany(input: RunManyInput): Promise<Array<Record<string, QueryOutcome>>>;
  mutate(input: MutationInput): Promise<MutationOutcome>;
  dryRun(input: DryRunInput): Promise<DryRunResult>;
  dryRunMutations(input: DryRunMutationsInput): Promise<DryRunMutationsResult>;
}

/**
 * ONE PAGE READ'S SQL BUDGET: a page's `sql` read. Inputs (inline and
 * dataset rows together) are bounded before the engine runs; `timeoutMs` is each `run`'s engine interrupt and
 * `wallMs` the whole call, dataset reads included.
 */
export const SQL_READ_LIMITS = Object.freeze({
  rows: 10000,
  cells: 1000000,
  tables: 64,
  queries: 64,
  params: 240,
  sqlBytes: 64000,
  /** Serialized materialized SQL input and internal dependency-answer work budget. */
  inputBytes: 8 * 1024 * 1024,
  /** Serialized returned table-name/outcome record, after the requested projection.
   * Four MiB admits bounded stored-data responses; the independent input/work ceiling remains eight MiB. */
  outputBytes: 4 * 1024 * 1024,
  timeoutMs: 5000,
  wallMs: 20000,
});

/** The wire: one POST per method. `serveSql`/`sqlClient` (the sql package) implement exactly this. */
export const SQL_ROUTES = { run: '/run', runMany: '/run-many', mutate: '/mutate', dryRun: '/dry-run', dryRunMutations: '/dry-run-mutations' } as const;

/** End-to-end mutation response budget, including persistence and downstream execution. */
export const MUTATION_REPLY_TIMEOUT_MS = 200_000;

/**
 * The rows of one query that TRAVEL — to the island, through the query route,
 * from a browser run: the display window, with `totalRows` and paging for the
 * rest. Only what is shipped is windowed; a query reading another inside one
 * engine run reads its whole result.
 */
export const DISPLAY_ROWS = 1_000;
