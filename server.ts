/**
 * OSS single-process host: shared authentication wraps the app. SQL, browser
 * and events run locally unless their service URLs select HTTP implementations.
 * `--app-only` supports development of the app without login routes.
 * Engine imports stay lazy at this composition boundary so remote service
 * selections never load DuckDB or Playwright into the app process.
 */
import http from 'node:http';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { developmentViteOptions } from './services/app/lib/dev-vite';
import { getRequestListener } from '@hono/node-server';
import { assemble, createTokenReader, inProcess } from '@artifactbin/utils';
import { ensureAuthSchema, authEnvNamesRead, authParts, readEnv, mailerForRuntime, createHumanAuth, loginProvidersOf, sessionStoreOf } from '@artifactbin/auth';

async function main(): Promise<void> {
  const env = process.env;
  const dev = env.NODE_ENV !== 'production';
  if (!dev && !readEnv(env, 'AUTH__SECRET')) {
    throw new Error('[boot] AUTH__SECRET is required in production (sessions and the agent cookie must survive a restart). Generate one: openssl rand -base64 32 — or run: npm run setup');
  }
  if (!dev && !readEnv(env, 'APP__PUBLIC_BASE_URL')) {
    throw new Error('[boot] APP__PUBLIC_BASE_URL is required in production (every published link is minted from it). Set it to the URL people reach this on.');
  }
  /** `npm run dev:app`: the app alone, no authentication composition (see the header). */
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
  // Establish the shared dev secret before app modules capture their config.
  // Otherwise auth rejects the guest cookie signed with the app's fallback.
  if (!appOnly && !readEnv(env, 'AUTH__SECRET')) env.AUTH__SECRET = generatedAuthSecret();

  /*
   * THE SESSION'S OWN ACTOR SECRET. In development a browser session's page requests
   * travel over loopback HTTP so that Vite — which fronts the listener, not the app —
   * serves them the modules a real browser gets (lib/session-bridge says why). That hop
   * carries the actor in the same signed header a split deployment uses, so development
   * needs a secret to sign with. Generated per boot and never written down: nothing
   * outside this process can mint an actor with it, and a restart invalidates it.
   * In production this stays exactly as configured — unset means the in-process hop.
   */
  const sessionActorSecret = readEnv(env, 'CONTRACT__ACTOR_SECRET')
    || (dev ? randomBytes(32).toString('base64url') : undefined);

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
   * not a second reader — and the authentication composition below shares this same
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
  /** Settings another package's env boundary consumed on this process's behalf. */
  const sessionEnvNames = new Set<string>();
  if (!SQL_SERVICE_URL) {
    const { createSql } = await import('@artifactbin/sql/local');
    setServices({ sql: createSql({ maxRows: MAX_QUERY_ROWS, timeoutMs: QUERY_TIMEOUT_MS }) });
  }
  if (!BROWSER_SERVICE_URL) {
    const { createBrowser, sessionEnvNamesRead, sessionProcessPaths } = await import('@artifactbin/browser/local');
    const { sessionBridge } = await import('@/lib/session-bridge');
    // `app` is composed below; the hop is chosen once, on the first page a session opens.
    let hop: ReturnType<typeof sessionBridge> | undefined;
    setServices({ browser: createBrowser({ sessions: { ...sessionProcessPaths(env), baseURL,
      request: (request, actor) => (hop ??= sessionBridge({ dev, port, secret: sessionActorSecret, app }))(request, actor) } }) });
    // The session settings are read in THAT package, so this process's audit is told about them.
    for (const name of sessionEnvNamesRead()) sessionEnvNames.add(name);
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
   * ONE `events` FOR THE WHOLE PROCESS. The authentication parts and Better Auth's
   * hooks say their moments into the SAME writer the app emits through — the
   * registry decided above once, never a second client — so the log this box
   * keeps is one table with one connection behind it, and `source` is all
   * that says whether the app or authentication spoke.
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
      ...developmentViteOptions(process.cwd(), port),
    });
  }
  /*
   * AUTHENTICATION COMPOSITION — skipped whole by `--app-only`: human login,
   * its schema and mailer, the token reader, the parts and the assembly.
   * Nothing below runs in the app-only shape; the app's own listener is
   * served directly instead (see the listener at the bottom).
   */
  let authSecret: string | undefined;
  let human: Awaited<ReturnType<typeof createHumanAuth>> | undefined;
  let reader: ReturnType<typeof createTokenReader> | undefined;
  if (!appOnly) {
    /* HUMAN LOGIN (Better Auth), composed from env — the options from the ONE pure builder. */
    authSecret = readEnv(env, 'AUTH__SECRET')!;
    const authSchema = readEnv(env, 'AUTH__SCHEMA') ?? 'auth';
    await ensureAuthSchema(queryable, authSchema);
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
     * THE AUTH BOUNDARY’S ONE READ of the app-owned `tokens` table: an indexed SELECT
     * with a short cache (utils createTokenReader), never an HTTP call. The
     * schema is where the deployment put the app's tables (APP__SCHEMA, public
     * by default). A revoke is immediate in the app's own reads and ≤ TTL here.
     */
    const appSchema = readEnv(env, 'APP__SCHEMA');
    reader = createTokenReader({ db: queryable, ttlMs: 5000, ...(appSchema ? { schema: appSchema } : {}) });
  }

  const app = createAppServer({
    webDir: path.resolve('dist/web'),
    ...(hmrPort !== null ? { devHmrPort: hmrPort } : {}),
    // The separate proxy transports identity in a signed header, rather than on the Request object —
    // and so does a development browser session, whose hop is a real request on this same socket.
    ...(appOnly
      ? { actorSecret: readEnv(env, 'CONTRACT__ACTOR_SECRET') || readEnv(env, 'AUTH__SECRET') }
      : dev && sessionActorSecret ? { actorSecret: sessionActorSecret } : {}),
    ...(reader ? { onTokenRevoked: (id) => reader.invalidate(id) } : {}),
    ...(vite ? { indexHtml: async (url: string) => vite!.transformIndexHtml(url, (await import('node:fs')).readFileSync(path.resolve('web/index.html'), 'utf8')) } : {}),
  });

  /*
   * THE LISTENER: the app alone, or authentication assembled around it. ONE boot
   * path — the flag only decides who answers the socket.
   */
  const listener = appOnly
    ? getRequestListener(app.fetch)
    : getRequestListener(assemble(authParts({
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
  const { unknownEnvNames, envNamesRead } = await import('@/lib/config');
  // Split mode reads only the identity transport settings, not authentication configuration.
  const known = new Set([...envNamesRead(), ...(!appOnly ? authEnvNamesRead() : [])]);
  known.add('CONTRACT__ACTOR_SECRET');
  for (const name of sessionEnvNames) known.add(name);
  if (appOnly) known.add('AUTH__SECRET');
  for (const name of unknownEnvNames(env, known)) {
    console.warn(`[env] ${name} is set but nothing reads it`);
  }

  /*
   * THE HTTP SERVER — the Vite chain (dev only) in FRONT of the listener for
   * its own assets: Vite runs `appType: 'custom'`, so it claims /@vite/*, /@fs/*,
   * /@id/*, /node_modules/.vite/* and web/ sources and calls next() for
   * everything else — so in dev its asset paths are matched BEFORE the door check.
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
    console.log(`[boot] ${appOnly ? 'app-only' : 'auth + app'} on ${baseURL} (${dev ? 'dev' : 'production'}, db ${raw.kind})`);
    if (hmrPort !== null) console.log(`[boot] vite hmr websocket on ws://localhost:${hmrPort} (defaults to APP__PORT + 1; APP__HMR_PORT overrides)`);
  });
}

void main().catch((error) => { console.error('[boot] failed:', error); process.exit(1); });
