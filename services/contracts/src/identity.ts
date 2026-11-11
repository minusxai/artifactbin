/**
 * THE PROXY'S ONE READ OF AN APP-OWNED TABLE. The app owns `tokens` and every write to it; the proxy
 * resolves a presented credential through this reader and nothing else — one indexed SELECT per request
 * (auth `createBearerReader`: token, OAuth family fence and account identity), never a cache or an HTTP call.
 */
export interface TokenRecord {
  id: string;
  userId: string | null;
  /** OAuth resource restriction; absent on ordinary/manual tokens. */
  audience?: string;
  /** Space-delimited OAuth scope; absent on ordinary/manual tokens. */
  scope?: string;
  /** ISO expiry; absent when the token does not expire. */
  expiresAt?: string;
  /** The account's identity, read in the same statement as the token; absent when it has no account row. */
  email?: string;
  emailVerified?: boolean;
}
export interface TokenReader {
  /** The bearer path. Refuses a value that is not token-shaped BEFORE hashing or touching the database. */
  byToken(presented: string): Promise<TokenRecord | null>;
}

/** ONE implementation of an app-owned one-time-code store; auth credentials have their own broader lifecycle. */
export type ClaimResult =
  | { ok: true; payload: Record<string, unknown> }
  | { ok: false; reason: 'expired' | 'exhausted' | 'mismatch' | 'unknown' };
export interface CodeStore {
  issue(i: { kind: string; secret: string; subject?: string | null; payload?: Record<string, unknown>; ttlMs: number; now?: number }): Promise<void>;
  /** High-entropy secrets: one lookup by hash, single use. */
  claimByHash(i: { kind: string; code: string; now?: number }): Promise<Record<string, unknown> | null>;
  /** Guessable codes: by subject, attempts counted, capped. */
  claimBySubject(i: { kind: string; subject: string; code: string; maxAttempts: number; now?: number }): Promise<ClaimResult>;
  peekByHash(i: { kind: string; code: string; now?: number }): Promise<Record<string, unknown> | null>;
}
