import type { DatasetCatalog, DatasetNotebook } from './types';
import type { Scalar } from '@/lib/story/dataflow';

/** Compile one named cell against raw sources and earlier cells, honoring SQL scopes. */
export function compileNotebookSql(_sources: DatasetCatalog, _notebook: DatasetNotebook, _cellId: string): { sql: string; values: Scalar[] } {
  throw new Error('dataset-notebook: implement');
}
