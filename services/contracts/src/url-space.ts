/**
 * THE URL SPACE: what every path on an Artifactbin origin is, declared once. This repository's servers and
 * host boundaries derive their allowlists from it (server/public-files, server/pages-host, server/user-host,
 * utils `isBuildAssetPath`); a deployment's proxy, a co-hosted service's router or a custom shell import the
 * same data (`URL_SPACE`, `classifyPath`) or fetch it from `URL_SPACE_PATH`. Pure data and functions, no imports
 * beyond the legacy table, so any runtime can load it.
 *
 *   Prefix              Job
 *   /api/               every JSON API, and the short links people click (`/api/people/<id>`, `/api/email/<id>`)
 *   /af/                every public, credential-free file: runtime modules, components, fonts, libraries,
 *                       the app's own bundles, boundary files, images, the manifest and this map. One CORS rule
 *                       (`Access-Control-Allow-Origin: *`, nothing credentialed), a cache class per directory.
 *   /a/<id>/...         one page: its screens (`/a/<id>`, `/edit`), its installed-app entry (`/app`, `/app/`) and its
 *                       doors (everything else under it)
 *   /@handle[/...]      a person's or group's address and a document's pretty address
 *   FIXED               the few root addresses that are stable public links or another service's, and the screens the
 *                       product draws itself even when a custom shell stands in for the others (below)
 *   LEGACY              old prefixes still answering (legacy-public-paths.ts, never taught)
 *   everything else     a screen (the app shell; unknown ones are its 404 page)
 *
 * ONE ANSWER TO "IS THIS A SCREEN" (`isScreenPath`): `screen`, `page-screen` and `handle`. A custom shell
 * (APP__SHELL_FILE, server/custom-shell) answers exactly those and a co-hosted router may claim exactly those;
 * `fixed` and `page-app` addresses stay the product's (`server/__tests__/custom-shell.test.ts` pins the server to it).
 *
 * `server/__tests__/url-space.test.ts` fails when the route table holds a route this map does not classify,
 * when an `/af/` handler reads a credential, or when the published JSON drifts from these constants.
 */
import { LEGACY_PUBLIC_PATHS, canonicalPublicPath, legacyPublicPath } from './legacy-public-paths';

/** Bumped when a consumer would read the document differently (a field changes meaning or goes away). */
const URL_SPACE_VERSION = 1;
/** Where the map is served, public and revalidated like the other `/af/` documents. */
export const URL_SPACE_PATH = '/af/url-space.json';

const API_PREFIX = '/api/';
export const PUBLIC_FILES_PREFIX = '/af/';
/** The Vite build of the app's own pages (dist/web/af/app): content-hashed js, css, fonts and images. */
const APP_BUILD_PREFIX = '/af/app/';

/**
 * How a public file may be cached. `immutable`: the address is its content (a year). `revalidate`: a stable
 * name whose bytes change on deploy (`no-cache` with a strong ETag). `versioned`: a version-addressed build that
 * may be rebuilt (a day, stale for a week). `day`: plain files (a day).
 */
export type CacheClass = 'immutable' | 'revalidate' | 'versioned' | 'day';
export const CACHE_CONTROL: Readonly<Record<CacheClass, string>> = {
  immutable: 'public, max-age=31536000, immutable',
  revalidate: 'no-cache',
  versioned: 'public, max-age=86400, stale-while-revalidate=604800',
  day: 'public, max-age=86400',
};

export interface PublicFileClass {
  readonly prefix: string;
  readonly what: string;
  readonly cache: CacheClass;
  /** True when server/public-files sets the cache rule (a static directory); otherwise the handler does. */
  readonly staticDirectory: boolean;
  /** The part of the class an anonymous owner host serves (regex source), or null: owner hosts are read-only readers. */
  readonly ownerHost: string | null;
}

