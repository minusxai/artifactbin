import {inviteGroupMember,acceptGroupInvitations} from '@/lib/groups';
/**
 * THE APP TEST HARNESS. One deep module behind every route-level test: every file starts on a database in exactly
 * the state a fresh one gives it, every table wiped before each test (FK-safe order derived from the schema, never
 * a hand-written list), the rate limiter reset, the test's session (`setSession`) cleared and its live subscriptions
 * dropped, the database released or recycled at the end, and the typed request/actor/cookie helpers.
 *
 * ONE DATABASE PER WORKER in the shared-graph `api` project (vitest.config.ts provides `harnessReusesDatabase`):
 * opening a PGLite from the schema image was a third of a small api file's time (~200ms locally, ~600ms on a CI
 * runner, per file). So at a file's end the harness returns the database to a fresh one's state (`recycle`: rows
 * wiped, sequences restarted, the session discarded) and keeps it only when nothing a wipe cannot undo changed: the
 * catalog fingerprint (`catalogState`: schemas, tables, columns, constraints, indexes, views, functions, types,
 * triggers, extensions, roles, role and database settings, policies, grants, sequences, prepared transactions, large
 * objects, advisory locks, listening channels, non-default settings, every table's row count) must equal the one
 * taken when it opened, no LISTEN may still be held, and no method of the database object may have been replaced.
 * Otherwise it closes it, says which file changed what, and the next file opens a fresh one, as every file did
 * before. Every other project, and a file that closed the database itself, still opens one per file.
 */
import { afterAll, beforeAll, beforeEach, expect, inject } from 'vitest';
import { attachActor } from '@artifactbin/utils';
import { createBearerReader, ensureAuthSchema, ensureHumanAuthSchema } from '@artifactbin/auth';
import type { Actor, Credential } from '@artifactbin/contracts';
import { identityForUser, type AccessActor, type RequestIdentity } from '@/lib/accounts';
import { overrideSession, type Session } from '@/auth';
import { AGENT_COOKIE } from '@/lib/accounts/agent-session';
import { resetAllowances } from '@/lib/allowances';
import { EVENTS_SCHEMA } from '@/lib/platform/config';
import { overrideCatalogExecutor } from '@/lib/datasets/execute';
import { AUTH_SECRET } from '@/lib/platform/config';
import { getDb, recycleDbSession, resetDb, type Db, type Queryable } from '@/lib/platform/db';
import { syncIdentitySettings } from '@/lib/platform';
import { resetExportRenderer } from '@/lib/export';
import { flushViews } from '@/lib/analytics';
import { resetRenderCache } from '@/lib/document-serving/render-cache';
import { resetLiveSubscriptions } from '@/lib/publish/realtime/live';
import { SCHEMA_STATEMENTS } from '@/lib/platform/schema';
import { createHmac, randomUUID } from 'node:crypto';
import { mintToken as mintRawToken, MAX_TOKEN_TTL_MS } from '@/lib/accounts/tokens';
import { generateInternalId } from '@/lib/platform/ids';
import type { PagesSite } from '@/lib/http';

const SCHEMA_TABLES = SCHEMA_STATEMENTS.flatMap((statement) => {
  const table = /^CREATE TABLE IF NOT EXISTS (\w+)/.exec(statement)?.[1];
  return table ? [table] : [];
});
const WIPE_SQL = SCHEMA_TABLES.toReversed().map((table) => `DELETE FROM ${table};`).join('\n');

declare module 'vitest' {
  interface ProvidedContext { harnessReusesDatabase?: boolean }
}

