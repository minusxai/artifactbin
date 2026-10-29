/**
 * THE EVENTS SERVICE, from the outside: the contract (re-exported from
 * @artifactbin/contracts), the table it owns, the HTTP client that speaks the
 * wire (utils' eventsClient), the server shell that serves ANY EventsService
 * over it, and the boot a process entry or a deployment wrapper calls. The
 * writer itself is `@artifactbin/events/local` — the shell serves whatever
 * EventsService it is handed, and only `runEvents` (the boot, which owns the
 * pool) reaches for the local one.
 */
import { Pool } from 'pg';
import type { EventsService, EventSink, EventSubscriber, Queryable } from '@artifactbin/contracts';
import { EVENTS_ROUTES } from '@artifactbin/contracts';
import { createEnv, jsonServer, log, serviceSecretForServer, type JsonServer } from '@artifactbin/utils';
import { createEvents, ensureEventsSchema } from './local';
import { DEFAULT_EVENTS_SCHEMA, IDENTIFIER } from './schema';

export type * from '@artifactbin/contracts';
export { EVENTS_ROUTES, EVENT_VERBS, eventName } from '@artifactbin/contracts';
export { eventsClient, type EventsClientOptions } from '@artifactbin/utils';
export { DEFAULT_EVENTS_SCHEMA, EVENTS_TABLE, EVENTS_TABLES } from './schema';

/** The one GET a shell answers — the liveness/readiness probe for whatever orchestrates the service. */
const HEALTH = '/health';

/**
 * One POST (`/emit`, a JSON array of envelopes → `{ accepted: n }`) plus
 * `GET /health`, answered BEFORE the secret check so the probe works with a
 * secret set. The same shell as services/sql's: utils' jsonServer with its
 * secret guard, method guard, body cap and name-only error.
 */
export function serveEvents(svc: EventsService, opts: { maxBody?: number; serviceSecret?: string; routes?: Record<string,(body:unknown)=>Promise<unknown>> } = {}): JsonServer {
  const routes: Record<string, (body: unknown) => Promise<unknown>> = {
    ...opts.routes,
    [EVENTS_ROUTES.publish]: async b => {
      if (!Array.isArray(b) || !svc.publish) throw new Error('Durable publication unavailable');
      await svc.publish(b);
      return {accepted:b.length};
    },
    [EVENTS_ROUTES.emit]: async (b) => {
      // The wire IS the envelope array; anything else is a 400 whose detail
      // stays in the operator log (jsonServer's catch).
      if (!Array.isArray(b)) throw new Error(`${EVENTS_ROUTES.emit}: body is not an array of envelopes`);
      await svc.emit(b);
      return { accepted: b.length };
    },
  };
  return jsonServer(routes, { maxBody: opts.maxBody ?? 1024 * 1024, health: HEALTH, serviceSecret: opts.serviceSecret, label: 'events-shell' });
}

/** What the process needs, resolved from the environment by `loadEventsConfig`. */
interface EventsConfig {
  /** APP__PORT, default 8080; 0 = ephemeral. */
  port: number;
  /** APP__HOST, default 0.0.0.0. */
  host?: string;
  /** DATABASE_URL — the events role's own connection. Required unless a `db` is injected at run. */
  databaseUrl?: string;
  /** EVENTS__SCHEMA, default `events`. */
  schema: string;
  /** INTERNAL__SERVICE_SECRET — required in production (utils serviceSecretForServer). */
  serviceSecret?: string;
  /** MODULE__NAME settings of our shape that nothing read — a typo, reported at boot. */
  unknownNames: string[];
}

interface LoadEventsConfigOptions {
  /** Names that MUST be present; every missing one is named in ONE error. */
  required?: string[];
  /** Names the CALLER reads itself (a deployment wrapper's own settings), so the audit does not report them unknown. */
  known?: string[];
}

