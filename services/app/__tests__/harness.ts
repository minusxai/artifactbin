/**
 * THE APP TEST HARNESS. One deep module behind every route-level test: one PGLite per FILE,
 * every table wiped before each test (FK-safe order derived from the schema, never a hand-written list), the
 * rate limiter reset, the test's session (`setSession`) cleared, the database released at the end, and the typed
 * request/actor/cookie helpers.
 */
import { afterAll, beforeAll, beforeEach } from 'vitest';
import { attachActor, decodeAgentSession as decodeAgentSessionEnvelope } from '@artifactbin/utils';
import type { Actor } from '@artifactbin/contracts';
import { overrideSession, type Session } from '@/auth';
import { AGENT_COOKIE, encodeAgentSession } from '@/lib/accounts/agent-session';
import { resetRateLimit } from '@/lib/accounts/auth';
import { EVENTS_SCHEMA } from '@/lib/platform/config';
import { overridePostgres } from '@/lib/datasets/postgres';
import { overrideCatalogExecutor } from '@/lib/datasets/execute';
import { AUTH_SECRET } from '@/lib/platform/config';
import { getDb, resetDb } from '@/lib/platform/db';
import { resetExportRenderer } from '@/lib/export/exporter';
import { services } from '@/lib/platform/services';
import { drainPreparedPageWarmups } from '@/lib/story/prepared/prepared-page.server';
import { drainSnapshotRevalidations } from '@/lib/compiled-page/snapshots.server';
import { SCHEMA_STATEMENTS } from '@/lib/platform/schema';
import { createHash, randomUUID } from 'node:crypto';
import { mintToken as mintRawToken } from '@/lib/accounts/tokens';

const SCHEMA_TABLES = SCHEMA_STATEMENTS.flatMap((statement) => {
  const table = /^CREATE TABLE IF NOT EXISTS (\w+)/.exec(statement)?.[1];
  return table ? [table] : [];
});

/** Authenticated route fixtures always belong to an email account. Explicit null
 * remains available for legacy-credential rejection and adoption tests. */
export async function mintAccountToken(...args: Parameters<typeof mintRawToken>) {
  const [name, suppliedUserId, query, options] = args;
  if (suppliedUserId === null) return { ...await mintRawToken(name, null, query, options), userId: null, email: null };
  const userId = suppliedUserId ?? `mxmx_test_${randomUUID()}`;
  const db = query ?? await getDb();
  await db.query("INSERT INTO users (id,email,kind) VALUES ($1,$2,'account') ON CONFLICT (id) DO NOTHING", [userId, `mxmx_test_${Buffer.from(userId).toString('hex')}@example.test`]);
  const { rows } = await db.query<{ email: string | null }>('SELECT email FROM users WHERE id=$1', [userId]);
  return { ...await mintRawToken(name, userId, db, options), userId, email: rows[0]?.email ?? null };
}

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
 * Build a Request for a route handler on the harness's base URL. ONE place for the bearer header, the
 * attached actor, the cookie and the origin, so no test file hand-rolls a `req` builder. Throws when `token` and
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
  const value = await encodeAgentSession({ tokenIds });
  const cookie = `${AGENT_COOKIE}=${value}`;
  await registerAgentCookieValue(value);
  return cookie;
}

async function registerAgentCookieValue(value: string, previousValue?: string): Promise<void> {
  const session = decodeAgentSessionEnvelope(value, AUTH_SECRET);
  if (!session?.sessionId || !session.tokenIds.length) return;
  const db = await getDb();
  // The proxy owns this schema in production; route tests model only its
  // browser-liveness row, without importing the proxy package into app.
  await db.query('CREATE SCHEMA IF NOT EXISTS auth');
  await db.query('CREATE TABLE IF NOT EXISTS auth.credentials (kind text NOT NULL, credential_hash text NOT NULL, subject_id text NOT NULL, expires_at timestamptz NOT NULL, consumed_at timestamptz, deleted_at timestamptz)');
  const previous = decodeAgentSessionEnvelope(previousValue, AUTH_SECRET);
  if (previous?.sessionId) await db.query("UPDATE auth.credentials SET deleted_at=now() WHERE kind='agent-browser' AND credential_hash=$1 AND deleted_at IS NULL", [createHash('sha256').update(previous.sessionId).digest('hex')]);
  await db.query(
    "INSERT INTO auth.credentials(kind,credential_hash,subject_id,expires_at) VALUES ('agent-browser',$1,$2,now()+interval '30 days')",
    [createHash('sha256').update(session.sessionId).digest('hex'), session.tokenIds.at(-1)],
  );
}

