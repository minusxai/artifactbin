import type { ArtifactFormat } from '@artifactbin/contracts';
import type { DatasetColumn, Row } from '@/lib/dataflow';

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
  tables: Array<{ schema: string; name: string; source?: {schema:string;table:string}; columns?: Array<string|DatasetColumn>; sql?: string; rows?: Row[]; modelCellId?: string }>;
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
/**
 * The fields of the artifact row hosting a dataset that the engine reads. The row type itself
 * belongs to lib/artifacts, which sits above datasets; any artifact row satisfies this shape.
 */
export interface DatasetHost { id: string; format: ArtifactFormat; meta: Record<string, unknown>; dataset_policy?: unknown }
