import type { Queryable } from './db';

/**
 * THE PROXY'S ONE READ OF AN APP-OWNED TABLE. The app owns `tokens` and every write to it; the proxy
 * resolves a presented credential through this reader and nothing else — an indexed SELECT with a short
 * cache, never an HTTP call. utils names no credential policy: the caller says which credential it is
 * building an Actor for.
 */
export interface TokenRecord {
  id: string;
  userId: string | null;
  /** OAuth resource restriction; absent on ordinary/manual tokens. */
  audience?: string;
  /** Space-delimited OAuth scope; absent on ordinary/manual tokens. */
  scope?: string;
}
export interface TokenReader {
  /** The bearer path. Refuses a value that is not token-shaped BEFORE hashing or touching the database. */
  byToken(presented: string): Promise<TokenRecord | null>;
  /** The agent-cookie path (the cookie carries ids, never secrets). */
  byId(id: string): Promise<TokenRecord | null>;
  /** Composition-root hook: the app's revoke calls this in the full image; across a network the bound is the TTL. */
  invalidate(id?: string): void;
}
export interface TokenReaderOptions {
  db: Queryable;
  /** Where `tokens` lives (APP__SCHEMA). Interpolated — validated as a plain identifier. */
  schema?: string;
  ttlMs?: number;
  negativeTtlMs?: number;
  maxEntries?: number;
  now?: () => number;
}

/** ONE implementation of the one-time-code store; each owner binds it to its own table (app.codes, auth.codes). */
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

/** The signed browser cookie: token IDS, never secrets; the last id is the primary. */
export interface AgentSession { tokenIds: string[] }
