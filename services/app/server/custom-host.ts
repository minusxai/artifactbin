/**
 * THE CUSTOM-HOST BOUNDARY — the first thing a request meets (server/app).
 *
 * When the request's host (the same source `baseUrl()` reads) is a VERIFIED
 * custom domain (lib/custom-domains), this answers the request itself and
 * serves only:
 *
 *   GET/HEAD /                      the owner's home page: their profile listing (lib/custom-domain-home)
 *   GET/HEAD /<id>[-<slug>]         a post: the owner's public document, bare
 *   /a/<id>/query                   GET; POST only with the reader's local tables
 *   /a/<id>/mutate                  POST only for a `scope="local"` Mutation; OPTIONS
 *   /a/<id>/events, /events/frame   GET
 *   /a/<id>/resolve                 GET/HEAD
 *   /a/<id>/assets                  GET
 *   GET/HEAD /a/<id>/raw            an image, file or PDF one of the owner's public posts embeds
 *   GET/HEAD /assets/<sha>          our copy of a web image one of those posts names
 *   GET/HEAD /a/<id>/export?format=jpg&mode=card   a public post's card, the home page's thumbnail
 *   GET/HEAD /api/users/<owner>/avatar              the owner's picture, the home page's hero
 *   GET/HEAD /assets/<name>.css|.woff2              the app's built stylesheet and fonts, never its script
 *   /story, /fonts, /webfonts, /libraries, /geojson, /favicon.ico   the static runtime
 *
 * Every `/a/<id>` route and every post is scoped to the OWNER's PUBLIC markup
 * documents — the app's own doors also admit unlisted ones to anyone, so that
 * is decided here, before a handler runs. Everything else is 404, never a
 * redirect. Handlers see a request with no cookie, authorization or actor, so
 * they answer as they would a guest, and no response leaves with Set-Cookie.
 *
 * Any host that is NOT a verified mapping passes through untouched.
 */
import type { Context, MiddlewareHandler } from 'hono';
import { artifactIdFromSegment } from '@artifactbin/utils/artifact-reference';
import { ACTOR_HEADER, BUILD_ASSET_PATH } from '@artifactbin/contracts';
import { isBuildAssetPath } from '@artifactbin/utils';
import { getArtifactById, declarationsForRow } from '@/lib/artifacts';
import { PUBLIC_BASE_URL } from '@/lib/config';
import { customHostCandidate, ownerForHost, servesDocument, servesEmbeddedArtifact, servesWebAsset } from '@/lib/custom-domains';
import { DOMAIN_HOME_CSP, renderDomainHome } from '@/lib/custom-domain-home';
import type { ProfileListingData } from '@/components/ProfileListing';
import { baseUrl, json } from '@/lib/http';
import { ID_RE } from '@/lib/ids';
import { runWithRequest } from '@/lib/request-context';
import { domainPostPath } from '@/lib/urls';
import { getUserById } from '@/lib/users';
import { GET as rawGet, HEAD as rawHead } from '@/app/a/[id]/raw/route';
import { GET as queryGet, POST as queryPost } from '@/app/a/[id]/query/route';
import { OPTIONS as mutateOptions, POST as mutatePost } from '@/app/a/[id]/mutate/route';
import { GET as eventsGet } from '@/app/a/[id]/events/route';
import { GET as eventsFrameGet } from '@/app/a/[id]/events/frame/route';
import { GET as resolveGet } from '@/app/a/[id]/resolve/route';
import { GET as assetsGet } from '@/app/a/[id]/assets/route';
import { GET as webAssetGet } from '@/app/assets/[hash]/route';
import { GET as exportGet } from '@/app/a/[id]/export/route';
import { GET as avatarGet } from '@/app/api/users/[id]/avatar/route';
import { GET as profileGet } from '@/app/api/page/profile/[user]/[[...path]]/route';

type Handler = (request: Request, ctx: { params: Promise<{ id: string }> }) => Promise<Response> | Response;

