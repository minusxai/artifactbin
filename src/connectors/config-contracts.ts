import type { ConnectorHost, PgPool } from "./contracts.ts";
export type ParameterSelector =
  | { from: "tenant" | "subject" }
  | { from: "input"; path: readonly (string | number)[] };
export interface ResourceGrant {
  documentId: string;
  backendVersion: string;
  resource: string;
  namedOperations: readonly string[];
}
export interface ResourceConfiguration {
  resources: Record<
    string,
    | {
        kind: "http";
        origin: string;
        tokenEnv: string;
        operations: Record<string, { path: string; method: "POST" }>;
      }
    | {
        kind: "postgres";
        connectionStringEnv: string;
        operations: Record<
          string,
          { text: string; params: readonly ParameterSelector[] }
        >;
      }
  >;
  grants: readonly ResourceGrant[];
}
export interface ConfiguredPgPool extends PgPool {
  on?(event: "error", listener: (error: unknown) => void): unknown;
}
export interface ResourceConfigOptions {
  env?: Record<string, string | undefined>;
  allowLoopbackHttp?: boolean;
  poolFactory?: (options: {
    connectionString: string;
    max: number;
    connectionTimeoutMillis: number;
    idleTimeoutMillis: number;
    statement_timeout: number;
    query_timeout: number;
  }) => ConfiguredPgPool;
}
export interface ConfiguredResources {
  host: ConnectorHost;
  grants: readonly ResourceGrant[];
}
