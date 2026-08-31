/**
 * THE ENGINE, IN THIS PROCESS. The only entry of this package that reaches
 * the native module — and lazily even then (engine.ts), so a broken binding
 * fails a QUERY, never the process. Import `@artifactbin/sql` for the client
 * and the server shell; import this only from a composition root.
 */
import type { SqlService } from '@artifactbin/contracts';
import { DEFAULT_CAPS, type SqlCaps } from './caps';
import { dryRunMutations, dryRunQueries, runMutation, runQueries } from './engine';

export function createSql(opts: Partial<SqlCaps> = {}): SqlService {
  const caps: SqlCaps = { ...DEFAULT_CAPS, ...opts };
  return {
    run: (input) => runQueries(input, caps),
    mutate: (input) => runMutation(input, caps),
    // The dry runs take no caps: they prepare and execute against EMPTY tables,
    // so there is no row cap to apply and nothing for the interrupt to stop.
    dryRun: (input) => dryRunQueries(input),
    dryRunMutations: (input) => dryRunMutations(input),
  };
}
export type { SqlCaps } from './caps';
