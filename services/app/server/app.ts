import {getDeploymentState} from '@/lib/deployment';
import { artifactAppPath } from '@/lib/serving';
import { type ArtifactRow, canReadArtifact, getArtifactById, effectiveRole, UnservableDocument } from '@/lib/artifacts';
import { readableApp, artifactManifest, artifactAppIcon, withArtifactAppHead, artifactPwaEnabled } from '@/lib/serving';
import { loginRedirectTarget } from '@/lib/http';
/**
 * THE APP SERVER — Hono, the whole app behind the proxy:
 *
 *  - every `app/**\/route.ts` handler, from the generated table (server/api);
 *  - canonical artifact URLs use the same app document for every viewer,
 *    with permission-filtered prepared data and readable initial story HTML;
 *    explicit raw/export responses retain their document sandbox policy;
 *  - the app's pages: one SPA (web/, built by Vite) served for the app's
 *    paths under the app CSP;
 *  - the static tree under public/, with its cache rules set here
 *    (content-addressed → immutable; /geojson a day).
 *
 * The request is held in AsyncLocalStorage for the duration of each handler
 * (lib/request-context), which is how `publicOrigin()` and analytics see it.
 */
import { agentDiscovery, agentDiscoveryBody, agentDiscoveryHead, withAgentDiscoveryTail } from '@/lib/serving/agent-discovery';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { createGithubResponse } from './external/github';
import { escapeHtml } from '@artifactbin/utils/escape';
import { Hono, type Context } from 'hono';
import { actorReceiver, isPublicAssetRequest, publicAssetResponse } from '@artifactbin/utils';
import { ID_RE, verifyExportKey } from '@/lib/platform';
import { measureQueries, runWithRequest } from '@/lib/platform';
import { artifactViewPath, canonicalArtifactPath, parsePrettyPath } from '@/lib/http';
/** Every static address solid/App.tsx routes: a direct load or a reload of one missing here is a 404. */
import { spaPaths } from '@/lib/http/app-pages';
import { ANONYMOUS_ACTOR, ownerUsername, sessionActor } from '@/lib/accounts';
import { AGENT_COOKIE } from '@/lib/accounts';
import { canEdit } from '@artifactbin/contracts';
import { APP_BUILD_HEADER, APP_BUILD_META, baseUrl, json, setAppBuild } from '@/lib/http';
import { ASSETS_ORIGIN } from '@/lib/platform';
import { GET as publicAssetBytes } from '@/app/assets/[hash]/route';
import { exportAssetResponse } from '@/lib/export/assets';
import { publicRefAssetResponse } from '@/lib/serving';
import { mountRoutes } from './api';
import { ROUTES } from './routes.generated';
import { GITHUB_EXTERNAL_URL } from '@/lib/serving';
import { createListingPreloader, listingPage } from './reader-preloads';
import { artifactPageAnswer, type ArtifactPageAnswer } from '@/lib/serving';
import { DOCUMENT_FRAME_CSS, documentFrameFallback, documentFrameHtml, documentHeadTags, type DocumentFrame } from '@/lib/serving/document-frame';
import { appBuildId, mountBuildAssets } from './build-assets';
import { compressDynamic, dynamicEncoding, precompressedStatic } from './content-encoding';
import { customHostBoundary } from './custom-host';
import { pagesHost } from './pages-host';
import { pagesSite as deployedPagesSite, type PagesSite } from '@/lib/http/pages-origin';
import { linkedStylesheets } from '@/lib/serving';
import { THEME_BOOTSTRAP_HASH } from '@/lib/serving';
import { canonicalDocumentUrl } from '@/lib/serving';
import { APP_SHELL_FONT_PRELOADS } from '@/lib/serving';
import { fontPreloadTags } from '@/lib/page-styles';

/**
 * The `<link rel="help">` and agent metadata an agent that fetched any page reads, on the caller's
 * base — FIRST in the head, ahead of every preload and stylesheet link Vite stamps into the shell, so a
 * shell tool that keeps only the first few kilobytes of a page still sees them. A page with no `<head>`
 * at all gets them before `</head>`.
 */
function withAgentDiscovery(html: string, origin: string): string {
  const help = agentDiscovery(origin);
  const tags = agentDiscoveryHead(help);
  // Paint a product loading state before app JavaScript arrives. The app replaces
  // it on mount; agent discovery remains in the head, tail and noscript help.
  html = html.replace(/<div id="root">/i, (open) => `${open}${agentDiscoveryBody(help)}`);
  const open = /<head(?:\s[^>]*)?>/i.exec(html);
  if (open) return `${html.slice(0, open.index + open[0].length)}${tags}${html.slice(open.index + open[0].length)}`;
  return html.replace('</head>', () => `${tags}</head>`);
}

/**
 * The generic unfurl card, for an address with no document of its own to
 * photograph — the home page, login, a profile. Absolute against the request's
 * origin for the same reason the artifact tag below is: a relative og:image is
 * resolved by some scrapers against the page URL and by others not at all.
 * `public/og.png` is written by `npm run generate:og`.
 */
