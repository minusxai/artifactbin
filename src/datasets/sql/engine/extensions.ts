// Adapted from Apache-2.0 licensed SQL engine; see LICENSE and NOTICE.
import type { MutationInput, QueryFailure } from "./sql-contracts.ts";
import type { SqliteDatabase } from "./database.ts";
/**
 * Installed by a trusted composition root; query authors cannot install
 * executable hooks. Engine-neutral in shape: the hook receives the mutation's
 * own throwaway database (the engine's guarded `SqliteDatabase`) before the
 * statement is prepared — to register functions under names only it knows
 * (`internalFunction`), never to attach or load anything an author could read.
 * It may return a function the engine calls after the statement ran: a
 * continuation it answers makes the write a `QueryFailure` carrying it, and
 * nothing is persisted.
 */
export interface SqlExtensions {
  setupMutation?: (
    database: SqliteDatabase,
    context: { input?: MutationInput; dryRun: boolean },
  ) => (() => QueryFailure["continuation"]) | void;
}
