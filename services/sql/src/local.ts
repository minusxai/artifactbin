/**
 * THE ENGINE FOR A SERVER PROCESS (`@artifactbin/sql/local`): the SQLite
 * engine in a small pool of worker threads (./pool.ts), so no statement ever
 * runs on the process's own event loop. Import `@artifactbin/sql` for the
 * client and the server shell; import this only from a composition root.
 */
import type { SqlService } from '@artifactbin/contracts';
import type { SqlCaps } from './caps';
import { createSqlitePool, type SqlPoolOptions } from './pool';

export function createSql(opts: Partial<SqlCaps> = {}, pool: SqlPoolOptions = {}): SqlService & { close(): Promise<void> } {
  return createSqlitePool(opts, pool);
}
export type { SqlCaps } from './caps';
export type { SqlPoolOptions } from './pool';
export type { SqlExtensions } from './extensions';