function withGenericSocial(html: string, origin: string): string {
  const tags = `<meta property="og:image" content="${escapeHtml(origin)}/og.png"><meta name="twitter:card" content="summary_large_image">`;
  return html.replace('</head>', () => `${tags}</head>`);
}

/**
 * The frame's one new connection, started from the head: its first URL is on the document's own origin, which spends
 * the ticket and serves the document in one response. The origin comes from the frame the server drew
 * (lib/serving/artifact-page), never from the request. It follows the agent pointer, which stays the head's first element.
 */
function withPreconnects(html: string, frame: DocumentFrame): string {
  let origin: string;
  try { origin = new URL(frame.src).origin; } catch { return html; }
  const tags = `<link rel="preconnect" href="${escapeHtml(origin)}">`;
  const after = /<meta name="cli"[^>]*>/i.exec(html) ?? /<head(?:\s[^>]*)?>/i.exec(html);
  return after ? `${html.slice(0, after.index + after[0].length)}${tags}${html.slice(after.index + after[0].length)}` : html;
}

/**
 * THE APP PAGE FOR A DOCUMENT: the shell, named in its head as the document (its title, description and social
 * card replace the shell's), with the document's frame as the body's first element — drawn by the server, so the
 * document loads with the page, not after the app's code (lib/serving/document-frame; solid/pages/Document adopts it).
 */
function withDocumentFrame(html: string, frame: DocumentFrame): string {
  const head = withPreconnects(html, frame)
    .replace(/<title>[\s\S]*?<\/title>/i, '')
    .replace(/<meta name="description"[^>]*>/i, '')
    .replace('</head>', () => `${documentHeadTags(frame.head)}<style data-mx-frame-css>${DOCUMENT_FRAME_CSS}</style></head>`);
  return head.replace(/<body([^>]*)>/i, (open) => `${open}${documentFrameHtml(frame)}`)
    .replace(/<div id="root">/i, (open) => `${open}${documentFrameFallback(frame)}`);
}

/** The shell's first-screen face (lib/app-fonts), preloaded on a page with no document of its own. */
const withShellFonts = (html: string): string => html.replace('</head>', () => `${fontPreloadTags(APP_SHELL_FONT_PRELOADS)}</head>`);

/** Where the server hands the SPA a page's data so its FIRST paint is its final one. */
export const BOOTSTRAP_ID = 'mx-page-data';
/** `<` is the only character that can end a script element early; JSON never needs it. */
const safeJson = (value: unknown): string => JSON.stringify(value).replace(/</g, '\\u003c');
/**
 * The page's data rides at the END of the body — after the story the server
 * rendered, as the body's own last element — so the first paint never waits
 * for it to download. Still read before the app's first render: the SPA's
 * module runs after the document is parsed (solid/lib/bootstrap reads exactly this
 * element, a direct child of body, which no authored id inside the story can be).
 */
export const withBootstrap = (html: string, data: unknown): string => {
  // A function replacement keeps JavaScript's special replacement tokens in
  // user-authored JSON literal instead of expanding them with the HTML shell.
  const tag = `<script type="application/json" id="${BOOTSTRAP_ID}">${safeJson(data)}</script>`;
  const at = html.lastIndexOf('</body>');
  return at < 0 ? html.replace('</head>', () => `${tag}</head>`) : `${html.slice(0, at)}${tag}${html.slice(at)}`;
};

/**
 * THE HEAD IN THE ORDER A READER NEEDS IT. The story is readable before any
 * JavaScript runs, so code must not starve what paints it: the charset and
 * viewport, the render-blocking CSS, then the fonts the first screen paints —
 * at high priority — and only then the app's modules and their preloads,
 * which Vite writes early in the shell and the preloaders add at its end.
 */
