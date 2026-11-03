import type { ArtifactFormat } from '@artifactbin/contracts';
import type { DatasetColumn, Row } from '@/lib/dataflow';

/** Public, versioned catalog of stored tables and SQL models. */
export interface DatasetTable {
  schema: string;
  name: string;
  columns: DatasetColumn[];
  sql?: string;
  objectKey?: string;
  /** Retired connected-Postgres fields: only lib/page-graphql and lib/registered-page-queries still name them, and they go with those modules. */
  source?: { schema: string; table: string };
  modelCellId?: string;
}
/**
 * RETIRED: connected Postgres datasets. A catalog is always `stored`; `postgres`, `connection` and `notebook`
 * remain in the type only because lib/page-graphql, lib/registered-page-queries and lib/dataset-graphql still
 * compare against them, and are deleted with those modules. Nothing creates, reads or executes one.
 */
export type DatasetConnection = Omit<PostgresConfig, 'password'> & { passwordSecretId: string };
interface DatasetNotebook { cells: Array<{ id: string; name: string; sql: string }> }
export interface DatasetCatalog {
  kind: 'postgres' | 'stored';
  connection?: DatasetConnection;
  notebook?: DatasetNotebook;
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
  /** Throws the uniform 404 when the catalog cannot be viewed. */
  catalog(catalog: DatasetCatalog): DatasetCatalog;
  rows(table: DatasetTable, rows: Record<string, unknown>[]): Record<string, unknown>[];
}
export interface CatalogInput {
  kind: 'stored';
  defaultSchema?: string;
  refreshSeconds?: number;
  tables: Array<{ schema: string; name: string; columns?: Array<string|DatasetColumn>; sql?: string; rows?: Row[] }>;
}
/** RETIRED with DatasetConnection above. */
export interface PostgresConfig {
  host: string;
  port: number;
  database: string;
  username: string;
  password: string;
  ssl: boolean;
}
/**
 * The fields of the artifact row hosting a dataset that the engine reads. The row type itself
 * belongs to lib/artifacts, which sits above datasets; any artifact row satisfies this shape.
 */
export interface DatasetHost { id: string; format: ArtifactFormat; meta: Record<string, unknown>; dataset_policy?: unknown }
