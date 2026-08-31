/**
 * THE STANDALONE PROXY — the OSS composition a deployment boots as-is or composes against.
 *
 * `createStandaloneProxy(config, deps, overrides)` assembles `[health, ...proxyParts(...)]`; the ONE hook is
 * `overrides.parts`, which receives that literal list and returns the list to assemble — a deployment drops,
 * replaces or inserts parts BY NAME (`p.name === 'forward'`) and never edits a part's internals.
 * `buildDeps(config)` builds what the composition needs from config alone (session-less without DATABASE_URL).
 * `runStandalone(config, overrides)` boots it: deps → proxy → listening socket, and returns the handle to
 * close it — the whole boot a downstream `main.ts` needs, so it can be ten lines of policy.
 */
import { Pool } from 'pg';
import { assemble, createTokenReader, log, overHttp, serve } from '@artifactbin/utils';
import type { Hono } from 'hono';
import type { Part, Queryable, TokenReader, Upstream } from '@artifactbin/contracts';
import { createHumanAuth, type HumanAuthOptions, type Mailer } from './auth/human';
import type { ProxyConfig } from './config';
import { sessionStoreOf } from './index';
import { resendMailer } from './mail';
import { proxyParts, type SessionStore } from './parts';
import { ensureProxySchema } from './schema';

/** What the composition needs beyond config. Session-less when tokens/sessions are absent. */
export interface StandaloneDeps {
  upstream: Upstream;
  tokens?: TokenReader;
  sessions?: SessionStore;
  identityDb?: Queryable;
}

/** `buildDeps`' result: the deps plus what must be closed on shutdown. */
export interface BuiltDeps extends StandaloneDeps {
  pool?: Pool;
  close(): Promise<void>;
}

/** How a deployment composes against the OSS list. */
export interface StandaloneOverrides {
  /**
   * Receives the assembled literal — `health` first, then `proxyParts(...)` in order, `forward` last — and
   * returns the parts to mount, in order. Identity when absent. Filter/replace/insert by `name`; a returned
   * list is mounted exactly as given (no dedup, no reordering).
   */
  parts?: (assembled: Part[]) => Part[];
}

/** What `runStandalone` hands back: where it listens and how to stop it (socket, then deps). */
export interface RunningProxy {
  url: string;
  close(): Promise<void>;
}

const healthPart = (): Part => ({
  name: 'health',
  mount: (app) => app.get('/health', (c) => c.json({ ok: true }, 200, { 'Cache-Control': 'no-store' })),
});

const sessionless = (): { tokens: TokenReader; sessions: SessionStore } => ({
  tokens: { byToken: async () => null, byId: async () => null, invalidate: () => {} },
  sessions: { resolve: async () => null },
});

export function createStandaloneProxy(config: ProxyConfig, deps: StandaloneDeps, overrides: StandaloneOverrides = {}): Hono {
  const bare = sessionless();
  const parts = [
    healthPart(),
    ...proxyParts({
      upstream: deps.upstream,
      env: config.env,
      tokens: deps.tokens ?? bare.tokens,
      sessions: deps.sessions ?? bare.sessions,
      cookieSecret: config.authSecret,
      ...(config.secure ? { secure: true } : {}),
      ...(deps.identityDb ? { identityDb: deps.identityDb } : {}),
      upstreamDeadlineMs: config.upstreamDeadlineMs,
    }),
  ];
  return assemble(overrides.parts ? overrides.parts(parts) : parts);
}

const poolQueryable = (pool: Pool): Queryable => ({
  query: async <T = Record<string, unknown>>(sql: string, params: unknown[] = []) => {
    const result = await pool.query(sql, params as never[]);
    return { rows: result.rows as T[] };
  },
});

/**
 * Everything `createHumanAuth` needs that comes from config: secret, public base URL (or localhost:port), schema, secure,
 * the login providers (`config.google`, `config.oidc`) and the mailer — pure, so a test can see exactly what a config
 * turns into. `buildDeps` spreads this over its pool; the co-hosted server spreads the same shape over its PGLite.
 */
export function humanAuthOptionsFor(config: ProxyConfig, mail: Mailer): Omit<HumanAuthOptions, 'pool' | 'pglite'> {
  return {
    secret: config.authSecret,
    baseURL: config.publicBaseUrl ?? `http://localhost:${config.port}`,
    schema: config.authSchema,
    ...(config.secure ? { secure: true } : {}),
    ...(config.google ? { google: config.google } : {}),
    ...(config.oidc ? { oidc: config.oidc } : {}),
    mail,
  };
}

export async function buildDeps(config: ProxyConfig): Promise<BuiltDeps> {
  const upstream = overHttp(config.upstreamUrl, config.actorSecret);
  if (!config.databaseUrl) return { upstream, close: async () => {} };
  const pool = new Pool({ connectionString: config.databaseUrl });
  const db = poolQueryable(pool);
  await ensureProxySchema(db, config.authSchema);
  const human = await createHumanAuth({
    ...humanAuthOptionsFor(config, resendMailer(config.mail)),
    pool,
  });
  return {
    upstream,
    tokens: createTokenReader({ db, ttlMs: 5000, schema: config.appSchema }),
    sessions: sessionStoreOf(human),
    identityDb: db,
    pool,
    close: async () => { await pool.end(); },
  };
}

/**
 * Boot: deps → proxy → `serve` on `config.port` (`APP__PORT=0` = an ephemeral port; the returned `url` says
 * which) and `config.host` when set. Logs the boot warnings main.ts logs today (unknown names, generated
 * secret, no DATABASE_URL, no mail key) under the `proxy` logger. `close()` stops the socket, then the deps,
 * and is idempotent. Never installs signal handlers or exits the process — that is the entry's job.
 */
export async function runStandalone(config: ProxyConfig, overrides: StandaloneOverrides = {}): Promise<RunningProxy> {
  const boot = log('proxy');
  for (const name of config.unknownNames) boot.warn(`${name} is set but nothing reads it`);
  if (config.authSecretGenerated) boot.warn('AUTH__SECRET unset — generated per boot; sessions and the agent cookie do not survive a restart');
  if (!config.databaseUrl) boot.warn('DATABASE_URL unset — session-less: no login, no OAuth, bearer tokens unresolved');
  if (!config.mail.apiKey) boot.warn('EMAIL__RESEND_API_KEY unset — the mailer refuses to send; there is no log-the-code fallback');

  const deps = await buildDeps(config);
  const proxy = createStandaloneProxy(config, deps, overrides);
  const listening = serve(proxy, config.port, config.host ? { host: config.host } : {});
  try {
    await listening.ready;
  } catch (error) {
    await deps.close();
    throw error;
  }
  boot.info(`listening on ${listening.url} → ${config.upstreamUrl}`, { login: !!config.databaseUrl });

  let closing: Promise<void> | null = null;
  return {
    url: listening.url,
    close: () => {
      closing ??= (async () => {
        try { await listening.close(); } finally { await deps.close(); }
      })();
      return closing;
    },
  };
}
