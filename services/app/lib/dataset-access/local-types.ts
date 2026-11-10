import type {DatasetColumn} from '@artifactbin/contracts';
/** Local preview mutations stay in this session until the caller explicitly saves an export. */
export interface LocalDatasetTable {schema:string;name:string;columns:DatasetColumn[];rows:Record<string,unknown>[];rowIds?:readonly string[]}
