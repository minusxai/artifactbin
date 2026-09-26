/**
 * THE SQLITE ENGINE AS A SERVICE, in this thread (`@artifactbin/sql/sqlite`):
 * `@artifactbin/sql/core` behind the `SqlService` contract, with the caps rule
 * every composition applies — a request may lower the row cap and the
 * deadline, never raise them. Synchronous underneath: a call holds the thread
 * it runs on, which is right for a single-user process (the CLI, a test) and
 * wrong for a server, which runs the same engine in worker threads
 * (`@artifactbin/sql/local`).
 */
import type { SqlService } from '@artifactbin/contracts';
import { queryBounds } from './bounds';
import { DEFAULT_CAPS, type SqlCaps } from './caps';
import type { SqlExtensions } from './extensions';
import { loadSqlite } from './sqlite/index';

export function createSqliteSql(opts: Partial<SqlCaps> = {}, extensions: SqlExtensions = {}): SqlService {
  const caps: SqlCaps = { ...DEFAULT_CAPS, ...opts };
  return {
    run: async (input) => {
      const { limit, timeoutMs } = queryBounds(input, caps);
      return (await loadSqlite()).run(input, { limit, timeoutMs, pageLimit: queryBounds(input, caps, input.page).limit });
    },
    mutate: async (input) => (await loadSqlite()).mutate(input, queryBounds(input, caps), extensions),
    dryRun: async (input) => (await loadSqlite()).dryRun(input),
    dryRunMutations: async (input) => (await loadSqlite()).dryRunMutations(input, extensions),
  };
}
export type { SqlCaps } from './caps';
export type { SqlExtensions } from './extensions';
