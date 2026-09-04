/**
 * HUMAN LOGIN — Better Auth, core plus the two first-party plugins that ARE
 * the login surface (`emailOTP`, `genericOAuth`), Google as a core social
 * provider. Nothing else is installed: not `apiKey`, not `mcp`/`oidcProvider`,
 * not `admin` (no impersonation, ever). Every option below is load-bearing:
 *
 *  - sessions DB-backed with the cookie cache OFF — deleting the row is
 *    immediate revocation (spike D);
 *  - `generateId` emits our `usr_<base36>`, and migrated rows keep theirs
 *    (spike G); every artifact, share and token keys on those ids;
 *  - account linking on VERIFIED email only, and the OTP provider trusted —
 *    an OTP user who later clicks the IdP lands on the SAME usr_;
 *  - `changeEmail` enabled — the new address is verified before it counts;
 *  - passwords disabled (sidesteps CVE-2026-67327 outright);
 *  - `genericOAuth` given EXPLICIT endpoints where possible: discovery is
 *    fetched at init and an unreachable IdP aborts boot — loudly, by design.
 *
 * Tables live in the `auth` schema (spike I), created here at boot the same
 * additive way the rest of the schema is. The OPTIONS are built by the PURE
 * `humanAuthOptions` below — the renderer (scripts/render-schema.mjs) and
 * this runtime share ONE object instead of the renderer holding a copy.
 */
import { betterAuth } from 'better-auth';
import { getMigrations } from 'better-auth/db/migration';
import type { EventsService, Queryable } from '@artifactbin/contracts';
import { emailOTP, genericOAuth } from 'better-auth/plugins';
import { Kysely, PostgresDialect } from 'kysely';
import { randomBytes } from 'node:crypto';
import type { Pool } from 'pg';
import { say } from '../events';
import { pgliteDialect } from './pglite';

export interface OutgoingMail { to: string; kind: 'otp' | 'verify-email' | 'change-email' | 'other'; subject: string; text: string; otp?: string; url?: string }
export interface Mailer { send(mail: OutgoingMail): Promise<void> }

export interface OidcProvider {
  providerId: string;
  clientId: string;
  clientSecret: string;
  /** Explicit endpoints (preferred: no fetch at boot) … */
  authorizationUrl?: string;
  tokenUrl?: string;
  userInfoUrl?: string;
  /** … or discovery, which is fetched at init and FAILS BOOT if unreachable. */
  discoveryUrl?: string;
  scopes?: string[];
  /** Map the provider's user info to what linking needs. Defaults to the OIDC standard claims. */
  userInfo?: (accessToken: string) => Promise<{ id: string; email: string; emailVerified: boolean; name?: string }>;
}

export interface HumanAuthOptions {
  /**
   * The schema identity's tables live in (default `auth`). A deployment that
   * shares a database between products gives each one its own; the name must
   * be a plain identifier, since it cannot be parameterised.
   */
  schema?: string;
  secret: string;
  baseURL: string;
  mail: Mailer;
  /** One PGLite (co-hosted dev/self-host) OR a pg pool (production). */
  pglite?: unknown;
  pool?: Pool;
  google?: { clientId: string; clientSecret: string };
  oidc?: OidcProvider;
  /** Cookies carry Secure (production). */
  secure?: boolean;
  /**
   * Where the identity moments are SAID (services/events): a user row created (`user.signed_up`), a session
   * created (`user.login_verified`), an OAuth account linked (`user.oauth_linked`) — Better Auth's database
   * hooks, the only seam those moments cross. Absent = nothing is said. Never awaited on the login's path.
   */
  events?: EventsService;
}

/** A plain lowercase identifier — it goes into SQL unparameterised. */
const SCHEMA_RE = /^[a-z_][a-z0-9_]*$/;

/**
 * The two columns the hooks below read out of Better Auth's own `user` table.
 * The handle they get is `Kysely<Record<string, unknown>>` — schema-qualified
 * by the caller and deliberately untyped about the tables Better Auth owns —
 * so the read names exactly what it needs and nothing more.
 */
