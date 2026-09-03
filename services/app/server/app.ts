/**
 * THE APP SERVER — Hono, the whole app behind the proxy:
 *
 *  - every `app/**\/route.ts` handler, from the generated table (server/api);
 *  - the READER/OWNER split for `/a/<id>` and `/@user/...` (the one thing
 *    `proxy.ts` did as Next middleware): a reader is served the document
 *    ITSELF — the `raw` handler's response, per-row CSP and all, at the same
 *    URL, no iframe, no redirect; an owner, an editor, a commenter, or any
 *    document whose data needs the page's relay gets the app page;
 *  - the app's pages: one SPA (web/, built by Vite) served for the app's
 *    paths under the app CSP;
 *  - the static tree under public/ with the cache rules next.config used to
 *    carry (content-addressed → immutable; /geojson a day).
 *
 * The request is held in AsyncLocalStorage for the duration of each handler
 * (lib/request-context), which is how `publicOrigin()` and analytics see it.
 */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { Hono } from 'hono';
import { serveStatic } from '@hono/node-server/serve-static';
import { actorReceiver } from '@artifactbin/utils';
import { canReadArtifact, getArtifactById } from '@/lib/artifacts';
import { verifyExportKey } from '@/lib/export-key';
import { ID_RE } from '@/lib/ids';
import { runWithRequest } from '@/lib/request-context';
import { declaresLiveData } from '@/lib/story/helmet';
import { SHOWCASE_ORIGIN } from '@/lib/showcase';
import { canonicalArtifactPath, parsePrettyPath } from '@/lib/urls';
import { ownerUsername } from '@/lib/users';
import { roleFor, sessionActor } from '@/lib/viewer';
import { canAnnotate } from '@/lib/share-roles';
import { baseUrl, json } from '@/lib/http';
import { mountRoutes } from './api';
import { ROUTES } from './routes.generated';

/** Where the server hands the SPA a page's data so its FIRST paint is its final one. */
export const BOOTSTRAP_ID = 'mx-page-data';
/** `<` is the only character that can end a script element early; JSON never needs it. */
const safeJson = (value: unknown): string => JSON.stringify(value).replace(/</g, '\\u003c');
export const withBootstrap = (html: string, data: unknown): string =>
  html.replace('</head>', `  <script type="application/json" id="${BOOTSTRAP_ID}">${safeJson(data)}</script>\n  </head>`);

// Inline scripts emitted by our source HTML and Vite's development transform.
// Keeping the hashes explicit preserves the production policy while allowing
// React Fast Refresh to install its hook when this server hosts Vite middleware.
export const APP_INLINE_SCRIPT_HASHES = [
  "'sha256-MKCvCRsPxrVldjRT7eukzwMMAlrlAXCz+AyDpcVL9Fg='", // theme bootstrap (web/index.html — pinned by lib/__tests__/app-page-csp)
  "'sha256-Z2/iFzh9VMlVkEOar1f/oSHWwQk3ve1qk/C2WdsC4Xk='", // Vite React-refresh preamble
].join(' ');

export const APP_CSP = [
  "default-src 'none'", `script-src 'self' ${APP_INLINE_SCRIPT_HASHES}`, "style-src 'self' 'unsafe-inline'",
  // The showcase cards are the CANONICAL instance's own captures, addressed
  // absolutely because a local or self-hosted install does not have those ids
  // (lib/showcase). `'self'` admits them only when the app IS that origin, so
  // the landing page's pictures worked on the deployment and nowhere else.
  `img-src 'self' ${SHOWCASE_ORIGIN} data: blob:`, "font-src 'self' data:",
  "connect-src 'self' https://api-js.mixpanel.com https://api.mixpanel.com",
  "manifest-src 'self'", "frame-src 'self'", "frame-ancestors 'self'",
  // The source editor wires a Monaco worker (components/SourceEditor). It is
  // LAZY — measured: with only the HTML tokenizer loaded, nothing has yet asked
  // for it — so this is not what broke `code` mode (that was the CDN script,
  // refused by `script-src`). It is here because the failure would be silent
  // and remote: `worker-src` has no default of its own, falling back through
  // `child-src` to `default-src 'none'`, so the first Monaco feature that wants
  // a worker would be refused by a directive nobody wrote. Vite emits it as a
  // same-origin asset (measured: `new Worker('/assets/editor.worker-<hash>.js')`),
  // so `'self'` is the whole permission — NOT `blob:`, which would reopen
  // script-from-a-string.
  "worker-src 'self'",
  "form-action 'self'", "object-src 'none'", "base-uri 'self'",
].join('; ');
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
  publicDir?: string;
}

