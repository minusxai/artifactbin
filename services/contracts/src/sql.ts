/**
 * THE SQL SERVICE — DuckDB in a process of its own, or in this one. Stateless
 * by construction: every call carries the tables BY VALUE and answers rows;
 * nothing persists between calls, so a document's dependent queries travel in
 * ONE `run` (a later query may read an earlier one's result by name).
 *
 * Four methods, not two: the dry-runs are the publish-time check that refuses
 * a bad query with a 400 instead of a blank chart at render, and they cross
 * the same wire as the other two, so no caller needs DuckDB in its own process.
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
  /** Set when the failure was our timeout rather than the author's SQL. */
  timedOut?: boolean;
  /** Set when a WRITE would have taken the table past the row cap (nothing was stored). */
  full?: boolean;
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

/** An isolated DuckDB catalog. Only these logical tables and columns are exposed.
 * Models are native read SQL, bound lazily so unused drafts cannot break a read. */
export interface SqlReadCatalog {
  defaultSchema: string;
  tables: Array<{ schema: string; name: string; columns: DatasetColumn[]; source?: string; sql?: string }>;
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
  /** Read only a window of ONE query's result (its dependencies still run whole). */
  page?: { name: string } & QueryPage;
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
  /** Original row values, exposed to SQL as the native typed STRUCT `$_row`. */
  row?: { columns: DatasetColumn[]; values: Record<string, Scalar> };
  /** Required changed-row count for server-controlled writes such as cell edits. */
  expectedAffected?: number;
  /** The most rows the table may hold AFTER the write. */
  limit?: number;
  timeoutMs?: number;
}
/** A write that ran: the table's new rows and how many rows the statement touched. */
export interface MutationResult extends TableResult {
  affected: number;
  analysis?: MutationAnalysis;
  /** Actual assigned user fields, after expressions/presets. App validates before commit. */
  userWrites?: Row[];
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
  mutate(input: MutationInput): Promise<MutationOutcome>;
  dryRun(input: DryRunInput): Promise<DryRunResult>;
  dryRunMutations(input: DryRunMutationsInput): Promise<DryRunMutationsResult>;
}

/** The wire: one POST per method. `serveSql`/`sqlClient` (the sql package) implement exactly this. */
export const SQL_ROUTES = { run: '/run', mutate: '/mutate', dryRun: '/dry-run', dryRunMutations: '/dry-run-mutations' } as const;

/** End-to-end mutation response budget, including persistence and downstream execution. */
export const MUTATION_REPLY_TIMEOUT_MS = 200_000;
