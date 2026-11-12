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
