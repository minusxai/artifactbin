/**
 * One-time codes — ONE implementation of hash/TTL/single-use for every flow
 * that needs "a secret that expires and is spent once" (login, oauth, future
 * kinds). The implementation is `createCodeStore` in @artifactbin/utils,
 * product-blind and table-bound; this module is the APP's binding over the
 * app-owned `codes` table and keeps the vocabulary the app's callers and
 * tests already speak.
 *
 * Two lookup modes, and the difference is irreducible, not stylistic:
 *  - by HASH (claimByHash): the secret is high-entropy (≥128 bits), so the
 *    hash IS the key and guessing is not a threat. One atomic
 *    `DELETE … RETURNING` is the single-use guarantee — two concurrent claims
 *    of one code cannot both find the row.
 *  - by SUBJECT (claimBySubject): the secret is guessable (a 6-digit login
 *    code), so the row must be found by what it is bound to and every wrong
 *    guess must burn a metered attempt. Returns REASONS, not a boolean —
 *    the login flow tells expired apart from wrong apart from spent.
 *
 * What deliberately does NOT live here: email normalization and send rate
 * limits (login), PKCE and redirect checks (oauth), account creation. Callers
 * keep their own semantics; this module only mints and spends secrets.
 */
import { createCodeStore } from '@artifactbin/utils';
import type { ClaimResult } from '@artifactbin/contracts';
import { getDb } from './db';

/** JSON handed back to the claimer — the kind decides its shape. */
export type CodePayload = Record<string, unknown>;

export interface IssueCodeInput {
  kind: string;
  /** The secret to store (hashed). The caller generates it — entropy is the caller's contract. */
  secret: string;
  /** Bind the code to a thing (email, artifact id). Set ⇒ re-issue for the same subject supersedes. */
  subject?: string | null;
  payload?: CodePayload;
  ttlMs: number;
  now?: number;
}

export type ClaimBySubjectFailure = 'no_code' | 'expired' | 'too_many_attempts' | 'bad_code';

export type ClaimBySubjectResult =
  | { ok: true; payload: CodePayload }
  | { ok: false; reason: ClaimBySubjectFailure };

/** The store's reasons, in this module's (the callers') vocabulary. */
const REASONS: Record<Extract<ClaimResult, { ok: false }>['reason'], ClaimBySubjectFailure> = {
  unknown: 'no_code',
  expired: 'expired',
  exhausted: 'too_many_attempts',
  mismatch: 'bad_code',
};

/** The store is bound per call: the database handle is resolved lazily, so a reset in a test is seen. */
const store = () => createCodeStore({ query: async (sql, params) => (await getDb()).query(sql, params) }, { table: 'codes' });

const asSubjectResult = (r: ClaimResult): ClaimBySubjectResult =>
  r.ok ? { ok: true, payload: r.payload } : { ok: false, reason: REASONS[r.reason] };

/** Store a code. Same (kind, subject) ⇒ the new code supersedes and the attempt counter resets. */
export async function issueCode(input: IssueCodeInput): Promise<void> {
  await store().issue(input);
}

/**
 * Spend a high-entropy code: atomic single-use, always consumed once found —
 * even when it turns out expired, so replay stays closed. Null = unknown,
 * already spent, or expired (indistinguishable on purpose).
 */
export async function claimByHash(input: { kind: string; code: string; now?: number }): Promise<CodePayload | null> {
  return store().claimByHash(input);
}

/**
 * Spend a guessable code bound to a subject. Wrong guess burns an attempt;
 * at the cap even the RIGHT code answers too_many_attempts; expiry deletes
 * the row; a correct claim consumes it.
 */
export async function claimBySubject(input: {
  kind: string;
  subject: string;
  code: string;
  maxAttempts: number;
  now?: number;
}): Promise<ClaimBySubjectResult> {
  return asSubjectResult(await store().claimBySubject(input));
}

/**
 * Read a live code's payload WITHOUT consuming it — the claim is a separate,
 * deliberate act. Null = unknown, spent, or expired. The start flow leans on
 * this twice: the brief GET proves the link is live, and chunk writes need the
 * handle's token server-side while the handle stays valid for the next chunk.
 */
export async function peekByHash(input: { kind: string; code: string; now?: number }): Promise<CodePayload | null> {
  return store().peekByHash(input);
}
