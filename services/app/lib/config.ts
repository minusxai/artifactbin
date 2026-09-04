/**
 * The ONLY file that reads process.env (minusx convention — keeps runtime
 * configuration auditable in one place).
 *
 * NAMES ARE NAMESPACED BY MODULE: `MODULE__NAME` (two underscores), and there
 * is exactly ONE spelling of each setting. `env()` briefly accepted a legacy
 * flat name as a fallback, with a warning — two spellings for one setting is a
 * trap, and it sprang: a file carrying both, where the namespaced one silently
 * wins and the other reads as live. A retired name is not ignored either
 * (ignoring `AUTH_SECRET` would sign sessions with a per-boot secret and log
 * everyone out for no visible reason): `retiredEnvNamesInUse` finds them and
 * the runner warns, naming each replacement. Production hard-fails only when
 * AUTH__SECRET or APP__PUBLIC_BASE_URL is absent (see the composition root).
 * Two deliberate exceptions, because they are conventions every host and
 * pooler documents: `DATABASE_URL` and `S3_URL`. `NODE_ENV` is the runtime's.
 * Guarded by lib/__tests__/env-namespacing.test.ts.
 */

/**
 * Every name this module has asked for. Recorded rather than declared, so the
 * list cannot drift from the reads — `unknownEnvNames` below reports anything
 * of our shape that nobody asked for, which is how a typo (`AUTH__SECERT`)
 * announces itself instead of silently doing nothing.
 */
const asked = new Set<string>();
export const envNamesRead = (): ReadonlySet<string> => asked;

/** Read `${module}__${name}`. There is no other spelling. */
export function env(module: string, name: string): string | undefined {
  const key = `${module}__${name}`;
  asked.add(key);
  return process.env[key];
}

/**
 * The flat names this project used to accept, and what replaced them. Kept as
 * DATA so a deployment that still carries one is told precisely what to
 * rename — the list is the whole migration, and it can be deleted outright
 * once no deployment predates it.
 */
export const RETIRED_ENV_NAMES: Readonly<Record<string, string>> = {
  ADMIN_SECRET: 'ADMIN__SECRET',
  ANON_MINT_MAX: 'RATE_LIMITER__ANON_MINT_MAX',
  ARTIFACT_QUOTA_PER_TOKEN: 'QUOTA__ARTIFACTS_PER_TOKEN',
  AUTH_SECRET: 'AUTH__SECRET',
  // Namespaced→namespaced, unlike every other row: the browser seam stopped
  // being a Playwright WEBSOCKET (`chromium.connect`, which needs playwright
  // in this image to dial it) and became an HTTP service (services/browser),
  // so the name says `SERVICE_URL` like the SQL one and the old value would
  // not connect to anything.
  BROWSER__WS_URL: 'BROWSER__SERVICE_URL',
  EVENTS__DATABASE_URL: 'removed (the proxy has one forwarder; the app owns events)',
  APP__INTERNAL_ORIGIN: 'removed (app and proxy compose in-process)',
  RATE_LIMITER__BACKEND: 'removed (the proxy owns its limiter backend)',
  RATE_LIMITER__DENYLIST_FILE: 'removed (the proxy owns request admission)',
  RATE_LIMITER__ALLOWLIST_FILE: 'removed (the proxy owns request admission)',
  CONTRACT__ACTOR_SECRET: 'removed (in-process composition carries the actor on the request)',
  EXPORT_INTERNAL_ORIGIN: 'EXPORT__INTERNAL_ORIGIN',
  INVITE__CODE: 'removed (the invite gate retired at GA)',
  LOCAL_OBJECT_DIR: 'OBJECT_STORE__LOCAL_DIR',
  LOGIN_EMAIL_FROM: 'EMAIL__FROM',
  MAX_EXTERNAL_IMAGES_PER_PUBLISH: 'WEB_INGEST__MAX_IMAGES_PER_PUBLISH',
  MAX_IMAGE_BYTES: 'IMAGES__MAX_BYTES',
  MAX_QUERY_ROWS: 'SQL__MAX_QUERY_ROWS',
  MAX_ROWS_LIMIT: 'SQL__MAX_ROWS',
  MIXPANEL_HOST: 'MIXPANEL__HOST',
  MIXPANEL_TOKEN: 'MIXPANEL__TOKEN',
  MUTATION_MAX_PER_MINUTE: 'RATE_LIMITER__MUTATE_MAX',
  PORT: 'APP__PORT',
  PREVIEW_FEATURES: 'PREVIEW__FEATURES',
  PUBLIC_BASE_URL: 'APP__PUBLIC_BASE_URL',
  QUERY_TIMEOUT_MS: 'SQL__QUERY_TIMEOUT_MS',
  RESEND_API_KEY: 'EMAIL__RESEND_API_KEY',
  RESEND_BASE_URL: 'removed (the Resend API endpoint is fixed)',
  TRUSTED_PROXY_HOPS: 'RATE_LIMITER__TRUSTED_PROXY_HOPS',
  WEB_INGEST_ALLOW_PRIVATE: 'WEB_INGEST__ALLOW_PRIVATE',
  WEB_INGEST_MAX_PER_HOUR: 'WEB_INGEST__MAX_PER_HOUR',
  WEB_INGEST_TIMEOUT_MS: 'WEB_INGEST__TIMEOUT_MS',
  WAITLIST__WEBHOOK_URL: 'removed (the waitlist retired at GA)',
};

