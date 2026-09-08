/**
 * THE SQL SERVICE — DuckDB in a process of its own, or in this one. Stateless
 * by construction: every call carries the tables BY VALUE and answers rows;
 * nothing persists between calls, so a document's dependent queries travel in
 * ONE `run` (a later query may read an earlier one's result by name).
 *
 * Four methods, not two: the dry-runs are the publish-time check that refuses
 * a bad query with a 400 instead of a blank chart at render; leaving them
 * in-process made a DuckDB-less image crash on every write.
 */
export type Scalar = string | number | boolean | null;
export type Row = Record<string, unknown>;
export type ColumnType = 'string' | 'number' | 'boolean' | 'date';
export interface DatasetColumn { name: string; type: ColumnType }

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
  /** Stable machine-readable reason for a guarded edit cardinality failure. */
  code?: 'row_changed' | 'row_not_unique';
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

export interface RunInput {
  /** Registered tables by SQL name — `ref_<id>` for datasets, the declared name for inline tables. */
  tables: Record<string, { rows: Row[]; columns: DatasetColumn[] }>;
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
  /** The ONE table the statement may touch — the dataset, under its `ref_<id>` name. */
  table: { name: string; rows: Row[]; columns: DatasetColumn[] };
  sql: string;
  params: Record<string, Scalar>;
  /** Original row values, exposed to SQL as the native typed STRUCT `$_row`. */
  row?: { columns: DatasetColumn[]; values: Record<string, Scalar> };
  /** Required changed-row count for server-controlled writes such as cell edits. */
  expectedAffected?: number;
  /** The most rows the table may hold AFTER the write. */
  limit?: number;
  timeoutMs?: number;
}
/** A write that ran: the table's new rows and how many rows the statement touched. */
export interface MutationResult extends TableResult { affected: number }
export type MutationOutcome = MutationResult | QueryFailure;

export interface DryRunInput {
  tables: Record<string, { columns: DatasetColumn[] }>;
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
  }>;
  paramNames: string[];
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
