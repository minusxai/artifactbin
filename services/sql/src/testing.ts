/**
 * The in-thread SqlService fixture (`@artifactbin/sql/testing`). It shares the
 * engine and caps with the worker pool, but synchronous SQLite work blocks the
 * caller's event loop. Servers compose `@artifactbin/sql/local` instead.
 */
import { sqlTimeout, SQL_WALL_OVERHEAD_MS, type SqlCallContext, type QueryFailure, type SqlService } from '@artifactbin/contracts/sql';
import { queryBounds } from './bounds';
import { sqlCaps, type SqlCaps } from './caps';
import type { SqlExtensions } from './extensions';
import { loadSqlite, PreparedCache } from './sqlite/index';

export function createSqliteSql(opts: Partial<SqlCaps> = {}, extensions: SqlExtensions = {}): SqlService {
  const caps: SqlCaps = sqlCaps(opts);
  // The service's prepared catalog databases: calls run one at a time on this thread, so one cache.
  const prepared = new PreparedCache();
  // Same-thread execution cannot observe abort events while SQLite holds this event loop.
  // Admission, loading and statement boundaries still share one finite wall deadline.
  const lifecycle = (context?: SqlCallContext) => {
    const deadline = performance.now() + sqlTimeout(context?.wallTimeoutMs, caps.timeoutMs + SQL_WALL_OVERHEAD_MS, caps.timeoutMs + SQL_WALL_OVERHEAD_MS, 'wallTimeoutMs', true);
    return { remaining: () => Math.max(0, deadline - performance.now()), failure: (): QueryFailure | undefined => context?.signal?.aborted ? {error:'SQL call cancelled'} : performance.now() >= deadline ? {error:'SQL deadline exceeded', timedOut:true} : undefined };
  };
  return {
    readPolicy:Object.freeze({queryTimeoutMs:caps.timeoutMs}),
    run: async (input, context) => {
      try {
        const life = lifecycle(context);
        const { limit, timeoutMs } = queryBounds(input, caps);
        const engine = await loadSqlite();
        const failure = life.failure();
        if (failure) return Object.fromEntries(input.queries.map(q => [q.name, failure]));
        const result = engine.run(input, { limit, timeoutMs, deadline: performance.now() + life.remaining(), pageLimit: queryBounds(input, caps, input.page).limit, ...(input.outputBytes !== undefined ? { outputBytes: input.outputBytes } : {}) }, prepared);
        const expired = life.failure();
        return expired ? Object.fromEntries(input.queries.map(q => [q.name, expired])) : result;
      } catch { return Object.fromEntries(input.queries.map(q => [q.name, {error:'Invalid SQL read budget'}])); }
    },
    mutate: async (input) => (await loadSqlite()).mutate(input, queryBounds(input, { ...caps, timeoutMs: caps.mutationTimeoutMs }), extensions, prepared),
    dryRunMutations: async (input) => (await loadSqlite()).dryRunMutations(input, extensions),
  };
}
export type { SqlCaps } from './caps';
export type { SqlExtensions } from './extensions';
