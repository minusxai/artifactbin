/**
 * THE APP SERVER — Hono, the whole app behind the proxy:
 *
 *  - every `app/**\/route.ts` handler, from the generated table (server/api);
 *  - canonical artifact URLs use the same app document for every viewer,
 *    with permission-filtered prepared data and readable initial story HTML
 *    (./document-address admits the address, ./app-shell renders the page);
 *    explicit raw/export responses retain their document sandbox policy;
 *  - the app's pages: one SPA (web/, built by Vite) served for the app's
 *    paths under the app CSP (./app-policy);
 *  - every public file under /af/, and the old addresses that still
 *    answer for some of them (server/public-files).
 *
 * The request is held in AsyncLocalStorage for the duration of each handler
 * (lib/request-context), which is how `publicOrigin()` and analytics see it.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { Hono, type Context } from 'hono';
import { CANONICAL_CHART_IMAGE_PATH, CANONICAL_DRAFT_CHECK_PATH } from '@artifactbin/contracts/identity-service';
import { isGroupActor } from '@artifactbin/contracts/actor';
import { actorOf, actorReceiver, isPublicAssetRequest, publicAssetResponse } from '@artifactbin/utils';
import { getDeploymentState } from '@/lib/deployment';
import { measureQueries, runWithRequest, ASSETS_ORIGIN, setEventProjection, shellFile } from '@/lib/platform';
import { slugAddressTarget, UnservableDocument } from '@/lib/artifacts';
import { artifactAppAsset, artifactAppPath, readableApp, publicRefAssetResponse, type ArtifactPageAnswer, cachedShell } from '@/lib/document-serving';
import { loginRedirectTarget, spaPaths, APP_BUILD_HEADER, baseUrl, json, setAppBuild, GITHUB_EXTERNAL_URL, pagesSite as deployedPagesSite, type PagesSite } from '@/lib/http';
import { agentDiscovery, agentDiscoveryHead } from '@/lib/agent-copy';
import { exportAssetResponse } from '@/lib/export';
import { projectNotifications } from '@/lib/notifications';
import { ANONYMOUS_ACTOR, AGENT_COOKIE } from '@/lib/accounts';
import { sessionActor } from '@/lib/authentication';
import { linkedStylesheets } from '@/lib/user-pages';
import { GET as publicAssetBytes } from '@/app/assets/[hash]/route';
import { chartImageSeam } from './chart-image-seam';
import { draftCheckSeam } from './draft-check-seam';
import { createGithubResponse } from './external/github';
import { groupAdmitted, groupRefusal } from './group-admission';
import { mountRoutes } from './api';
import { createListingPreloader } from './reader-preloads';
import { appBuildId, mountBuildAssets } from './build-assets';
import { compressDynamic, dynamicEncoding, negotiateEncoding } from './content-encoding';
import { mountPublicFiles, publicFilePath } from './public-files';
import { userHostBoundary } from './user-host';
import { pagesHost } from './pages-host';
import { customShellResponse, loadCustomShell, namesDocument, shellAnswers } from './custom-shell';
import { APP_SECURITY_HEADERS, appPagePolicyAt } from './app-policy';
import { renderAppPage } from './app-shell';
import { type Admitted, admitDocumentAddress, anonymousDocumentHead, candidateDocument, pageBootstrap } from './document-address';

export interface AppServerOptions {
  /** Split deployment only: verify the transport header and attach its actor. */
  actorSecret?: string;
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
  /** APP__SHELL_FILE unless a test passes its own: the custom shell (./custom-shell) served for the app's screens. */
  shellFile?: string | null;
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
    help: guessedQuery ? '/llms/datasets' : '/llms.txt',
    ...(guessedQuery ? { details: ['Read and write a page\'s linked datasets with one SQL statement: POST /api/artifacts/<pageId>/sql {"sql", "params", "revision"}. Use /llms/datasets for tables, discovery and permissions.'] } : {}),
  }, 404, { 'Cache-Control': 'no-store' });
};

// The caller asked for a page: a browser's navigation names `text/html`; curl's `*/*` and a fetch tool's do not.
const wantsHtml = (request: Request): boolean => (request.headers.get('accept') ?? '').includes('text/html');

/** The document page's reader header: which renderer answered. */
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

/** The configured asset origin's requests: public asset bytes only, credential-free (utils `publicAssetResponse`). */
const assetsOriginBoundary = (assetsOrigin: string) => async (c: Context, next: () => Promise<void>): Promise<Response | void> => {
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
};

