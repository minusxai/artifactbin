/**
 * A PAGE FUNCTION CALL'S ADMISSION, re-decided at every capability it reaches (contracts `RunnerAdmission`).
 *
 * A call is admitted on a page head (the reader's door, lib/page-doors `pageFunction`, or a scheduled run,
 * lib/function-schedules), runs for up to the run's wall time, and reaches capabilities meanwhile. Three things can
 * change under it: the page can be published again (new code, new links), the caller can lose the role the function
 * needs (unshared, removed from the group), and a scheduled run's lease can be reclaimed by another process. So the
 * admission travels in the trusted run input (and the signed remote pin), and the composition's `admit` port
 * (lib/page-doors) re-decides all three before each dispatch (sql, query, fetch, db open and each db query). A SQL
 * write decides them again inside its commit transaction, from locked rows. Pure here: the digest and the types.
 */
import { createHash } from 'node:crypto';
import type { RunnerAdmission, RunnerCaller } from '@artifactbin/contracts';

/** The page head a call is admitted on: its version, edit and links, as one digest (never the edit id itself). */
export function pageHeadDigest(row: { version: number; edit_id: string; meta: unknown }): string {
  const links = (row.meta as { htmlLinks?: unknown } | null)?.htmlLinks ?? [];
  return createHash('sha256').update(JSON.stringify([row.version, row.edit_id, links])).digest('hex');
}

/** One re-decision: the admission, the admitted caller, and the function's rule (./functions `functionRule`). */
export interface AdmissionCheck {
  admission: RunnerAdmission;
  caller: RunnerCaller;
  rule: { role?: unknown; signedIn?: unknown };
}
/** Throws (a ResolverQueryError with its code) when the call may no longer reach a capability. */
export type ResolverAdmit = (check: AdmissionCheck, signal?: AbortSignal) => Promise<void>;
