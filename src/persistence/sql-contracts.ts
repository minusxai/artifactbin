/** The application pool and consumers share this declared capacity. */
export const DEFAULT_SQL_POOL_CAPACITY = 10;
/** SQL-only adapter boundary. Domain operations must expose semantic ports instead. */
export interface SqlClient {
  query(
    text: string,
    values?: readonly unknown[],
  ): Promise<{ rows: Record<string, unknown>[]; rowCount: number | null }>;
  release(discard?: Error | boolean): void;
}
export interface SqlPool {
  connect(): Promise<SqlClient>;
}
export interface SqlTransactionOptions {
  /** Opt-in end-to-end budget, including initialization and pool wait. */
  readonly timeoutMs: number;
  /** Aborts waiting and discards an active driver connection. Server work is additionally bounded by statement_timeout. */
  readonly signal?: AbortSignal;
}
export interface SqlDatabase {
  /** Actual maximum connection count; injected adapters default to DEFAULT_SQL_POOL_CAPACITY. */
  readonly poolCapacity?: number;
  transaction<T>(
    work: (client: SqlClient) => Promise<T>,
    options?: SqlTransactionOptions,
  ): Promise<T>;
}
export interface SqlDatabaseOptions {
  pool: SqlPool;
  /** Must match the underlying driver pool maximum. */
  poolCapacity?: number;
  initialize: () => Promise<void>;
  statementTimeoutMs: number;
  lockTimeoutMs?: number;
}
