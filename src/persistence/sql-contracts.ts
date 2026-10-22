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
export interface SqlDatabase {
  transaction<T>(work: (client: SqlClient) => Promise<T>): Promise<T>;
}
export interface SqlDatabaseOptions {
  pool: SqlPool;
  initialize: () => Promise<void>;
  statementTimeoutMs: number;
  lockTimeoutMs?: number;
}