/** Everything about a database a file can change that the per-test wipe cannot undo, outside the temporary schemas. */
const USER_SCHEMA = "n.nspname NOT IN ('pg_catalog','information_schema','pg_toast') AND n.nspname !~ '^pg_(toast_)?temp_'";
const CATALOG_SQL = `SELECT x FROM (
  SELECT 'n:'||n.nspname||':'||coalesce(n.nspacl::text,'') FROM pg_namespace n WHERE n.nspname !~ '^pg_(toast_)?temp_'
  UNION ALL SELECT 'c:'||c.oid::regclass::text||':'||c.relkind::text||c.relpersistence::text||':'||coalesce(c.relacl::text,'')||':'||c.relrowsecurity::text FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE ${USER_SCHEMA}
  UNION ALL SELECT 'a:'||c.oid::regclass::text||'.'||a.attname||':'||format_type(a.atttypid,a.atttypmod)||':'||a.attnotnull::text||':'||coalesce(pg_get_expr(d.adbin,d.adrelid),'') FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum WHERE a.attnum>0 AND NOT a.attisdropped AND ${USER_SCHEMA}
  UNION ALL SELECT 'k:'||k.conrelid::regclass::text||':'||k.conname||':'||pg_get_constraintdef(k.oid) FROM pg_constraint k JOIN pg_namespace n ON n.oid=k.connamespace WHERE ${USER_SCHEMA}
  UNION ALL SELECT 'i:'||pg_get_indexdef(i.indexrelid) FROM pg_index i JOIN pg_class c ON c.oid=i.indexrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE ${USER_SCHEMA}
  UNION ALL SELECT 'v:'||c.oid::regclass::text||':'||pg_get_viewdef(c.oid) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE c.relkind IN ('v','m') AND ${USER_SCHEMA}
  UNION ALL SELECT 'f:'||p.oid::regprocedure::text||':'||md5(coalesce(p.prosrc,''))||':'||coalesce(p.proacl::text,'') FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE ${USER_SCHEMA}
  UNION ALL SELECT 't:'||t.oid::regtype::text||':'||t.typtype::text FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace WHERE ${USER_SCHEMA} AND t.typtype IN ('e','d','r','m')
  UNION ALL SELECT 'e:'||e.enumtypid::regtype::text||':'||e.enumlabel FROM pg_enum e
  UNION ALL SELECT 'g:'||g.tgrelid::regclass::text||':'||g.tgname||':'||g.tgenabled::text FROM pg_trigger g WHERE NOT g.tgisinternal
  UNION ALL SELECT 'r:'||c.ev_class::regclass::text||':'||c.rulename FROM pg_rewrite c JOIN pg_class r ON r.oid=c.ev_class JOIN pg_namespace n ON n.oid=r.relnamespace WHERE ${USER_SCHEMA} AND c.rulename<>'_RETURN'
  UNION ALL SELECT 'x:'||extname||':'||extversion FROM pg_extension
  UNION ALL SELECT 'o:'||rolname||':'||concat_ws(',',rolsuper,rolinherit,rolcreaterole,rolcreatedb,rolcanlogin,rolbypassrls)||':'||coalesce(array_to_string(rolconfig,','),'') FROM pg_roles
  UNION ALL SELECT 'm:'||m.roleid::regrole::text||':'||m.member::regrole::text FROM pg_auth_members m
  UNION ALL SELECT 'd:'||coalesce(setdatabase,0)::text||':'||setrole::text||':'||array_to_string(setconfig,',') FROM pg_db_role_setting
  UNION ALL SELECT 'p:'||polrelid::regclass::text||':'||polname||':'||coalesce(pg_get_expr(polqual,polrelid),'') FROM pg_policy
  UNION ALL SELECT 'q:'||seqrelid::regclass::text||':'||concat_ws(',',seqstart,seqincrement,seqmax,seqcycle) FROM pg_sequence
  UNION ALL SELECT 'qv:'||schemaname||'.'||sequencename||':'||coalesce(last_value::text,'') FROM pg_sequences
  UNION ALL SELECT 's:'||name||'='||setting||':'||source FROM pg_settings WHERE source NOT IN ('default','override')
  UNION ALL SELECT 'l:'||locktype::text||':'||mode FROM pg_locks WHERE locktype='advisory'
  UNION ALL SELECT 'ln:'||ch FROM pg_listening_channels() ch
  UNION ALL SELECT 'px:'||gid FROM pg_prepared_xacts
  UNION ALL SELECT 'lo:'||count(*)::text FROM pg_largeobject_metadata
  UNION ALL SELECT 'ps:'||name FROM pg_prepared_statements
  UNION ALL SELECT 'cu:'||name FROM pg_cursors
) f(x) ORDER BY x`;

/** The catalog fingerprint above, then every user table's row count (one generated statement). */
async function catalogState(db: Queryable): Promise<string> {
  const catalog = (await db.query<{ x: string }>(CATALOG_SQL)).rows.map((row) => row.x);
  const tables = (await db.query<{ t: string }>(`SELECT c.oid::regclass::text AS t FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE c.relkind IN ('r','p') AND ${USER_SCHEMA} ORDER BY 1`)).rows.map((row) => row.t);
  const counts = tables.length
    ? (await db.query<{ x: string }>(tables.map((table) => `SELECT ${quoteLiteral(`rows:${table}:`)} || count(*)::text AS x FROM ${table}`).join(' UNION ALL '))).rows.map((row) => row.x)
    : [];
  return [...catalog, ...counts].join('\n');
}
const quoteLiteral = (text: string) => `'${text.replaceAll("'", "''")}'`;

