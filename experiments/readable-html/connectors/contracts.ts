export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
export interface Caller { userId: string; tenantId: string; grants: readonly string[] }
export interface Operation { operation: string; input: Json }
export interface Request extends Operation { resource: string }
export type ConnectorCode = 'DENIED' | 'INVALID' | 'TIMEOUT' | 'CANCELLED' | 'UNAVAILABLE' | 'CONFLICT' | 'CLOSED';
export interface ConnectorFailure extends Error { code: ConnectorCode; outcome: 'unknown' }
export interface ConnectorHost {
  invoke(caller: Caller, request: Request, signal?: AbortSignal): Promise<Json>;
  transaction(caller: Caller, resource: string, operations: Operation[], signal?: AbortSignal): Promise<Json[]>;
  close(): Promise<void>;
}
// Bindings are host deployment configuration; never provided by app/isolate callers.
export interface SqlOperation { text: string; params(caller: Caller, input: Json): Json[] }
export interface SqlBinding { kind: 'postgres'; pool: unknown; operations: Record<string, SqlOperation> }
export interface HttpOperation { path: string; method: 'POST' }
export interface HttpBinding { kind: 'http'; origin: string; token: string; operations: Record<string, HttpOperation> }
export type Binding = SqlBinding | HttpBinding;
