import type {
  DatasetCallContext,
  DatasetReadService,
  DatasetReadRequest,
} from "../contracts.ts";
import type {
  ColumnType,
  Scalar,
  TableResult,
} from "../sql/engine/sql-contracts.ts";
export interface QueryTableData {
  schema: string;
  table: string;
  columns: import("../sql/engine/sql-contracts.ts").DatasetColumn[];
  rows: Record<string, unknown>[];
}
/** Immutable source-owned declarations. No SQL, aliases, or bindings come from a runner request. */
export interface RegisteredServerQuery {
  name: string;
  sql: string;
  dependencies: readonly string[];
}
export interface RegisteredServerQueryPlan {
  queries: readonly RegisteredServerQuery[];
  scalars: Readonly<Record<string, { type: ColumnType; default: Scalar }>>;
  tables: readonly QueryTableData[];
  imports: readonly {
    schema: string;
    table: string;
    read: Pick<DatasetReadRequest, "binding" | "schema" | "table">;
  }[];
}
export interface ServerQueryAnswer {
  tables: Record<string, TableResult>;
  errors: Record<string, string>;
}
export interface DatasetQueryJob {
  kind: "dataset-query";
  engineVersion: "sqlite-3.53.4-read-v1";
  input: {
    tables: QueryTableData[];
    queries: { name: string; sql: string }[];
    params: Record<string, Scalar>;
    paramTypes: Record<string, ColumnType>;
  };
}
export interface RegisteredServerQueryPorts {
  /** Resolve from the saved backend/page/version, never by a runner-provided identifier. */
  registry(
    context: DatasetCallContext,
  ): Promise<RegisteredServerQueryPlan | null>;
  /** Fresh page access and exact saved backend/page/source version, including after execution. */
  authorize(context: DatasetCallContext): Promise<boolean>;
  /** Server-resolved legacy reader identity, invocation instant and validated zone. Never request values. */
  platform(
    context: DatasetCallContext,
  ): Promise<{ userId: string | null; now: string; tz: string }>;
  reads: DatasetReadService;
  execute(
    job: DatasetQueryJob,
    signal?: AbortSignal,
  ): Promise<ServerQueryAnswer>;
}
export interface RegisteredServerQueryService {
  execute(
    context: DatasetCallContext,
    request: unknown,
    signal?: AbortSignal,
  ): Promise<ServerQueryAnswer>;
}
export const SERVER_QUERY_LIMITS = Object.freeze({
  inputBytes: 8 * 1024 * 1024,
  outputBytes: 1024 * 1024,
  maxRows: 10000,
  maxCells: 1000000,
  maxTables: 64,
  maxQueries: 64,
  maxParams: 240,
  maxSqlBytes: 64000,
  timeoutMs: 5000,
  wallMs: 20000,
});