/** Each method an object answers to, by name, as its own or its prototypes' data properties (a spy left installed shows here). */
const ownMethods = (object: object): Map<string, unknown> => {
  const methods = new Map<string, unknown>();
  for (let at: object | null = object; at && at !== Object.prototype; at = Object.getPrototypeOf(at)) {
    for (const name of Object.getOwnPropertyNames(at)) {
      const value = Object.getOwnPropertyDescriptor(at, name)?.value;
      if (!methods.has(name) && typeof value === 'function') methods.set(name, value);
    }
  }
  return methods;
};
const sameMethods = (a: Map<string, unknown>, b: Map<string, unknown>) => a.size === b.size && [...a].every(([name, value]) => b.get(name) === value);

/** The PGLite instance under the harness's database (the harness only ever opens PGLite). */
function pgliteOf(db: Db): object {
  const raw = db.raw();
  if (raw.kind !== 'pglite') throw new Error('The harness database is PGLite.');
  return raw.instance as object;
}

/** What the worker's reused database looked like when it opened fresh. Kept on the process global, like the database. */
interface ReusedDatabase { db: Promise<Db>; state: string; methods: Map<string, unknown>; rawMethods: Map<string, unknown> }
declare global {
  // eslint-disable-next-line no-var
  var __artifact_bin_harness_db__: ReusedDatabase | undefined;
}

/** Authenticated route fixtures always belong to an email account. Explicit null
 * remains available for legacy-credential rejection and historical alias tests. */
/**
 * The auth host's bearer reader over this harness's database, as server.ts composes it: the auth tables its one
 * statement reads (credentials, Better Auth's user) created, and `account` writing the identity it returns.
 */
export async function bearerIdentity() {
  const db = await getDb();
  const raw = db.raw();
  if (raw.kind !== 'pglite') throw new Error('The harness database is PGLite.');
  await ensureAuthSchema(db, 'auth');
  await ensureHumanAuthSchema({ pglite: raw.instance, schema: 'auth' });
  return {
    reader: createBearerReader({ db }),
    async account(a: { userId: string; email: string; emailVerified: boolean }): Promise<void> {
      await db.query('DELETE FROM auth."user" WHERE email=$2 AND id<>$1', [a.userId, a.email]);
      await db.query('INSERT INTO auth."user"(id,name,email,"emailVerified") VALUES ($1,$2,$2,$3) ON CONFLICT (id) DO UPDATE SET email=EXCLUDED.email,"emailVerified"=EXCLUDED."emailVerified"', [a.userId, a.email, a.emailVerified]);
    },
  };
}

