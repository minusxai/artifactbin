import {userHostIngress,viteMayAnswer} from './services/app/server/user-host';
import {closeDefaultConnection,validateDefaultConnection} from './services/app/lib/connections';
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
import { developmentViteConfig } from './services/app/lib/runtime/dev-vite';
import { withRequestLog } from './services/app/lib/runtime/request-log';
import { getRequestListener } from '@hono/node-server';
import { assemble } from '@artifactbin/utils/assemble';
import { authEnvNamesRead, readEnv } from '@artifactbin/auth';
import { bootMode } from './services/app/server/boot-settings';
import { useLoopbackLookup } from '@artifactbin/utils/node/loopback-lookup';

// The server's own outbound calls (the exporter, a session's cookie jar, its public URL) may name a loopback
// host (`app.lvh.me`, `<hex id>.lvh.me`, `*.localhost`): resolved here, never asked of DNS.
useLoopbackLookup();

async function main(): Promise<void> {
  const env = process.env;
  const dev = bootMode(env) === 'development';
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

  const { createAppHost } = await import('@/server/host');
  const { localAuthentication } = await import('@/server/local-authentication');

  // An image built without an engine or a browser needs to be told where they
  // went — before a boot canary passes and the first export answers 503.
  const {
    BROWSER_SERVICE_URL, EVENTS_SCHEMA, EVENTS_SERVICE_URL, MAX_ROWS_LIMIT, QUERY_TIMEOUT_MS, SQL_MUTATION_TIMEOUT_MS, SQL_SERVICE_URL,
    services, setServices,
  } = await import('@/lib/platform');
  /** Settings another package's env boundary consumed on this process's behalf. */
  const sessionEnvNames = new Set<string>();
  // Dev only: Vite's HMR socket port, derived from our own port (see the Vite server below). The session browser
  // is told it too, so a hosted check's app page may reach that one loopback socket.
  const hmrPort: number | null = dev
    ? await import('@/lib/platform').then(({ APP_HMR_PORT_SETTING, resolveHmrPort }) => resolveHmrPort(APP_HMR_PORT_SETTING, port))
    : null;

  // The SPA: Vite in front of the listener in development (lib/runtime/dev-vite); the built tree in production.
  let vite: import('vite').ViteDevServer | null = null;
  if (dev && hmrPort !== null) {
    const { requirePagesHost } = await import('@/lib/platform');
    vite = await (await import('vite')).createServer(developmentViteConfig({ configFile: path.resolve(import.meta.dirname, 'vite.config.mts'), appRoot: process.cwd(), port, hmrPort, pagesHost: requirePagesHost(), publicBaseUrl: baseURL }));
  }

  // DATASETS__DEFAULT_CONNECTION: a bad value stops the start here, naming the setting (never its value).
  validateDefaultConnection();
  /** The admission parts authentication puts in front of the app (server/local-authentication), composed once the database is open. */
  let admission: Awaited<ReturnType<typeof localAuthentication>> | undefined;
  let server: http.Server | undefined;
  let dbKind = '';
  /*
   * THE APP HOST (server/host): the database, the boot reads, the durable jobs/outbox lifecycle every process entry
   * starts, and the app server. The database opens before the services below, because one of them writes through it.
   */
  const host = await createAppHost({
    webDir: path.resolve('dist/web'),
    ...(hmrPort !== null ? { devHmrPort: hmrPort } : {}),
    // The separate proxy transports identity in a signed header, rather than on the Request object —
    // and so does a development browser session, whose hop is a real request on this same socket.
    ...(appOnly
      ? { actorSecret: readEnv(env, 'CONTRACT__ACTOR_SECRET') || readEnv(env, 'AUTH__SECRET') }
      : dev && sessionActorSecret ? { actorSecret: sessionActorSecret } : {}),
    ...(vite ? { indexHtml: async (url: string) =>
      vite!.transformIndexHtml(url, (await import('node:fs')).readFileSync(path.resolve('web/solid-app.html'), 'utf8')) } : {}),
    initialize: async db => {
      dbKind = db.raw().kind;
      const queryable = { query: async <T = Record<string, unknown>>(sql: string, params: unknown[] = []) => (await db.query<T>(sql, params)) as { rows: T[] } };
      /**
       * THE SERVICES, INJECTED ONCE — this is the only place the process decides
       * where the SQL engine, Chromium and the event log live (`lib/services` registry).
       * Registered only when no URL names a service, because `./local` is the
       * entry that loads the native module, Playwright or the writer's own DDL,
       * and the lean image has none of them.
       */
      if (!SQL_SERVICE_URL) {
        const { createSql } = await import('@artifactbin/sql/local');
        setServices({ sql: createSql({ maxRows: MAX_ROWS_LIMIT, timeoutMs: QUERY_TIMEOUT_MS, mutationTimeoutMs: SQL_MUTATION_TIMEOUT_MS }) });
      }
      if (!BROWSER_SERVICE_URL) {
        const { createBrowser, sessionEnvNamesRead, sessionProcessPaths } = await import('@artifactbin/browser/local');
        const { sessionBridge } = await import('@/lib/runtime');
        // The app is composed after this; the hop is chosen once, on the first page a session opens.
        let hop: ReturnType<typeof sessionBridge> | undefined;
        const browser = createBrowser({ sessions: { ...sessionProcessPaths(env), baseURL, ...(hmrPort !== null ? { devSocketPort: hmrPort } : {}),
          request: (request, actor) => (hop ??= sessionBridge({ dev, port, secret: sessionActorSecret, app: host }))(request, actor) } });
        // BROWSER__RENDER_SANDBOX=chromium: a host that cannot sandbox Chromium refuses to boot here, by name.
        await browser.start();
        setServices({ browser });
        // The session settings are read in THAT package, so this process's audit is told about them.
        for (const name of sessionEnvNamesRead()) sessionEnvNames.add(name);
      }
      /*
       * The events writer runs IN THIS PROCESS on the app's OWN handle — a second engine pointed at one PGLite data
       * directory is a corrupted database, not a second reader — and authentication shares this same handle.
       */
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
       * AUTHENTICATION — human login and the public login/OAuth routes are skipped by `--app-only`, which still
       * admits bearers with auth's read against the existing family store.
       */
      admission = await localAuthentication({ env, db, baseURL, events: services().events, login: !appOnly });
    },
    shutdown: async () => {
      await new Promise<void>((resolve, reject) => server ? server.close(error => error ? reject(error) : resolve()) : resolve());
      await vite?.close();
      await closeDefaultConnection();
    },
  });

  /*
   * THE LISTENER: the app alone, or authentication assembled around it. ONE boot
   * path — the flag only decides who answers the socket.
   */
  const anonymousHosts = {name:'anonymousUserHosts',mount:<E extends import('hono').Env>(app:import('hono').Hono<E>)=>{app.use('*',userHostIngress(host));}};
  const listener = getRequestListener(assemble([anonymousHosts, ...admission!(host.request),
    ...(appOnly ? [{name:'application',mount:(app:import('hono').Hono)=>app.all('*',c=>host.fetch(c.req.raw))}] : [])]).fetch);

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
  server = http.createServer(withRequestLog(
    // An owner host's request reaches Vite only as server/user-host allows (`viteMayAnswer`).
    vite ? (req, res) => viteMayAnswer(req, baseURL) ? vite!.middlewares(req, res, () => void listener(req, res)) : void listener(req, res) : listener,
  ));
  server.once('error', (error: NodeJS.ErrnoException) => {
    if (error.code === 'EADDRINUSE') {
      console.error(`[boot] Port ${port} is already in use.${dev ? ' Choose a free app/HMR pair with: npm run setup -- --yes --port <port>' : ''}`);
      process.exit(1);
    }
    console.error('[boot] listener failed:', error);
    process.exit(1);
  });
  // The host's close: the background tasks, the events flush, then (its `shutdown`) this listener, Vite and the
  // default connection, and the database last.
  const { installShutdown } = await import('@/lib/runtime');
  installShutdown({ steps: [host.close] });

  server.listen(port, () => {
    console.log(`[boot] ${appOnly ? 'app-only' : 'auth + app'} on ${baseURL} (${dev ? 'dev' : 'production'}, db ${dbKind})`);
    if (hmrPort !== null) console.log(`[boot] vite hmr websocket on ws://localhost:${hmrPort} (defaults to APP__PORT + 1; APP__HMR_PORT overrides)`);
  });
}

void main().catch((error) => { console.error('[boot] failed:', error); process.exit(1); });