/** Which retired names this environment still carries, in the order they are listed. */
export function retiredEnvNamesInUse(
  environment: Record<string, string | undefined> = process.env,
): Array<{ retired: string; replacement: string }> {
  return Object.entries(RETIRED_ENV_NAMES)
    .filter(([retired]) => environment[retired] !== undefined)
    .map(([retired, replacement]) => ({ retired, replacement }));
}

/**
 * Names of OUR shape (`MODULE__NAME`) that nothing read — a typo, or a setting
 * from a version that no longer has it. Everything else in the environment
 * belongs to the machine and is none of our business.
 */
export function unknownEnvNames(
  environment: Record<string, string | undefined> = process.env,
  read: ReadonlySet<string> = asked,
): string[] {
  return Object.keys(environment)
    .filter((k) => k.includes('__') && /^[A-Z][A-Z0-9_]*$/.test(k))
    .filter((k) => !read.has(k) && !CONSUMED_BY_PREFIX.some((p) => k.startsWith(p)))
    .sort();
}

/**
 * Read wholesale rather than by name: every `RATE_LIMITER__*` goes to the
 * doors as a group (`rateLimiterEnv`), so a knob for a door nobody has read
 * yet is still a knob, not a typo.
 */
const CONSUMED_BY_PREFIX = ['RATE_LIMITER__'];
/** Every `RATE_LIMITER__*` value — what lib/rate-limiter reads. */
export function rateLimiterEnv(): Record<string, string | undefined> {
  const out: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(process.env)) if (k.startsWith('RATE_LIMITER__')) out[k] = v;
  // The ENVIRONMENT-dependent default (development relaxes the anonymous-mint
  // door so a gate run cannot exhaust it) lives on the constant below; the door
  // must see it too, or `npm run dev` closes minting the first time it is asked.
  if (out.RATE_LIMITER__ANON_MINT_MAX === undefined) out.RATE_LIMITER__ANON_MINT_MAX = String(ANON_MINT_MAX);
  if (out.RATE_LIMITER__MUTATE_MAX === undefined) out.RATE_LIMITER__MUTATE_MAX = String(MUTATION_MAX_PER_MINUTE);
  return out;
}

/**
 * This process's own address. Read EAGERLY, and once: a setting read only on
 * the right-hand side of a `??` is never evaluated when the left side is set,
 * so it never reaches `envNamesRead` and the boot notice calls it unread.
 */
const APP_PORT = env('APP', 'PORT');
const THIS_PROCESS = `http://127.0.0.1:${APP_PORT ?? '3000'}`;

/**
 * Vite's HMR websocket port in dev. Vite defaults to 24678 for EVERY project,
 * so two checkouts running side by side collide there while their app ports
 * do not — the second boot logs "Port 24678 is already in use" and its hot
 * reload silently never connects. Derived from the app port (+1) so that
 * choosing an app port chooses this one too; `APP__HMR_PORT` overrides it.
 */
export const APP_HMR_PORT_SETTING = env('APP', 'HMR_PORT');
export function resolveHmrPort(explicit: string | undefined, appPort: number): number {
  const n = Number(explicit);
  return explicit && Number.isInteger(n) && n > 0 && n < 65536 ? n : appPort + 1;
}

/** Enables POST /api/tokens minting. Unset ⇒ the endpoint answers 404. */
export const ADMIN_SECRET = env('ADMIN', 'SECRET');

/**
 * THE database env — the URL is the type (lib/db.ts parseDatabaseUrl):
 * unset ⇒ embedded PGLite at ./data/pglite; `pglite://<path>` ⇒ embedded
 * PGLite there (`pglite://memory` for RAM); anything else ⇒ Postgres,
 * passed to pg verbatim. Tests always run in-memory regardless.
 */
