/**
 * A DOCUMENT'S DATA HALF, COMPILED. Publishing turns the `<Helmet>`
 * declarations into typed functions and one dependency graph, using SQLite's
 * own report of what every statement reads and writes
 * (@artifactbin/contracts StatementAnalysis). Everything downstream — the
 * server that executes queries, the runtime that decides what to re-run and
 * where, the view that binds results — reads this record and never SQL text.
 *
 * Types only. The compiler (lib/story/compile-dataflow) produces it; it is
 * stored in `meta.parsedArtifact` and shipped to the runtime in the island.
 */
import type { ColumnType, DatasetColumn } from '@artifactbin/contracts';
import type { Scalar, Row } from './dataflow';

/**
 * Built-in inputs; names start with `_` so no author name can collide. `_me`,
 * `_now` and `_tz` come from the platform. `_row.<column>` and `_value` come
 * from the control that runs a mutation: the row it sits in, and the new value
 * an editing cell holds.
 */
export type BuiltinInput = '_me.id' | '_me.role' | '_now' | '_tz' | '_value' | `_row.${string}`;
/** Built-in tables. `_me` is the reader as a one-row table; `_members` the artifact's accepted members. */
export type BuiltinTable = '_me' | '_members';

export interface CompiledImport {
  /** The schema name SQL reads it by: `<Import name="bookings">` → `bookings.rows`. */
  name: string;
  /** Dataset artifact id. */
  ref: string;
  tables: Array<{ name: string; columns: DatasetColumn[] }>;
}

export interface CompiledValue {
  name: string;
  kind: 'scalar' | 'table';
  type: ColumnType | 'table';
  default: Scalar;
  /** Inline rows for a table value. */
  rows?: Row[];
  columns?: DatasetColumn[];
  /** `false`: never read from or written to the address. */
  url?: false;
  /** A user picker's options: the dataset (`source="ref:<id>"`) and user column it draws from, and that column's constraints. */
  source?: string;
  column?: string;
  constraints?: import('@artifactbin/contracts').UserConstraints;
}

/** What a query or mutation depends on, by kind. Every name is declared or built in. */
export interface CompiledReads {
  imports: string[];
  queries: string[];
  /** Scalar and table values, by name. */
  values: string[];
  /** Built-in inputs (`_me.id`, `_now`) and tables (`_members`). */
  builtins: Array<BuiltinInput | BuiltinTable>;
}

export interface CompiledQuery {
  name: string;
  /** `sqlite` runs wherever its reads allow; `postgres` runs inside the connected database, on the server. */
  engine: 'sqlite' | 'postgres';
  /** The connected Postgres dataset id, for `engine: 'postgres'`. */
  source?: string;
  /** Executable SQL: built-in fields rewritten to plain parameters (`$_me.id` → `$_me__id`). */
  sql: string;
  /** Parameters in first-appearance order, by logical name (`day`, `_me.id`). */
  params: string[];
  reads: CompiledReads;
  /** The signature's result: every output column and its type (null when no type can be known). */
  columns: Array<{ name: string; type: ColumnType | null }>;
  /** Source span of the declaration, for errors that point at the markup. */
  start: number;
  end: number;
}

export interface CompiledMutation {
  name: string;
  sql: string;
  /** What it writes: an imported dataset table, or a local table value. */
  target: { import: string; table: string } | { local: string };
  /**
   * The signature: every parameter that is not a built-in, filled from the
   * page value of the same name unless the control's `args=` names another
   * source. Row fields and the edited value are built-ins (`_row.id`, `_value`)
   * in `reads.builtins`, supplied by the control.
   */
  args: Array<{ name: string; type: ColumnType | null }>;
  reads: CompiledReads;
  /**
   * What its controls supply, typed by where they sit: each `$_row.<column>`
   * by the row's table, `$_value` by the column an editing cell edits.
   * Absent when the statement reads neither.
   */
  rowTypes?: Record<string, ColumnType | null>;
  valueType?: ColumnType | null;
  expectedAffected?: number;
  /** Page values put back to their defaults after a successful write. */
  reset?: string[];
  start: number;
  end: number;
}

export interface CompiledDataflow {
  imports: CompiledImport[];
  values: CompiledValue[];
  /** In dependency order: a query appears after every query it reads. */
  queries: CompiledQuery[];
  mutations: CompiledMutation[];
}

export const EMPTY_COMPILED_DATAFLOW: CompiledDataflow = { imports: [], values: [], queries: [], mutations: [] };