/** Every directory under `/af/`, most specific first. Every `/af/` address belongs to exactly one. */
const PUBLIC_FILE_CLASSES: readonly PublicFileClass[] = [
  { prefix: APP_BUILD_PREFIX, what: 'the app\'s own bundles (Vite build)', cache: 'immutable', staticDirectory: true, ownerHost: '^/af/app/[\\w.-]+\\.(?:css|woff2)$' },
  { prefix: '/af/components/', what: 'af-* interface elements: entries revalidate, chunk-<hash>.js immutable', cache: 'revalidate', staticDirectory: false, ownerHost: '^/af/components/[a-z][a-z0-9-]*\\.js$' },
  { prefix: '/af/fonts/', what: 'platform fonts by name and by content-hashed file', cache: 'immutable', staticDirectory: true, ownerHost: '^/af/fonts/[a-z0-9-]+(?:\\.[a-f0-9]{8})?\\.woff2$' },
  { prefix: '/af/lib/', what: 'hosted libraries, `/af/lib/<name>-<version>/index.js`', cache: 'versioned', staticDirectory: true, ownerHost: '^/af/lib/[a-z][a-z0-9-]*-\\d+\\.\\d+\\.\\d+/index\\.js$' },
  { prefix: '/af/geojson/', what: 'boundary files a map fetches, `/af/geojson/<name>.json`', cache: 'day', staticDirectory: true, ownerHost: '^/af/geojson/[a-z0-9-]+\\.json$' },
  { prefix: '/af/img/', what: 'the app\'s images: logos, design-system previews', cache: 'day', staticDirectory: true, ownerHost: null },
  { prefix: '/af/v1/', what: 'pinned content-addressed copies of earlier runtime builds (and the pre-D17 core address)', cache: 'immutable', staticDirectory: false, ownerHost: null },
  { prefix: PUBLIC_FILES_PREFIX, what: 'runtime modules (`/af/<name>.js`), styles.css, import-map.json, manifest.json, host.js, url-space.json', cache: 'revalidate', staticDirectory: false, ownerHost: '^/af/(?:apollo|reader)\\.js$|^/af/styles\\.css$' },
];

/** A short link a person clicks (from an e-mail, a mention): a GET that answers a 302/303, never JSON on success. */
interface LinkEndpoint { readonly prefix: string; readonly what: string }
const LINK_ENDPOINTS: readonly LinkEndpoint[] = [
  { prefix: '/api/people/', what: 'a person mention: 302 to the person\'s current `/@username`' },
  { prefix: '/api/email/', what: 'a notification e-mail click: recorded, then 302 to its same-site target' },
  { prefix: '/api/workspace/', what: 'compatibility only (legacy `/workspace/<id>`): 303 to the page after an edit check' },
];
/** The link a person mention names: written into new mentions; `/people/<id>` is the stored old form. */
export const personLinkPath = (userId: string): string => `/api/people/${encodeURIComponent(userId)}`;
/** The click link a notification e-mail carries (the deployment's mail extension writes it). */
export const emailLinkPath = (deliveryId: string): string => `/api/email/${encodeURIComponent(deliveryId)}`;

/**
 * A page's own addresses. Screens are drawn by the app or a shell standing in for it; the installed-app entry is the
 * product's own page (it carries the app's manifest and icons, which a shell cannot name for it); every other address
 * under `/a/<id>/` is a door of that page.
 */
const PAGE_SPACE = {
  prefix: '/a/',
  id: '[A-Za-z0-9]{6,12}',
  /** `''` is `/a/<id>` itself. */
  screens: ['', 'edit'],
  /** The installed-app entry: `app/` is the page, `app` redirects to it. */
  app: ['app', 'app/'],
  /** The route table's sub-resources (`:x` is one segment); the drift test pins this list to app/a/[id]/. */
  doors: [
    'assets', 'css', 'datasets/:datasetId/files', 'datasets/:datasetId/files/:fileId', 'datasets/:datasetId/images',
    'datasets/:datasetId/images/:imageId', 'download', 'events', 'events/authorize', 'events/frame', 'export', 'fetch',
    'mutate', 'query', 'raw', 'resolve', 'story', 'tables', 'app/:asset',
  ],
};

/** `/@name` (a profile) and `/@name/<slug…>` (a document's pretty address). */
const HANDLE_PATTERN = '^/@[a-z0-9_]+(?:/.*)?$';