/** Which document, if any, a path names — `/a/<id>` or a pretty URL. */
export function candidateDocument(pathname: string): { id: string } | null {
  const segments = pathname.split('/').filter(Boolean);
  if (segments[0] === 'a') return segments.length === 2 && ID_RE.test(segments[1]) ? { id: segments[1] } : null;
  if (!segments[0]?.startsWith('@')) return null;
  const file = parsePrettyPath(segments.slice(1).map((s) => { try { return decodeURIComponent(s); } catch { return s; } }));
  return file ? { id: file.id } : null;
}

/**
 * Reader or owner? A rewrite to the served document when the viewer is a
 * plain reader of a markup document that needs no session for its data;
 * otherwise the page. Ported from proxy.ts unchanged in its decisions.
 */
export async function servesDocumentDirectly(request: Request): Promise<string | null> {
  const url = new URL(request.url);
  const found = candidateDocument(url.pathname);
  if (!found) return null;
  if (url.searchParams.has('key')) return null;
  const actor = await sessionActor(request).catch(() => null);
  const anonymous = !actor || (!actor.viewer && !actor.tokenId);
  const artifact = await getArtifactById(found.id);
  if (!artifact || artifact.format !== 'markup') return null;
  const needsSessionForData = declaresLiveData(artifact.source) && !(await canReadArtifact(artifact, null));
  if (needsSessionForData) return null;
  // The shell is for anyone who may do more than READ it — today owner,
  // editor and commenter; tomorrow whoever a `comment`-granting link lets in,
  // with no change here. A plain viewer is served the document itself.
  if (!anonymous && canAnnotate(await roleFor(artifact, actor))) return null;
  if (!(await canReadArtifact(artifact, actor?.viewer ?? null))) return null;
  return found.id;
}

const SPA_PATHS = /^(\/|\/login|\/account|\/tokens|\/docs-human)$/;

/**
 * A guessed machine address is answered in the machine's language. `/docs`
 * and `/docs/*` are the agent surface; everything an agent GUESSES on the way
 * there — a path under `/api/` nobody serves, `/openapi.json`,
 * `/.well-known/ai-plugin.json` — used to fall through to the SPA and answer
 * a page of HTML, which tells a fetch tool nothing. It now answers the same
 * shape `unauthorized()` does: the error, and the one address that fixes it.
 *
 * Mounted AFTER the real routes (an earlier match wins) and BEFORE the SPA
 * fallback, by EXACT path under `/.well-known/` — a prefix mount there would
 * swallow `/.well-known/oauth-protected-resource`, which is the proxy's.
 *
 * Every OTHER miss answers this too when the caller never asked for HTML
 * (`page()` below): measured on production, `/.well-known/deepseek` and
 * `/help` handed a fetch tool the 891-byte SPA shell and no way on.
 */
const apiNotFound = (c: { req: { raw: Request } }) =>
  json({ error: 'not_found', docs: `${baseUrl(c.req.raw)}/docs` }, 404, { 'Cache-Control': 'no-store' });

