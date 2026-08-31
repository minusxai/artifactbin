/**
 * THE APP TEST HARNESS (cleanup/testmig-2 → 4). One deep module behind every route-level test: one PGLite per FILE,
 * every table wiped before each test (FK-safe order derived from the schema, never a hand-written list), the
 * rate limiter reset, the database released at the end. Later milestones add the typed request/actor/cookie helpers.
 *
 * Seeded skeleton (testmig-2): signatures and doc-comments are the contract; bodies throw.
 */
import { afterAll, beforeAll, beforeEach } from 'vitest';
import { attachActor } from '@artifactbin/utils';
import type { Actor } from '@artifactbin/contracts';
import { AGENT_COOKIE, encodeAgentSession } from '@/lib/agent-session';
import { resetRateLimit } from '@/lib/auth';
import { getDb, resetDb } from '@/lib/db';
import { SCHEMA_STATEMENTS } from '@/lib/schema';

const SCHEMA_TABLES = SCHEMA_STATEMENTS.flatMap((statement) => {
  const table = /^CREATE TABLE IF NOT EXISTS (\w+)/.exec(statement)?.[1];
  return table ? [table] : [];
});

/** What a route test may send. `token` (bearer) and `actor` (proxy-attached) are two DIFFERENT credentials: naming both is a test bug, refused. */
export interface RequestOptions {
  method?: string;
  /** JSON body; sets content-type. */
  json?: unknown;
  /** Raw body when `json` is not enough. */
  body?: BodyInit;
  /** Bearer token — the agent path (`Authorization: Bearer …`). */
  token?: string;
  /** The actor the PROXY would attach (`attachActor`): session, bearer or agent-cookie, already resolved. */
  actor?: Actor;
  /** The browser's cookie header, e.g. from `agentCookie(ids)`. */
  cookie?: string;
  /** An Origin header (CSRF tests); `same` means the app's own origin. */
  origin?: string | 'same';
  headers?: Record<string, string>;
}

/**
 * Build a Request for a route handler on the harness's base URL (testmig-3). ONE place for the bearer header, the
 * attached actor, the cookie and the origin, so the 65 hand-written `req` builders can go. Throws when `token` and
 * `actor` are both given — one credential per request, by construction.
 */
export function request(path: string, opts: RequestOptions = {}): Request {
  if (opts.token && opts.actor) throw new Error('request accepts only one credential: token or actor');

  const headers = new Headers(opts.headers);
  if (opts.json !== undefined && !headers.has('content-type')) headers.set('content-type', 'application/json');
  if (opts.token) headers.set('authorization', `Bearer ${opts.token}`);
  if (opts.cookie !== undefined) headers.set('cookie', opts.cookie);

  const baseUrl = 'http://localhost:3000';
  if (opts.origin) headers.set('origin', opts.origin === 'same' ? baseUrl : opts.origin);

  const built = new Request(`${baseUrl}${path}`, {
    method: opts.method ?? 'GET',
    headers,
    body: opts.json === undefined ? opts.body : JSON.stringify(opts.json),
  });
  return opts.actor ? attachActor(built, opts.actor) : built;
}

/** The signed agent cookie header value for these held token ids: `${AGENT_COOKIE}=${encoded}`. */
export async function agentCookie(tokenIds: string[]): Promise<string> {
  return `${AGENT_COOKIE}=${await encodeAgentSession({ tokenIds })}`;
}

/** Read one Set-Cookie from a response: its value (null when absent) and whether it CLEARS the cookie (Max-Age=0). */
export function cookieValue(response: Response, name: string = AGENT_COOKIE): { value: string | null; cleared: boolean } {
  const headers = response.headers as Headers & { getSetCookie?: () => string[] };
  const setCookies = headers.getSetCookie?.() ?? [headers.get('set-cookie')].filter((header): header is string => header !== null);
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  for (const setCookie of setCookies) {
    const match = new RegExp(`(?:^|,\\s*)${escapedName}=([^;]*)`).exec(setCookie);
    if (match) return { value: match[1] ?? '', cleared: /(?:^|;\s*)Max-Age=0(?:;|$)/i.test(setCookie) };
  }
  return { value: null, cleared: false };
}

export interface AppHarness {
  /** The one open database of this file — an escape hatch for tests whose behaviour includes a direct row assertion. */
  db(): ReturnType<typeof getDb>;
}

/**
 * Call ONCE at the top level of a test file. Registers `beforeAll` (boot one PGLite), `beforeEach` (wipe every table in
 * FK-safe order + resetRateLimit), `afterAll` (resetDb) on vitest's current suite. Two tests in the same file observe the
 * SAME database instance; no row written by one test survives into the next; a table added to the schema later is wiped
 * without anyone editing a list.
 */
export function useAppHarness(): AppHarness {
  let database: ReturnType<typeof getDb> | undefined;

  beforeAll(() => {
    database = getDb();
    return database;
  });

  beforeEach(async () => {
    const db = await database!;
    // The schema is declared parent-first. Reverse it so a future foreign key
    // can never make the shared wipe depend on a copied cleanup list.
    for (const table of SCHEMA_TABLES.toReversed()) {
      await db.query(`DELETE FROM ${table}`);
    }
    resetRateLimit();
  });

  afterAll(async () => {
    database = undefined;
    await resetDb();
  });

  return {
    db: () => database ?? getDb(),
  };
}