/** Hosts besides the app's that serve a fixed address: `documents` = a page's own origin, `owner` = an anonymous owner host. */
type FixedHost = 'documents' | 'owner';
interface FixedPath {
  readonly path: string;
  readonly match: 'exact' | 'prefix';
  readonly what: string;
  /** Why it is not under `/api/` or `/af/`. */
  readonly why: string;
  readonly hosts: readonly FixedHost[];
}
/** As small as it can be: each is a link already out in the world, a convention, or another service's. */
const FIXED_PATHS: readonly FixedPath[] = [
  { path: '/login', match: 'exact', what: 'the sign-in screen', why: 'sign-in links, OAuth and the proxy\'s login routes return to it by name', hosts: [] },
  { path: '/welcome', match: 'exact', what: 'the first sign-in\'s handle step', why: 'the onboarding gate and sign-in send a new account to it by name, with its callbackUrl', hosts: [] },
  { path: '/start', match: 'exact', what: 'the create door and the agent handoff (`?agent=1`)', why: 'agents and links hand people this exact address to make a page and open it', hosts: [] },
  { path: '/local/connect', match: 'exact', what: 'the local-file helper screen', why: 'local files and loopback documents frame it by name, under their own frame-ancestors', hosts: [] },
  { path: '/health', match: 'exact', what: 'liveness probe', why: 'container healthchecks and orchestrators probe it; it must never move', hosts: [] },
  { path: '/llms.txt', match: 'exact', what: 'the agent guide index', why: 'the llms.txt convention', hosts: [] },
  { path: '/llms/', match: 'prefix', what: 'agent guides by topic', why: 'linked from llms.txt, every page\'s agent pointer and installed skills', hosts: [] },
  { path: '/skills/artifactbin.zip', match: 'exact', what: 'the author skill archive', why: 'installed skills\' updaters require this exact URL (strict equality, redirect:"error")', hosts: [] },
  { path: '/skills/artifactbin/latest.json', match: 'exact', what: 'the skill release manifest', why: 'installed skills\' updaters fetch this exact URL', hosts: [] },
  { path: '/.well-known/', match: 'prefix', what: 'OAuth discovery metadata', why: 'RFC 8615 well-known locations (services/auth)', hosts: [] },
  { path: '/oauth/', match: 'prefix', what: 'OAuth authorization, token and device flows', why: 'registered OAuth endpoints clients already hold (services/auth)', hosts: [] },
  { path: '/assets/', match: 'prefix', what: 'stored bytes: web-asset copies, Mermaid drawings, ref images, keyed export images', why: 'user content with its own policy (sandbox CSP, attachment), served alone on APP__ASSETS_ORIGIN; not product files', hosts: ['documents'] },
  { path: '/tiles/', match: 'prefix', what: 'map tile proxy (Carto)', why: 'an upstream proxy, not files; stored chart specs name it and a fronting nginx may intercept it', hosts: [] },
  { path: '/basemap/', match: 'prefix', what: 'street basemap proxy (OpenFreeMap) and the MapLibre worker', why: 'an upstream proxy, not files; old readers name it', hosts: ['documents'] },
  { path: '/favicon.ico', match: 'exact', what: 'the site icon', why: 'browsers request it at the root by convention', hosts: ['documents', 'owner'] },
  { path: '/og.png', match: 'exact', what: 'the generic unfurl card', why: 'social scrapers and chat apps cached it by URL in every link preview already shared', hosts: [] },
  { path: '/openapi.json', match: 'exact', what: 'retired: answers the API not-found shape', why: 'agents guess it; the answer names /llms.txt', hosts: [] },
  { path: '/chat', match: 'exact', what: 'retired: always 404', why: 'a retired surface, kept unanswerable', hosts: [] },
  { path: '/chat/', match: 'prefix', what: 'retired: always 404', why: 'a retired surface, kept unanswerable', hosts: [] },
  { path: '/install.sh', match: 'exact', what: 'retired: always 404', why: 'the installer lives on the project site; never served here', hosts: [] },
  { path: '/login/cli', match: 'exact', what: 'retired: always 404', why: 'a retired sign-in flow, kept unanswerable', hosts: [] },
];

export type PathKind = 'api' | 'public-file' | 'page-door' | 'page-screen' | 'page-app' | 'handle' | 'fixed' | 'legacy' | 'screen';