export async function mintAccountToken(...args: Parameters<typeof mintRawToken>) {
  const [name, suppliedUserId, options] = args;
  if (suppliedUserId === null) return { ...await mintRawToken(name, null, options), userId: null, email: null };
  const userId = suppliedUserId ?? `mxmx_test_${randomUUID()}`;
  const db = await getDb();
  await db.query("INSERT INTO users (id,email,kind) VALUES ($1,$2,'account') ON CONFLICT (id) DO NOTHING", [userId, `mxmx_test_${Buffer.from(userId).toString('hex')}@example.test`]);
  const { rows } = await db.query<{ email: string | null }>('SELECT email FROM users WHERE id=$1', [userId]);
  return { ...await mintRawToken(name, userId, options), userId, email: rows[0]?.email ?? null };
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

/** A resolved request identity as a door hands it to a handler (lib/authentication request-identity). It grants nothing. */
export function testIdentity(credential: Credential, ids: { userId?: string | null; tokenId?: string | null; email?: string | null; emailVerified?: boolean | null } = {}): RequestIdentity {
  return { ...identityForUser(ids.userId ?? null, ids.tokenId ?? null, ids.email ?? null), credential, emailVerified: ids.emailVerified ?? null };
}

/** Historical cookie input for rejection tests. No product encoder or credential issuance. */
export async function agentCookie(tokenIds: string[]): Promise<string> {
  const payload = Buffer.from(JSON.stringify({ tokenIds, sessionId: 'h'.repeat(43) })).toString('base64url');
  const signature = createHmac('sha256', `agent:${AUTH_SECRET}`).update(payload).digest('base64url');
  return `${AGENT_COOKIE}=${payload}.${signature}`;
}

/** A legacy guest row (no login identity) with one token: no product code mints one any more, but historical references and rejection tests still meet them. */
export async function createGuestOwner(options: { name?: string; tokenName?: string; expiresInMs?: number } = {}): Promise<{ userId: string; tokenId: string; cookie: string }> {
  const userId = 'usr_' + generateInternalId();
  await (await getDb()).query("INSERT INTO users (id, email, kind, name) VALUES ($1, NULL, 'guest', $2)", [userId, options.name ?? null]);
  const tokenId = (await mintRawToken(options.tokenName ?? 'guest-browser', userId, { expiresInMs: options.expiresInMs ?? MAX_TOKEN_TTL_MS })).id;
  return { userId, tokenId, cookie: await agentCookie([tokenId]) };
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
 * Who `auth()` says is signed in for a direct handler call (no proxy stamps a session there): a session, a
 * function asked on every call (a file's own mutable "current user"), or null for nobody, whatever the request
 * carries. `useAppHarness` clears it before every test and after the file, so it never outlives either; a file
 * that keeps one for all its tests installs it in its own `beforeEach`.
 */
export function setSession(session: Session | (() => Session | null) | null): void {
  overrideSession(typeof session === 'function' ? session : () => session);
}

interface AppHarness {
  /** The one open database of this file — an escape hatch for tests whose behaviour includes a direct row assertion. */
  db(): ReturnType<typeof getDb>;
  /**
   * ONE FIXTURE FOR A DESCRIBE WHOSE TESTS ONLY READ IT. Call inside a `describe`: before its first test the database
   * is wiped once and `seed` runs; its tests then keep those rows (the per-test wipe is skipped, the drains, the rate
   * limiter and the session still reset), and the next test outside it wipes as usual. Returns the seed's value. A
   * test that writes builds its own fixture in a describe of its own, never in one of these.
   */
  shared<T>(seed: () => Promise<T>): () => T;
}

/**
 * Call ONCE at the top level of a test file (harness-reuse.test.ts calls it once per describe, each running as a file). Registers `beforeAll` (boot one PGLite), `beforeEach` (drop live subscriptions,
 * wipe every table in FK-safe order + resetAllowances), `afterAll` (resetDb) on vitest's current suite. Two tests in the same file observe the
 * SAME database instance; no row written by one test survives into the next; a table added to the schema later is wiped
 * without anyone editing a list.
 */
export function useAppHarness(): AppHarness {
  let database: ReturnType<typeof getDb> | undefined;
  /** Set while a `shared` describe runs: its tests keep the rows its seed wrote. */
  let keepRows = false;

  const wipe = async () => {
    const db = await database!;
    if (keepRows) return;
    // The schema is declared parent-first. Reverse it so a future foreign key
    // can never make the shared wipe depend on a copied cleanup list. ONE simple-protocol batch, not a statement per
    // table: ~55 round trips were 6.8ms of every test's 9ms of harness work (1.3ms batched), before every one of the
    // api project's ~1,700 tests.
    const raw = db.raw();
    if (raw.kind !== 'pglite') throw new Error('The harness database is PGLite.');
    await (raw.instance as { exec(sql: string): Promise<unknown> }).exec(WIPE_SQL);
    // Co-hosted auth creates its tables at service boot, outside SCHEMA_TABLES.
    // Discover them rather than copying Better Auth's table list into each test.
    const authTables=await db.query<{name:string}>("SELECT format('%I.%I',schemaname,tablename) AS name FROM pg_tables WHERE schemaname='auth' ORDER BY tablename");
    if(authTables.rows.length)await db.query(`TRUNCATE TABLE ${authTables.rows.map(row=>row.name).join(', ')} CASCADE`);
    // The events table belongs to the events SERVICE, so it is not in the
    // app's schema and no test file may wipe it itself (harness-rollout pins
    // that). It exists only in a file that created it; guard on to_regclass so
    // every other file's wipe stays a no-op rather than an error.
    const present = await db.query<{ present: boolean }>('SELECT to_regclass($1) IS NOT NULL AS present', [`${EVENTS_SCHEMA}.events`]);
    if (present.rows[0]?.present) await db.query(`DELETE FROM ${EVENTS_SCHEMA}.events`);
    // Every boot writes the row the identity views' rules read (lib/platform identity-host); the wipe took it.
    await syncIdentitySettings(db);
  };

  const reuse = inject('harnessReusesDatabase') === true;

  /**
   * The database back to a fresh one's state: session discarded, every row wiped, every sequence restarted, and the
   * events service's schema gone (a fresh database has none: each file's writer, test/setup/vitest.setup.ts, creates it
   * on its first emit, its counter starting again at the stored maximum, so leaving it would carry positions over).
   */
  const recycle = async () => {
    await recycleDbSession();
    const db = await database!;
    await db.query(`DROP SCHEMA IF EXISTS ${EVENTS_SCHEMA} CASCADE`);
    await wipe();
    const sequences = (await db.query<{ s: string; start: string }>("SELECT format('%I.%I',schemaname,sequencename) AS s, start_value::text AS start FROM pg_sequences")).rows;
    for (const { s: sequence, start } of sequences) await db.query('SELECT setval($1::regclass,$2::bigint,false)', [sequence, start]);
  };

  beforeAll(async () => {
    database = getDb();
    const db = await database;
    if (!reuse) return database;
    const held = globalThis.__artifact_bin_harness_db__;
    if (held?.db === database) return database;
    // A fresh database: recycled once so its state is taken exactly as a reused one's will be compared.
    await recycle();
    globalThis.__artifact_bin_harness_db__ = { db: database, state: await catalogState(db), methods: ownMethods(db), rawMethods: ownMethods(pgliteOf(db)) };
    return database;
  });

  beforeEach(async () => {
    // A view the last test buffered lands before the wipe, no render outlives the rows it was made from, and every
    // test starts with no live subscription (a stream an earlier test left open, or one it counted).
    await flushViews();
    resetRenderCache();
    await resetLiveSubscriptions();
    await wipe();
    resetAllowances();
    overrideSession(undefined);
  });

  afterAll(async () => {
    // The api project shares one module graph per worker: the next file starts with no session named and
    // none of the overrides below (dataset execution; configuration and request headers are
    // cleared by the setup file, which also covers files that do not use the harness).
    overrideSession(undefined);
    overrideCatalogExecutor(undefined);
    // The export cache holds the database it was opened on; the next file on this worker (the api
    // project shares one module graph per worker) must open its own, not reuse a closed one.
    await resetExportRenderer();
    await flushViews();
    resetRenderCache();
    // Its listeners hold connections on this file's database, which closes next.
    await resetLiveSubscriptions();
    const mine = database;
    database = undefined;
    const held = globalThis.__artifact_bin_harness_db__;
    if (!reuse || !held || !mine || held.db !== mine || globalThis.__artifact_bin_db__ !== mine) { globalThis.__artifact_bin_harness_db__ = undefined; await resetDb(); return; }
    const drift = await (async () => {
      database = mine;
      try {
        const db = await mine;
        if (!sameMethods(ownMethods(db), held.methods) || !sameMethods(ownMethods(pgliteOf(db)), held.rawMethods)) return 'replaced a method of the database object';
        const listening = (await db.query<{ n: number }>('SELECT count(*)::int AS n FROM pg_listening_channels()')).rows[0]?.n ?? 0;
        if (listening) return `left ${listening} LISTEN channel(s) open`;
        await recycle();
        const state = await catalogState(db);
        if (state === held.state) return null;
        const before = new Set(held.state.split('\n')), after = new Set(state.split('\n'));
        const changed = [...[...after].filter((line) => !before.has(line)).map((line) => `+${line}`), ...[...before].filter((line) => !after.has(line)).map((line) => `-${line}`)];
        return `changed the database: ${changed.slice(0, 6).join(' ')}${changed.length > 6 ? ` (+${changed.length - 6} more)` : ''}`;
      } catch (error) {
        return `left the database unrecyclable (${error instanceof Error ? error.message : String(error)})`;
      } finally {
        database = undefined;
      }
    })();
    if (drift === null) return;
    process.stderr.write(`harness: ${expect.getState().testPath ?? 'a test file'} ${drift}; the next file opens a fresh database\n`);
    globalThis.__artifact_bin_harness_db__ = undefined;
    await resetDb();
  });

  return {
    db: () => database ?? getDb(),
    shared<T>(seed: () => Promise<T>) {
      let seeded: { value: T } | undefined;
      beforeAll(async () => {
        await wipe();
        resetAllowances();
        overrideSession(undefined);
        seeded = { value: await seed() };
        keepRows = true;
      });
      afterAll(() => { keepRows = false; seeded = undefined; });
      return () => {
        if (!seeded) throw new Error('harness.shared: read its value inside a test of the describe that seeded it');
        return seeded.value;
      };
    },
  };
}

/**
 * THE DOCUMENT AN APP PAGE FRAMES, as its reader's browser loads it (lib/document-serving/document-frame): the app page at
 * `path` (asked with `init`, its reader's credentials), then the frame's first URL — the document's own origin,
 * which spends the page's one-time ticket and serves the document in that same response. Null when the app page
 * draws no frame. `app` is `createAppServer()`'s.
 */
export async function framedDocument(app: { request(input: string | Request, init?: RequestInit): Response | Promise<Response> }, path: string, init: RequestInit = {}): Promise<Response | null> {
  const page = await app.request(path, init);
  const src = /<iframe data-mx-document-frame="" src="([^"]+)"/.exec(await page.text())?.[1]?.replaceAll('&amp;', '&');
  if (!src) return null;
  return app.request(src, { headers: { accept: 'text/html' } });
}

/** A pages site for a pages host under a public URL, built as lib/http's `pagesSite()` builds the deployment's. */
export function testPagesSite(host: string, publicBaseUrl: string): PagesSite {
  const url = new URL(publicBaseUrl);
  return { host, scheme: url.protocol, port: url.port, app: url.origin };
}

/**
 * Set a dataset's policy through lib/document-data's policy door (the policy route's `writeDatasetPolicy`), with the
 * answers of the store call beneath it: the saved `{ revision, policy }`, `{ conflict: true }` for a stale revision,
 * null when the actor cannot edit that dataset, and an Error for an invalid policy (a version 1 or 2 body included).
 */
export async function setDatasetPolicy(actor: AccessActor, id: string, policy: unknown, expectedPolicyRevision: number): Promise<{ revision: number; policy: unknown } | { conflict: true } | null> {
  const { writeDatasetPolicy } = await import('@/lib/document-data');
  const response = await writeDatasetPolicy(actor, id, { policy, expectedPolicyRevision });
  const body = await response.json() as { revision: number; policy: unknown; detail?: string };
  if (response.status === 404) return null;
  if (response.status === 409) return { conflict: true };
  if (response.status !== 200) throw new Error(body.detail ?? `policy refused (${response.status})`);
  return body;
}

/**
 * EVERY STATEMENT THE DATABASE SEES while `work` runs, for query-budget tests: their text (inside transactions
 * too), how many transactions `work` opened, and the statement count `measureQueries` reports.
 */
export async function recordStatements<T>(work: () => Promise<T>): Promise<{ value: T; sql: string[]; transactions: number; count: number }> {
  const db = await getDb();
  // Restored exactly as found (an own property only if there was one), so the harness's reuse check sees no change.
  const own = { query: Object.getOwnPropertyDescriptor(db, 'query'), transaction: Object.getOwnPropertyDescriptor(db, 'transaction') };
  const query = db.query.bind(db), transaction = db.transaction.bind(db);
  const sql: string[] = [];
  let transactions = 0;
  db.query = (async <R,>(text: string, params?: unknown[]) => { sql.push(text); return query<R>(text, params); }) as typeof db.query;
  db.transaction = (async <R,>(fn: (tx: Queryable) => Promise<R>) => {
    transactions++;
    return transaction((tx) => fn({ query: async <U,>(text: string, params?: unknown[]) => { sql.push(text); return tx.query<U>(text, params); } }));
  }) as typeof db.transaction;
  try {
    // The index, asked late: a test file's vi.mock of a platform module must still reach it.
    const { measureQueries } = await import('@/lib/platform');
    const { value, stats } = await measureQueries(work);
    return { value, sql, transactions, count: stats.count };
  } finally {
    for (const name of ['query', 'transaction'] as const) {
      const descriptor = own[name];
      if (descriptor) Object.defineProperty(db, name, descriptor); else delete (db as Partial<Db>)[name];
    }
  }
}

/** Admit fixtures through verified-email acceptance, never role PUT. */
export async function admitGroupMember(actorId:string,groupId:string,userId:string,role:import('@artifactbin/contracts').GroupRole):Promise<void>{
 const email=(await (await getDb()).query<{email:string}>('SELECT email FROM users WHERE id=$1',[userId])).rows[0]?.email;
 if(!email)throw Error('Fixture member requires an email account');
 await inviteGroupMember(actorId,groupId,email,role);await acceptGroupInvitations(userId,email);
}
