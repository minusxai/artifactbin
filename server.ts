import {isUserPagesHost,handleFromUserPagesHost} from './services/app/lib/user-pages';
import {userHostIngress,userHostStaticPath,USER_HOST_CREDENTIAL_HEADERS} from './services/app/server/user-host';
import {admitDeploymentIdentity,validateDeploymentConfiguration} from './services/app/lib/deployment';
import {closeDefaultConnection,validateDefaultConnection} from './services/app/lib/connections';
import {trustedForwarded} from './services/app/lib/http';
/**
 * OSS single-process host: shared authentication wraps the app. SQL, browser
 * and events run locally unless their service URLs select HTTP implementations.
 * `--app-only` supports development of the app without login routes.
 * Engine imports stay lazy at this composition boundary so remote service
 * selections never start SQL engine threads or Playwright in the app process.
 */
import http from 'node:http';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { developmentPagesHosts, developmentViteOptions } from './services/app/lib/runtime/dev-vite';
import { withRequestLog } from './services/app/lib/runtime/request-log';
import { getRequestListener } from '@hono/node-server';
import { assemble, inProcess } from '@artifactbin/utils';
import { bearerAdmission, createBearerReader, ensureAuthSchema, ensureHumanAuthSchema, authEnvNamesRead, authParts, readEnv, mailerForRuntime, mailSettingsOf, createHumanAuth, loginProvidersOf, sessionStoreOf, testDomainSignInOf } from '@artifactbin/auth';
import { useLoopbackLookup } from '@artifactbin/utils/node/loopback-lookup';

// The server's own outbound calls (the exporter, a session's cookie jar, its public URL) may name a loopback
// host (`app.lvh.me`, `<hex id>.lvh.me`, `*.localhost`): resolved here, never asked of DNS.
useLoopbackLookup();