// Every module script — inline ones too, so modules keep their relative (execution) order.
const MODULE_TAG = /<script\b[^>]*\btype=["']module["'][^>]*>[\s\S]*?<\/script>|<link\b[^>]*\brel=["']modulepreload["'][^>]*>/gi;
const FONT_PRELOAD = /<link\b[^>]*\brel=["']preload["'][^>]*\bas=["']font["'][^>]*>/gi;
const STYLESHEET = /<link\b[^>]*\brel=["'](?:stylesheet|preload)["'][^>]*\bas=["']style["'][^>]*>|<link\b[^>]*\brel=["']stylesheet["'][^>]*>/gi;
/** `text` with every match of `pattern` taken out, and the matches, in order — a MOVE, never a filter. */
function lift(text: string, pattern: RegExp): { rest: string; lifted: string[] } {
  const lifted: string[] = [];
  let rest = '', at = 0;
  for (const m of text.matchAll(pattern)) { rest += text.slice(at, m.index); lifted.push(m[0]); at = m.index! + m[0].length; }
  return { rest: rest + text.slice(at), lifted };
}
/** Where the fonts go: after the render-blocking CSS, else the viewport, the charset, the agent pointer (always first), the head. */
function fontSlot(head: string): number {
  let cut = -1;
  for (const m of head.matchAll(STYLESHEET)) cut = m.index! + m[0].length;
  if (cut >= 0) return cut;
  for (const tag of [/<meta\b[^>]*name=["']viewport["'][^>]*>/i, /<meta\b[^>]*charset=[^>]*>/i, /<meta\b[^>]*name=["']cli["'][^>]*>/i, /<head\b[^>]*>/i]) {
    const m = tag.exec(head);
    if (m) return m.index + m[0].length;
  }
  return 0;
}
function withReaderHeadOrder(html: string): string {
  const end = html.indexOf('</head>');
  if (end < 0) return html;
  const code = lift(html.slice(0, end), MODULE_TAG);
  const faces = lift(code.rest, FONT_PRELOAD);
  const fonts = faces.lifted.map((tag) => (/\bfetchpriority=/i.test(tag) ? tag : `<link fetchpriority="high"${tag.slice('<link'.length)}`));
  const cut = fontSlot(faces.rest);
  return `${faces.rest.slice(0, cut)}${fonts.join('')}${faces.rest.slice(cut)}${code.lifted.join('')}${html.slice(end)}`;
}

// Inline scripts emitted by our source HTML. Keeping the hashes explicit preserves the production policy.
export const APP_INLINE_SCRIPT_HASHES = [
  THEME_BOOTSTRAP_HASH, // theme bootstrap (web/solid-app.html — lib/theme-bootstrap, pinned by lib/__tests__/app-page-csp)
].join(' ');

/**
 * THE APP PAGES' POLICY — one, strict, for every app page: no document ever runs inside one. `frames` are the
 * pages origins (APP__PAGES_HOST) the app page frames documents on — every document label under the pages host,
 * and nothing else (the apex is not a document and is never framed).
 */
function appCsp({ frames = [] }: { frames?: readonly string[] } = {}): string {
  return [
    // 'wasm-unsafe-eval' lets the page COMPILE WebAssembly — the SQLite engine a
    // reader's document runs its queries on (lib/islands/page-sqlite) —
    // and nothing else: no eval, no Function, no string timers.
    "default-src 'none'", `script-src 'self' 'wasm-unsafe-eval' ${APP_INLINE_SCRIPT_HASHES}`, "style-src 'self' 'unsafe-inline'",
    // Listing thumbnails redirect from /a/:id/export to the configured asset
    // origin. Admit that destination for images; local posters remain same-origin.
    `img-src 'self' data: blob:${ASSETS_ORIGIN ? ` ${ASSETS_ORIGIN}` : ''}`,
    "font-src 'self' data:",
    // `media-src` has no default of its own either, so without this line every
    // <video> and <audio> on an app page is refused by `default-src 'none'`.
    // `'self'` is a stored file played back from /a/<id>/raw; `blob:` is the
    // upload page previewing a file BEFORE it is sent (web/pages/FileUpload).
    // GLTFLoader also fetches embedded textures through local blob URLs.
    // Frame and worker policies stay same-origin; blobs are data here.
    "media-src 'self' blob:",
    "connect-src 'self' blob:",
    "manifest-src 'self'", ['frame-src', "'self'", ...frames].join(' '), "frame-ancestors 'self'",
    // `worker-src` has no default of its own: it falls back through `child-src`
    // to `default-src 'none'`, so a worker would be refused by a directive nobody
    // wrote, silently. The one worker the product starts — MapLibre's, for a
    // `<DeckGL>` street basemap — is a same-origin module script
    // (/basemap/worker.mjs, app/basemap), and Vite emits workers as same-origin
    // assets, so `'self'` is the whole permission — NOT `blob:`, which would
    // reopen script-from-a-string.
    "worker-src 'self'",
    "form-action 'self'", "object-src 'none'", "base-uri 'self'",
  ].join('; ');
}
/** The strict app policy, before the pages origins it frames are named (pagesFrameSources). */
export const APP_CSP = appCsp();
/** The policy every app page carries on a deployment whose documents are served under `site` (production adds no more). */
export const appPagePolicy = (site: PagesSite): string => appCsp({ frames: pagesFrameSources(site) });
/** The pages origins an app page may frame (lib/http/pages-origin): every document label under the pages host. */
export function pagesFrameSources(site: PagesSite): string[] {
  const port = site.port ? `:${site.port}` : '';
  return [`${site.scheme}//*.${site.host}${port}`];
}
/** Only the development socket joins connect-src; production uses the policy unchanged. */
function developmentAppCsp(csp: string, pageUrl: string, port: number): string {
  const socket = new URL(pageUrl);
  socket.protocol = socket.protocol === 'https:' ? 'wss:' : 'ws:';
  socket.port = String(port);
  return csp.replace("connect-src 'self'", `connect-src 'self' ${socket.origin}`);
}
const APP_SECURITY_HEADERS = {
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'strict-origin-when-cross-origin',
  'permissions-policy': 'camera=(), microphone=(), geolocation=()',
};
const IMMUTABLE = 'public, max-age=31536000, immutable';

export interface AppServerOptions {
  /** Split deployment only: verify the transport header and attach its actor. */
  actorSecret?: string;
  /** Composition hook keeping the proxy's token cache coherent after revoke. */
  onTokenRevoked?: (id?: string) => void;
  /** Where the built SPA lives (dist/web). In dev, `index` is answered by Vite instead. */
  webDir?: string;
  /** Dev: how the app shell (web/solid-app.html) is produced (Vite transforms it); prod: read from webDir. */
  indexHtml?: (url: string) => Promise<string>;
  /** Dev: Vite's connect middleware, mounted before everything else for its own assets. */
  devMiddleware?: (req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse, next: () => void) => void;
  /** Dev only: the Vite socket port resolved by the server composition. */
  devHmrPort?: number;
  publicDir?: string;
  /** Every document on its own origin (APP__PAGES_HOST): this deployment's pages site unless a test passes its own. */
  pagesSite?: PagesSite;
}

/** Which document, if any, a path names — `/a/<id>` or a pretty URL. */
export function candidateDocument(pathname: string): { id: string } | null {
  pathname = artifactViewPath(pathname);
  const segments = pathname.split('/').filter(Boolean);
  if (segments[0] === 'a') return segments.length === 2 && ID_RE.test(segments[1]) ? { id: segments[1] } : null;
  if (!segments[0]?.startsWith('@')) return null;
  const file = parsePrettyPath(segments.slice(1).map((s) => { try { return decodeURIComponent(s); } catch { return s; } }));
  return file ? { id: file.id } : null;
}



/**
 * A guessed machine address is answered in the machine's language. A path
 * under `/api/` nobody serves, `/openapi.json` and `/.well-known/ai-plugin.json`
 * answer the same shape `unauthorized()` does: the error, and the one way on —
 * `/llms.txt`. A page of HTML tells a fetch tool nothing.
 *
 * Mounted AFTER the real routes (an earlier match wins) and BEFORE the SPA
 * fallback, by EXACT path under `/.well-known/` — a prefix mount there would
 * swallow `/.well-known/oauth-protected-resource`, which is the proxy's.
 *
 * Every OTHER miss answers this too when the caller never asked for HTML
 * (`page()` below).
 */
const apiNotFound = (c: { req: { raw: Request } }) => {
  const guessedQuery = /^\/api\/artifacts\/[^/]+\/query\/?$/.test(new URL(c.req.raw.url).pathname);
  return json({
    error: 'not_found',
    help: guessedQuery ? '/llms/html-datasets' : '/llms.txt',
    ...(guessedQuery ? { details: ['Read linked dataset schema and rows through the page GraphQL endpoint /api/artifacts/<pageId>/graphql. Use /llms/html-datasets for namespaces, discovery and permissions.'] } : {}),
  }, 404, { 'Cache-Control': 'no-store' });
};

/** A document row this request already fetched and admitted (documentPreparation), and its canonical path when it was computed. */
interface Admitted { row: ArtifactRow; canonicalPath?: string }
/** The document page's reader header (docs/phase2-architecture.md §6): which renderer answered. */
const readerHeaders = (reader: ArtifactPageAnswer['reader'] | undefined): Record<string, string> => (reader ? { ['x-mx-reader']: reader.mode } : {});

/**
 * `Server-Timing` on every response: the whole chain's wall time (`total`) and what it waited on the database
 * (`db`, with the statement COUNT — never a statement, an id or a URL), so a deployment is measurable from the
 * browser's network panel. APPENDED, so the phases a route reports itself (the offline download's) stay in the same
 * one header. A stream keeps streaming: only the headers are touched, the body passes through.
 */
const serverTiming = async (c: Context, next: () => Promise<void>): Promise<void> => {
  const started = performance.now();
  const { stats } = await measureQueries(next);
  const timing = `total;dur=${(performance.now() - started).toFixed(1)}, db;dur=${stats.ms.toFixed(1)};desc="${stats.count} queries"`;
  try {
    c.res.headers.append('Server-Timing', timing);
  } catch {
    // Immutable headers (a redirect, a fetched response): copy the response rather than lose the measurement.
    try {
      const copy = new Response(c.res.body, c.res);
      copy.headers.append('Server-Timing', timing);
      c.res = copy;
    } catch { /* a response that cannot be copied (a protocol switch) goes out as it is */ }
  }
};

/**
 * `x-artifactbin-build` on every response (lib/http/app-build): the build this server serves NOW, which a page left
 * open across a deploy compares with the build it is. Same immutable-headers fallback as `serverTiming`.
 */
const buildHeader = (build: string) => async (c: Context, next: () => Promise<void>): Promise<void> => {
  await next();
  try { c.res.headers.set(APP_BUILD_HEADER, build); } catch {
    try { const copy = new Response(c.res.body, c.res); copy.headers.set(APP_BUILD_HEADER, build); c.res = copy; } catch { /* a protocol switch */ }
  }
};

export function createAppServer(opts: AppServerOptions = {}): Hono {
  const app = new Hono();
  app.use('*', serverTiming);
  const webDir = opts.webDir ?? path.resolve('dist/web');
  // The build this server serves: the built tree's (production); development's Vite-served shell is none.
  const build = opts.indexHtml ? null : appBuildId(webDir);
  setAppBuild(build);
  if (build) app.use('*', buildHeader(build));
  // A page route that reads a stored document the current code does not serve answers its 410 by name (lib/artifacts/servable), never a bare 500.
  app.onError((error, c) => {
    if (error instanceof UnservableDocument) return error.response();
    console.error(`[page] ${c.req.method} ${new URL(c.req.url).pathname} failed:`, error);
    return new Response('Internal Server Error', { status: 500 });
  });
  // A deploy compiles nothing, so its build is made durable here: a later deploy can still bind a page
  // assembled for this one (`/islands/d/<sha>.js?b=`, shared-builds.server retainedBuild).
  // Transport identity must be attached before any app middleware or route
  // asks viewer.ts who is calling.
  if (opts.actorSecret) actorReceiver(opts.actorSecret).mount(app);
  /*
   * Every document on its own origin (server/pages-host): a pages hostname, a pages Origin and the
   * pages cookie are decided there, before any other host boundary.
   */
  const pagesSite = opts.pagesSite ?? deployedPagesSite();
  app.use('*', pagesHost(pagesSite));
  /** The policy every app page carries: strict, framing only the pages origins. */
  const appPageCsp = appPagePolicy(pagesSite);
  const pageCsp = (url: string): string => (opts.devHmrPort !== undefined ? developmentAppCsp(appPageCsp, url, opts.devHmrPort) : appPageCsp);
  let indexCache: string | null = null;
  /** The app shell: the one Solid entry (web/solid-app.html) for every address the app answers. */
  const index = async (url: string): Promise<string> => {
    if (opts.indexHtml) return opts.indexHtml(url);
    return (indexCache ??= readFileSync(path.join(webDir, 'solid-app.html'), 'utf8'));
  };

  // A verified custom domain is answered by its own boundary before any app
  // route can see it (server/custom-host); every other host passes straight on.
  // Its home page links the stylesheets THIS page links, read from the same shell.
  app.use('*', customHostBoundary({ stylesheets: async (url) => linkedStylesheets(await index(url)) }));
  const assetsOrigin = ASSETS_ORIGIN;
  if (assetsOrigin) app.use('*', async (c, next) => {
    const incoming = new URL(c.req.url);
    if (incoming.host !== new URL(assetsOrigin).host && baseUrl(c.req.raw) !== assetsOrigin) return next();
    // Only the byte validator crosses this anonymous boundary; never credentials.
    const headers = new Headers();
    const validator = c.req.header('if-none-match');
    if (validator !== undefined) headers.set('if-none-match', validator);
    const request = new Request(assetsOrigin + incoming.pathname + incoming.search, { method: c.req.method, headers });
    if (!isPublicAssetRequest(request, assetsOrigin)) return new Response('not found', { status: 404, headers: { 'cache-control': 'no-store' } });
    const response = incoming.pathname.startsWith('/assets/export/')
      ? await exportAssetResponse(request, incoming.pathname.slice('/assets/export/'.length))
      : incoming.pathname.startsWith('/assets/ref/')
      ? await publicRefAssetResponse(request, incoming.pathname.slice('/assets/ref/'.length))
      : await publicAssetBytes(request, { params: Promise.resolve({ hash: incoming.pathname.slice('/assets/'.length) }) });
    const safe = publicAssetResponse(response);
    return c.req.method === 'HEAD' ? new Response(null, { status: safe.status, headers: safe.headers }) : safe;
  });
  if (opts.onTokenRevoked) {
    app.use('/api/*', async (c, next) => {
      await next();
      if (c.req.method !== 'DELETE' || c.res.status !== 204) return;
      const match = /^\/api\/(?:my\/)?tokens\/([^/]+)$/.exec(new URL(c.req.url).pathname);
      if (match) opts.onTokenRevoked?.(decodeURIComponent(match[1]));
    });
  }
  if (!opts.indexHtml) mountBuildAssets(app, webDir);
  const preloadListing = opts.indexHtml ? (html: string) => html : createListingPreloader(webDir);
  // …and per document, the lazy code THIS document runs: its chart module, its Mermaid kinds.
  app.get(GITHUB_EXTERNAL_URL, createGithubResponse());
  const publicDir = opts.publicDir ?? path.resolve('public');
  /**
   * The app page. When the address names something the page will immediately
   * ask for — a document, a profile — the server answers that question HERE
   * and inlines the answer, so the SPA's first paint is its final geometry:
   * no fetch round trip, no chrome settling, no address healing a beat later.
   * The endpoints stay the truth; this is the same data, arriving earlier.
   */
  const page = async (c: { req: { raw: Request; url: string } }, status?: 200 | 404, canonical?: string, address?: string, admitted?: Admitted) => {
    // A document served at a non-canonical address is rendered AS its canonical address (see documentAddress).
    const url = address ? new URL(address + new URL(c.req.url).search, c.req.url).href : c.req.url;
    const found = status === 404 ? null : await bootstrapFor(c.req.raw, new URL(url).pathname, admitted);
    const data = found ? { ...found.data, ...(address ? { address } : {}) } : null;
    const appRow = admitted?.row ?? null;
    // A document is the app page's frame (lib/serving/document-frame), named in the page's head as the document.
    const frame = found?.frame ?? null;
    // An @-address whose profile resolves to NOTHING is a miss, and a miss is
    // 404 as a STATUS (the rule documents already live by) — the SPA is still
    // the body, so the person sees the app's own 404 page rather than a
    // default. Only derived when the caller did not already decide (the
    // document handlers pass their admission's 404 explicitly).
    const miss = data === null && new URL(url).pathname.split('/').filter(Boolean)[0]?.startsWith('@');
    const code = status ?? (miss ? 404 : 200);
    const html = await index(url);
    // A dead end is answered in the language the caller asked in: a browser
    // gets the app's own 404 page, anything else (curl's `*/*`, a fetch tool)
    // gets the refusal that names the way on.
    if (code === 404 && !(c.req.raw.headers.get('accept') ?? '').includes('text/html')) return apiNotFound(c);
    // The agent pointer is injected here, on the request base, for EVERY shell
    // — the static web/solid-app.html carries none, so there is one source (lib/compiled-page/agent-discovery).
    const discovered = withAgentDiscovery(html, baseUrl(c.req.raw));
    const listing = listingPage(data);
    const fonted = withShellFonts(listing ? preloadListing(discovered, listing) : discovered);
    const shell = frame ? withDocumentFrame(fonted, frame) : withGenericSocial(fonted, baseUrl(c.req.raw));
    // The address search engines index a document under (lib/custom-domains canonicalDocumentUrl).
    const linked = canonical ? shell.replace('</head>', () => `<link rel="canonical" href="${escapeHtml(canonical)}"></head>`) : shell;
    // The build this page is (lib/http/app-build), which the page compares with what the server says later.
    const indexed = build ? linked.replace('</head>', () => `<meta name="${APP_BUILD_META}" content="${build}"></head>`) : linked;
    // Last, so the pointer is the page's final line whatever else was inlined.
    // Brotli for a client that takes it (server/content-encoding); identity otherwise, as before.
    const inlined = data;
    const ordered = withReaderHeadOrder(appRow ? withArtifactAppHead(indexed, appRow) : indexed);
    return compressDynamic(c.req.raw, new Response(withAgentDiscoveryTail(inlined ? withBootstrap(ordered, inlined) : ordered, agentDiscovery(baseUrl(c.req.raw))), { status: code, headers: {
      'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', ...APP_SECURITY_HEADERS,
      'content-security-policy': new URL(c.req.url).pathname==='/local/connect' ? pageCsp(c.req.url).replace("frame-ancestors 'self'", "frame-ancestors file: http://localhost:* http://127.0.0.1:* http://[::1]:*") : pageCsp(c.req.url),
      ...readerHeaders(found?.reader),
      // A document's address carries the agent pointer as a header too, for a fetch that reads no body.
      ...(frame ? { Link: `<${agentDiscovery(baseUrl(c.req.raw)).url}>; rel="help"` } : {}),
    } }));
  };

  const pageData = (dir: string) => ROUTES.find((r) => r.dir === dir)?.module.GET as ((request: Request, ctx: { params: Promise<Record<string, string>> }) => Promise<Response>) | undefined;
  const profileData = pageData('/api/page/profile/[user]/[[...path]]');

  /**
   * What this address will be asked for, answered now. A pretty URL that names
   * a document carries BOTH answers — the resolution and the document page —
   * because the profile page renders the artifact page, and one missing answer
   * is one round trip and one visible settle. A document's answer comes with
   * the story its runtime renders (lib/artifact-page), which the page inlines.
   */
  type Bootstrap = { data: { path: string; profile?: unknown; artifact?: unknown }; frame?: DocumentFrame; reader?: ArtifactPageAnswer['reader'] };
  /** The document parts of an answer the page serves: the document's frame, and which renderer is in it. */
  const documentParts = (answer: ArtifactPageAnswer | null): Omit<Bootstrap, 'data'> => (answer ? {
    ...(answer.frame ? { frame: answer.frame } : {}),
    ...(answer.reader ? { reader: answer.reader } : {}),
  } : {});
  async function bootstrapFor(request: Request, pathname = new URL(request.url).pathname, admitted?: Admitted): Promise<Bootstrap | null> {
    // The ORIGINAL request answers, whatever path it is rendered as: its actor rides on the object (utils inProcess).
    const url = { pathname };
    const segments = url.pathname.split('/').filter(Boolean);
    // The row documentPreparation already fetched and admitted for this request rides along: one fetch, one check.
    const document = async (id: string) => {
      const answer = await runWithRequest(request, () => artifactPageAnswer(request, id, { ...(admitted ? { admitted: admitted.row } : {}), pages: pagesSite }));
      return answer.status === 200 ? answer : null;
    };
    if (segments.at(-1) === 'edit' || (segments[0] === 'a' && segments.length === 3 && segments[2] === 'app')) segments.pop();
    if (segments[0] === 'a' && segments.length === 2) {
      const artifact = await document(segments[1]!);
      return artifact ? { data: { path: url.pathname, artifact: artifact.body }, ...documentParts(artifact) } : null;
    }
    if (segments[0]?.startsWith('@')) {
      /*
       * The document's own canonical address, already fetched and admitted for this request: the
       * resolution is the profile route's own answer for it (`{ kind: 'artifact', id }`), without a
       * second fetch of the row or a second admission.
       */
      const own = admitted?.canonicalPath !== undefined && `/${segments.join('/')}` === admitted.canonicalPath;
      const res = own || !profileData ? null : await runWithRequest(request, () => profileData(request, { params: Promise.resolve({ user: segments[0]!, ...(segments.length > 1 ? { path: segments.slice(1).join('/') } : {}) }) }));
      const profile = own ? { kind: 'artifact', id: admitted!.row.id } : res?.ok ? await res.json() as { kind?: string; id?: string } : null;
      if (!profile) return null;
      const artifact = profile.kind === 'artifact' && profile.id ? await document(profile.id) : null;
      return { data: { path: url.pathname, profile, ...(artifact ? { artifact: artifact.body } : {}) }, ...documentParts(artifact) };
    }
    return null;
  }

  /**
   * A document address the viewer may not read answers 404 — the STATUS, not
   * only the page. "Gone" and "not yours" look alike by design, and a 200
   * carrying a not-found page would be a weaker answer than the one the
   * server-rendered page gave (and is what a crawler, a curl and the gates
   * all read). The SPA renders its own 404 body inside it.
   */
  /**
   * The canonical address for a document, when the one the viewer asked for is
   * not it — served IN PLACE, not redirected: the page is rendered as the
   * canonical address and names it (`address`) for the SPA to put in the
   * address bar (solid/lib/heal-address), saving a shared link its round trip. It
   * runs AFTER the ACL, so a private document never leaks its owner to a
   * viewer who cannot read it; a valid export key skips the healing, because a
   * capture must stay at the address it was handed.
   */
  const documentPreparation = async (request: Request): Promise<{ status: 200 | 404; address?: string; canonical?: string; admitted?: Admitted }> => {
    const url = new URL(request.url);
    const found = candidateDocument(url.pathname);
    if (!found) return { status: 200 };
    const row = await getArtifactById(found.id);
    if (!row) return { status: 404 };
    // A key skips canonical healing, but only a valid key admits the page.
    const key = url.searchParams.get('key');
    if (!url.pathname.endsWith('/edit') && key && verifyExportKey(row.id, key)) return { status: 200, admitted: { row } };
    const actor = await sessionActor(request).catch(() => null);
    const editingDataset = row.format === 'dataset' && url.pathname.endsWith('/edit');
    if (editingDataset && (!actor || !canEdit(await effectiveRole(row, actor)))) return { status: 404 };
    if (!(await canReadArtifact(row, actor ?? ANONYMOUS_ACTOR))) return { status: 404 };
    // Admitted, by this request's own actor: the page's answer reuses the row and this decision.
    if (url.searchParams.has('key')) return { status: 200, admitted: { row } };
    const canonicalPath = canonicalArtifactPath(row, await ownerUsername(row.user_id));
    const canonical = canonicalPath + (editingDataset ? '/edit' : '');
    return { status: 200, admitted: { row, canonicalPath }, canonical: await canonicalDocumentUrl(row), ...(canonical !== url.pathname ? { address: canonical } : {}) };
  };

  // Static: content-addressed trees are immutable; everything else is served plainly.
  app.use('/libraries/*', async (c, next) => { await next(); c.header('cache-control', 'public, max-age=3600'); c.header('access-control-allow-origin', '*'); });
  // Opaque-origin /raw frames import these modules and fetch the page engine's wasm.
  // Every file is content-addressed; both requests need CORS and immutable caching.
  app.use('/islands/*', async (c, next) => { await next(); if (c.res.status < 400) c.header('cache-control', IMMUTABLE); c.header('access-control-allow-origin', '*'); });
  app.use('/fonts/*', async (c, next) => { await next(); c.header('cache-control', IMMUTABLE); c.header('access-control-allow-origin', '*'); });
  app.use('/geojson/*', async (c, next) => { await next(); c.header('cache-control', 'public, max-age=86400'); c.header('access-control-allow-origin', '*'); });
  app.use('/assets/*', async (c, next) => { await next(); c.header('cache-control', IMMUTABLE); });
  // In development Vite owns /assets and dist/web does not exist yet. Avoid
  // registering a static root that can only warn; production builds it first.
  if (existsSync(webDir)) app.use('/assets/*', precompressedStatic({ root: path.relative(process.cwd(), webDir) || '.' }));
  app.all('/chat/*', async c => c.notFound());
  app.all('/install.sh', async c => c.notFound());
  app.all('/login/cli', async c => c.notFound());
  // Content-addressed islands and the compatibility libraries carry build-time brotli/gzip siblings.
  app.use('/*', precompressedStatic({ root: path.relative(process.cwd(), publicDir) || '.', onFound: () => {}, onNotFound: () => {} }));

  app.on(['GET', 'HEAD'], '/', async c => {
    const signedIn = await runWithRequest(c.req.raw, async () => {
      const actor = await sessionActor(c.req.raw);
      return actor.credential === 'session' && !!actor.userId;
    });
    if (signedIn) return page(c);
    c.header('Cache-Control', 'no-store');
    if ((await getDeploymentState(null)).mode === 'company') return page(c);
    // A browser still holding its old guest cookie was signed out when guest sessions ended: say so on the login page.
    const wasGuest = (c.req.header('cookie') ?? '').split(/;\s*/).some(part => part.startsWith(`${AGENT_COOKIE}=`));
    return c.redirect(wasGuest ? '/login?signedOut=1' : '/login', 302);
  });
  app.on(['GET', 'HEAD'], ['/login'], async c => {
    c.header('Cache-Control', 'no-store');
    const actor = await runWithRequest(c.req.raw, () => sessionActor(c.req.raw));
    if (actor.credential === 'session' && actor.userId) {
      const url = new URL(c.req.url);
      return c.redirect(loginRedirectTarget(url.searchParams.get('callbackUrl'), baseUrl(c.req.raw)), 302);
    }
    return page(c);
  });
  // The tour for people.
  app.get('/docs', (c) => {
    c.header('Vary', 'Accept');
    c.header('Cache-Control', 'no-store');
    return c.req.header('Accept')?.includes('text/html') ? c.redirect('/docs-human', 302) : apiNotFound(c);
  });
  app.on(['GET','HEAD'],'/local/publish',(c)=>page(c));
  app.get('/docs-human', (c) => page(c));
  // The broker is platform-owned chrome, framed by file:// or loopback documents.
  app.get('/local/connect', (c) => page(c));
  app.get('/getting-started', (c) => page(c));
  // Page data is finished JSON: brotli for a client that takes it (server/content-encoding).
  app.use('/api/page/*', dynamicEncoding());
  // The app's API and document handlers.
  mountRoutes(app);

  app.all('/api', apiNotFound);
  app.all('/api/*', apiNotFound);
  app.all('/openapi.json', apiNotFound);
  app.all('/.well-known/ai-plugin.json', apiNotFound);

  // The reader/owner split, then the app page.
  const documentAddress = async (c: { req: { raw: Request; url: string } }) => {
    // Canonical readers share the app document so its router can transition
    // without changing security policy. Only /raw and exports retain the
    // standalone top-level sandbox; authored scripts still run in Iframes.
    const { status, address, canonical, admitted } = await runWithRequest(c.req.raw, () => documentPreparation(c.req.raw));
    // Admission's 404 is final; its 200 can mean "not a document
    // address" — a pretty path under an unknown handle still misses, and
    // page() derives that from the profile resolution it already ran.
    return page(c, status === 404 ? 404 : undefined, canonical, address, admitted);
  };

  // App identity stays at its stable URL; never heal it to the pretty reader address.
  app.get('/a/:id/app/', async c => {
    const row = await runWithRequest(c.req.raw, () => readableApp(c.req.raw, c.req.param('id')));
    return page(c, row ? 200 : 404, undefined, undefined, row ? { row } : undefined);
  });
  app.get('/a/:id/app', async c => {
    const row = await runWithRequest(c.req.raw, () => readableApp(c.req.raw, c.req.param('id')));
    return row ? c.redirect(artifactAppPath(row.id), 302) : page(c, 404);
  });
  app.get('/a/:id/app/:asset', async c => {
    const row = await runWithRequest(c.req.raw, () => readableApp(c.req.raw, c.req.param('id')));
    if (!row || !artifactPwaEnabled(row)) return c.notFound();
    const asset = c.req.param('asset');
    const headers = { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' };
    if (asset === 'manifest.webmanifest') return new Response(JSON.stringify(artifactManifest(row)), { headers: { ...headers, 'content-type': 'application/manifest+json' } });
    const size = asset === 'icon-192.png' ? 192 : asset === 'icon-512.png' ? 512 : null;
    if (!size) return c.notFound();
    return new Response(new Uint8Array(await artifactAppIcon(row, size)), { headers: { ...headers, 'content-type': 'image/png' } });
  });
  app.get('/a/:id/edit', documentAddress);
  app.get('/a/:id', documentAddress);
  // A handle is `@name` in ONE segment — Hono's params are whole segments, so the shape is a regex param.
  app.get('/:user{@[a-z0-9_]+}/*', documentAddress);
  app.get('/:user{@[a-z0-9_]+}', (c) => page(c));
  // A root typo gets the SPA too — its 404 page, under the 404 STATUS. A development server also answers its dev pages.
  const appPages = spaPaths({ dev: opts.devHmrPort !== undefined });
  app.get('*', async (c) => (appPages.test(new URL(c.req.url).pathname) ? page(c) : page(c, 404)));
  return app;
}
