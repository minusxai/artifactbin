/**
 * THE CUSTOM-HOST BOUNDARY — the first thing a request meets (server/app).
 *
 * When the request's host (the same source `baseUrl()` reads) is a VERIFIED
 * custom domain (lib/custom-domains), this answers the request itself and
 * serves only:
 *
 *   GET/HEAD /                      the owner's home page (lib/custom-domain-home)
 *   GET/HEAD /<id>[-<slug>]         a post: the owner's public document, bare
 *   /a/<id>/query                   GET; POST only with the reader's local tables
 *   /a/<id>/mutate                  POST only for a `scope="local"` Mutation; OPTIONS
 *   /a/<id>/events, /events/frame   GET
 *   /a/<id>/resolve                 GET/HEAD
 *   /a/<id>/assets                  GET
 *   GET/HEAD /a/<id>/raw            an image, file or PDF one of the owner's public posts embeds
 *   GET/HEAD /assets/<sha>          our copy of a web image one of those posts names
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
import { ACTOR_HEADER } from '@artifactbin/contracts';
import { getArtifactById, declarationsForRow } from '@/lib/artifacts';
import { PUBLIC_BASE_URL } from '@/lib/config';
import { customHostCandidate, domainPostPath, listDomainPosts, ownerForHost, servesDocument, servesEmbeddedArtifact, servesWebAsset } from '@/lib/custom-domains';
import { DOMAIN_HOME_CSP, renderDomainHome } from '@/lib/custom-domain-home';
import { baseUrl, json } from '@/lib/http';
import { ID_RE } from '@/lib/ids';
import { runWithRequest } from '@/lib/request-context';
import { getUserById } from '@/lib/users';
import { GET as rawGet, HEAD as rawHead } from '@/app/a/[id]/raw/route';
import { GET as queryGet, POST as queryPost } from '@/app/a/[id]/query/route';
import { OPTIONS as mutateOptions, POST as mutatePost } from '@/app/a/[id]/mutate/route';
import { GET as eventsGet } from '@/app/a/[id]/events/route';
import { GET as eventsFrameGet } from '@/app/a/[id]/events/frame/route';
import { GET as resolveGet } from '@/app/a/[id]/resolve/route';
import { GET as assetsGet } from '@/app/a/[id]/assets/route';
import { GET as webAssetGet } from '@/app/assets/[hash]/route';

type Handler = (request: Request, ctx: { params: Promise<{ id: string }> }) => Promise<Response> | Response;

/** Static trees the served document and its runtime load from; passed on to the app's own static handlers. */
const STATIC = /^\/(?:story|fonts|webfonts|libraries|geojson)\/|^\/favicon\.ico$/;
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

/** The home page: every public document the owner has, as a list of links. */
async function home(request: Request, hostname: string, ownerId: string): Promise<Response> {
  const [owner, posts] = await Promise.all([getUserById(ownerId), listDomainPosts(ownerId)]);
  const base = PUBLIC_BASE_URL.replace(/\/+$/, '');
  const html = renderDomainHome({
    hostname,
    owner: { username: owner?.username ?? null, name: owner?.name ?? null },
    posts,
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
  const asset = /^\/assets\/([0-9a-f]{64})$/.exec(path);
  if (asset) {
    const hash = asset[1]!;
    if (!(await servesWebAsset(ownerId, hash))) return notFound();
    const guest = await asGuest(request);
    return runWithRequest(guest, async () => {
      const res = await webAssetGet(guest, { params: Promise.resolve({ hash }) });
      return request.method === 'HEAD' ? new Response(null, { status: res.status, headers: res.headers }) : res;
    });
  }
  return null;
}

const DOCUMENT_ROUTE = /^\/a\/([^/]+)\/(query|mutate|events|events\/frame|resolve|assets)$/;

/**
 * The boundary as Hono middleware. Mounted before every other route, so a
 * verified host never reaches the app behind it except for the static trees.
 */
export function customHostBoundary(): MiddlewareHandler {
  return async (c: Context, next) => {
    const named = requestHostname(c.req.raw);
    const hostname = named ? customHostCandidate(named) : null;
    if (!hostname) return next();
    const ownerId = await ownerForHost(hostname);
    if (!ownerId) return next();

    const request = c.req.raw;
    const path = new URL(request.url).pathname;
    const readable = request.method === 'GET' || request.method === 'HEAD';

    if (STATIC.test(path) && readable) {
      await next();
      const passed = c.res;
      // Clear first: Hono's setter otherwise merges the old headers (Set-Cookie included) into the new response.
      c.res = undefined as unknown as Response;
      c.res = passed.status === 404 ? notFound() : withoutCookies(passed);
      return;
    }
    if (path === '/' && readable) return withoutCookies(await home(request, hostname, ownerId));
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
