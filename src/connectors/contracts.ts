export type Json =
  | null
  | boolean
  | number
  | string
  | Json[]
  | { [key: string]: Json };
export interface ConnectorGrant {
  readonly resource: string;
  readonly operation: string;
}
export interface ConnectorCaller {
  readonly tenant: string;
  readonly subject: string;
  readonly grants: readonly ConnectorGrant[];
}
export interface ConnectorOperation {
  operation: string;
  input: Json;
}
export interface ConnectorRequest extends ConnectorOperation {
  resource: string;
}
export type ConnectorCode =
  | "DENIED"
  | "INVALID"
  | "TIMEOUT"
  | "CANCELLED"
  | "UNAVAILABLE"
  | "CONFLICT"
  | "CLOSED";
export interface PgClient {
  query(text: string, values?: unknown[]): Promise<{ rows: unknown[] }>;
  release(destroy?: boolean): void;
}
export interface PgPool {
  connect(): Promise<PgClient>;
  end(): Promise<void>;
}
export interface SqlOperation {
  text: string;
  params(caller: ConnectorCaller, input: Json): Json[];
}
export interface SqlBinding {
  kind: "postgres";
  pool: PgPool;
  operations: Record<string, SqlOperation>;
}
export interface HttpOperation {
  path: string;
  method: "POST";
}
export interface HttpBinding {
  kind: "http";
  origin: string;
  token: string;
  operations: Record<string, HttpOperation>;
}
export type ConnectorBinding = SqlBinding | HttpBinding;
export interface ConnectorOptions {
  timeoutMs?: number;
  maxBytes?: number;
  maxActive?: number;
  maxPendingAcquisitions?: number;
  maxTransactionOperations?: number;
  allowLoopbackHttp?: boolean;
}
export interface ConnectorHost {
  invoke(
    caller: ConnectorCaller,
    request: ConnectorRequest,
    signal?: AbortSignal,
  ): Promise<Json>;
  transaction(
    caller: ConnectorCaller,
    resource: string,
    operations: readonly ConnectorOperation[],
    signal?: AbortSignal,
  ): Promise<Json[]>;
  close(): Promise<void>;
}
