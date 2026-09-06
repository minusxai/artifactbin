import type { DatasetColumn } from '@/lib/story/dataset-shape';
import type { Row } from '@/lib/story/dataflow';

/** Public, versioned catalog. Credentials never appear here. */
export interface DatasetTable {
  schema: string;
  name: string;
  columns: DatasetColumn[];
  source?: { schema: string; table: string };
  sql?: string;
  objectKey?: string;
  modelCellId?: string;
}
/** Connection configuration belongs to the dataset; only this ID names a secret. */
export type DatasetConnection = Omit<PostgresConfig, 'password'> & { passwordSecretId: string };
export interface NotebookCell { id: string; name: string; sql: string }
export interface DatasetNotebook { cells: NotebookCell[] }
export interface DatasetCatalog {
  kind: 'postgres' | 'stored';
  connection?: DatasetConnection;
  notebook?: DatasetNotebook;
  /** Server execution metadata; never part of a reader's public catalog. */
  notebookSources?: DiscoveredTable[];
  defaultSchema: string;
  tables: DatasetTable[];
  refreshSeconds: number;
}
export interface CatalogInput {
  kind: 'postgres' | 'stored';
  connection?: DatasetConnection;
  notebook?: DatasetNotebook;
  defaultSchema?: string;
  refreshSeconds?: number;
  tables: Array<{ schema: string; name: string; source?: {schema:string;table:string}; columns?: string[]; sql?: string; rows?: Row[]; modelCellId?: string }>;
}
export interface PostgresConfig {
  host: string;
  port: number;
  database: string;
  username: string;
  password: string;
  ssl: boolean;
}
export interface DiscoveredTable { schema: string; name: string; columns: DatasetColumn[] }
