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
/**
 * THE ROLE VIEW a catalog read runs over (lib/dataset-permissions `datasetView` builds it): the catalog
 * with the columns this caller may not see removed, and each stored table's rows as they may see them.
 * `executeCatalog` requires one, or an explicit null (owner, editor, a role that reads everything, or a
 * host-owned read such as model probing), so no door reads rows without deciding.
 */
export interface CatalogRowView {
  /** The role, policy revision, session and rules this view applies: part of every cache key over it. */
  identity: string;
  /** Throws the uniform 404 when the catalog cannot be viewed (a connected source under a restricting rule). */
  catalog(catalog: DatasetCatalog): DatasetCatalog;
  rows(table: DatasetTable, rows: Record<string, unknown>[]): Record<string, unknown>[];
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