/** Model the proxy's post-response cookie registration around a direct route call. */
export async function registerAgentCookie(response: Response, previousCookie?: string): Promise<void> {
  const next = cookieValue(response).value;
  const previous = previousCookie?.split(';').map(part => part.trim()).find(part => part.startsWith(`${AGENT_COOKIE}=`))?.slice(AGENT_COOKIE.length + 1);
  if (next) await registerAgentCookieValue(next, previous);
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

/**
 * Let a write's fire-and-forget work land before a test counts its own queries: the events writer's
 * lazy schema setup and insert, and the analytics row. Waits for the writer's setup, lets every queued
 * continuation run, then passes one statement through the database's serialized queue, so anything
 * already sent has finished.
 */
export async function settleBackgroundWrites(): Promise<void> {
  await (services().events as { drain?: () => Promise<void> }).drain?.();
  await new Promise<void>((resolve) => setImmediate(resolve));
  await (await getDb()).query('SELECT 1');
}

/**
 * Who `auth()` says is signed in for a direct handler call (no proxy stamps a session there): a session, a
 * function asked on every call (a file's own mutable "current user"), or null for nobody, whatever the request
 * carries. `useAppHarness` clears it before every test and after the file, so it never outlives either; a file
 * that keeps one for all its tests installs it in its own `beforeEach`.
 */
export function setSession(session: Session | (() => Session | null) | null): void {
  overrideSession(typeof session === 'function' ? session : () => session);
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
    // A publish prepares its page after the response (lib/story/prepared/prepared-page.server): let the last
    // test's finish before its rows go, so no warm-up writes into the next test's database.
    await drainPreparedPageWarmups();
    // Likewise a guest-snapshot revalidation a write queued (server/app enables them).
    await drainSnapshotRevalidations();
    // The schema is declared parent-first. Reverse it so a future foreign key
    // can never make the shared wipe depend on a copied cleanup list.
    for (const table of SCHEMA_TABLES.toReversed()) {
      await db.query(`DELETE FROM ${table}`);
    }
    // The events table belongs to the events SERVICE, so it is not in the
    // app's schema and no test file may wipe it itself (harness-rollout pins
    // that). It exists only in a file that created it; guard on to_regclass so
    // every other file's wipe stays a no-op rather than an error.
    const present = await db.query<{ present: boolean }>('SELECT to_regclass($1) IS NOT NULL AS present', [`${EVENTS_SCHEMA}.events`]);
    if (present.rows[0]?.present) await db.query(`DELETE FROM ${EVENTS_SCHEMA}.events`);
    resetRateLimit();
    overrideSession(undefined);
  });

  afterAll(async () => {
    // The api project shares one module graph per worker: the next file starts with no session named and
    // none of the overrides below (the Postgres driver, dataset execution; configuration and request headers are
    // cleared by the setup file, which also covers files that do not use the harness).
    overrideSession(undefined);
    overridePostgres(undefined);
    overrideCatalogExecutor(undefined);
    await drainPreparedPageWarmups();
    await drainSnapshotRevalidations();
    // The export cache holds the database it was opened on; the next file on this worker (the api
    // project shares one module graph per worker) must open its own, not reuse a closed one.
    await resetExportRenderer();
    database = undefined;
    await resetDb();
  });

  return {
    db: () => database ?? getDb(),
  };
}

/**
 * THE DOCUMENT AN APP PAGE FRAMES, as its reader's browser loads it (lib/serving/document-frame): the app page at
 * `path` (asked with `init`, its reader's credentials), then the frame's first URL — the pages apex's session
 * exchange, which spends the page's one-time ticket for the `afbin_pages` cookie — and then the document on its own
 * origin with that cookie. Null when the app page draws no frame. `app` is `createAppServer()`'s.
 */
export async function framedDocument(app: { request(input: string | Request, init?: RequestInit): Response | Promise<Response> }, path: string, init: RequestInit = {}): Promise<Response | null> {
  const page = await app.request(path, init);
  const src = /<iframe data-mx-document-frame="" src="([^"]+)"/.exec(await page.text())?.[1]?.replaceAll('&amp;', '&');
  if (!src) return null;
  const exchange = await app.request(src);
  const next = exchange.headers.get('location');
  if (!next) return null;
  const cookie = /afbin_pages=([^;]*)/.exec(exchange.headers.get('set-cookie') ?? '')?.[1];
  return app.request(next, { headers: { accept: 'text/html', ...(cookie ? { cookie: `afbin_pages=${cookie}` } : {}) } });
}
