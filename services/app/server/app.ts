import { loginRedirectTarget } from '@/lib/safe-redirect';
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
import {agentDiscovery,agentDiscoveryHead,withAgentDiscoveryTail} from '@/lib/agent-discovery';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { createGithubResponse } from './external/github';
import { loadStorySsr } from '@/lib/story/ssr.server';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import StarterInstructions from '@/components/StarterInstructions';
import type { PreparedStoryRuntime } from '@/lib/story/prepared-runtime';
import { inlineStoryHtml } from '@/lib/story/inline-story-html';
import { escapeHtml } from '@/lib/story/reader-chrome';
import { APP_BAR_H } from '@/lib/story/edit-bar';
import { Hono } from 'hono';
import { serveStatic } from '@hono/node-server/serve-static';
import { offlineExtrasAsset, offlineExtrasEncoded } from '@/lib/offline/bundle.server';
import { actorReceiver, isPublicAssetRequest, publicAssetResponse } from '@artifactbin/utils';
import { canReadArtifact, getArtifactById } from '@/lib/artifacts';
import { verifyExportKey } from '@/lib/export-key';
import { ID_RE } from '@/lib/ids';
import { runWithRequest } from '@/lib/request-context';
import { artifactViewPath, canonicalArtifactPath, parsePrettyPath } from '@/lib/urls';
import { ownerUsername } from '@/lib/users';
import { canEdit } from '@/lib/share-roles';
import { roleFor, sessionActor } from '@/lib/viewer';
import { baseUrl, json } from '@/lib/http';
import { ASSETS_ORIGIN } from '@/lib/config';
import { GET as publicAssetBytes } from '@/app/assets/[hash]/route';
import { CARD_RENDER_GENERATION } from '@/lib/export-card';
import { exportAssetResponse } from '@/lib/export/assets';
import { publicRefAssetResponse } from '@/lib/public-ref-assets';
import { mountRoutes } from './api';
import { ROUTES } from './routes.generated';
import { authorFrameResponse } from './author-frame';
import { AUTHOR_FRAME_PATH } from '@/lib/story-runtime/author-frame';
import { GITHUB_EXTERNAL_URL } from '@/lib/github-star';
import { createDocumentPreloader, createListingPreloader, createReaderPreloader, listingPage } from './reader-preloads';
import { artifactPageAnswer, type InitialStory } from '@/lib/artifact-page';
import { mountBuildAssets } from './build-assets';
import { compressDynamic, dynamicEncoding, precompressedStatic, variantResponse } from './content-encoding';
import { customHostBoundary } from './custom-host';
import { linkedStylesheets } from '@/lib/custom-domain-home';
import { THEME_BOOTSTRAP_HASH } from '@/lib/theme-bootstrap';
import { canonicalDocumentUrl } from '@/lib/custom-domains';
import { APP_SHELL_FONT_PRELOADS } from '@/lib/app-fonts';
import { fontPreloadTags } from '@/lib/story/first-screen-fonts';

/**
 * The `<link rel="help">` and `<meta name="afbin">` an agent that fetched any page reads, on the caller's
 * base — FIRST in the head, ahead of every preload and stylesheet link Vite stamps into the shell, so a
 * shell tool that keeps only the first few kilobytes of a page still sees them. A page with no `<head>`
 * at all gets them before `</head>`.
 */
