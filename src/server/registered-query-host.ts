import type { RegisteredServerQueryIdentity } from "../datasets/query/contracts.ts";
import type { SqlDatabase } from "../persistence/sql.ts";
import type { SavedQueryInvocation } from "../persistence/dataset-queries-contracts.ts";
import type { DatasetReadService } from "../datasets/contracts.ts";
import type { DatasetSqlExecutor } from "../backend/dataset-sql-contracts.ts";
import { createSavedQueryRepository } from "../persistence/dataset-queries.ts";
import { createRegisteredServerQueryService } from "../datasets/query/service.ts";
/** Internal composition only. The saved invocation authority supplies this envelope;
 * resolver arguments supply only values/only. No public capability or program runner is installed. */
export function createSavedQueryHost(options: {
  database: SqlDatabase;
  reads: DatasetReadService;
  executor: DatasetSqlExecutor;
  now?: () => number;
}) {
  const now = options.now ?? Date.now,
    repository = createSavedQueryRepository(options.database, now);
  return {
    async bind(invocation: SavedQueryInvocation, signal: AbortSignal) {
      const saved = structuredClone(invocation),
        initial = await repository.resolve(saved, signal);
      if (!initial) throw Error("query_unavailable");
      const context = Object.freeze(initial.context),
        identity = initial.registration.plan.registration;
      const same = (other: RegisteredServerQueryIdentity) =>
        (
          [
            "backendId",
            "backendVersion",
            "pageId",
            "pageVersion",
            "sourceSha256",
          ] as const
        ).every((key) => other[key] === identity[key]);
      const current = async (signal: AbortSignal) => {
        const fresh = await repository.resolve(saved, signal);
        return fresh &&
          same(fresh.registration.plan.registration) &&
          fresh.userId === initial.userId
          ? fresh
          : null;
      };
      const service = createRegisteredServerQueryService({
        registry: async (_context, signal) =>
          (await current(signal))?.registration.plan ?? null,
        authorize: async (_context, registration, signal) =>
          same(registration) && !!(await current(signal)),
        platform: async (_context, signal) => {
          const fresh = await current(signal);
          if (!fresh) throw Error("query_unavailable");
          return {
            userId: fresh.userId,
            now: new Date(now()).toISOString(),
            tz: "UTC",
          };
        },
        reads: options.reads,
        execute: async (job, signal) => {
          if (!options.executor.query) throw Error("query_unavailable");
          return options.executor.query(job, signal);
        },
      });
      return Object.freeze({
        execute: (request: unknown, signal?: AbortSignal) =>
          service.execute(context, request, signal),
      });
    },
  };
}
