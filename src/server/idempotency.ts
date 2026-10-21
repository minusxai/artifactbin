/**
 * Idempotency keys and comment cursors (pure). The Postgres side is
 * src/persistence/idempotency.ts; the rules are in af-api-contracts.ts.
 */
import { IDEMPOTENCY_TTL_MS } from "./af-api-contracts.ts";
import { fail } from "../errors.ts";

/** A stored first response for one (page, account, key). */
export interface StoredResponse {
  fingerprint: string;
  status: number;
  body: unknown;
  /** Clock time the first request committed. */
  createdAt: number;
}
export type IdempotencyDecision =
  | { kind: "fresh" }
  | { kind: "replay"; status: number; body: unknown };

/** The Idempotency-Key header: absent is null; present must be 1..200 printable ASCII. */
export function idempotencyKey(header: string | string[] | undefined): string | null {
  if (header === undefined) return null;
  const value = Array.isArray(header) ? header[0] : header;
  if (typeof value !== "string" || !/^[\x21-\x7e](?:[\x20-\x7e]{0,198}[\x21-\x7e])?$/.test(value))
    fail(400, "Idempotency-Key must be 1 to 200 printable characters");
  return value;
}

/** The oldest createdAt still honoured at `now`. */
export const idempotencyCutoff = (now: number, ttl = IDEMPOTENCY_TTL_MS): number => now - ttl;

/**
 * What to do with a request whose key may have a stored response: replay it,
 * or run it as new (no row, or the row expired). Another body is 422.
 */
export function decideIdempotency(
  stored: StoredResponse | null,
  fingerprint: string,
  now: number,
  ttl = IDEMPOTENCY_TTL_MS,
): IdempotencyDecision {
  if (!stored || stored.createdAt < idempotencyCutoff(now, ttl)) return { kind: "fresh" };
  if (stored.fingerprint !== fingerprint)
    fail(422, "This Idempotency-Key was already used with a different request body");
  return { kind: "replay", status: stored.status, body: stored.body };
}

const CURSOR_PREFIX = "c1.";
/** An opaque comment cursor for a page change counter. */
export function encodeCursor(sequence: number): string {
  if (!Number.isSafeInteger(sequence) || sequence < 0) throw Error("Invalid cursor position");
  return CURSOR_PREFIX + sequence.toString(36);
}
/** The change counter in `?since=`, null when absent; a malformed cursor is 400. */
export function decodeCursor(value: string | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const match = /^c1\.(0|[1-9a-z][0-9a-z]{0,9})$/.exec(value);
  const sequence = match ? parseInt(match[1]!, 36) : NaN;
  if (!Number.isSafeInteger(sequence)) fail(400, "since must be a cursor from an earlier response");
  return sequence;
}
