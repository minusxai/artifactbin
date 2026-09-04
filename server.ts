/**
 * THE SERVER — one process: the proxy (services/proxy, as PARTS) in front of
 * the app (server/app: Hono — the API and document handlers, the reader/owner
 * split, the SPA), sharing one database. There is no Node-layer runner any
 * more: the parts' `forward` hands each Request to `inProcess(app)` — the
 * SAME Request object, the actor riding it (utils attachActor) — so nothing
 * is rebuilt, no header is stamped, and `CONTRACT__ACTOR_SECRET` is not
 * generated per boot (nothing in-process signs anything; the app's header
 * fallback simply never fires because no header arrives).
 *
 *   dev:  scripts/dev.mjs  → `tsx server.ts`          (proxy + app; Vite in middleware mode, HMR on APP__PORT + 1)
 *   dev:  scripts/dev-app.mjs → `tsx server.ts --app-only`  (the app ALONE — see below)
 *   prod: node proxy-server.mjs               (bundled by scripts/build-server.mjs; the SPA from dist/web)
 *
 * `--app-only` is the ONE deviation, and it is a flag rather than a second
 * entry file on purpose: two entries is one more place the Vite chain and
 * the canary order can drift. It skips the proxy composition (auth schema,
 * mailer, human login, token reader, `assemble`) and serves the app's own
 * listener directly — the shape `npm run dev:app` runs when the proxy is a
 * separate process beside it (or not wanted at all): db → object-store
 * canary → register local sql/browser when no URL names them → Vite chain →
 * the app. The app resolves bearer/agent-cookie credentials itself in direct
 * mode (lib/viewer); what is deliberately absent is the PROXY's surface —
 * human login and OAuth answer 404 here, which is exactly what a dev loop
 * that fronts this app with its own proxy wants to see.
 *
 * Boot: the database opens and applies its schema; the object-store canary
 * runs (a bad S3_URL fails HERE, with the store named); the proxy's own
 * proxy-owned OAuth tables in the `auth` schema are ensured; human login
 * (Better Auth) is composed from env;
 * the token reader (the proxy's one SELECT over the app-owned `tokens`) is
 * pointed at the shared database; the parts are assembled around
 * `inProcess(app)` — all of that is the FULL shape, skipped whole by
 * `--app-only`; the Vite chain sits in FRONT of the listener for dev assets
 * only.
 */
import http from 'node:http';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { getRequestListener } from '@hono/node-server';
import { assemble, createTokenReader, inProcess } from '@artifactbin/utils';
import { ensureProxySchema, proxyEnvNamesRead, proxyParts, readEnv, mailerForRuntime, createHumanAuth, loginProvidersOf, sessionStoreOf } from '@artifactbin/proxy';