function withAgentDiscovery(html: string, origin: string): string {
  const tags = agentDiscoveryHead(agentDiscovery(origin));
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

/** The shell's first-screen face (lib/app-fonts), preloaded on a page with no document of its own. */
const withShellFonts = (html: string): string => html.replace('</head>', () => `${fontPreloadTags(APP_SHELL_FONT_PRELOADS)}</head>`);

/** Where the server hands the SPA a page's data so its FIRST paint is its final one. */
export const BOOTSTRAP_ID = 'mx-page-data';
/** `<` is the only character that can end a script element early; JSON never needs it. */
const safeJson = (value: unknown): string => JSON.stringify(value).replace(/</g, '\\u003c');
export const withBootstrap = (html: string, data: unknown): string =>
  // A function replacement keeps JavaScript's special replacement tokens in
  // user-authored JSON literal instead of expanding them with the HTML shell.
  html.replace('</head>', () => `  <script type="application/json" id="${BOOTSTRAP_ID}">${safeJson(data)}</script>\n  </head>`);

/** What the app page inlines for a document: its story element and the head facts about it. */
export interface InitialStoryParts {
  /** The story element (lib/story/inline-story-html), rendered on demand. */
  html: () => string;
  title: string;
  fontPreloads: readonly string[];
}

/** A story from RAW prepared parts (a test, or any caller without a prepared page): isolated and rendered here. */
export function initialStoryOf(runtime: PreparedStoryRuntime): InitialStoryParts {
  return { html: () => inlineStoryHtml(runtime, loadStorySsr().renderInlineStory), title: runtime.title, fontPreloads: runtime.fontPreloads ?? [] };
}

/** Initial readable document, outside React's empty root; captured by reference
 * before React mounts. The inline runtime ADOPTS its story element and hydrates
 * it (lib/story-runtime/inline-composition is the tree on both sides); the
 * wrapper around it, with its handoff rule, is removed in the same commit. App
 * root and head bootstrap precede ALL author nodes, including colliding ids.
 */
export function withInitialStory(html: string, initial: InitialStoryParts, id: string, description?: string | null, origin = '', starter = false): string {
  const story = starter
    ? renderToStaticMarkup(createElement(StarterInstructions, { id, initialOrigin: origin }))
    : initial.html();
  // While lazy app code mounts, it must not push the readable server sibling
  // down by its viewport height. This temporary rule belongs to the captured
  // sibling, so its removal atomically reveals the committed app document.
  // Only the real first body child is hidden, never an authored colliding id.
  const handoffCss = `body > #root:first-child{display:none!important}[data-mx-initial-story]{position:relative;min-height:100vh;box-sizing:border-box;padding-top:0}@media(min-width:640px){[data-mx-initial-story]{padding-top:${APP_BAR_H}px}}`;
  // What this first screen paints: the document's faces, or — for a starter
  // placeholder, which draws the shell's instructions — the shell's own.
  const fontPreloads = fontPreloadTags(starter ? APP_SHELL_FONT_PRELOADS : initial.fontPreloads);
  const metadata = fontPreloads + `<meta property="og:title" content="${escapeHtml(initial.title)}">`
    + (description ? `<meta name="description" content="${escapeHtml(description)}"><meta property="og:description" content="${escapeHtml(description)}">` : '')
    + `<meta property="og:image" content="${escapeHtml(origin)}/a/${escapeHtml(id)}/export?mode=card&amp;r=${CARD_RENDER_GENERATION}"><meta name="twitter:card" content="summary_large_image">`;
  return html.replace(/<title>[\s\S]*?<\/title>/i, () => `<title>${escapeHtml(initial.title)}</title>`)
    .replace('</head>', () => `${metadata}</head>`)
    .replace('</body>', () => `<div data-mx-initial-story=""><style>${handoffCss}</style>${story}</div></body>`);
}

/**
 * THE SHEET RIDES ONCE. When the page inlines the document's story, that
 * story's `<style>` is the one copy of its isolated sheet: the bootstrap drops
 * `runtime.css`, and web/bootstrap puts the style's text back before anything
 * reads the payload. A starter's instructions are not the story, so its
 * payload keeps the sheet.
 */
function withoutInlinedSheet<T>(data: T): T {
  const artifact = (data as { artifact?: { surface?: { runtime?: { css?: string } } } }).artifact;
  const runtime = artifact?.surface?.runtime;
  if (!runtime || runtime.css === undefined) return data;
  const { css: _sheet, ...rest } = runtime;
  return { ...data, artifact: { ...artifact, surface: { ...artifact.surface, runtime: rest } } };
}

// Inline scripts emitted by our source HTML and Vite's development transform.
// Keeping the hashes explicit preserves the production policy while allowing
// React Fast Refresh to install its hook when this server hosts Vite middleware.
export const APP_INLINE_SCRIPT_HASHES = [
  THEME_BOOTSTRAP_HASH, // theme bootstrap (web/index.html — lib/theme-bootstrap, pinned by lib/__tests__/app-page-csp)
  "'sha256-Z2/iFzh9VMlVkEOar1f/oSHWwQk3ve1qk/C2WdsC4Xk='", // Vite React-refresh preamble
].join(' ');

export const APP_CSP = [
  // 'wasm-unsafe-eval' lets the page COMPILE WebAssembly — the SQLite engine a
  // reader's document runs its queries on (lib/story-runtime/page-sqlite) —
  // and nothing else: no eval, no Function, no string timers. Author code
  // never runs here; it runs in its own frame, whose policy does not admit it.
  "default-src 'none'", `script-src 'self' 'wasm-unsafe-eval' ${APP_INLINE_SCRIPT_HASHES}`, "style-src 'self' 'unsafe-inline'",
  // Listing thumbnails redirect from /a/:id/export to the configured asset
  // origin. Admit that destination for images; local posters remain same-origin.
  `img-src 'self' data: blob:${ASSETS_ORIGIN ? ` ${ASSETS_ORIGIN}` : ''}`, "font-src 'self' data:",
  // `media-src` has no default of its own either, so without this line every
  // <video> and <audio> on an app page is refused by `default-src 'none'`.
  // `'self'` is a stored file played back from /a/<id>/raw; `blob:` is the
  // upload page previewing a file BEFORE it is sent (web/pages/FileUpload).
  // GLTFLoader also fetches embedded textures through local blob URLs.
  // Frame and worker policies stay same-origin; blobs are data here.
  "media-src 'self' blob:",
  "connect-src 'self' blob:",
  "manifest-src 'self'", "frame-src 'self'", "frame-ancestors 'self'",
  // No feature starts a worker today (the source editor runs none). This is
  // here because the failure would be silent and remote: `worker-src` has no
  // default of its own, falling back through `child-src` to `default-src
  // 'none'`, so the first feature that wants a worker would be refused by a
  // directive nobody wrote. Vite emits workers as same-origin assets, so
  // `'self'` is the whole permission — NOT `blob:`, which would reopen
  // script-from-a-string.
  "worker-src 'self'",
  "form-action 'self'", "object-src 'none'", "base-uri 'self'",
].join('; ');
/** Only the development socket joins connect-src; production uses APP_CSP unchanged. */
function developmentAppCsp(pageUrl: string, port: number): string {
  const socket = new URL(pageUrl);
  socket.protocol = socket.protocol === 'https:' ? 'wss:' : 'ws:';
  socket.port = String(port);
  return APP_CSP.replace("connect-src 'self'", `connect-src 'self' ${socket.origin}`);
}
const APP_SECURITY_HEADERS = {
  'content-security-policy': APP_CSP,
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
  /** Dev: how index.html is produced (Vite transforms it); prod: read from webDir. */
  indexHtml?: (url: string) => Promise<string>;
  /** Dev: Vite's connect middleware, mounted before everything else for its own assets. */
  devMiddleware?: (req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse, next: () => void) => void;
  /** Dev only: the Vite socket port resolved by the server composition. */
  devHmrPort?: number;
  publicDir?: string;
  /** Where `npm run build:binary -w services/cli` leaves a CLI build (services/cli/dist). When its version is the
   * one the served installer pins, this server serves that build and the installer installs it from here. */
  cliReleaseDir?: string;
}

const GITHUB_RELEASES = 'https://github.com/minusxai/artifactbin/releases/download/afbin-v$version';
/** The version of the CLI build in a local release directory, read from the manifest its build writes. */
function localCliRelease(dir: string): string | null {
  try {
    for (const file of readdirSync(dir)) {
      if (!/^afbin-[a-z0-9]+-[a-z0-9]+(?:\.exe)?\.manifest\.json$/.test(file)) continue;
      const version: unknown = JSON.parse(readFileSync(path.join(dir, file), 'utf8')).version;
      if (typeof version === 'string') return version;
    }
  } catch { /* no local build */ }
  return null;
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


/** Every static address web/App.tsx routes: a direct load or a reload of one missing here is a 404. */
const SPA_PATHS = /^(\/|\/login|\/start|\/account|\/notifications|\/welcome|\/chat|\/assets|\/trash|\/tokens|\/docs-human|\/datasets\/new|\/files\/new)$/;

/**
 * A guessed machine address is answered in the machine's language. A path
 * under `/api/` nobody serves, `/openapi.json` and `/.well-known/ai-plugin.json`
 * answer the same shape `unauthorized()` does: the error, and the one way on —
 * `afbin help`. A page of HTML tells a fetch tool nothing.
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
    help: guessedQuery ? 'afbin help publishing-query' : 'afbin help',
    ...(guessedQuery ? { details: ['This route does not exist. Stored document queries use /a/<documentId>/query and select declared queries with {"only":["query_name"]}; they do not accept SQL. Use afbin help publishing-query for methods and access rules.'] } : {}),
  }, 404, { 'Cache-Control': 'no-store' });
};

export function createAppServer(opts: AppServerOptions = {}): Hono {
  const app = new Hono();
  // Transport identity must be attached before any app middleware or route
  // asks viewer.ts who is calling.
  if (opts.actorSecret) actorReceiver(opts.actorSecret).mount(app);
  const webDir = opts.webDir ?? path.resolve('dist/web');
  let indexCache: string | null = null;
  const index = async (url: string): Promise<string> => {
    if (opts.indexHtml) return opts.indexHtml(url);
    return (indexCache ??= readFileSync(path.join(webDir, 'index.html'), 'utf8'));
  };
  // A verified custom domain is answered by its own boundary before any app
  // route can see it (server/custom-host); every other host passes straight on.
  // Its home page links the stylesheets THIS page links, read from the same shell.
  app.use('*', customHostBoundary({ stylesheets: async (url) => linkedStylesheets(await index(url)) }));
  const assetsOrigin = ASSETS_ORIGIN;
  app.get(AUTHOR_FRAME_PATH, c => authorFrameResponse(c.req.raw, assetsOrigin, baseUrl(c.req.raw)));
  if (assetsOrigin) app.use('*', async (c, next) => {
    const incoming = new URL(c.req.url);
    if (incoming.host !== new URL(assetsOrigin).host && baseUrl(c.req.raw) !== assetsOrigin) return next();
    const request = new Request(assetsOrigin + incoming.pathname + incoming.search, { method: c.req.method });
    if (!isPublicAssetRequest(request, assetsOrigin)) return new Response('not found', { status: 404 });
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
  const preloadReader = opts.indexHtml ? (html: string) => html : createReaderPreloader(webDir);
  const preloadListing = opts.indexHtml ? (html: string) => html : createListingPreloader(webDir);
  // …and per document, the lazy code THIS document runs: its chart module, its Mermaid kinds.
  const preloadDocument = opts.indexHtml ? (html: string) => html : createDocumentPreloader(webDir);
  app.get(GITHUB_EXTERNAL_URL, createGithubResponse());
  const publicDir = opts.publicDir ?? path.resolve('public');
  const cliReleaseDir = opts.cliReleaseDir ?? path.resolve(publicDir, '..', '..', 'cli', 'dist');
  /**
   * The app page. When the address names something the page will immediately
   * ask for — a document, a profile — the server answers that question HERE
   * and inlines the answer, so the SPA's first paint is its final geometry:
   * no fetch round trip, no chrome settling, no address healing a beat later.
   * The endpoints stay the truth; this is the same data, arriving earlier.
   */
  const page = async (c: { req: { raw: Request; url: string } }, status?: 200 | 404, canonical?: string, address?: string) => {
    // A document served at a non-canonical address is rendered AS its canonical address (see documentAddress).
    const url = address ? new URL(address + new URL(c.req.url).search, c.req.url).href : c.req.url;
    const html = await index(url);
    const found = await bootstrapFor(c.req.raw, new URL(url).pathname);
    const data = found ? { ...found.data, ...(address ? { address } : {}) } : null;
    // An @-address whose profile resolves to NOTHING is a miss, and a miss is
    // 404 as a STATUS (the rule documents already live by) — the SPA is still
    // the body, so the person sees the app's own 404 page rather than a
    // default. Only derived when the caller did not already decide (the
    // document handlers pass their admission's 404 explicitly).
    const miss = data === null && new URL(url).pathname.split('/').filter(Boolean)[0]?.startsWith('@');
    const code = status ?? (miss ? 404 : 200);
    // A dead end is answered in the language the caller asked in: a browser
    // gets the app's own 404 page, anything else (curl's `*/*`, a fetch tool)
    // gets the refusal that names the way on.
    if (code === 404 && !(c.req.raw.headers.get('accept') ?? '').includes('text/html')) return apiNotFound(c);
    const surface = (data?.artifact as { surface?: { id: string }; description?: string | null } | undefined);
    // The agent pointer is injected here, on the request base, for EVERY shell
    // — the static index.html carries none, so there is one source (lib/agent-discovery).
    const discovered = withAgentDiscovery(html, baseUrl(c.req.raw));
    const listing = listingPage(data);
    const story = found?.story;
    const shell = story && surface?.surface
      // A starter placeholder draws its instructions, not its body: no lazy code of its own.
      ? withInitialStory(preloadDocument(preloadReader(discovered), story.starter ? { chart: false, mermaid: [] } : story.lazyCode), story, surface.surface.id, surface.description, baseUrl(c.req.raw), story.starter)
      // No document: the first screen is the shell's, set in its own face.
      : withGenericSocial(withShellFonts(listing ? preloadListing(discovered, listing) : discovered), baseUrl(c.req.raw));
    // The address search engines index a document under (lib/custom-domains canonicalDocumentUrl).
    const indexed = canonical ? shell.replace('</head>', () => `<link rel="canonical" href="${escapeHtml(canonical)}"></head>`) : shell;
    // Last, so the pointer is the page's final line whatever else was inlined.
    // Brotli for a client that takes it (server/content-encoding); identity otherwise, as before.
    const inlined = story && !story.starter ? withoutInlinedSheet(data) : data;
    return compressDynamic(c.req.raw, new Response(withAgentDiscoveryTail(inlined ? withBootstrap(indexed, inlined) : indexed, agentDiscovery(baseUrl(c.req.raw))), { status: code, headers: {
      'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', ...APP_SECURITY_HEADERS,
      ...(opts.devHmrPort !== undefined ? { 'content-security-policy': developmentAppCsp(c.req.url, opts.devHmrPort) } : {}),
      ...(story ? { Link: `<${baseUrl(c.req.raw)}/llms.txt>; rel="help"` } : {}),
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
  async function bootstrapFor(request: Request, pathname = new URL(request.url).pathname): Promise<{ data: { path: string; profile?: unknown; artifact?: unknown }; story?: InitialStory } | null> {
    // The ORIGINAL request answers, whatever path it is rendered as: its actor rides on the object (utils inProcess).
    const url = { pathname };
    const segments = url.pathname.split('/').filter(Boolean);
    const document = async (id: string) => {
      const answer = await runWithRequest(request, () => artifactPageAnswer(request, id));
      return answer.status === 200 ? answer : null;
    };
    if (segments.at(-1) === 'edit') segments.pop();
    if (segments[0] === 'a' && segments.length === 2) {
      const artifact = await document(segments[1]!);
      return artifact ? { data: { path: url.pathname, artifact: artifact.body }, ...(artifact.story ? { story: artifact.story } : {}) } : null;
    }
    if (segments[0]?.startsWith('@')) {
      const res = profileData ? await runWithRequest(request, () => profileData(request, { params: Promise.resolve({ user: segments[0]!, ...(segments.length > 1 ? { path: segments.slice(1).join('/') } : {}) }) })) : null;
      const profile = res?.ok ? await res.json() as { kind?: string; id?: string } : null;
      if (!profile) return null;
      const artifact = profile.kind === 'artifact' && profile.id ? await document(profile.id) : null;
      return { data: { path: url.pathname, profile, ...(artifact ? { artifact: artifact.body } : {}) }, ...(artifact?.story ? { story: artifact.story } : {}) };
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
   * address bar (web/heal-address), saving a shared link its round trip. It
   * runs AFTER the ACL, so a private document never leaks its owner to a
   * viewer who cannot read it; a valid export key skips the healing, because a
   * capture must stay at the address it was handed.
   */
  const documentPreparation = async (request: Request): Promise<{ status: 200 | 404; address?: string; canonical?: string }> => {
    const url = new URL(request.url);
    const found = candidateDocument(url.pathname);
    if (!found) return { status: 200 };
    const row = await getArtifactById(found.id);
    if (!row) return { status: 404 };
    // A key skips canonical healing, but only a valid key admits the page.
    const key = url.searchParams.get('key');
    if (!url.pathname.endsWith('/edit') && key && verifyExportKey(row.id, key)) return { status: 200 };
    const actor = await sessionActor(request).catch(() => null);
    if (url.pathname.endsWith('/edit') && (!actor || !canEdit(await roleFor(row, actor)))) return { status: 404 };
    if (!(await canReadArtifact(row, actor?.viewer ?? null))) return { status: 404 };
    if (url.searchParams.has('key')) return { status: 200 };
    const canonical = canonicalArtifactPath(row, await ownerUsername(row.user_id)) + (url.pathname.endsWith('/edit') ? '/edit' : '');
    return { status: 200, canonical: await canonicalDocumentUrl(row), ...(canonical !== url.pathname ? { address: canonical } : {}) };
  };

  // Static: content-addressed trees are immutable; everything else is served plainly.
  app.use('/story/*', async (c, next) => { await next(); c.header('cache-control', IMMUTABLE); c.header('access-control-allow-origin', '*'); });
  /*
   * The offline file's code-view extras (lib/offline/extras): the source editor and prettier,
   * content-addressed like /story/*, and loaded from a file:// page (a `null`
   * origin) by an SRI-pinned script — which is a CORS request, hence the open ACAO.
   */
  app.on(['GET', 'HEAD'], '/offline/:name', async (c) => {
    const code = await offlineExtrasAsset(c.req.param('name'));
    if (!code) return c.notFound();
    return variantResponse(c, code, await offlineExtrasEncoded(c.req.param('name')), {
      'content-type': 'text/javascript; charset=utf-8', 'cache-control': IMMUTABLE, 'access-control-allow-origin': '*', 'x-content-type-options': 'nosniff',
    });
  });
  app.use('/libraries/*', async (c, next) => { await next(); c.header('cache-control', 'public, max-age=3600'); c.header('access-control-allow-origin', '*'); });
  app.use('/fonts/*', async (c, next) => { await next(); c.header('cache-control', IMMUTABLE); c.header('access-control-allow-origin', '*'); });
  app.use('/geojson/*', async (c, next) => { await next(); c.header('cache-control', 'public, max-age=86400'); c.header('access-control-allow-origin', '*'); });
  app.use('/assets/*', async (c, next) => { await next(); c.header('cache-control', IMMUTABLE); });
  // In development Vite owns /assets and dist/web does not exist yet. Avoid
  // registering a static root that can only warn; production builds it first.
  if (existsSync(webDir)) app.use('/assets/*', precompressedStatic({ root: path.relative(process.cwd(), webDir) || '.' }));
  // The CLI installer and its uninstaller are fetched with `curl … | sh`; serve both the same way.
  for (const script of ['/install.sh', '/chat/install.sh', '/chat/uninstall.sh']) app.use(script, async (c, next) => {
    await next();
    c.header('content-type', 'text/x-shellscript; charset=utf-8');
    c.header('cache-control', 'public, max-age=300');
    c.header('x-content-type-options', 'nosniff');
  });
  // A CLI built on this machine is served by this server, so a local install never leaves it: the installer
  // then names this origin instead of GitHub. Production has no local build and serves the file unchanged.
  for (const installer of ['/install.sh', '/chat/install.sh']) app.get(installer, (c) => {
    const script = readFileSync(path.join(publicDir, 'chat', 'install.sh'), 'utf8');
    const pinned = script.match(/^ {2}version=(\S+)$/m)?.[1];
    const local = pinned !== undefined && localCliRelease(cliReleaseDir) === pinned;
    // The script is told where it came from, so a CLI installed from a self-hosted origin talks to that
    // origin by default instead of the public server (`afbin setup --server`, then `.env`).
    const origin = baseUrl(c.req.raw);
    const addressed = script.replace(/^ {2}origin=''$/m, () => `  origin='${origin}'`);
    return c.text(local ? addressed.replace(GITHUB_RELEASES, () => `${origin}/chat/releases/afbin-v$version`) : addressed);
  });
  app.get('/chat/install.ps1', c => {
    const script=readFileSync(path.join(publicDir,'chat','install.ps1'),'utf8');
    const pinned=script.match(/\$Version = '(\d+\.\d+\.\d+)'/)?.[1];
    const origin=baseUrl(c.req.raw),literal=(value:string)=>value.replace(/'/g,"''");
    let body=script.replace(/^\$Origin = '[^']*'$/m,()=>`$Origin = '${literal(origin)}'`);
    if(pinned&&localCliRelease(cliReleaseDir)===pinned)body=body.replace(/^\$ReleaseRoot = '[^']*'$/m,()=>`$ReleaseRoot = '${literal(origin)}/chat/releases'`);
    c.header('content-type','text/plain; charset=utf-8');c.header('cache-control','public, max-age=300');c.header('x-content-type-options','nosniff');
    return c.body(body);
  });
  app.use('/chat/releases/*', async (c, next) => {
    const [release = '', file = '', ...rest] = c.req.path.split('/').slice(3);
    const version = release.startsWith('afbin-v') ? release.slice('afbin-v'.length) : '';
    if (rest.length || !/^\d+\.\d+\.\d+$/.test(version) || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(file) || localCliRelease(cliReleaseDir) !== version) return c.notFound();
    await next();
    c.header('cache-control', 'no-store');
  });
  if(existsSync(cliReleaseDir)) app.use('/chat/releases/*', serveStatic({ root: path.relative(process.cwd(), cliReleaseDir) || '.', rewriteRequestPath: (p) => p.replace(/^\/chat\/releases\/[^/]+\//, '/'), onFound: () => {}, onNotFound: () => {} }));
  // Content-addressed trees (/story, /libraries) carry build-time brotli/gzip siblings (server/content-encoding).
  app.use('/*', precompressedStatic({ root: path.relative(process.cwd(), publicDir) || '.', onFound: () => {}, onNotFound: () => {} }));

  app.on(['GET', 'HEAD'], '/', async c => {
    const signedIn = await runWithRequest(c.req.raw, async () => {
      const actor = await sessionActor(c.req.raw);
      return actor.credential === 'session' && !!actor.viewer?.userId;
    });
    if (signedIn) return page(c);
    c.header('Cache-Control', 'no-store');
    return c.redirect('/login', 302);
  });
  app.on(['GET', 'HEAD'], '/login', async c => {
    c.header('Cache-Control', 'no-store');
    const actor = await runWithRequest(c.req.raw, () => sessionActor(c.req.raw));
    if (actor.credential === 'session' && actor.viewer?.userId) {
      const url = new URL(c.req.url);
      return c.redirect(loginRedirectTarget(url.searchParams.get('callbackUrl'), baseUrl(c.req.raw)), 302);
    }
    return page(c);
  });
  // The tour for people.
  app.get('/docs-human', (c) => page(c));
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
    const { status, address, canonical } = await runWithRequest(c.req.raw, () => documentPreparation(c.req.raw));
    // Admission's 404 is final; its 200 can mean "not a document
    // address" — a pretty path under an unknown handle still misses, and
    // page() derives that from the profile resolution it already ran.
    return page(c, status === 404 ? 404 : undefined, canonical, address);
  };

  app.get('/a/:id/edit', documentAddress);
  app.get('/a/:id', documentAddress);
  // A handle is `@name` in ONE segment — Hono's params are whole segments, so the shape is a regex param.
  app.get('/:user{@[a-z0-9_]+}/*', documentAddress);
  app.get('/:user{@[a-z0-9_]+}', (c) => page(c));
  // A root typo gets the SPA too — its 404 page, under the 404 STATUS.
  app.get('*', async (c) => (SPA_PATHS.test(new URL(c.req.url).pathname) ? page(c) : page(c, 404)));
  return app;
}
