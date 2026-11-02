/** Stored-flow values and native dataset request typing. No document language is compiled here. */
import {isTimestamp} from '@artifactbin/utils/shape';
import type {ColumnType,DatasetColumn} from './dataset-shape';
export type Scalar=string|number|boolean|null;
export type Row=Record<string,unknown>;
export const DECL_NAME_RE=/^[A-Za-z_]\w*$/;
const DATE_RE=/^\d{4}-\d{2}-\d{2}([T ].*)?$/;
export interface TableResult {
  rows: Row[];
  columns: DatasetColumn[];
  /** Present only when the result was cut at the row cap. */
  truncated?: boolean;
  /** The real row count when known (before the cap). */
  totalRows?: number;
}

/**
 * The document's data at one instant: every scalar's current value and every
 * table's current rows, keyed by declared name. Built server-side at render
 * (defaults + a fresh run of every query) and thereafter owned by the runtime
 * store, which re-runs the queries a changed value feeds.
 */
export interface DataflowState {
  /** Per-viewer mutation availability: null permits, a message explains refusal. Missing means not yet checked. */
  mutationAccess?: Record<string, string | null>;
  userOptions?: Record<string, import('@artifactbin/contracts').UserOption[]>;
  /** The people this document may name, by id (lib/datasets/user-fields people). */
  people?: Record<string,import('@artifactbin/contracts').PersonCard>;
  values: Record<string, Scalar>;
  tables: Record<string, TableResult>;
  /** Queries that did not run, by name → the engine's message (shown in place of the embed). */
  errors: Record<string, string>;
}


export const scalarMatches = (v: unknown, t: ColumnType): boolean => {
  if (v === null) return true;
  switch (t) {
    case 'number': return typeof v === 'number' && Number.isFinite(v);
    case 'boolean': return typeof v === 'boolean';
    case 'timestamp': return isTimestamp(v);
    case 'date': return typeof v === 'string' && DATE_RE.test(v);
    case 'user':
    case 'string': return typeof v === 'string';
  }
};
