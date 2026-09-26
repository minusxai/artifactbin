import type {SqlExtensions} from './extensions';
export type {SqlExtensions} from './extensions';
/**
 * THE ENGINES, IN THIS PROCESS. The only entry of this package that reaches
 * the native module — and lazily even then (engine.ts), so a broken binding
 * fails a QUERY, never the process. Import `@artifactbin/sql` for the client
 * and the server shell; import this only from a composition root.
 *
 * `createSql` is DuckDB; `createSqliteSql` is the SQLite engine
 * (`@artifactbin/sql/core`) behind the same contract, with the same caps.
 */
import type { SqlService } from '@artifactbin/contracts';
import { queryBounds } from './bounds';
import { DEFAULT_CAPS, type SqlCaps } from './caps';
import { dryRunMutations, dryRunQueries, runMutation, runQueries } from './engine';
import { loadSqlite } from './sqlite/index';

export function createSql(opts: Partial<SqlCaps> = {}, extensions:SqlExtensions = {}): SqlService {
  const caps: SqlCaps = { ...DEFAULT_CAPS, ...opts };
  return {
    run: (input) => runQueries(input, caps),
    mutate: (input) => runMutation(input, caps, extensions),
    // The dry runs take no caps: they prepare and execute against EMPTY tables,
    // so there is no row cap to apply and nothing for the interrupt to stop.
    dryRun: (input) => dryRunQueries(input),
    dryRunMutations: (input) => dryRunMutations(input, extensions),
  };
}

/** The SQLite engine as a `SqlService`: a request may lower the caps, never raise them. */
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
