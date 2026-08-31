/**
 * THE APP'S VIEW OF SQL: the shared contract, reached through the
 * services registry — an HTTP client when `SQL__SERVICE_URL` is set, the
 * in-process engine a composition root registered otherwise. Nothing else in
 * the app knows DuckDB exists; the guards, the caps and the wire live in the
 * package (services/sql/CONTRACT.md).
 */
import type { SqlService } from '@artifactbin/contracts';
import { MAX_QUERY_ROWS, QUERY_TIMEOUT_MS } from '@/lib/config';
import { services } from '@/lib/services';
import { queryBounds as bounds } from '@artifactbin/utils';

export type { DryRunResult, MutationInput, MutationOutcome, MutationResult, QueryFailure, QueryOutcome, QueryPage, RunInput, SqlQuery } from '@artifactbin/contracts';
export { isQueryFailure } from '@artifactbin/contracts';

export const runQueries: SqlService['run'] = (input) => services().sql.run(input);
export const runMutation: SqlService['mutate'] = (input) => services().sql.mutate(input);
export const dryRunQueries: SqlService['dryRun'] = (input) => services().sql.dryRun({ ...input, paramNames: [...input.paramNames] });
export const dryRunMutations: SqlService['dryRunMutations'] = (input) => services().sql.dryRunMutations({ ...input, paramNames: [...input.paramNames] });

/** The caps THIS process would apply — what a paged read is bounded by before it is even sent. */
export const queryBounds = (input: { limit?: number; timeoutMs?: number }, page?: { limit: number } | null) =>
  bounds(input, { maxRows: MAX_QUERY_ROWS, timeoutMs: QUERY_TIMEOUT_MS }, page);
