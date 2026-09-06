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
}
export interface DatasetCatalog {
  kind: 'postgres' | 'stored';
  connectionId?: string;
  defaultSchema: string;
  tables: DatasetTable[];
  refreshSeconds: number;
}
export interface CatalogInput {
  kind: 'postgres' | 'stored';
  connectionId?: string;
  defaultSchema?: string;
  refreshSeconds?: number;
  tables: Array<{ schema: string; name: string; source?: {schema:string;table:string}; columns?: string[]; sql?: string; rows?: Row[] }>;
}
export interface PostgresConfig {
  host: string;
  port: number;
  database: string;
  username: string;
  password: string;
  ssl: boolean;
}
export interface ConnectionSummary {
  id: string;
  name: string;
  host: string;
  port: number;
  database: string;
  username: string;
  ssl: boolean;
}
export interface DiscoveredTable { schema: string; name: string; columns: DatasetColumn[] }
