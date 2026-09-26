/**
 * WHAT A STATEMENT TOUCHES, as SQLite reports it while preparing the
 * statement (its authorizer callback plus statement metadata). No rows are
 * read. The document compiler derives every dependency, signature and
 * placement decision from this record, so no other code parses SQL text.
 */
import type { ColumnType } from './sql';

export type StatementKind = 'select' | 'insert' | 'update' | 'delete';

export interface ColumnRead {
  /** The attached schema: an `<Import>` name, `main` for document tables, or `_` built-ins. */
  schema: string;
  table: string;
  /** Empty when the statement uses the table without reading a column (`count(*)`, `exists (select 1 …)`). */
  column: string;
}

export interface TableWrite {
  schema: string;
  table: string;
  op: 'insert' | 'update' | 'delete';
  /** The columns an UPDATE assigns; absent for INSERT and DELETE. */
  columns?: string[];
}

export interface OutputColumn {
  name: string;
  /**
   * The source column's declared type when the output is a direct column
   * reference (SQLite `decltype`), else null. A `user` column keeps its type
   * only through a direct projection.
   */
  declaredType: ColumnType | null;
  /**
   * The loaded column it directly references, when there is one — what lets
   * the compiler type a projection of an earlier query's result by that
   * query's own (compiled) column type.
   */
  origin?: { schema: string; table: string; column: string };
}

export interface StatementAnalysis {
  kind: StatementKind;
  /** Base-table columns read. Reads of CTEs and subqueries are not included. */
  reads: ColumnRead[];
  writes: TableWrite[];
  /** Function names called, lower-cased and deduplicated. */
  functions: string[];
  /** Parameter names in first-appearance order, without the `$`, as written in the executable SQL. */
  params: string[];
  columns: OutputColumn[];
}

/**
 * A field of a built-in row (`$_me.id`) is written with a dot, which SQLite
 * parameters cannot contain. The compiler rewrites it to this parameter name
 * before SQLite sees the statement, and binds it by the same name.
 */
export const paramSqlName = (logical: string): string => logical.replace('.', '__');
export const paramLogicalName = (sqlName: string): string => sqlName.replace('__', '.');
