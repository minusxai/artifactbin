import type { PGlite } from '@electric-sql/pglite';
import {
  CompiledQuery,
  PostgresAdapter,
  PostgresIntrospector,
  PostgresQueryCompiler,
  type DatabaseConnection,
  type Dialect,
  type Driver,
  type QueryResult,
  type TransactionSettings,
} from 'kysely';

/** The small Kysely bridge the proxy needs; code-generation belongs in neither runtime nor install. */
export function pgliteDialect(client: PGlite): Dialect {
  return {
    createAdapter: () => new PostgresAdapter(),
    createDriver: () => new PGliteDriver(client),
    createIntrospector: (db) => new PostgresIntrospector(db),
    createQueryCompiler: () => new PostgresQueryCompiler(),
  };
}

class PGliteDriver implements Driver {
  constructor(private readonly client: PGlite) {}

  async init(): Promise<void> {}
  async acquireConnection(): Promise<DatabaseConnection> { return new PGliteConnection(this.client); }
  async beginTransaction(connection: DatabaseConnection, _settings: TransactionSettings): Promise<void> { await connection.executeQuery(CompiledQuery.raw('BEGIN')); }
  async commitTransaction(connection: DatabaseConnection): Promise<void> { await connection.executeQuery(CompiledQuery.raw('COMMIT')); }
  async rollbackTransaction(connection: DatabaseConnection): Promise<void> { await connection.executeQuery(CompiledQuery.raw('ROLLBACK')); }
  async releaseConnection(_connection: DatabaseConnection): Promise<void> {}
  async destroy(): Promise<void> { await this.client.close(); }
}

class PGliteConnection implements DatabaseConnection {
  constructor(private readonly client: PGlite) {}

  async executeQuery<R>(compiledQuery: CompiledQuery): Promise<QueryResult<R>> {
    return await this.client.query<R>(compiledQuery.sql, [...compiledQuery.parameters]) as unknown as QueryResult<R>;
  }

  async *streamQuery<R>(): AsyncIterableIterator<QueryResult<R>> {
    throw new Error('PGlite does not support streaming.');
  }
}