export const DATABASE_URL = process.env.DATABASE_URL;

export const IS_TEST = process.env.NODE_ENV === 'test';

/**
 * Development mode. Used to decide whether prebuilt server-side bundles may be
 * cached in module memory: in dev they are rebuilt under the running process
 * (scripts/build-story-runtime.mjs), and a cached copy would serve markup from
 * BEFORE the rebuild while the browser loads the new client half — a hydration
 * mismatch produced entirely by the dev loop.
 */
export const IS_DEV = process.env.NODE_ENV === 'development';

/** NextAuth JWT-session signing secret. The fallback is for local dev only. */
export const AUTH_SECRET = env('AUTH', 'SECRET') ?? 'dev-only-secret-change-me';

/**
 * Per-token artifact cap — creation answers
 * 403 quota_exceeded at the cap. 0 disables the check.
 */
export const ARTIFACT_QUOTA_PER_TOKEN = Number(env('QUOTA', 'ARTIFACTS_PER_TOKEN') ?? '1000');

/**
 * THE BYTE CAP — how many stored bytes one importer may cause (uploaded images
 * plus the URLs they were the first to import). 0 disables it.
 *
 * A separate question from ARTIFACT_QUOTA_PER_TOKEN, which counts ROWS and so
 * bounds nothing expensive: a thousand artifacts can be five gigabytes or five
 * kilobytes. URL-kept assets make bytes the thing worth capping, and the charge
 * is the importer's, once — a second document naming an already-cached URL
 * fetches nothing and stores nothing (lib/asset-quota).
 */
export const ASSETS_MAX_BYTES_PER_TOKEN = Number(env('ASSETS', 'MAX_BYTES_PER_TOKEN') ?? '536870912');

/**
 * Anonymous-mint ceiling, per IP per hour — the abuse valve on the endpoints
 * that hand out a capability for free (`/api/tokens/anonymous`, `/api/start`,
 * and the login-code request).
 *
 * 10 is the number for a deployment reachable from the internet. It is the
 * WRONG number for localhost, where the only caller is the developer and this
 * repo's own browser gates mint on every run — a few `scripts/gate-*.mjs` in a
 * row exhaust the hour, the window is in-memory, and the only recovery is
 * restarting the dev server in the middle of whatever you were verifying.
 *
 * So the DEFAULT follows the environment while the KNOB stays absolute: an
 * explicit ANON_MINT_MAX wins everywhere. The relaxed default is reachable only
 * under `next dev` — `next build` and `next start` both force
 * NODE_ENV=production — so it can never be what a deployment runs on.
 */
export const ANON_MINT_MAX = Number(env('RATE_LIMITER', 'ANON_MINT_MAX') ?? (IS_DEV ? '1000' : '0'));

/**
 * How many proxies sit in front of this app — which is to say, how much of
 * `X-Forwarded-For` was written by something we trust.
 *
 * The header is a list, and each hop APPENDS the address it received the
 * connection from, so a route sees `<whatever the client sent>, <what proxy1
 * saw>, …`. Everything to the LEFT of our own hops is caller-supplied text.
 * Reading the wrong end lets a caller pick their own rate-limit bucket, which
 * is the same as having no limit.
 *
 * 1 matches the shape docker-compose.yml documents (one TLS-terminating proxy —
 * Caddy/Traefik/your host's). Raise it when another trusted hop is added in
 * front (a CDN, say); never raise it past the number of proxies that actually
 * rewrite the header, or the extra hops start reading caller-controlled values
 * again.
 */
export const TRUSTED_PROXY_HOPS = Math.max(1, Math.trunc(Number(env('RATE_LIMITER', 'TRUSTED_PROXY_HOPS') ?? '1')) || 1);

/**
 * Public deployments require Resend credentials for login-code email. A
 * loopback development origin instead uses the protected local outbox owned by
 * the proxy composition; the application itself never exposes a live code.
 */
/**
 * Object storage as ONE connection string (see lib/object-store/url.ts):
 *   s3://KEY:SECRET@s3.us-west-1.amazonaws.com/bucket/artifacts?region=us-west-1
 * Unset, the app falls back to the local filesystem so a laptop and CI need no
 * external service — the same promise PGLite makes for the database.
 */
export const S3_URL = process.env.S3_URL;