export function createAppServer(opts: AppServerOptions = {}): Hono {
  // Every composition (server.ts, src/main.ts, server/host) serves through here: facts project into inboxes.
  setEventProjection(projectNotifications);
  // An old public address is routed as the one that owns it now (server/public-files, the legacy table).
  const app = new Hono({ getPath: publicFilePath });
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
  // Transport identity must be attached before any app middleware or route
  // asks viewer.ts who is calling.
  if (opts.actorSecret) actorReceiver(opts.actorSecret).mount(app);
  // AN AGENT SIGNED IN AS A GROUP (contracts `GroupActor`) reaches only the routes ./group-admission lists: one refusal
  // for every other, before any door, page or asset, in-process and across the signed hop alike.
  app.use('*', async (c, next) => isGroupActor(actorOf(c.req.raw)) && !groupAdmitted(c.req.method, new URL(c.req.url).pathname) ? groupRefusal() : next());
  /*
   * Every document on its own origin (server/pages-host): a pages hostname, a pages Origin and the
   * pages cookie are decided there, before any other host boundary.
   */
  const pagesSite = opts.pagesSite ?? deployedPagesSite();
  app.use('*', pagesHost(pagesSite));
  /** The policy the app page (`shell`: the custom shell's screen) at this request's address carries (./app-policy). */
  const policyAt = (request: Request, shell = false): string => appPagePolicyAt(new URL(request.url), { site: pagesSite, pageOrigin: baseUrl(request), devHmrPort: opts.devHmrPort, shell });
  // Read at boot: a file that cannot be read stops the boot here, naming the setting.
  const configuredShell = opts.shellFile === undefined ? shellFile() : opts.shellFile;
  const customShell = configuredShell ? loadCustomShell(configuredShell) : null;
  let indexCache: string | null = null;
  /** The app shell: the one Solid entry (web/solid-app.html) for every address the app answers. */
  const index = async (url: string): Promise<string> => {
    if (opts.indexHtml) return opts.indexHtml(url);
    return (indexCache ??= readFileSync(path.join(webDir, 'solid-app.html'), 'utf8'));
  };

  // An anonymous owner host is answered by its own boundary before any app
  // route can see it (server/user-host); every other host passes straight on.
  // Its home page links the stylesheets THIS page links, read from the same shell.
  app.use('*', userHostBoundary({ stylesheets: async (url) => linkedStylesheets(await index(url)) }));
  if (ASSETS_ORIGIN) app.use('*', assetsOriginBoundary(ASSETS_ORIGIN));
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
    // A document served at a non-canonical address is rendered AS its canonical address (see admitDocumentAddress).
    const url = address ? new URL(address + new URL(c.req.url).search, c.req.url).href : c.req.url;
    const found = status === 404 ? null : await pageBootstrap(c.req.raw, new URL(url).pathname, admitted, pagesSite);
    const data = found ? { ...found.data, ...(address ? { address } : {}) } : null;
    // A document is the app page's frame (lib/document-serving/document-frame), named in the page's head as the document.
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
    if (code === 404 && !wantsHtml(c.req.raw)) return apiNotFound(c);
    const origin = baseUrl(c.req.raw);
    const body = renderAppPage(html, { origin, data, frame, canonical, build, appRow: admitted?.row ?? null, preloadListing });
    // Brotli for a client that takes it (server/content-encoding); identity otherwise, as before.
    return compressDynamic(c.req.raw, new Response(body, { status: code, headers: {
      'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', ...APP_SECURITY_HEADERS,
      'content-security-policy': policyAt(c.req.raw),
      ...readerHeaders(found?.reader),
      // A document's address carries the agent pointer as a header too, for a fetch that reads no body.
      ...(frame ? { Link: `<${agentDiscovery(origin).url}>; rel="help"` } : {}),
    } }));
  };

  /** One of the app's own screens: the custom shell in its place when one is set (./custom-shell), else the app page. */
  const screen = async (c: { req: { raw: Request; url: string; method: string } }): Promise<Response> => {
    if (!customShell) return page(c);
    const url = new URL(c.req.url);
    const help = agentDiscovery(baseUrl(c.req.raw));
    // The head slot carries the agent pointer the app page's head carries, then the document's own head where it names one.
    const head = !customShell.headed ? '' : agentDiscoveryHead(help) + (namesDocument(url) ? await runWithRequest(c.req.raw, () => anonymousDocumentHead(c.req.raw, url.pathname)) : '');
    // The policy the app page at this address carries (a document address admits its trusted embedders), and its agent pointer.
    return customShellResponse(customShell, c.req.method, policyAt(c.req.raw, true),
      { ...APP_SECURITY_HEADERS, Link: `<${help.url}>; rel="help"` }, head);
  };
  // Every public file (server/public-files): /af/, its old addresses, the two root files.
  mountPublicFiles(app, { webDir, publicDir });
  app.all('/chat/*', async c => c.notFound());
  app.all('/install.sh', async c => c.notFound());
  app.all('/login/cli', async c => c.notFound());

  app.on(['GET', 'HEAD'], '/', async c => {
    if (customShell) return screen(c);
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
    // Signed out: a custom shell's own sign-in screen when one is set (./custom-shell), else the app page.
    return customShell ? screen(c) : page(c);
  });
  // The tour for people.
  app.get('/docs', (c) => {
    c.header('Vary', 'Accept');
    c.header('Cache-Control', 'no-store');
    return c.req.header('Accept')?.includes('text/html') ? c.redirect('/docs-human', 302) : apiNotFound(c);
  });
  app.on(['GET','HEAD'],'/local/publish',(c)=>screen(c));
  app.get('/docs-human', (c) => screen(c));
  // The broker is platform-owned chrome, framed by file:// or loopback documents.
  app.get('/local/connect', (c) => page(c));
  app.get('/getting-started', (c) => screen(c));
  // Page data is finished JSON: brotli for a client that takes it (server/content-encoding).
  app.use('/api/page/*', dynamicEncoding());
  // The app's API and document handlers.
  app.post(CANONICAL_CHART_IMAGE_PATH,c=>runWithRequest(c.req.raw,()=>chartImageSeam(c.req.raw,actorOf(c.req.raw))));
  app.post(CANONICAL_DRAFT_CHECK_PATH,c=>runWithRequest(c.req.raw,()=>draftCheckSeam(c.req.raw,actorOf(c.req.raw))));
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
    // An anonymous reader's page is the same for everyone: lib/document-serving/shell-cache answers it after admission.
    return cachedShell({
      request: c.req.raw, id: candidateDocument(new URL(c.req.url).pathname)?.id ?? null, build: build ?? null,
      // A title-slug address (lib/artifacts/slug-address) is cached as the page it names for an anonymous reader.
      fallbackId: () => slugAddressTarget(c.req.raw, new URL(c.req.url).pathname, ANONYMOUS_ACTOR),
      encoding: negotiateEncoding(c.req.raw.headers.get('accept-encoding'), ['br']),
    }, async () => {
      const { status, address, canonical, admitted } = await runWithRequest(c.req.raw, () => admitDocumentAddress(c.req.raw));
      // Admission's 404 is final; its 200 can mean "not a document
      // address" — a pretty path under an unknown handle still misses, and
      // page() derives that from the profile resolution it already ran.
      return page(c, status === 404 ? 404 : undefined, canonical, address, admitted);
    });
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
    return (row && await artifactAppAsset(row, c.req.param('asset'))) ?? c.notFound();
  });
  // A custom shell answers a page's and a handle's screens itself (./custom-shell `shellAnswers`); the app, otherwise.
  const documentScreen = (c: Parameters<typeof documentAddress>[0] & { req: { method: string } }) =>
    (customShell && shellAnswers(new URL(c.req.url)) ? screen(c) : documentAddress(c));
  app.get('/a/:id/edit', documentScreen);
  app.get('/a/:id', documentScreen);
  // A handle is `@name` in ONE segment — Hono's params are whole segments, so the shape is a regex param.
  app.get('/:user{@[a-z0-9_]+}/*', documentScreen);
  app.get('/:user{@[a-z0-9_]+}', (c) => (customShell ? screen(c) : page(c)));
  // A root typo gets the SPA too — its 404 page, under the 404 STATUS. A development server also answers its dev pages.
  const appPages = spaPaths({ dev: opts.devHmrPort !== undefined });
  app.get('*', async (c) => {
    const pathname = new URL(c.req.url).pathname;
    // The shell answers every address it owns, for every caller: its screens are the host's, which this app cannot
    // tell from unknown addresses, and its head carries the agent pointer a fetch tool reads.
    if (customShell && shellAnswers(new URL(c.req.url))) return screen(c);
    return appPages.test(pathname) ? page(c) : page(c, 404);
  });
  return app;
}
