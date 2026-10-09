import {readFileSync} from 'node:fs';
import {isIP} from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseAssetsOrigin } from '@artifactbin/utils';
import { DEFAULT_UPLOAD_MAX_BYTES, normalizeOrigin } from '@artifactbin/contracts';

/**
 * The ONLY file that reads process.env, which keeps runtime configuration
 * auditable in one place.
 *
 * NAMES ARE NAMESPACED BY MODULE: `MODULE__NAME` (two underscores), and there
 * is exactly ONE spelling of each setting. There is no unnamespaced fallback:
 * two spellings for one setting is a trap — a file carrying both, where the
 * namespaced one silently wins and the other reads as live — so an
 * unnamespaced name is simply not a setting.
 * Production hard-fails when
 * AUTH__SECRET or APP__PUBLIC_BASE_URL is absent (see the composition root); every boot, development
 * included, refuses without APP__PAGES_HOST (PAGES_HOST below).
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
/** Settings a test has replaced (`overrideConfig`), answered by `env()` before the process environment. */
const envOverrides = new Map<string, string | undefined>();
export const envNamesRead = (): ReadonlySet<string> => asked;

/** Read `${module}__${name}`. There is no other spelling. */
export function env(module: string, name: string): string | undefined {
  const key = `${module}__${name}`;
  asked.add(key);
  return envOverrides.has(key) ? envOverrides.get(key) : process.env[key];
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
    .filter((k) => !read.has(k))
    .sort();
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
 * unset ⇒ embedded PGLite at the app package's data/pglite (stable across
 * launch directories); `pglite://<path>` ⇒ embedded PGLite at that explicit
 * path (`pglite://memory` for RAM); anything else ⇒ Postgres, passed to pg
 * verbatim. Tests always run in-memory regardless.
 */
export const DATABASE_URL = process.env.DATABASE_URL;

export const IS_TEST = process.env.NODE_ENV === 'test';

/**
 * Development mode. Used to decide whether prebuilt server-side bundles may be
 * cached in module memory: in dev they are rebuilt under the running process
 * (scripts/build-server-reader.mjs), and a cached copy would serve markup from
 * BEFORE the rebuild while the browser loads the new client half — a hydration
 * mismatch produced entirely by the dev loop.
 */
export const IS_DEV = process.env.NODE_ENV === 'development';