/**
 * Rows kept from a data source. A 200k-row sheet imports fine and then makes an
 * unloadable page: every row is fetched from storage, parsed, and serialized
 * into the document. Until there is a query layer, a dataset is a SAMPLE — the
 * first N rows — and the true row count is recorded so nothing is silent.
 */
export const MAX_ROWS_LIMIT = Number(env('SQL', 'MAX_ROWS') ?? '10000');

/**
 * The most rows one `<Query>` result may carry into a document. A result is
 * serialized into the page (and into every reader's download), so an unbounded
 * `select *` over a big dataset is the same unloadable page the ingest cap
 * exists to prevent — but a cut result is RECORDED (`truncated`, `totalRows`),
 * never silent, because a chart built from a sample believing it is the set is
 * the failure that matters. Defaults to the INGEST cap, deliberately: every
 * dataset already fits under it, so `select * from ref_<id>` is never cut and
 * nothing that rendered whole before the dataflow renders as a sample now (a
 * 7,361-point scatter did, at 5,000). Only a query that GROWS its input past
 * the cap — a join, a range() — meets it.
 */
export const MAX_QUERY_ROWS = Number(env('SQL', 'MAX_QUERY_ROWS') ?? String(MAX_ROWS_LIMIT));

/**
 * How long one query may run before it is interrupted. The engine is in-process
 * and a document renders behind it, so a runaway query is a hung page; DuckDB's
 * own interrupt makes stopping one cheap and leaves the connection usable.
 */
export const QUERY_TIMEOUT_MS = Number(env('SQL', 'QUERY_TIMEOUT_MS') ?? '5000');

/**
 * Turn the PREVIEW features on for this whole deployment (lib/features/).
 * Unset, they are opt-in per REQUEST with `?v=2`. A staging box sets this; a
 * production one leaves it alone until a feature ships.
 */
export const PREVIEW_FEATURES = env('PREVIEW', 'FEATURES') === '1';

/**
 * How many dataset writes one VISITOR may make per minute through documents
 * (`POST /a/<id>/mutate`, keyed by client IP — the same identity the
 * anonymous-mint valve uses). A public writable dataset behind a public
 * document is an open inbox by design (that is what a poll is); this is what
 * keeps one script from filling it. Well clear of a human clicking.
 */
export const MUTATION_MAX_PER_MINUTE = Number(env('RATE_LIMITER', 'MUTATE_MAX') ?? '60');

/** Where the local fallback writes when S3_URL is unset. */
export const LOCAL_OBJECT_DIR = env('OBJECT_STORE', 'LOCAL_DIR') ?? '.artifact-objects';

/**
 * Web ingestion (lib/web-ingest) — importing an asset by URL fetches it ONCE,
 * server-side, and stores a copy; nothing is ever hotlinked. The private
 * switch admits loopback/RFC1918 targets so a dev checkout can ingest from
 * itself (gates do); link-local — the metadata IP — never softens. Production
 * leaves it off.
 */
export const WEB_INGEST_ALLOW_PRIVATE = env('WEB_INGEST', 'ALLOW_PRIVATE') === '1' || IS_DEV;
export const WEB_INGEST_TIMEOUT_MS = Number(env('WEB_INGEST', 'TIMEOUT_MS') ?? '10000');
/** Fetch ATTEMPTS one identity may spend per hour (lib/auth webIngestRateLimited). */
export const WEB_INGEST_MAX_PER_HOUR = Number(env('WEB_INGEST', 'MAX_PER_HOUR') ?? '300');
/** External images one publish may import — bounds publish latency, not storage. */
export const MAX_EXTERNAL_IMAGES_PER_PUBLISH = Number(env('WEB_INGEST', 'MAX_IMAGES_PER_PUBLISH') ?? '8');
/**
 * External ASSETS one publish may import in total — images AND the `@font-face`
 * urls in its stylesheet. The image cap above counts images alone, which left
 * the number of outbound fetches a single document could cause up to whoever
 * wrote the document: twelve faces named twelve hosts and no cap saw them.
 * Over this, the excess is NAMED in the reply and not fetched; the document
 * still publishes, because a cap is not a reason to lose someone's work.
 */
export const MAX_EXTERNAL_ASSETS_PER_PUBLISH = Number(env('WEB_INGEST', 'MAX_ASSETS_PER_PUBLISH') ?? '16');

/**
 * The biggest image an artifact may hold. Decoupled from MAX_CONTENT_BYTES (the
 * ~2 MB JSON-body cap) because an image rides its own object in the store and a
 * raw-body upload, not a base64 string in a JSON document.
 */
