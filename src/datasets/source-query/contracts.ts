import type { DatasetCallContext } from "../contracts.ts";
import type {
  DatasetColumn,
  TableResult,
  Scalar,
  ColumnType,
} from "../sql/engine/sql-contracts.ts";
import type { PgPool } from "../../connectors/contracts.ts";
/** Trusted migration input. SQL and resource handles never enter a page binding. */
export interface MigrationSourceQueryRegistration {
  pageLegacyId: string;
  pageVersion: number;
  name: string;
  sourceRef: string;
  resource: string;
  /** Authored query identity; executionSql is trusted notebook-expanded SQL when required. */
  sql: string;
  sqlSha256: string;
  executionSql?: string;
  executionSqlSha256?: string;
  params: Record<string, ColumnType>;
  columns: DatasetColumn[];
}
/** Immutable original saved external query authority; never grants the generic viewer capability. */
export interface HistoricalSourceQueryAuthority {
  kind: "standalone-external-history-v1";
  sourceNamespace: string;
  pageLegacyId: string;
  pageId: string;
  pageVersion: number;
  headVersion: number;
  artifactSha256: string;
  editId: string;
}
export interface SourceQueryRegistration
  extends MigrationSourceQueryRegistration {
  backendId: string;
  backendVersion: string;
  pageId: string;
  sourceNamespace: string;
  historicalAuthority?: HistoricalSourceQueryAuthority;
}
export interface SourceQueryRequest {
  name: string;
  valuesJson: string;
  offset: number;
  limit: number;
  sortJson?: string | null;
}
export interface SourceQueryAuthority {
  generation: string;
  userId: string | null;
  now: string;
  tz: string;
}
export interface SourceQueryPorts {
  registry(
    context: DatasetCallContext,
    name: string,
    signal?: AbortSignal,
  ): Promise<SourceQueryRegistration | null>;
  authority(
    context: DatasetCallContext,
    signal?: AbortSignal,
  ): Promise<SourceQueryAuthority | null>;
  pool(resource: string): PgPool | undefined;
}
export interface SourceQueryService {
  availability(
    context: DatasetCallContext,
    input: unknown,
    signal?: AbortSignal,
  ): Promise<boolean>;
  query(
    context: DatasetCallContext,
    input: unknown,
    signal?: AbortSignal,
  ): Promise<TableResult>;
}
export type SourceQueryValues = Record<string, Scalar>;
/** Private operator JSON. Values refer only to process environment keys, never URLs. */
export interface SourceQueryResourceConfiguration {
  resources: Record<
    string,
    | { connectionStringEnv: string; caEnv: string }
    | { connectionStringEnv: string; ca: "system-default-roots" }
  >;
}