const fixedOf = (pathname: string): FixedPath | undefined =>
  FIXED_PATHS.find((f) => (f.match === 'exact' ? pathname === f.path : pathname.startsWith(f.path)));
// Literals, not built from the strings above at load, so a bundle that imports nothing here carries none of it
// (the drift test pins them equal to PAGE_SPACE and HANDLE_PATTERN).
const PAGE_RE = /^\/a\/([A-Za-z0-9]{6,12})(?:\/(.*))?$/;
const HANDLE_RE = /^\/@[a-z0-9_]+(?:\/.*)?$/;

/** What `pathname` is. Pure; the same answer every consumer of the map gets. */
export function classifyPath(pathname: string): PathKind {
  if (pathname === '/api' || pathname.startsWith(API_PREFIX)) return 'api';
  if (pathname.startsWith(PUBLIC_FILES_PREFIX)) return 'public-file';
  if (legacyPublicPath(pathname)) return 'legacy';
  const page = PAGE_RE.exec(pathname);
  if (page) {
    const sub = page[2] ?? '';
    return PAGE_SPACE.app.includes(sub) ? 'page-app' : PAGE_SPACE.screens.includes(sub) ? 'page-screen' : 'page-door';
  }
  if (HANDLE_RE.test(pathname)) return 'handle';
  if (fixedOf(pathname)) return 'fixed';
  return 'screen';
}

/**
 * THE SCREENS RULE, for a custom shell: true when the app or a shell standing in for it draws this address —
 * a page's screens, a handle's address and everything that is not `/api/`, `/af/`, a page door or app entry, a fixed
 * path or a legacy address. A screen the app does not know is still a screen: its 404 page.
 */
export const isScreenPath = (pathname: string): boolean => {
  const kind = classifyPath(pathname);
  return kind === 'screen' || kind === 'page-screen' || kind === 'handle';
};

/** The `/af/` class an address belongs to (after canonicalizing a legacy file address), or null. */
export function publicFileClass(pathname: string): PublicFileClass | null {
  const canonical = canonicalPublicPath(pathname);
  if (!canonical.startsWith(PUBLIC_FILES_PREFIX)) return null;
  return PUBLIC_FILE_CLASSES.find((c) => canonical.startsWith(c.prefix)) ?? null;
}

const legacyFile = (pathname: string): boolean => legacyPublicPath(pathname)?.kind === 'file';

/** A document's own origin (the pages host) may load: every public file, old file addresses, and the fixed paths marked `documents`. */
export function documentHostServes(pathname: string): boolean {
  return pathname.startsWith(PUBLIC_FILES_PREFIX) || legacyFile(pathname) || !!fixedOf(pathname)?.hosts.includes('documents');
}

/** An anonymous owner host may load: the reader's part of each class (old file addresses too), and the fixed paths marked `owner`. */
export function ownerHostServes(pathname: string): boolean {
  if (fixedOf(pathname)?.hosts.includes('owner')) return true;
  if (!pathname.startsWith(PUBLIC_FILES_PREFIX) && !legacyFile(pathname)) return false;
  const cls = publicFileClass(pathname);
  return !!cls?.ownerHost && new RegExp(cls.ownerHost).test(canonicalPublicPath(pathname));
}

/** A Vite build file the proxy may answer without a session (utils build-assets): manifest-checked by the app. */
export const isAppBuildPath = (pathname: string): boolean => /^\/af\/app\/[\w.-]+\.(?:js|css|woff2)$/.test(pathname);

/** The map as one JSON document: served at URL_SPACE_PATH byte for byte (`JSON.stringify(URL_SPACE)`). */
export const URL_SPACE = {
  version: URL_SPACE_VERSION,
  api: { prefix: API_PREFIX, internal: '/api/internal/', links: LINK_ENDPOINTS },
  publicFiles: { prefix: PUBLIC_FILES_PREFIX, cors: '*', credentials: false, cacheControl: CACHE_CONTROL, classes: PUBLIC_FILE_CLASSES },
  page: PAGE_SPACE,
  handle: HANDLE_PATTERN,
  fixed: FIXED_PATHS,
  legacy: LEGACY_PUBLIC_PATHS,
  otherwise: 'screen',
};