export const MAX_IMAGE_BYTES = Number(env('IMAGES', 'MAX_BYTES') ?? '5000000');

/**
 * The biggest PDF an artifact may hold — its own cap, five times the image
 * one, because a PDF is a document somebody wrote rather than a picture we may
 * shrink: nothing re-encodes it, so the number here is the number stored.
 *
 * 25 MB is the size the spike measured the serving path against, and it is
 * affordable only because that path STREAMS (lib/object-store getStream): a
 * whole read of one of these would be +25 MB of RSS per response and would
 * evict the store's entire read cache.
 */
export const MAX_PDF_BYTES = Number(env('PDF', 'MAX_BYTES') ?? '25000000');

export const RESEND_API_KEY = env('EMAIL', 'RESEND_API_KEY');

/** Sender for login codes. Must be a domain verified in Resend, or sends fail. */
export const LOGIN_EMAIL_FROM = env('EMAIL', 'FROM') ?? 'artifactbin <login@example.com>';

/**
 * The externally-visible origin, for absolute URLs built OUTSIDE a request
 * scope (the MCP tools' url echoes). HTTP routes derive it from the request.
 */
export const PUBLIC_BASE_URL = env('APP', 'PUBLIC_BASE_URL') ?? `http://localhost:${APP_PORT ?? '3030'}`;

/**
 * Origin the EXPORT browser uses to reach this same process (markup rows
 * render via the live /v page). In a container the request's external origin
 * is not reachable from inside — compose sets http://127.0.0.1:3000. Unset ⇒
 * the request origin (right for bare `npm run dev`/`npm start`).
 */
/**
 * Where the EXPORT browser reaches this process. Internal by default, for the
 * same reason the mint call is (see INTERNAL_ORIGIN below): a screenshot of
 * our own page has no business leaving the host, and a certificate the browser
 * does not trust ends the render — measured behind a TLS reverse proxy,
 * `net::ERR_CERT_AUTHORITY_INVALID` on every export, which is the ordinary
 * self-signed / internal-CA self-host. Set it explicitly when the browser is
 * somewhere else (`BROWSER__SERVICE_URL`), where this must resolve from THAT side.
 */
export const EXPORT_INTERNAL_ORIGIN = env('EXPORT', 'INTERNAL_ORIGIN') ?? THIS_PROCESS;

/**
 * Mixpanel product analytics (components/MixpanelClient). Unset token ⇒
 * analytics fully off (dev/CI default). The token is a PUBLIC client
 * identifier, not a secret — it ships in the HTML by design; it lives here
 * rather than in a NEXT_PUBLIC_ var so config stays the one file reading
 * process.env. Default host is the US-residency JS ingest endpoint.
 */
export const MIXPANEL_TOKEN = env('MIXPANEL', 'TOKEN');
export const MIXPANEL_HOST = env('MIXPANEL', 'HOST') ?? 'https://api-js.mixpanel.com';

/**
 * The analytics `visitor` fingerprint's own secret — its OWN so rotating the
 * auth secret never silently rewrites every "views" number. Falls back to
 * AUTH_SECRET for deployments that have not set it.
 */
export const ANALYTICS_SECRET = env('ANALYTICS', 'SECRET') ?? AUTH_SECRET;

/**
 * May a document be `public` (listed on a profile)? OFF by default: `unlisted`
 * already gives "anyone with the link", so `public` only adds listing — a
 * stranger-facing feature the public deployment turns on explicitly.
 */
export const ALLOW_PUBLIC_VISIBILITY = env('ARTIFACTS', 'ALLOW_PUBLIC') === '1' || IS_DEV;

/**
 * Where Chromium runs. Set, the export renders through an HTTP client to the
 * browser service (`services/browser`, `node server` in its own container) and
 * this image needs no Playwright at all; unset — the self-host default — the
 * composition root registered a local one and it launches in this process.
 * Either way the app calls `services().browser.render(...)` and cannot tell.
 */
export const BROWSER_SERVICE_URL = env('BROWSER', 'SERVICE_URL');
export const INTERNAL_SERVICE_SECRET = env('INTERNAL', 'SERVICE_SECRET');

/**
 * Where the SQL engine runs. Unset (the self-host default) it runs IN THIS
 * PROCESS on the native DuckDB module — one throwaway instance per call. Set,
 * every run travels to that service instead, which runs the same module under
 * the same guards: what leaves this process is the SQL, the params and the
 * rows to register, never a document and never a credential.
 */
export const SQL_SERVICE_URL = env('SQL', 'SERVICE_URL');