async function main(): Promise<void> {
  const env = process.env;
  const dev = env.NODE_ENV !== 'production';
  if (!dev && !readEnv(env, 'AUTH__SECRET')) {
    throw new Error('[boot] AUTH__SECRET is required in production (sessions and the agent cookie must survive a restart). Generate one: openssl rand -base64 32 — or run: npm run setup');
  }
  if (!dev && !readEnv(env, 'APP__PUBLIC_BASE_URL')) {
    throw new Error('[boot] APP__PUBLIC_BASE_URL is required in production (every published link is minted from it). Set it to the URL people reach this on.');
  }
  /** `npm run dev:app`: the app alone, no proxy composition (see the header). */
  const appOnly = process.argv.includes('--app-only');
  const port = Number(env.APP__PORT ?? (env.APP__PUBLIC_BASE_URL ? new URL(env.APP__PUBLIC_BASE_URL).port : '') ?? 3030) || 3030;
  const baseURL = env.APP__PUBLIC_BASE_URL ?? `http://localhost:${port}`;

  /*
   * HUMAN LOGIN signs with AUTH__SECRET — and the agent cookie rides the same
   * key. Without one, a generated per-boot secret forgets every browser's held
   * tokens on restart, so the generation is dev-only and says so.
   */
  const generatedAuthSecret = (): string => {
    console.warn('[boot] AUTH__SECRET unset — generated per boot; sessions and the agent cookie do not survive a restart');
    return randomBytes(32).toString('base64url');
  };

  const { getDb } = await import('@/lib/db');
  const { createAppServer } = await import('@/server/app');

  // An image built without an engine or a browser needs to be told where they
  // went — before a boot canary passes and the first export answers 503.
  const {
    BROWSER_SERVICE_URL, EVENTS_SCHEMA, EVENTS_SERVICE_URL, MAX_QUERY_ROWS, QUERY_TIMEOUT_MS, SQL_SERVICE_URL,
  } = await import('@/lib/config');

  /*
   * THE DATABASE OPENS FIRST, because one of the services below writes through
   * it. The events writer runs IN THIS PROCESS on the app's OWN handle — a
   * second engine pointed at one PGLite data directory is a corrupted database,
   * not a second reader — and the proxy composition below shares this same
   * `queryable`.
   */
  const db = await getDb();
  const raw = db.raw();
  const queryable = { query: async <T = Record<string, unknown>>(sql: string, params: unknown[] = []) => (await db.query<T>(sql, params)) as { rows: T[] } };

  /**
   * THE SERVICES, INJECTED ONCE — this is the only place the process decides
   * where DuckDB, Chromium and the event log live (`lib/services` registry).
   * Registered only when no URL names a service, because `./local` is the
   * entry that loads the native module, Playwright or the writer's own DDL,
   * and the lean image has none of them.
   */
  const { services, setServices } = await import('@/lib/services');
  if (!SQL_SERVICE_URL) {
    const { createSql } = await import('@artifactbin/sql/local');
    setServices({ sql: createSql({ maxRows: MAX_QUERY_ROWS, timeoutMs: QUERY_TIMEOUT_MS }) });
  }
  if (!BROWSER_SERVICE_URL) {
    const { createBrowser } = await import('@artifactbin/browser/local');
    setServices({ browser: createBrowser() });
  }
  if (!EVENTS_SERVICE_URL) {
    const { backfillAnalyticsEvents, createEvents, ensureEventsSchema } = await import('@artifactbin/events/local');
    setServices({ events: createEvents({ db: queryable, schema: EVENTS_SCHEMA }) });
    /*
     * THE BOOT PAYS FOR THE SCHEMA HERE, not on the first emit as the writer
     * alone would: the backfill has to INSERT into a table, so it has to exist
     * before the statement runs. Both are idempotent — the copy happens only
     * into a log holding no row of its own, because `trackEvent` dual-writes
     * every moment and a copy beside a live sentence would say it twice — and both are wrapped,
     * because telemetry may cost a boot a round trip but never the boot itself.
     * The database here is the app's own (PGLite, or a Postgres it owns), so it
     * holds `analytics_events` too; a SPLIT deployment's events role has no read
     * on the app schema, so its operator runs the same statement once by hand
     * (services/events/CONTRACT.md).
     */
    try {
      await ensureEventsSchema(queryable, EVENTS_SCHEMA);
      const copied = await backfillAnalyticsEvents(queryable, { schema: EVENTS_SCHEMA, from: 'analytics_events' });
      if (copied > 0) console.log(`[events] copied ${copied} legacy analytics rows into ${EVENTS_SCHEMA}.events`);
    } catch (error) {
      console.error('[events] the legacy analytics backfill failed:', error);
    }
  }
  /*
   * ONE `events` FOR THE WHOLE PROCESS. The proxy's parts and Better Auth's
   * hooks say their moments into the SAME writer the app emits through — the
   * registry decided above once, never a second client — so the log this box
   * keeps is one table with one connection behind it, and `source` is all
   * that says whether the app or the proxy spoke.
   */
  const events = services().events;

  // The SPA: Vite in middleware mode for dev (modules, HMR, index transform); the built tree in production.
  let vite: import('vite').ViteDevServer | null = null;
  let hmrPort: number | null = null;
  if (dev) {
    const { createServer } = await import('vite');
    const { APP_HMR_PORT_SETTING, resolveHmrPort } = await import('@/lib/config');
    hmrPort = resolveHmrPort(APP_HMR_PORT_SETTING, port);
    vite = await createServer({
      configFile: path.resolve(import.meta.dirname, 'vite.config.mts'),
      // Vite's HMR socket defaults to 24678 for every project on the machine;
      // derive it from our own port so two checkouts never fight over it.
      server: { middlewareMode: true, ws: { port: hmrPort } },
      appType: 'custom',
      // Vite pre-bundles what the SPA imports; the server-only trees (vega, duckdb,
      // playwright, PGLite) are the app's, never the browser's.
      optimizeDeps: { entries: ['web/main.tsx'] },
    });
  }
  /*
   * THE PROXY COMPOSITION — skipped whole by `--app-only`: human login,
   * its schema and mailer, the token reader, the parts and the assembly.
   * Nothing below runs in the app-only shape; the app's own listener is
   * served directly instead (see the listener at the bottom).
   */
  let authSecret: string | undefined;
  let human: Awaited<ReturnType<typeof createHumanAuth>> | undefined;
  let reader: ReturnType<typeof createTokenReader> | undefined;
  if (!appOnly) {
    /*
     * HUMAN LOGIN (Better Auth), composed from env exactly as the old
     * assembleProxy did — the options from the ONE pure builder.
     */
    authSecret = readEnv(env, 'AUTH__SECRET') ?? generatedAuthSecret();
    const authSchema = readEnv(env, 'AUTH__SCHEMA') ?? 'auth';
    await ensureProxySchema(queryable, authSchema);
    const mailer = mailerForRuntime({
      apiKey: readEnv(env, 'EMAIL__RESEND_API_KEY'),
      from: readEnv(env, 'EMAIL__FROM') ?? 'artifactbin <login@example.com>',
      publicBaseUrl: baseURL,
      devOutboxPath: readEnv(env, 'EMAIL__DEV_OUTBOX_PATH'),
    });
    const loginProviders = loginProvidersOf(env);
    human = await createHumanAuth({
      secret: authSecret,
      baseURL,
      mail: mailer,
      events,
      ...(raw.kind === 'pglite' ? { pglite: raw.instance } : { pool: raw.pool as import('pg').Pool }),
      ...loginProviders,
      secure: baseURL.startsWith('https://'),
      ...(authSchema ? { schema: authSchema } : {}),
    });

    /*
     * THE PROXY'S ONE READ of the app-owned `tokens` table: an indexed SELECT
     * with a short cache (utils createTokenReader), never an HTTP call. The
     * schema is where the deployment put the app's tables (APP__SCHEMA, public
     * by default). A revoke is immediate in the app's own reads and ≤ TTL here.
     */
    const appSchema = readEnv(env, 'APP__SCHEMA');
    reader = createTokenReader({ db: queryable, ttlMs: 5000, ...(appSchema ? { schema: appSchema } : {}) });
  }

  const app = createAppServer({
    webDir: path.resolve('dist/web'),
    ...(reader ? { onTokenRevoked: (id) => reader.invalidate(id) } : {}),
    ...(vite ? { indexHtml: async (url: string) => vite!.transformIndexHtml(url, (await import('node:fs')).readFileSync(path.resolve('web/index.html'), 'utf8')) } : {}),
  });

  /*
   * THE LISTENER: the app alone, or the proxy assembled around it. ONE boot
   * path — the flag only decides who answers the socket.
   */
  const listener = appOnly
    ? getRequestListener(app.fetch)
    : getRequestListener(assemble(proxyParts({
      upstream: inProcess(app),
      env,
      tokens: reader!,
      sessions: sessionStoreOf(human!),
      cookieSecret: authSecret!,
      secure: baseURL.startsWith('https://'),
      identityDb: queryable,
      appSchema: readEnv(env, 'APP__SCHEMA'),
      events,
    })).fetch);

  /*
   * SAY SOMETHING ABOUT AN ENV NOBODY READ. There is exactly one spelling of
   * each setting (lib/config `env`), so a name of our shape that nothing asked
   * for is either a typo or a setting from a version that no longer has it.
   */
  const { retiredEnvNamesInUse, unknownEnvNames, envNamesRead } = await import('@/lib/config');
  for (const { retired, replacement } of retiredEnvNamesInUse(env)) {
    // setup.mjs also prepares the checkout for the split compose shape, whose
    // proxy consumes this shared secret. It is expected but unused here.
    if (!appOnly && retired === 'CONTRACT__ACTOR_SECRET') continue;
    console.warn(`[env] ${retired} is not read any more — it was renamed to ${replacement}`);
  }
  // The proxy's names are read only where the proxy is composed; in the
  // app-only shape a set AUTH__SECRET is genuinely unread, and saying so is
  // the audit working, not noise.
  const known = new Set([...envNamesRead(), ...(!appOnly ? proxyEnvNamesRead() : [])]);
  if (!appOnly) known.add('CONTRACT__ACTOR_SECRET');
  for (const name of unknownEnvNames(env, known)) {
    console.warn(`[env] ${name} is set but nothing reads it`);
  }

  /*
   * THE HTTP SERVER — the Vite chain (dev only) in FRONT of the listener for
   * its own assets: Vite runs `appType: 'custom'`, so it claims /@vite/*, /@fs/*,
   * /@id/*, /node_modules/.vite/* and web/ sources and calls next() for
   * everything else. (One behaviour change from the old Node runner: Vite's
   * asset paths are matched BEFORE the door check rather than after. Dev only.)
   */
  const server = http.createServer(
    vite ? (req, res) => vite!.middlewares(req, res, () => void listener(req, res)) : listener,
  );
  server.once('error', (error: NodeJS.ErrnoException) => {
    if (error.code === 'EADDRINUSE') {
      console.error(`[boot] Port ${port} is already in use.${dev ? ' Choose a free app/HMR pair with: npm run setup -- --yes --port <port>' : ''}`);
      process.exit(1);
    }
    console.error('[boot] listener failed:', error);
    process.exit(1);
  });
  server.listen(port, () => {
    console.log(`[boot] ${appOnly ? 'app-only' : 'proxy + app'} on ${baseURL} (${dev ? 'dev' : 'production'}, db ${raw.kind})`);
    if (hmrPort !== null) console.log(`[boot] vite hmr websocket on ws://localhost:${hmrPort} (defaults to APP__PORT + 1; APP__HMR_PORT overrides)`);
  });
}

void main().catch((error) => { console.error('[boot] failed:', error); process.exit(1); });