export function createAppServer(opts: AppServerOptions = {}): Hono {
  const app = new Hono();
  // Transport identity must be attached before any app middleware or route
  // asks viewer.ts who is calling.
  if (opts.actorSecret) actorReceiver(opts.actorSecret).mount(app);
  if (opts.onTokenRevoked) {
    app.use('/api/*', async (c, next) => {
      await next();
      if (c.req.method !== 'DELETE' || c.res.status !== 204) return;
      const match = /^\/api\/(?:my\/)?tokens\/([^/]+)$/.exec(new URL(c.req.url).pathname);
      if (match) opts.onTokenRevoked?.(decodeURIComponent(match[1]));
    });
  }
  const webDir = opts.webDir ?? path.resolve('dist/web');
  const publicDir = opts.publicDir ?? path.resolve('public');
  const raw = ROUTES.find((r) => r.dir === '/a/[id]/raw')?.module.GET as ((request: Request, ctx: { params: Promise<{ id: string }> }) => Promise<Response>) | undefined;
  let indexCache: string | null = null;
  const index = async (url: string): Promise<string> => {
    if (opts.indexHtml) return opts.indexHtml(url);
    return (indexCache ??= readFileSync(path.join(webDir, 'index.html'), 'utf8'));
  };
  /**
   * The app page. When the address names something the page will immediately
   * ask for — a document, a profile — the server answers that question HERE
   * and inlines the answer, so the SPA's first paint is its final geometry:
   * no fetch round trip, no chrome settling, no address healing a beat later.
   * The endpoints stay the truth; this is the same data, arriving earlier.
   */
  const page = async (c: { req: { raw: Request; url: string } }, status?: 200 | 404) => {
    const html = await index(c.req.url);
    const data = await bootstrapFor(c.req.raw);
    // An @-address whose profile resolves to NOTHING is a miss, and a miss is
    // 404 as a STATUS (the rule documents already live by) — the SPA is still
    // the body, so the person sees the app's own 404 page rather than a
    // default. Only derived when the caller did not already decide (the
    // document handlers pass documentStatus's 404 explicitly).
    const miss = data === null && new URL(c.req.url).pathname.split('/').filter(Boolean)[0]?.startsWith('@');
    const code = status ?? (miss ? 404 : 200);
    // A dead end is answered in the language the caller asked in: a browser
    // gets the app's own 404 page, anything else (curl's `*/*`, a fetch tool)
    // gets the refusal that names the way on.
    if (code === 404 && !(c.req.raw.headers.get('accept') ?? '').includes('text/html')) return apiNotFound(c);
    return new Response(data ? withBootstrap(html, data) : html, { status: code, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', ...APP_SECURITY_HEADERS } });
  };

  const pageData = (dir: string) => ROUTES.find((r) => r.dir === dir)?.module.GET as ((request: Request, ctx: { params: Promise<Record<string, string>> }) => Promise<Response>) | undefined;
  const artifactData = pageData('/api/page/artifact/[id]');
  const profileData = pageData('/api/page/profile/[user]/[[...path]]');

  /**
   * What this address will be asked for, answered now. A pretty URL that names
   * a document carries BOTH answers — the resolution and the document page —
   * because the profile page renders the artifact page, and one missing answer
   * is one round trip and one visible settle.
   */
  async function bootstrapFor(request: Request): Promise<{ path: string; profile?: unknown; artifact?: unknown } | null> {
    const url = new URL(request.url);
    const segments = url.pathname.split('/').filter(Boolean);
    const call = async (fn: typeof artifactData, params: Record<string, string>) => {
      if (!fn) return null;
      const res = await runWithRequest(request, () => fn(request, { params: Promise.resolve(params) }));
      return res.ok ? await res.json() : null;
    };
    if (segments[0] === 'a' && segments.length === 2) {
      const artifact = await call(artifactData, { id: segments[1] });
      return artifact ? { path: url.pathname, artifact } : null;
    }
    if (segments[0]?.startsWith('@')) {
      const profile = await call(profileData, { user: segments[0], ...(segments.length > 1 ? { path: segments.slice(1).join('/') } : {}) }) as { kind?: string; id?: string } | null;
      if (!profile) return null;
      const artifact = profile.kind === 'artifact' && profile.id ? await call(artifactData, { id: profile.id }) : null;
      return { path: url.pathname, profile, ...(artifact ? { artifact } : {}) };
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
   * The canonical address for a document the viewer gets the PAGE for, when
   * the one they asked for is not it — a redirect, exactly as the page used to
   * throw. It runs AFTER the ACL, so a private document never leaks its owner
   * through a redirect target; and only for the page, since a READER is served
   * the document AT the address they were given (the shared link is canonical).
   */
  const healTo = async (request: Request): Promise<string | null> => {
    const url = new URL(request.url);
    const found = candidateDocument(url.pathname);
    if (!found || url.searchParams.has('key')) return null;
    const row = await getArtifactById(found.id);
    if (!row) return null;
    const actor = await sessionActor(request).catch(() => null);
    if (!(await canReadArtifact(row, actor?.viewer ?? null))) return null;
    const canonical = canonicalArtifactPath(row, await ownerUsername(row.user_id));
    return canonical === url.pathname ? null : canonical + url.search;
  };

  const documentStatus = async (request: Request): Promise<200 | 404> => {
    const found = candidateDocument(new URL(request.url).pathname);
    if (!found) return 200;
    const row = await getArtifactById(found.id);
    if (!row) return 404;
    // The exporter's key is the one credential a session-less browser can
    // hold, so it is CHECKED here. Trusting its mere presence made the status
    // an existence oracle for every private document — and `edit_id`, which
    // the page hands to every viewer, was the obvious thing to try in it.
    const key = new URL(request.url).searchParams.get('key');
    if (key && verifyExportKey(row.id, key)) return 200;
    const actor = await sessionActor(request).catch(() => null);
    return (await canReadArtifact(row, actor?.viewer ?? null)) ? 200 : 404;
  };

  // Static: content-addressed trees are immutable; everything else is served plainly.
  app.use('/story/*', async (c, next) => { await next(); c.header('cache-control', IMMUTABLE); c.header('access-control-allow-origin', '*'); });
  app.use('/fonts/*', async (c, next) => { await next(); c.header('cache-control', IMMUTABLE); c.header('access-control-allow-origin', '*'); });
  app.use('/geojson/*', async (c, next) => { await next(); c.header('cache-control', 'public, max-age=86400'); c.header('access-control-allow-origin', '*'); });
  app.use('/assets/*', async (c, next) => { await next(); c.header('cache-control', IMMUTABLE); });
  // In development Vite owns /assets and dist/web does not exist yet. Avoid
  // registering a static root that can only warn; production builds it first.
  if (existsSync(webDir)) app.use('/assets/*', serveStatic({ root: path.relative(process.cwd(), webDir) || '.' }));
  app.use('/install.sh', async (c, next) => { await next(); c.header('content-type', 'text/x-shellscript; charset=utf-8'); });
  app.use('/*', serveStatic({ root: path.relative(process.cwd(), publicDir) || '.', onFound: () => {}, onNotFound: () => {} }));

  // The tour for people, registered AHEAD of the API mount: `/docs/*` is one
  // catch-all route (the skills tree), and it would otherwise swallow the old
  // address's redirect. `/docs-human` is outside that catch-all by shape, and
  // sits here beside the address it replaced.
  app.get('/docs-human', (c) => page(c));
  app.get('/docs/human', (c) => c.redirect('/docs-human', 301));
  // The token page must likewise win over the later profile-shaped catch-all
  // (`/tokens/new` otherwise looks like user "tokens", path "new").
  app.get('/tokens/new', (c) => page(c));
  // The app's API and document handlers.
  mountRoutes(app);

  app.all('/api', apiNotFound);
  app.all('/api/*', apiNotFound);
  app.all('/openapi.json', apiNotFound);
  app.all('/.well-known/ai-plugin.json', apiNotFound);

  // The reader/owner split, then the app page.
  const documentAddress = async (c: { req: { raw: Request; url: string } }) => {
    const id = await runWithRequest(c.req.raw, () => servesDocumentDirectly(c.req.raw));
    if (id && raw) return runWithRequest(c.req.raw, () => raw(c.req.raw, { params: Promise.resolve({ id }) }));
    const to = await runWithRequest(c.req.raw, () => healTo(c.req.raw));
    if (to) return new Response(null, { status: 302, headers: { location: to, 'cache-control': 'no-store' } });
    // documentStatus's 404 is final; its 200 only means "not a document
    // address" — a pretty path under an unknown handle still misses, and
    // page() derives that from the profile resolution it already ran.
    const status = await runWithRequest(c.req.raw, () => documentStatus(c.req.raw));
    return page(c, status === 404 ? 404 : undefined);
  };

  app.get('/a/:id', documentAddress);
  // A handle is `@name` in ONE segment — Hono's params are whole segments, so the shape is a regex param.
  app.get('/:user{@[a-z0-9_]+}/*', documentAddress);
  app.get('/:user{@[a-z0-9_]+}', (c) => page(c));
  // A root typo gets the SPA too — its 404 page, under the 404 STATUS — where
  // Hono's own notFound() answered bare text that looked like a different app.
  app.get('*', async (c) => (SPA_PATHS.test(new URL(c.req.url).pathname) ? page(c) : page(c, 404)));
  return app;
}