async function main(): Promise<void> {
  const env = process.env;
  const dev = env.NODE_ENV !== 'production';
  if (!dev && !readEnv(env, 'AUTH__SECRET')) {
    throw new Error('[boot] AUTH__SECRET is required in production (sessions and the agent cookie must survive a restart). Generate one: openssl rand -base64 32 — or run: npm run setup');
  }
  if (!dev && !readEnv(env, 'APP__PUBLIC_BASE_URL')) {
    throw new Error('[boot] APP__PUBLIC_BASE_URL is required in production (every published link is minted from it). Set it to the URL people reach this on.');
  }
  // Every document is served on its own origin (lib/http/pages-origin): there is no other renderer to fall back to.
  if (!readEnv(env, 'APP__PAGES_HOST')) {
    throw new Error('[boot] APP__PAGES_HOST is required: every document is served on its own origin, <hex id>.<pages host>, framed by the app page. Development: APP__PAGES_HOST=lvh.me with APP__PUBLIC_BASE_URL=http://app.lvh.me:<port> — or run: npm run setup');
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

  const { getDb } = await import('@/lib/platform');
  const { canAuthenticateUser } = await import('@/lib/user-kinds');
  const { createAppServer } = await import('@/server/app');
  // The skill's deployment extras (SKILLS__EXTRA_DIR) are read now: an invalid directory refuses the boot.
  (await import('@/lib/skills')).skillExtras();

  // An image built without an engine or a browser needs to be told where they
  // went — before a boot canary passes and the first export answers 503.
  const {
    BROWSER_SERVICE_URL, EVENTS_SCHEMA, EVENTS_SERVICE_URL, MAX_QUERY_ROWS, QUERY_TIMEOUT_MS, SQL_SERVICE_URL,
  } = await import('@/lib/platform');

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
   * where the SQL engine, Chromium and the event log live (`lib/services` registry).
   * Registered only when no URL names a service, because `./local` is the
   * entry that loads the native module, Playwright or the writer's own DDL,
   * and the lean image has none of them.
   */
  const { services, setServices,USER_PAGES_HOST } = await import('@/lib/platform');
  /** Settings another package's env boundary consumed on this process's behalf. */
  const sessionEnvNames = new Set<string>();
  if (!SQL_SERVICE_URL) {
    const { createSql } = await import('@artifactbin/sql/local');
    setServices({ sql: createSql({ maxRows: MAX_QUERY_ROWS, timeoutMs: QUERY_TIMEOUT_MS }) });
  }
  // Dev only: Vite's HMR socket port, derived from our own port (see the Vite server below). The session browser
  // is told it too, so a hosted check's app page may reach that one loopback socket.
  const hmrPort: number | null = dev
    ? await import('@/lib/platform').then(({ APP_HMR_PORT_SETTING, resolveHmrPort }) => resolveHmrPort(APP_HMR_PORT_SETTING, port))
    : null;
  if (!BROWSER_SERVICE_URL) {
    const { createBrowser, sessionEnvNamesRead, sessionProcessPaths } = await import('@artifactbin/browser/local');
    const { sessionBridge } = await import('@/lib/runtime');
    // `app` is composed below; the hop is chosen once, on the first page a session opens.
    let hop: ReturnType<typeof sessionBridge> | undefined;
    setServices({ browser: createBrowser({ sessions: { ...sessionProcessPaths(env), baseURL, ...(hmrPort !== null ? { devSocketPort: hmrPort } : {}),
      request: (request, actor) => (hop ??= sessionBridge({ dev, port, secret: sessionActorSecret, app }))(request, actor) } }) });
    // The session settings are read in THAT package, so this process's audit is told about them.
    for (const name of sessionEnvNamesRead()) sessionEnvNames.add(name);
  }
  if (!EVENTS_SERVICE_URL) {
    const { createEvents, ensureEventsSchema } = await import('@artifactbin/events/local');
    setServices({ events: createEvents({ db: queryable, schema: EVENTS_SCHEMA }) });
    // The schema is paid for at boot, not on the first emit; idempotent, and wrapped because telemetry may cost a boot a round trip but never the boot itself.
    try {
      await ensureEventsSchema(queryable, EVENTS_SCHEMA);
    } catch (error) {
      console.error('[events] schema setup failed:', error);
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
  if (dev && hmrPort !== null) {
    const { createServer } = await import('vite');
    const { requirePagesHost } = await import('@/lib/platform');
    vite = await createServer({
      configFile: path.resolve(import.meta.dirname, 'vite.config.mts'),
      // Vite's HMR socket defaults to 24678 for every project on the machine;
      // derive it from our own port so two checkouts never fight over it.
      // With documents on their own origins (APP__PAGES_HOST), Vite must answer the pages hostnames it
      // fronts (its DNS-rebinding guard refuses unknown hosts) and leave CORS to the app's origin gate.
      server: { middlewareMode: true, ws: { port: hmrPort }, ...developmentPagesHosts(requirePagesHost(), baseURL) },
      appType: 'custom',
      // Vite pre-bundles what the SPA imports; the server-only trees (vega, sqlite-wasm,
      // playwright, PGLite) are the app's, never the browser's.
      ...developmentViteOptions(process.cwd(), port),
    });
  }
  /*
   * AUTHENTICATION COMPOSITION — skipped whole by `--app-only`: human login,
   * its schema and mailer, and the public login/OAuth routes.
   * App-only still uses auth-owned bearer admission against the existing family store.
   */
  let authSecret: string | undefined;
  let human: Awaited<ReturnType<typeof createHumanAuth>> | undefined;
  // Both compositions admit bearers with auth's one-statement read (token, family fence, identity), so both
  // create the auth tables it reads at boot; app-only omits login and mint routes.
  const authSchema = readEnv(env, 'AUTH__SCHEMA') ?? 'auth';
  await ensureAuthSchema(queryable, authSchema);
  if (appOnly) await ensureHumanAuthSchema({ schema: authSchema, ...(raw.kind === 'pglite' ? { pglite: raw.instance } : { pool: raw.pool as import('pg').Pool }) });
  const reader = createBearerReader({ db: queryable, authSchema, admitBearer: token => canAuthenticateUser(token.userId) });
  // DATASETS__DEFAULT_CONNECTION: a bad value stops the start here, naming the setting (never its value).
  validateDefaultConnection();
  if (!appOnly) {
    validateDeploymentConfiguration();
    /* HUMAN LOGIN (Better Auth), composed from env — the options from the ONE pure builder. */
    authSecret = readEnv(env, 'AUTH__SECRET')!;
    const mailer = mailerForRuntime({
      ...mailSettingsOf(env),
      publicBaseUrl: baseURL,
      devOutboxPath: readEnv(env, 'EMAIL__DEV_OUTBOX_PATH'),
    });
    const loginProviders = loginProvidersOf(env);
    const testDomain = testDomainSignInOf(env);
    human = await createHumanAuth({
      secret: authSecret,
      baseURL,
      mail: mailer,
      events,
      ...(raw.kind === 'pglite' ? { pglite: raw.instance } : { pool: raw.pool as import('pg').Pool }),
      ...loginProviders,
      ...(testDomain ? { testDomain } : {}),
      secure: baseURL.startsWith('https://'),
      ...(authSchema ? { schema: authSchema } : {}),
    });

    setServices({humanSessions:human.sessions});


  }

  // The identity read surface again, now that Better Auth's tables exist (its `sessions` view), when this process
  // hosts identity (lib/platform identity-host; its database open made the rest).
  await (await import('@/lib/platform')).ensureLocalIdentity(db);

  // All process entry points start the same durable jobs/outbox lifecycle.
  // This import stays after env + service initialization, as do the other app imports.
  const { startAppBackgroundTasks } = await import('@/lib/runtime');
  const stopBackgroundTasks = await startAppBackgroundTasks(db);

  const app = createAppServer({
    webDir: path.resolve('dist/web'),
    ...(hmrPort !== null ? { devHmrPort: hmrPort } : {}),
    // The separate proxy transports identity in a signed header, rather than on the Request object —
    // and so does a development browser session, whose hop is a real request on this same socket.
    ...(appOnly
      ? { actorSecret: readEnv(env, 'CONTRACT__ACTOR_SECRET') || readEnv(env, 'AUTH__SECRET') }
      : dev && sessionActorSecret ? { actorSecret: sessionActorSecret } : {}),
    ...(vite ? { indexHtml: async (url: string) =>
      vite!.transformIndexHtml(url, (await import('node:fs')).readFileSync(path.resolve('web/solid-app.html'), 'utf8')) } : {}),
  });

  /*
   * THE LISTENER: the app alone, or authentication assembled around it. ONE boot
   * path — the flag only decides who answers the socket.
   */
  const anonymousHosts = {name:'anonymousUserHosts',mount:<E extends import('hono').Env>(host:import('hono').Hono<E>)=>{host.use('*',userHostIngress(app));}};
  const listener = appOnly
    ? getRequestListener(assemble([anonymousHosts,bearerAdmission({env,tokens:reader,admitIdentity:admitDeploymentIdentity}),
      {name:'application',mount:host=>host.all('*',c=>app.fetch(c.req.raw))}]).fetch)
    : getRequestListener(assemble([anonymousHosts,...authParts({
      upstream: inProcess(app),
      env,
      tokens: reader,
      sessions: sessionStoreOf(human!),
      admitIdentity:admitDeploymentIdentity,
      cookieSecret: authSecret!,
      secure: baseURL.startsWith('https://'),
      identityDb: queryable,
      appSchema: readEnv(env, 'APP__SCHEMA'),
      events,
    })]).fetch);

  /*
   * SAY SOMETHING ABOUT AN ENV NOBODY READ. There is exactly one spelling of
   * each setting (lib/config `env`), so a name of our shape that nothing asked
   * for is either a typo or a setting from a version that no longer has it.
   */
  const { unknownEnvNames, envNamesRead } = await import('@/lib/platform');
  // Split mode reads only the identity transport settings, not authentication configuration.
  const known = new Set([...envNamesRead(), ...(!appOnly ? authEnvNamesRead() : [])]);
  known.add('CONTRACT__ACTOR_SECRET');
  for (const name of sessionEnvNames) known.add(name);
  if (appOnly) { known.add('AUTH__SECRET'); known.add('AUTH__SCHEMA'); }
  for (const name of unknownEnvNames(env, known)) {
    console.warn(`[env] ${name} is set but nothing reads it`);
  }

  /*
   * THE HTTP SERVER — the Vite chain (dev only) in FRONT of the listener for
   * its own assets: Vite runs `appType: 'custom'`, so it claims /@vite/*, /@fs/*,
   * /@id/*, /node_modules/.vite/* and web/ sources and calls next() for
   * everything else — so in dev its asset paths are matched BEFORE the door check.
   */
  const server = http.createServer(withRequestLog(
    vite ? (req, res) => {
      // The addressed host as the app reads it (lib/http trustedForwarded): a forwarded host only from a trusted hop.
      const header=(name:string)=>{const value=req.headers[name];return Array.isArray(value)?value.join(','):value??null;};
      const host=trustedForwarded({get:header},'x-forwarded-host')??req.headers.host??new URL(baseURL).host;
      if(isUserPagesHost(host,USER_PAGES_HOST)){
        const pathname=new URL(req.url??'/',baseURL).pathname;
        // Vite normally fronts authentication. Owner hosts must never reach its
        // executable source graph or bypass the product's resource boundary.
        if(!handleFromUserPagesHost(host,USER_PAGES_HOST)||!['GET','HEAD'].includes(req.method??'')||!userHostStaticPath(pathname)){
          void listener(req,res);return;
        }
        for(const name of USER_HOST_CREDENTIAL_HEADERS)delete req.headers[name];
      }
      vite!.middlewares(req,res,()=>void listener(req,res));
    } : listener,
  ));
  server.once('error', (error: NodeJS.ErrnoException) => {
    if (error.code === 'EADDRINUSE') {
      console.error(`[boot] Port ${port} is already in use.${dev ? ' Choose a free app/HMR pair with: npm run setup -- --yes --port <port>' : ''}`);
      process.exit(1);
    }
    console.error('[boot] listener failed:', error);
    process.exit(1);
  });
  const { installShutdown } = await import('@/lib/runtime');
  installShutdown({ steps: [
    stopBackgroundTasks,
    () => services().events.close?.() ?? Promise.resolve(),
    () => new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())),
    async () => { await vite?.close(); },
    closeDefaultConnection,
    () => db.close(),
  ] });

  server.listen(port, () => {
    console.log(`[boot] ${appOnly ? 'app-only' : 'auth + app'} on ${baseURL} (${dev ? 'dev' : 'production'}, db ${raw.kind})`);
    if (hmrPort !== null) console.log(`[boot] vite hmr websocket on ws://localhost:${hmrPort} (defaults to APP__PORT + 1; APP__HMR_PORT overrides)`);
  });
}

void main().catch((error) => { console.error('[boot] failed:', error); process.exit(1); });
