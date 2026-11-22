/** Stored-flow values and native dataset request typing. No document language is compiled here. */

import type { DatasetColumn } from './dataset-shape';
export type Scalar=string|number|boolean|null;
export type Row=Record<string,unknown>;
export interface TableResult {
  rows: Row[];
  columns: DatasetColumn[];
  /** Present only when the result was cut at the row cap. */
  truncated?: boolean;
  /** The real row count when known (before the cap). */
  totalRows?: number;
}