/** Static trees the served document and its runtime load from; passed on to the app's own static handlers. */
const STATIC = /^\/(?:story|fonts|webfonts|libraries|geojson)\/|^\/favicon\.ico$/;
/** The app's built stylesheet and its fonts, at the address the app page links them or the manifest-checked one; never a script. */
const buildStyle = (path: string): boolean => {
  const asset = path.startsWith(`${BUILD_ASSET_PATH}/`) ? path.slice(BUILD_ASSET_PATH.length) : path;
  return isBuildAssetPath(asset) && /\.(?:css|woff2)$/.test(asset);
};
/** Credentials never reach a handler on a custom host: the reader is a guest, by construction. */
const CREDENTIAL_HEADERS = ['cookie', 'authorization', 'proxy-authorization', ACTOR_HEADER];

const NOT_FOUND_HTML = '<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Not found</title></head><body style="font:16px/1.6 system-ui,sans-serif;max-width:680px;margin:64px auto;padding:0 16px"><h1 style="font-size:20px">Not found</h1></body></html>';
const notFound = (): Response => new Response(NOT_FOUND_HTML, { status: 404, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' } });

/** The same response, without any Set-Cookie a handler may have added. */
function withoutCookies(response: Response): Response {
  if (!response.headers.has('set-cookie')) return response;
  const headers = new Headers(response.headers);
  headers.delete('set-cookie');
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

/** A HEAD's answer from a GET handler: the same status and headers, no body. */
function bodiless(response: Response): Response {
  void response.body?.cancel();
  return new Response(null, { status: response.status, headers: response.headers });
}

/** The hostname the client addressed, as `baseUrl()` reads it; null when it cannot be parsed. */
function requestHostname(request: Request): string | null {
  try { return new URL(baseUrl(request)).hostname; } catch { return null; }
}

/** A guest's copy of the request: same method, URL and body, no credentials, no attached actor. */
async function asGuest(request: Request, body?: ArrayBuffer | null): Promise<Request> {
  const headers = new Headers(request.headers);
  for (const name of CREDENTIAL_HEADERS) headers.delete(name);
  const hasBody = request.method !== 'GET' && request.method !== 'HEAD';
  return new Request(request.url, { method: request.method, headers, body: hasBody ? body ?? await request.arrayBuffer() : undefined });
}

const parseJson = (bytes: ArrayBuffer): Record<string, unknown> | null => {
  try {
    const value: unknown = JSON.parse(new TextDecoder().decode(bytes));
    return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
  } catch { return null; }
};

const call = (handler: Handler, request: Request, id: string) =>
  runWithRequest(request, async () => handler(request, { params: Promise.resolve({ id }) }));

/** The home page's data: the profile page route's answer, asked as a guest; null when there is no profile to list. */
async function profileOf(request: Request, username: string | null): Promise<ProfileListingData | null> {
  if (!username) return null;
  const user = `@${username}`;
  const guest = await asGuest(new Request(new URL(`/api/page/profile/${encodeURIComponent(user)}`, request.url), { headers: request.headers }));
  const res = await runWithRequest(guest, async () => profileGet(guest, { params: Promise.resolve({ user }) }));
  if (!res.ok) return null;
  const data = await res.json() as ProfileListingData & { kind?: string };
  return data.kind === 'public-profile' ? data : null;
}

/** The home page: the owner's profile listing, drawn by the app's own components under the app's own stylesheet. */
async function home(request: Request, hostname: string, ownerId: string, stylesheets: (url: string) => Promise<string[]>): Promise<Response> {
  const owner = await getUserById(ownerId);
  const [profile, styles] = await Promise.all([profileOf(request, owner?.username ?? null), stylesheets(request.url)]);
  const base = PUBLIC_BASE_URL.replace(/\/+$/, '');
  const html = renderDomainHome({
    hostname,
    owner: { username: owner?.username ?? null, name: owner?.name ?? null },
    profile,
    stylesheets: styles,
    footerHref: owner?.username ? `${base}/@${owner.username}` : base,
  });
  return new Response(request.method === 'HEAD' ? null : html, { status: 200, headers: {
    'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'content-security-policy': DOMAIN_HOME_CSP,
    'x-content-type-options': 'nosniff', 'referrer-policy': 'strict-origin-when-cross-origin',
  } });
}

/** A post: `/<id>` or `/<id>-<slug>`; any other slug is redirected to the canonical one on this host. */
async function post(request: Request, segment: string, hostname: string, ownerId: string): Promise<Response> {
  let decoded: string;
  try { decoded = decodeURIComponent(segment); } catch { return notFound(); }
  const id = artifactIdFromSegment(decoded);
  if (!id) return notFound();
  const row = await getArtifactById(id);
  if (!row || !servesDocument(ownerId, row)) return notFound();
  const canonical = domainPostPath(row);
  if (decoded !== id && `/${decoded}` !== canonical) {
    return new Response(null, { status: 302, headers: { location: canonical + new URL(request.url).search, 'cache-control': 'no-store' } });
  }
  const guest = await asGuest(request);
  const domain = { hostname, ownerId };
  return runWithRequest(guest, async () => (request.method === 'HEAD' ? rawHead : rawGet)(guest, { params: Promise.resolve({ id }), domain }));
}

/** A served document's own read-side routes, on the same methods the app answers them with. */
async function documentRoute(request: Request, id: string, route: string, ownerId: string): Promise<Response> {
  const method = request.method;
  const row = ID_RE.test(id) ? await getArtifactById(id) : null;
  if (!row || !servesDocument(ownerId, row)) return notFound();
  const get = method === 'GET';
  switch (route) {
    case 'query': {
      if (get) return call(queryGet, await asGuest(request), id);
      if (method !== 'POST') return notFound();
      // A POST exists for the reader's own temporary rows, and for nothing else.
      const body = await request.arrayBuffer();
      const local = parseJson(body)?.localTables;
      if (!local || typeof local !== 'object' || !Object.keys(local).length) return notFound();
      return call(queryPost, await asGuest(request, body), id);
    }
    case 'mutate': {
      if (method === 'OPTIONS') return call(mutateOptions, await asGuest(request), id);
      if (method !== 'POST') return notFound();
      const body = await request.arrayBuffer();
      const name = parseJson(body)?.mutation;
      const declared = declarationsForRow(row)?.flow.mutations?.find((m) => m.name === name);
      // Only a local Mutation runs here: it writes the reader's own rows, never a dataset.
      if (declared && declared.scope !== 'local') {
        return json({ error: 'dataset_read_only', detail: 'This page is read-only.' }, 403, { 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-store' });
      }
      return call(mutatePost, await asGuest(request, body), id);
    }
    case 'events': return get ? call(eventsGet, await asGuest(request), id) : notFound();
    case 'events/frame': return get ? call(eventsFrameGet, await asGuest(request), id) : notFound();
    case 'resolve': return get || method === 'HEAD' ? call(resolveGet, await asGuest(request), id) : notFound();
    case 'assets': return get ? call(assetsGet, await asGuest(request), id) : notFound();
    default: return notFound();
  }
}

/**
 * The bytes a post embeds. An uploaded image renders as `/a/<id>/raw?v=<n>[&w=]`
 * (lib/story/ref-data imageRawUrl), a web image as our copy at `/assets/<sha>`
 * (lib/story/asset-url). Each is served only when one of the owner's public
 * posts embeds it, through the app's own handler, to a guest.
 *
 * And the home page's two images: a public post's card thumbnail
 * (components/Shelf, `/a/<id>/export?format=jpg&mode=card`) and the owner's
 * picture (lib/avatars). Same rule: the app's handler, a guest, this owner's
 * public posts and nobody else's.
 */
async function embedded(request: Request, path: string, ownerId: string): Promise<Response | null> {
  const raw = /^\/a\/([^/]+)\/raw$/.exec(path);
  if (raw) {
    const id = raw[1]!;
    const row = ID_RE.test(id) ? await getArtifactById(id) : null;
    if (!row || !(await servesEmbeddedArtifact(ownerId, row))) return notFound();
    // No capability rides in on the URL: an export key never admits bytes here.
    const url = new URL(request.url);
    url.searchParams.delete('key');
    const guest = await asGuest(new Request(url, request));
    return call(request.method === 'HEAD' ? rawHead : rawGet, guest, id);
  }
  const card = /^\/a\/([^/]+)\/export$/.exec(path);
  if (card) {
    const id = card[1]!;
    const asked = new URL(request.url).searchParams;
    // Exactly the thumbnail Shelf draws (the card JPEG); no re-render, archive, slide or key rides in.
    if (asked.get('format') !== 'jpg' || asked.get('mode') !== 'card') return notFound();
    const row = ID_RE.test(id) ? await getArtifactById(id) : null;
    if (!row || !servesDocument(ownerId, row)) return notFound();
    const url = new URL(request.url);
    url.search = '';
    for (const name of ['format', 'mode', 'v', 'r']) { const value = asked.get(name); if (value !== null) url.searchParams.set(name, value); }
    const guest = await asGuest(new Request(url, { method: 'GET', headers: request.headers }));
    // As bytes: the redirect to the export asset would leave this host.
    const res = await runWithRequest(guest, async () => exportGet(guest, { params: Promise.resolve({ id }), delivery: 'bytes' }));
    return request.method === 'HEAD' ? bodiless(res) : res;
  }
  const avatar = /^\/api\/users\/([^/]+)\/avatar$/.exec(path);
  if (avatar) {
    // The owner's picture alone: the hero draws it, and no other account is anyone's business here.
    if (avatar[1] !== ownerId) return notFound();
    const guest = await asGuest(new Request(request.url, { method: 'GET', headers: request.headers }));
    const res = await runWithRequest(guest, async () => avatarGet(guest, { params: Promise.resolve({ id: ownerId }) }));
    return request.method === 'HEAD' ? bodiless(res) : res;
  }
  const asset = /^\/assets\/([0-9a-f]{64})$/.exec(path);
  if (asset) {
    const hash = asset[1]!;
    if (!(await servesWebAsset(ownerId, hash))) return notFound();
    const guest = await asGuest(request);
    return runWithRequest(guest, async () => {
      const res = await webAssetGet(guest, { params: Promise.resolve({ hash }) });
      return request.method === 'HEAD' ? bodiless(res) : res;
    });
  }
  return null;
}

const DOCUMENT_ROUTE = /^\/a\/([^/]+)\/(query|mutate|events|events\/frame|resolve|assets)$/;

/**
 * The boundary as Hono middleware. Mounted before every other route, so a
 * verified host never reaches the app behind it except for the static trees.
 */
export interface CustomHostOptions {
  /** The stylesheets the app page links (its index.html, as served for `url`), so the home page wears the same CSS. */
  stylesheets?: (url: string) => Promise<string[]>;
}

export function customHostBoundary(options: CustomHostOptions = {}): MiddlewareHandler {
  const stylesheets = options.stylesheets ?? (async () => []);
  return async (c: Context, next) => {
    const named = requestHostname(c.req.raw);
    const hostname = named ? customHostCandidate(named) : null;
    if (!hostname) return next();
    const ownerId = await ownerForHost(hostname);
    if (!ownerId) return next();

    const request = c.req.raw;
    const path = new URL(request.url).pathname;
    const readable = request.method === 'GET' || request.method === 'HEAD';

    if ((STATIC.test(path) || buildStyle(path)) && readable) {
      await next();
      const passed = c.res;
      // Clear first: Hono's setter otherwise merges the old headers (Set-Cookie included) into the new response.
      c.res = undefined as unknown as Response;
      c.res = passed.status === 404 ? notFound() : withoutCookies(passed);
      return;
    }
    if (path === '/' && readable) return withoutCookies(await home(request, hostname, ownerId, stylesheets));
    if (readable) {
      const bytes = await embedded(request, path, ownerId);
      if (bytes) return withoutCookies(bytes);
    }
    const document = DOCUMENT_ROUTE.exec(path);
    if (document) return withoutCookies(await documentRoute(request, document[1]!, document[2]!, ownerId));
    const segment = /^\/([^/]+)$/.exec(path)?.[1];
    if (segment && readable) return withoutCookies(await post(request, segment, hostname, ownerId));
    return notFound();
  };
}