type IdentityTables = { user: { id: string; email: string } };

/** The address on a user row, through the SAME handle Better Auth writes with (so it is the same schema, always). */
const emailOf = async (db: Kysely<Record<string, unknown>>, userId: string): Promise<string | undefined> => {
  const row = await (db as unknown as Kysely<IdentityTables>)
    .selectFrom('user').select('email').where('id', '=', userId).executeTakeFirst();
  return row?.email;
};

export interface HumanAuth {
  /** Better Auth's HTTP handler: mount at /api/auth/*. */
  handler: (request: Request) => Promise<Response>;
  sessions: { resolve(request: Request): Promise<{ userId: string; email: string; emailVerified: boolean } | null> };
  /** The instance, for the proxy's own routes (sign-out on revoke, …). */
  api: ReturnType<typeof betterAuth>['api'];
}

const usrId = () => 'usr_' + BigInt('0x' + randomBytes(12).toString('hex')).toString(36);
const anyId = (model: string) => `${model.slice(0, 3)}_` + BigInt('0x' + randomBytes(12).toString('hex')).toString(36);

/** The Better Auth options type, named so the renderer and the runtime can share the function's shape. */
export type BetterAuthOptions = Parameters<typeof betterAuth>[0];

/**
 * THE OPTIONS, AND NOTHING ELSE — PURE. No schema is opened, no migration
 * runs, no discovery is fetched: the renderer builds these exactly as the
 * runtime does, over a Kysely handle the CALLER schema-qualifies
 * (`.withSchema(AUTH__SCHEMA)` — that is where the qualification comes from,
 * `compileMigrations` emits `create table "auth"."user"` only when the handle
 * carries it). Every side effect lives in createHumanAuth.
 */
