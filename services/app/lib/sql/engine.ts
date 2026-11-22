/**
 * THE APP'S VIEW OF SQL: the shared contract, reached through the
 * services registry — an HTTP client when `SQL__SERVICE_URL` is set, the
 * in-process engine a composition root registered otherwise. Nothing else in
 * the app knows which engine runs; the guards, the caps and the wire live in the
 * package (services/contracts/src/sql.ts says what the service enforces).
 */
import type { SqlService } from '@artifactbin/contracts/sql';
import { MAX_ROWS_LIMIT, QUERY_TIMEOUT_MS, services } from '@/lib/platform';
import { queryBounds as bounds } from '@artifactbin/utils/clients';

export type { DryRunResult, MutationInput, MutationOutcome, MutationResult, QueryFailure, QueryOutcome, QueryPage, RunInput, RunManyInput, SqlQuery } from '@artifactbin/contracts/sql';
export { isQueryFailure } from '@artifactbin/contracts/sql';

export const runQueries: SqlService['run'] = (input, context) => services().sql.run(input, context);
export const runMutation: SqlService['mutate'] = (input) => services().sql.mutate(input);
export const dryRunMutations: SqlService['dryRunMutations'] = (input) => services().sql.dryRunMutations({ ...input, paramNames: [...input.paramNames] });

/** The caps THIS process would apply — what a paged read is bounded by before it is even sent. */
export const queryBounds = (input: { limit?: number; timeoutMs?: number }, page?: { limit: number } | null) =>
  bounds(input, { maxRows: MAX_ROWS_LIMIT, timeoutMs: QUERY_TIMEOUT_MS }, page);
