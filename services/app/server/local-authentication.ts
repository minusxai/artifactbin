/**
 * AUTHENTICATION IN FRONT OF THE APP, IN ONE PROCESS: the parts that admit a request before the app sees it, composed
 * from env over the app's own database. server.ts serves through them, and so do the tests that drive a login end to
 * end (test/helpers/auth-host.ts), so both compose authentication one way.
 *
 * Bearers are admitted by auth's one-statement read (token, family fence, identity) and the app's own account rule,
 * so the auth tables it reads are created first. With `login`, human login (Better Auth, its options from the auth
 * package's pure builders, mail through the configured mailer or the dev outbox) and the public login and OAuth
 * routes join, and the app's human-session liveness reads that login's sessions. Without it (`npm run dev:app`), only
 * bearer admission runs, over the same tables. Either way the identity read surface is ensured again afterwards,
 * now that Better Auth's tables exist (its `sessions` view).
 */
import { backfillTrustedRoot, authParts, bearerAdmission, createBearerReader, createHumanAuth, ensureAuthSchema, ensureHumanAuthSchema, loginProvidersOf, mailerForRuntime, mailSettingsOf, readEnv, sessionStoreOf, testDomainSignInOf } from '@artifactbin/auth';
import type { EventsService } from '@artifactbin/contracts/events';
import type { Part, Upstream } from '@artifactbin/contracts/part';
import { parseServiceAudiences } from '@artifactbin/contracts/service-audiences';
import { admitDeploymentIdentity, validateDeploymentConfiguration } from '@/lib/deployment';
import { ensureLocalIdentity, setServices, type Db } from '@/lib/platform';
import { canAuthenticateUser } from '@/lib/user-kinds';

export interface LocalAuthenticationOptions {
  env: NodeJS.ProcessEnv;
  /** The app's own database: the auth tables, Better Auth's and the identity read surface live on it. */
  db: Db;
  /** APP__PUBLIC_BASE_URL: the origin login links and cookies are minted for. */
  baseURL: string;
  events: EventsService;
  /** Human login and its public routes (AUTH__SECRET signs them); false admits bearers alone. */
  login: boolean;
}

/** The admission parts for an app reached through `upstream`, in the order they run. */
export async function localAuthentication(o: LocalAuthenticationOptions): Promise<(upstream: Upstream) => Part[]> {
  const { env, db, baseURL, events } = o;
  const raw = db.raw();
  const store = raw.kind === 'pglite' ? { pglite: raw.instance } : { pool: raw.pool as import('pg').Pool };
  const queryable = { query: async <T = Record<string, unknown>>(sql: string, params: unknown[] = []) => (await db.query<T>(sql, params)) as { rows: T[] } };
  const authSchema = readEnv(env, 'AUTH__SCHEMA') ?? 'auth';
  await ensureAuthSchema(queryable, authSchema);
  if (!o.login) await ensureHumanAuthSchema({ schema: authSchema, ...store });
  const tokens = createBearerReader({ db: queryable, authSchema, readSchema: readEnv(env, 'IDENTITY__SCHEMA'), serviceAudiences: parseServiceAudiences(readEnv(env, 'IDENTITY__SERVICE_AUDIENCES')), admitBearer: token => canAuthenticateUser(token.userId) });
  if (!o.login) {
    await ensureLocalIdentity(db);
    return () => [bearerAdmission({ env, tokens, admitIdentity: admitDeploymentIdentity })];
  }
  validateDeploymentConfiguration();
  const secret = readEnv(env, 'AUTH__SECRET');
  if (!secret) throw new Error('[boot] human login needs AUTH__SECRET');
  const secure = baseURL.startsWith('https://'), testDomain = testDomainSignInOf(env);
  const human = await createHumanAuth({
    secret, baseURL, events, secure, schema: authSchema, ...store, ...loginProvidersOf(env), ...(testDomain ? { testDomain } : {}),
    mail: mailerForRuntime({ ...mailSettingsOf(env), publicBaseUrl: baseURL, devOutboxPath: readEnv(env, 'EMAIL__DEV_OUTBOX_PATH') }),
  });
  setServices({ humanSessions: human.sessions });
  await ensureLocalIdentity(db);
  await backfillTrustedRoot(db,env,authSchema,readEnv(env,'APP__SCHEMA'));
  return upstream => authParts({
    upstream, env, tokens, sessions: sessionStoreOf(human), admitIdentity: admitDeploymentIdentity, cookieSecret: secret, secure,
    identityDb: queryable,
    // The trusted-issuer sign-in's writes, in one transaction on the app's own handle (identityDb stays plain).
    identityTransactions: { ...queryable, transaction: fn => db.transaction(fn) },
    appSchema: readEnv(env, 'APP__SCHEMA'),
    events,
  });
}