export function humanAuthOptions(opts: HumanAuthOptions, db: Kysely<Record<string, unknown>>): BetterAuthOptions {
  const trusted = ['email-otp', ...(opts.google ? ['google'] : []), ...(opts.oidc ? [opts.oidc.providerId] : [])];
  return {
    baseURL: opts.baseURL,
    secret: opts.secret,
    database: { db, type: 'postgres' },
    emailAndPassword: { enabled: false },
    /*
     * LOGIN RATE LIMITING IS THE DOORS' JOB, and Better Auth's own limiter is
     * off because it could not do it here: behind a proxy it cannot resolve a
     * client address, and it says so — "falling back to a single shared
     * per-path bucket", which is ONE COUNTER FOR THE WHOLE DEPLOYMENT.
     * Measured against the built image: after ~30 logins every login anywhere
     * answered 429. It defaults to on in production only, so neither the
     * suite nor `npm run dev` could ever see it.
     *
     * The doors are keyed on purpose — LOGIN_SEND per ADDRESS (five an hour),
     * LOGIN_VERIFY per ip — and the one limit that is genuinely Better Auth's,
     * the guess cap per code, is emailOTP's `allowedAttempts`, untouched by
     * this. The headers below stay configured regardless, so anything that
     * DOES key by address here keys correctly.
     */
    rateLimit: { enabled: false },
    session: { cookieCache: { enabled: false } },
    /*
     * THE IDENTITY MOMENTS, said where the ROWS land rather than where the
     * routes are — Better Auth owns half a dozen ways in (a code, Google, any
     * OIDC, a link from an existing account) and they all end in these three
     * inserts. A hook that watched routes would miss whichever one was added
     * next.
     *
     * Every hook is fire-and-forget (`void say`, which never rejects) and
     * NEVER throws into Better Auth: a log that is down may not cost anyone
     * their login. The one thing awaited is the address read for
     * `login_verified`, a primary-key select on the row that was just written.
     *
     * MEASURED (Better Auth 1.7, this file's own options): an email-OTP
     * sign-in writes NO `account` row at all — the account table only ever
     * gets a row from an OAuth provider — and `emailAndPassword` is disabled,
     * so a `credential` account cannot exist either. `account.create` is
     * therefore an OAuth link and nothing else; there is no non-OAuth
     * providerId here to exclude.
     */
    databaseHooks: {
      user: {
        create: {
          after: async (user: { id: string; email: string }) => {
            void say(opts.events, { kind: 'user', id: user.id }, 'signed_up', { kind: 'user', id: user.id }, { email: user.email });
          },
        },
      },
      session: {
        create: {
          after: async (session: { userId: string }) => {
            try {
              const email = await emailOf(db, session.userId);
              if (email === undefined) return;
              void say(opts.events, { kind: 'user', id: session.userId }, 'login_verified', { kind: 'user', id: session.userId }, { email });
            } catch (error) {
              console.error('[events] login_verified failed:', error);
            }
          },
        },
      },
      account: {
        create: {
          after: async (account: { userId: string; providerId: string }) => {
            void say(opts.events, { kind: 'user', id: account.userId }, 'oauth_linked', { kind: 'user', id: account.userId }, { provider: account.providerId });
          },
        },
      },
    },
    advanced: {
      // The client's address as the proxy in front of us reports it.
      ipAddress: { ipAddressHeaders: ['x-forwarded-for'] },
      database: { generateId: ({ model }) => (model === 'user' ? usrId() : anyId(model)) },
      useSecureCookies: opts.secure ?? false,
    },
    account: { accountLinking: { enabled: true, trustedProviders: trusted } },
    user: {
      changeEmail: {
        enabled: true,
        sendChangeEmailConfirmation: async ({ user, newEmail, url }: { user: { email: string }; newEmail: string; url: string }) => {
          await opts.mail.send({ to: newEmail, kind: 'change-email', subject: 'Confirm your new email', text: `Confirm the change for ${user.email}: ${url}`, url });
        },
      },
    },
    emailVerification: {
      sendVerificationEmail: async ({ user, url }: { user: { email: string }; url: string }) => {
        await opts.mail.send({ to: user.email, kind: 'verify-email', subject: 'Verify your email', text: url, url });
      },
    },
    ...(opts.google ? { socialProviders: { google: { clientId: opts.google.clientId, clientSecret: opts.google.clientSecret } } } : {}),
    plugins: [
      emailOTP({
        otpLength: 6,
        expiresIn: 600,
        allowedAttempts: 5,
        sendVerificationOTP: async ({ email, otp, type }) => {
          await opts.mail.send({ to: email, kind: 'otp', subject: 'Your login code', text: `Your code is ${otp}`, otp: `${otp}`, url: type });
        },
      }),
      ...(opts.oidc ? [genericOAuth({ config: [{
        providerId: opts.oidc.providerId,
        clientId: opts.oidc.clientId,
        clientSecret: opts.oidc.clientSecret,
        ...(opts.oidc.discoveryUrl ? { discoveryUrl: opts.oidc.discoveryUrl } : {}),
        ...(opts.oidc.authorizationUrl ? { authorizationUrl: opts.oidc.authorizationUrl } : {}),
        ...(opts.oidc.tokenUrl ? { tokenUrl: opts.oidc.tokenUrl } : {}),
        ...(opts.oidc.userInfoUrl ? { userInfoUrl: opts.oidc.userInfoUrl } : {}),
        scopes: opts.oidc.scopes ?? ['openid', 'email', 'profile'],
        ...(opts.oidc.userInfo ? {
          getUserInfo: async (tokens: { accessToken?: string }) => {
            const info = await opts.oidc!.userInfo!(tokens.accessToken ?? '');
            // An UNVERIFIED email may not link and may not create: refuse it here, before Better Auth sees a user.
            if (!info.emailVerified) throw new Error('unverified email: refused');
            return { id: info.id, email: info.email, emailVerified: true, name: info.name ?? info.email, image: null, createdAt: new Date(), updatedAt: new Date() };
          },
        } : {}),
      } as never] })] : []),
    ],
  };
}