/** Shared authentication signing secret. The fallback is for local dev only. */
export const AUTH_SECRET = env('AUTH', 'SECRET') ?? 'dev-only-secret-change-me';
/** Operator opt-in for databases on a private/self-hosted network. */
export const DATASET_ALLOW_PRIVATE_NETWORKS = env('DATASET','ALLOW_PRIVATE_NETWORKS') === 'true';
export function parseDatasetDnsServers(value:string|undefined):readonly string[]{
  if(value===undefined||value.trim()==='')return [];
  const servers=value.split(',').map(server=>server.trim());
  if(servers.some(server=>!server||isIP(server)===0))throw new Error('DATASET__DNS_SERVERS must contain only literal DNS server IP addresses.');
  return Object.freeze(servers);
}
/** Optional resolver list used only for remote dataset PostgreSQL hosts. */
export const DATASET_DNS_SERVERS=parseDatasetDnsServers(env('DATASET','DNS_SERVERS'));

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
export const ASSETS_MAX_BYTES_PER_TOKEN = Number(env('ASSETS', 'MAX_BYTES_PER_TOKEN') ?? '10000000000');

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
 * 1 matches the documented deployment shape (one TLS-terminating proxy in front
 * of the server — Caddy/Traefik/your host's). Raise it when another trusted hop is added in
 * front (a CDN, say); never raise it past the number of proxies that actually
 * rewrite the header, or the extra hops start reading caller-controlled values
 * again.
 */
export const TRUSTED_PROXY_HOPS = Math.max(1, Math.trunc(Number(env('HTTP', 'TRUSTED_PROXY_HOPS') ?? '1')) || 1);

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
 * dataset already fits under it, so `select * from ref_<id>` is never cut.
 * Only a query that GROWS its input past the cap — a join, a range() — meets
 * it.
 */
export const MAX_QUERY_ROWS = Number(env('SQL', 'MAX_QUERY_ROWS') ?? String(MAX_ROWS_LIMIT));

/**
 * How long one query may run before it is interrupted. A document renders
 * behind its queries, so a runaway query is a hung page; the engine's progress
 * handler interrupts it inside the statement, and its thread is free again.
 */
export const QUERY_TIMEOUT_MS = Number(env('SQL', 'QUERY_TIMEOUT_MS') ?? '5000');

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

/**
 * The biggest image an artifact may hold. Decoupled from MAX_DOCUMENT_BYTES (the
 * ~2 MB JSON-body cap) because an image rides its own object in the store and a
 * raw-body upload, not a base64 string in a JSON document.
 */
export const MAX_IMAGE_BYTES = Number(env('IMAGES', 'MAX_BYTES') ?? DEFAULT_UPLOAD_MAX_BYTES);

/**
 * PDFs and files share the 50 MB upload default. Downloads stream through
 * object-store getStream so each reader does not buffer an entire upload.
 * PDFs are not re-encoded, so uploaded bytes are also the stored bytes.
 */
export const MAX_PDF_BYTES = Number(env('PDF', 'MAX_BYTES') ?? DEFAULT_UPLOAD_MAX_BYTES);
export const MAX_FILE_BYTES = Number(env('FILES', 'MAX_BYTES') ?? DEFAULT_UPLOAD_MAX_BYTES);

/**
 * Public deployments require Resend credentials for login-code email. A
 * loopback development origin instead uses the protected local outbox owned by
 * the identity composition; the application itself never exposes a live code.
 */
export const RESEND_API_KEY = env('EMAIL', 'RESEND_API_KEY');

/**
 * The externally-visible origin, for absolute URLs built OUTSIDE a request
 * scope (`publicOrigin()`'s fallback). HTTP routes derive it from the request.
 */
export let PUBLIC_BASE_URL = env('APP', 'PUBLIC_BASE_URL') ?? `http://localhost:${APP_PORT ?? '3030'}`;
const assetsOriginSetting = env('APP', 'ASSETS_ORIGIN');
export let ASSETS_ORIGIN = assetsOriginSetting ? parseAssetsOrigin(PUBLIC_BASE_URL, null, assetsOriginSetting) : null;

/**
 * OTHER ADDRESSES THIS SAME DEPLOYMENT ANSWERS AT — a marketing hostname that
 * proxies to this process, a legacy name kept alive after a rename.
 *
 * `APP__PUBLIC_BASE_URL` stays the ONE canonical origin: every minted link, and
 * the `origin` of the public identity document, come from it. This list only
 * tells a client that a URL at one of these names is the same server, so a
 * pasted link is accepted and a folder tracked against the old name keeps
 * working — and clients still send every request and credential to the
 * canonical origin, never to a name on this list.
 *
 * Comma-separated origins, validated with the one origin rule the CLI's
 * `normalizeServer` uses (HTTPS, or HTTP on a local development host; no path,
 * query, fragment or credentials). A malformed entry throws at module load,
 * like DATASET__DNS_SERVERS: half a list is worse than a refused boot, because
 * the missing half is a name that silently stops being the same server.
 */
export function parseAliasOrigins(value: string | undefined): readonly string[] {
  if (value === undefined || value.trim() === '') return Object.freeze([]);
  const origins: string[] = [];
  for (const entry of value.split(',')) {
    const origin = normalizeOrigin(entry.trim());
    if (!origin) throw new Error('APP__ALIAS_ORIGINS must be a comma-separated list of origins this deployment also answers at (HTTPS, or HTTP on a local development host such as localhost or *.lvh.me), without a path, query, fragment or credentials.');
    if (!origins.includes(origin)) origins.push(origin);
  }
  return Object.freeze(origins);
}
export let ALIAS_ORIGINS = parseAliasOrigins(env('APP', 'ALIAS_ORIGINS'));

/**
 * EVERY DOCUMENT ON ITS OWN ORIGIN (lib/http/pages-origin) — the only way a document is rendered.
 * The hostname documents are served under, one label per document: `<hex(id)>.<pages host>`, and the
 * app page frames that origin. It MUST be a subdomain of the app's registrable domain (same site) —
 * the frame's `afbin_pages` cookie is SameSite=Lax — and the scheme and port are the public URL's
 * (`APP__PUBLIC_BASE_URL`), so development appends its port. A bare hostname: no scheme, port, path
 * or wildcard. REQUIRED to serve: a malformed value refuses any import of this module, and an unset one
 * refuses the boot (`requirePagesHost`, asked by the composition and the app server) — tooling that reads
 * this module without serving (the teaching compiler, scripts) does not need it. `npm run setup` writes `lvh.me`.
 */
export function parsePagesHost(value: string | undefined): string | null {
  const host = value?.trim().toLowerCase().replace(/\.$/, '') ?? '';
  if (!host) return null;
  if (!/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*$/.test(host)) {
    throw new Error('APP__PAGES_HOST must be a bare hostname documents are served under (for example pages.example.com, or lvh.me in development), without a scheme, port, path or wildcard.');
  }
  return host;
}
const PAGES_HOST = parsePagesHost(env('APP', 'PAGES_HOST'));
/** This deployment's pages host; unset refuses the boot with the setting's name. */
export function requirePagesHost(): string {
  if (!PAGES_HOST) {
    throw new Error('APP__PAGES_HOST is required: the hostname every document is served under on its own origin (for example pages.example.com, or lvh.me in development with the app at http://app.lvh.me:<port>). Run `npm run setup` to write it.');
  }
  return PAGES_HOST;
}

/**
 * Where the EXPORT browser reaches this process. Internal by default, for the
 * local browser: a screenshot of our own page has no business leaving the
 * host, and a certificate the browser
 * does not trust ends the render — measured behind a TLS reverse proxy,
 * `net::ERR_CERT_AUTHORITY_INVALID` on every export, which is the ordinary
 * self-signed / internal-CA self-host. Set it explicitly when the browser is
 * somewhere else (`BROWSER__SERVICE_URL`), where this must resolve from THAT side.
 * Blank values, as shipped in .env.example, also use the local default.
 */
export const EXPORT_INTERNAL_ORIGIN = env('EXPORT', 'INTERNAL_ORIGIN')?.trim() || THIS_PROCESS;

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
 * CUSTOM DOMAINS — the DNS target hostname a person points their own domain at
 * (`domains.artifactbin.dev`): a CNAME/ALIAS to it, or an A record to the
 * address it resolves to. Unset or empty is OFF.
 *
 * It gates ATTACHING and VERIFYING only (lib/custom-domains). Serving a
 * verified domain, the certificate ask check, the daily re-check and removal
 * all ignore it, so switching it off never breaks a live domain or locks an
 * owner into one they cannot detach.
 */
export function parseCustomDomainsTarget(value: string | undefined): string | null {
  const target = value?.trim().toLowerCase().replace(/\.$/, '') ?? '';
  return target || null;
}
export let CUSTOM_DOMAINS_TARGET = parseCustomDomainsTarget(env('FLAG', 'CUSTOM_DOMAINS'));

/**
 * Where Chromium runs. Set, the export renders through an HTTP client to the
 * browser service (`services/browser`, `node server` in its own container) and
 * this image needs no Playwright at all; unset — the self-host default — the
 * composition root registered a local one and it launches in this process.
 * Either way the app calls `services().browser.render(...)` and cannot tell.
 */
export let BROWSER_SERVICE_URL = env('BROWSER', 'SERVICE_URL');
export let INTERNAL_SERVICE_SECRET = env('INTERNAL', 'SERVICE_SECRET');

/**
 * Where the SQL engine runs. Unset (the self-host default) it runs IN THIS
 * PROCESS, SQLite in a few worker threads — one throwaway database per call.
 * Set, every run travels to that service instead, which runs the same engine
 * under the same guards: what leaves this process is the SQL, the params and
 * the rows to register, never a document and never a credential.
 */
export let SQL_SERVICE_URL = env('SQL', 'SERVICE_URL');

/**
 * Where the events log is WRITTEN. Set, every `emit` travels to that service
 * (services/events, `node server` in its own container). Unset, the
 * composition root registered the in-process writer, or nothing at all — a
 * noop: no event is persisted or forwarded. The app calls
 * `services().events.emit(...)` and cannot tell which.
 */
export let EVENTS_SERVICE_URL = env('EVENTS', 'SERVICE_URL');

/**
 * The schema the events service OWNS, which this app reads with SELECT only
 * (lib/workspace-analytics). The schema comes from the environment; the table name is a
 * constant — exactly how the proxy reads the app's `tokens` table
 * (`APP__SCHEMA` + a literal). Default `events`; prod names its own.
 */
export const EVENTS_SCHEMA = env('EVENTS', 'SCHEMA') ?? 'events';

/** Optional runner HTTP boundary; otherwise the composition root registers a local runner. */
export const RUNNER_SERVICE_URL = env('RUNNER','SERVICE_URL');
export const RUNNER_ACTOR_SECRET = env('CONTRACT','ACTOR_SECRET');
/** Optional managed agent service. Unset means no hosted/default agent is installed. */
export const HOSTED_AGENT_SERVICE_URL = env('HOSTED_AGENT','SERVICE_URL');

/**
 * The afbin release this server tells clients to run: `version` in public/chat/release.json, the pointer
 * `npm run release:cli` bumps and `afbin update` fetches. Read from disk (cwd is services/app, as for the
 * public/ mount in server/app) once, on first use, so a bundle that imports this module without serving the
 * app (the CLI toolkit) never needs the file.
 */
let cliRelease: string | undefined;
/** The places the released CLI pointer can live, in order: the app's working directory (a production
 * package copies `public/` beside the bundle), this source tree's own `public/` (tests and tools that run the
 * app from another working directory, such as the server repository's), and a repository root. */
export const CLI_RELEASE_CANDIDATES = (): string[] => {
  const candidates = [path.resolve('public/chat/release.json')];
  // Under a browser-like test environment import.meta.url is not a file URL; the source-tree candidate is
  // then simply unavailable, never an error.
  try {
    if (import.meta.url.startsWith('file:')) candidates.push(fileURLToPath(new URL('../../public/chat/release.json', import.meta.url)));
  } catch {
    // no source-tree candidate
  }
  candidates.push(path.resolve('services/app/public/chat/release.json'));
  return candidates;
};
/** Read the first candidate that parses; `''` when none does, so a missing pointer degrades the version header
 * and the update-required body instead of failing the request that needed them. */
export function readCliReleaseVersion(candidates: string[] = CLI_RELEASE_CANDIDATES()): string {
  for (const file of candidates) {
    try {
      const version = (JSON.parse(readFileSync(file, 'utf8')) as { version?: unknown }).version;
      if (typeof version === 'string' && version) return version;
    } catch {
      // try the next candidate
    }
  }
  return '';
}
export function cliReleaseVersion(): string {
  cliRelease ??= readCliReleaseVersion();
  return cliRelease;
}

/**
 * THE TEST OVERRIDE for configuration: replaces the settings below, and `env()` reads, without touching the
 * process environment or the module graph, so a test file that needs a deployment shape (a public origin, a
 * service URL, an operator secret) shares its worker's graph. The settings are live bindings, so every importer
 * sees the replacement. `{ setting: undefined }` means unset. The test harness calls `resetConfigOverrides` after
 * every file; production code never calls either.
 */
const SETTING_DEFAULTS = {
  publicBaseUrl: PUBLIC_BASE_URL, assetsOrigin: ASSETS_ORIGIN, aliasOrigins: ALIAS_ORIGINS, customDomainsTarget: CUSTOM_DOMAINS_TARGET,
  browserServiceUrl: BROWSER_SERVICE_URL, internalServiceSecret: INTERNAL_SERVICE_SECRET, sqlServiceUrl: SQL_SERVICE_URL, eventsServiceUrl: EVENTS_SERVICE_URL,
};
type ConfigOverrides = { [K in keyof typeof SETTING_DEFAULTS]?: (typeof SETTING_DEFAULTS)[K] };
export function overrideConfig(settings: ConfigOverrides, environment: Record<string, string | undefined> = {}): void {
  if ('publicBaseUrl' in settings) PUBLIC_BASE_URL = settings.publicBaseUrl!;
  if ('assetsOrigin' in settings) ASSETS_ORIGIN = settings.assetsOrigin!;
  if ('aliasOrigins' in settings) ALIAS_ORIGINS = settings.aliasOrigins!;
  if ('customDomainsTarget' in settings) CUSTOM_DOMAINS_TARGET = settings.customDomainsTarget!;
  if ('browserServiceUrl' in settings) BROWSER_SERVICE_URL = settings.browserServiceUrl;
  if ('internalServiceSecret' in settings) INTERNAL_SERVICE_SECRET = settings.internalServiceSecret;
  if ('sqlServiceUrl' in settings) SQL_SERVICE_URL = settings.sqlServiceUrl;
  if ('eventsServiceUrl' in settings) EVENTS_SERVICE_URL = settings.eventsServiceUrl;
  for (const [key, value] of Object.entries(environment)) envOverrides.set(key, value);
}
export function resetConfigOverrides(): void {
  PUBLIC_BASE_URL = SETTING_DEFAULTS.publicBaseUrl; ASSETS_ORIGIN = SETTING_DEFAULTS.assetsOrigin; ALIAS_ORIGINS = SETTING_DEFAULTS.aliasOrigins;
  CUSTOM_DOMAINS_TARGET = SETTING_DEFAULTS.customDomainsTarget; BROWSER_SERVICE_URL = SETTING_DEFAULTS.browserServiceUrl;
  INTERNAL_SERVICE_SECRET = SETTING_DEFAULTS.internalServiceSecret; SQL_SERVICE_URL = SETTING_DEFAULTS.sqlServiceUrl; EVENTS_SERVICE_URL = SETTING_DEFAULTS.eventsServiceUrl;
  envOverrides.clear();
}