/** Read the process environment into an EventsConfig. Pure: a test hands it a plain object. */
export function loadEventsConfig(source: Record<string, string | undefined>, opts: LoadEventsConfigOptions = {}): EventsConfig {
  const missing = [...new Set(opts.required ?? [])].filter((name) => {
    const value = source[name];
    return value === undefined || value.trim() === '';
  });
  // EVERY missing name in ONE error — one round trip to a complete .env, never the first only.
  if (missing.length) throw new Error(`Required environment names are missing or empty: ${missing.join(', ')}`);

  const { env, unknownNames } = createEnv(source);
  // Eager, every name — the audit is only honest if nothing is read lazily.
  const portRaw = env('APP', 'PORT');
  const parsedPort = Number(portRaw);
  const port = portRaw !== undefined && portRaw.trim() !== '' && Number.isInteger(parsedPort) && parsedPort >= 0 && parsedPort <= 65_535
    ? parsedPort
    : 8080;
  const host = env('APP', 'HOST') || '0.0.0.0';
  const schema = env('EVENTS', 'SCHEMA') || DEFAULT_EVENTS_SCHEMA;
  if (!IDENTIFIER.test(schema)) throw new Error(`EVENTS__SCHEMA ${JSON.stringify(schema)} is not a plain identifier`);
  // The secret is read THROUGH the audit (so it is not reported unknown) and
  // then judged by utils' one rule: production is fail-closed.
  const secret = env('INTERNAL', 'SERVICE_SECRET');
  const serviceSecret = serviceSecretForServer({
    ...(secret !== undefined ? { INTERNAL__SERVICE_SECRET: secret } : {}),
    ...(source.NODE_ENV !== undefined ? { NODE_ENV: source.NODE_ENV } : {}),
  } as NodeJS.ProcessEnv);
  // A conventional exception (DATABASE_URL/S3_URL) — no MODULE__NAME shape, so
  // it is read straight from the source and audited by nobody.
  const databaseUrl = source.DATABASE_URL || undefined;
  const known = new Set(opts.known ?? []);
  return {
    port,
    ...(host ? { host } : {}),
    ...(databaseUrl ? { databaseUrl } : {}),
    schema,
    ...(serviceSecret ? { serviceSecret } : {}),
    unknownNames: unknownNames().filter((name) => !known.has(name)),
  };
}

/** How a deployment composes against the OSS boot: the sinks, and (tests only) the database. */
interface EventsOverrides {
  routes?: Record<string,(body:unknown)=>Promise<unknown>>;
  sinks?: EventSink[];
  subscribers?: EventSubscriber[];
  /** A Queryable to write through instead of a pg Pool on `databaseUrl` — tests and the single image. */
  db?: Queryable;
}

interface RunningEvents {
  url: string;
  /** Stops the socket, then the pool; idempotent. Never installs signal handlers — the entry's job. */
  close(): Promise<void>;
}

/** A pg Pool behind the one database interface every package speaks. */
const poolQueryable = (pool: Pool): Queryable => ({
  query: async <T = Record<string, unknown>>(sql: string, params: unknown[] = []) => {
    const result = await pool.query(sql, params as never[]);
    return { rows: result.rows as T[] };
  },
});

/**
 * Boot: config → writer (schema ensured) → shell → listening socket. The
 * unknown-name warnings are logged under `events`.
 * The schema is ensured HERE, at boot, so a service that cannot reach its
 * database dies loudly instead of dropping the first hour of the log.
 */
export async function runEvents(config: EventsConfig, overrides: EventsOverrides = {}): Promise<RunningEvents> {
  const boot = log('events');
  for (const name of config.unknownNames) boot.warn(`${name} is set but nothing reads it`);

  let pool: Pool | undefined;
  let db = overrides.db;
  if (!db) {
    if (!config.databaseUrl) throw new Error('runEvents: DATABASE_URL is required when no database is injected');
    pool = new Pool({ connectionString: config.databaseUrl });
    db = poolQueryable(pool);
  }
  try {
    await ensureEventsSchema(db, config.schema);
  } catch (error) {
    if (pool) await pool.end();
    throw error;
  }
  const svc = createEvents({ db, schema: config.schema, ...overrides });
  const timer = setInterval(() => { void svc.drain().catch(error => boot.error('Delivery drain failed', {error:String(error)})); }, 1000);
  timer.unref();
  const server = serveEvents(svc, {serviceSecret:config.serviceSecret,routes:overrides.routes});
  const listening = server.listen(config.port, config.host);
  boot.info(`listening on ${listening.url}`, { schema: config.schema });

  let closing: Promise<void> | null = null;
  return {
    url: listening.url,
    close: () => {
      closing ??= (async () => {
        try { clearInterval(timer); await server.close(); await svc.drain(); } finally { if (pool) await pool.end(); }
      })();
      return closing;
    },
  };
}

// probe: pull request lane type check timing