export async function createHumanAuth(opts: HumanAuthOptions): Promise<HumanAuth> {
  if (!opts.pglite && !opts.pool) throw new Error('createHumanAuth: a PGLite instance or a pg pool is required');
  const dialect = opts.pglite
    ? pgliteDialect(opts.pglite as Parameters<typeof pgliteDialect>[0])
    : new PostgresDialect({ pool: opts.pool! });
  /*
   * WHERE identity lives. `auth` by default; a deployment that shares one
   * database between products (one schema each) names its own, and the name
   * is admitted as a plain identifier or refused — it is interpolated into
   * `CREATE SCHEMA` and into the introspection below, which cannot take a
   * parameter, the same rule the relay's LISTEN channels are held to.
   */
  const schema = opts.schema ?? 'auth';
  if (!SCHEMA_RE.test(schema)) throw new Error(`createHumanAuth: schema ${JSON.stringify(schema)} is not a plain identifier`);
  const create = `CREATE SCHEMA IF NOT EXISTS ${schema}`;
  const schemaProbe = `SELECT 1 AS one FROM pg_namespace WHERE nspname = '${schema}'`;
  const raw = new Kysely<Record<string, unknown>>({ dialect });
  const run = async (sql: string): Promise<{ rows: unknown[] }> => {
    try {
      return await raw.executeQuery({ sql, parameters: [], query: { kind: 'RawNode', sqlFragments: [sql], parameters: [] } } as never) as { rows: unknown[] };
    } catch {
      // some dialects reject the raw-node shape; fall back to the driver directly
      if (opts.pglite) return (await (opts.pglite as { query(sql: string): Promise<{ rows: unknown[] }> }).query(sql));
      return await opts.pool!.query(sql) as unknown as { rows: unknown[] };
    }
  };
  /*
   * ASK BEFORE CREATING. `CREATE SCHEMA IF NOT EXISTS` still needs CREATE on
   * the DATABASE, which a deployment that gives identity its own least-privileged
   * role has no reason to grant: the schema was made for it, and it owns it.
   * Issuing the statement anyway is "permission denied for database" at boot,
   * on a database where the schema is already there and correct.
   */
  const already = await run(schemaProbe).catch(() => ({ rows: [] as unknown[] }));
  // The schema exists before Better Auth's migrations run inside it.
  if (already.rows.length === 0) await run(create);
  const db = raw.withSchema(schema);

  /*
   * THE OPTIONS, from the ONE pure builder — the same object the schema
   * renderer builds, over the same schema-qualified handle (that handle is
   * where `compileMigrations` gets its `auth.` prefixes).
   */
  const auth = betterAuth(humanAuthOptions(opts, db));

  // Better Auth's migration introspects WITHOUT the schema qualifier, so on a
  // second boot against an existing `auth.*` it would try to create the tables
  // again and fail. Every boot after the first therefore skips it by asking
  // information_schema — the same additive, idempotent stance as lib/schema.
  /** The handle the step below needs: a parameterised query, whichever driver we were handed. */
  const queryable: Queryable = {
    query: async <T = Record<string, unknown>>(sql: string, params?: unknown[]) => {
      if (opts.pglite) return (await (opts.pglite as { query(sql: string, params?: unknown[]): Promise<{ rows: T[] }> }).query(sql, params)) as { rows: T[] };
      return (await opts.pool!.query(sql, params)) as unknown as { rows: T[] };
    },
  };
  const exists = async (): Promise<boolean> =>
    (await queryable.query('SELECT 1 FROM information_schema.tables WHERE table_schema = $1 AND table_name = \'user\'', [schema])).rows.length > 0;
  if (!(await exists())) {
    const { runMigrations } = await getMigrations(auth.options);
    await runMigrations();
  }

  return {
    handler: (request) => auth.handler(request),
    api: auth.api,
    sessions: {
      async resolve(request) {
        const s = await auth.api.getSession({ headers: request.headers }).catch(() => null);
        if (!s?.user?.id) return null;
        return { userId: s.user.id, email: s.user.email, emailVerified: !!s.user.emailVerified };
      },
    },
  };
}
