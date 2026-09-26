/**
 * THE SQLITE ENGINE AS A SERVICE, in this process (`@artifactbin/sql/sqlite`):
 * `@artifactbin/sql/core` behind the `SqlService` contract, with the caps rule
 * `createSql` (./local, DuckDB) applies — a request may lower the row cap and
 * the deadline, never raise them. Its own entry, so importing the DuckDB
 * composition does not bundle the wasm engine, and the reverse.
 */
import type { SqlService } from '@artifactbin/contracts';
import { queryBounds } from './bounds';
import { DEFAULT_CAPS, type SqlCaps } from './caps';
import { loadSqlite } from './sqlite/index';

export function createSqliteSql(opts: Partial<SqlCaps> = {}): SqlService {
  const caps: SqlCaps = { ...DEFAULT_CAPS, ...opts };
  return {
    run: async (input) => {
      const { limit, timeoutMs } = queryBounds(input, caps);
      return (await loadSqlite()).run(input, { limit, timeoutMs, pageLimit: queryBounds(input, caps, input.page).limit });
    },
    mutate: async (input) => (await loadSqlite()).mutate(input, queryBounds(input, caps)),
    dryRun: async (input) => (await loadSqlite()).dryRun(input),
    dryRunMutations: async (input) => (await loadSqlite()).dryRunMutations(input),
  };
}
export type { SqlCaps } from './caps';
