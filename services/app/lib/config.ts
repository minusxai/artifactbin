import {isIP} from 'node:net';

import { parseAssetsOrigin } from '@artifactbin/utils';
import { normalizeOrigin } from '@artifactbin/contracts';

/**
 * The ONLY file that reads process.env, which keeps runtime configuration
 * auditable in one place.
 *
 * NAMES ARE NAMESPACED BY MODULE: `MODULE__NAME` (two underscores), and there
 * is exactly ONE spelling of each setting. There is no unnamespaced fallback:
 * two spellings for one setting is a trap — a file carrying both, where the
 * namespaced one silently wins and the other reads as live — so an
 * unnamespaced name is simply not a setting.
 * Production hard-fails only when
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
 * (scripts/build-story-runtime.mjs), and a cached copy would serve markup from
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
export const ASSETS_MAX_BYTES_PER_TOKEN = Number(env('ASSETS', 'MAX_BYTES_PER_TOKEN') ?? '536870912');

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
 * How long one query may run before it is interrupted. The engine is in-process
 * and a document renders behind it, so a runaway query is a hung page; DuckDB's
 * own interrupt makes stopping one cheap and leaves the connection usable.
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
export const MAX_FILE_BYTES = Number(env('FILES', 'MAX_BYTES') ?? '50000000');

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
export const PUBLIC_BASE_URL = env('APP', 'PUBLIC_BASE_URL') ?? `http://localhost:${APP_PORT ?? '3030'}`;
const assetsOriginSetting = env('APP', 'ASSETS_ORIGIN');
export const ASSETS_ORIGIN = assetsOriginSetting ? parseAssetsOrigin(PUBLIC_BASE_URL, null, assetsOriginSetting) : null;

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
 * `normalizeServer` uses (HTTPS, or HTTP on loopback for development; no path,
 * query, fragment or credentials). A malformed entry throws at module load,
 * like DATASET__DNS_SERVERS: half a list is worse than a refused boot, because
 * the missing half is a name that silently stops being the same server.
 */
export function parseAliasOrigins(value: string | undefined): readonly string[] {
  if (value === undefined || value.trim() === '') return Object.freeze([]);
  const origins: string[] = [];
  for (const entry of value.split(',')) {
    const origin = normalizeOrigin(entry.trim());
    if (!origin) throw new Error('APP__ALIAS_ORIGINS must be a comma-separated list of origins this deployment also answers at (HTTPS, or HTTP on loopback), without a path, query, fragment or credentials.');
    if (!origins.includes(origin)) origins.push(origin);
  }
  return Object.freeze(origins);
}
export const ALIAS_ORIGINS = parseAliasOrigins(env('APP', 'ALIAS_ORIGINS'));

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

/**
 * Where the events log is WRITTEN. Set, every `emit` travels to that service
 * (services/events, `node server` in its own container). Unset, the
 * composition root registered the in-process writer, or nothing at all — a
 * noop: no event is persisted or forwarded. The app calls
 * `services().events.emit(...)` and cannot tell which.
 */
export const EVENTS_SERVICE_URL = env('EVENTS', 'SERVICE_URL');

/**
 * The schema the events service OWNS, which this app reads with SELECT only
 * (lib/workspace-analytics). The schema comes from the environment; the table name is a
 * constant — exactly how the proxy reads the app's `tokens` table
 * (`APP__SCHEMA` + a literal). Default `events`; prod names its own.
 */
export const EVENTS_SCHEMA = env('EVENTS', 'SCHEMA') ?? 'events';
