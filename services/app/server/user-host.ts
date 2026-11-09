/** Anonymous default hosts: typed owners, eligible HTML, native read doors only. */
import type { Context, MiddlewareHandler } from 'hono';
import { artifactIdFromSegment } from '@artifactbin/utils/artifact-reference';
import { ACTOR_HEADER } from '@artifactbin/contracts';
import { isBuildAssetPath } from '@artifactbin/utils';
import { getArtifactById } from '@/lib/artifacts';
import { PUBLIC_BASE_URL, USER_PAGES_HOST, IS_DEV } from '@/lib/platform';
import { isUserPagesHost, handleFromUserPagesHost, ownerForHandle, documentOwner, userPagesOrigin, publicHomeFiles, homePageId, eligibleDocument, servesDocument, servesEmbeddedArtifact, servesWebAsset, type UserPagesOwner } from '@/lib/user-pages';
import { DOMAIN_HOME_CSP, renderDomainHome, type ProfileListingData } from '@/lib/user-pages';
import { PayloadTooLarge, baseUrl, json, readBody } from '@/lib/http';
import { ID_RE } from '@/lib/platform';
import { runWithRequest } from '@/lib/platform';
import { domainPostPath } from '@/lib/http';
import { getUserById } from '@/lib/accounts';
import { pageOperationKind } from '@/lib/page-operations';
import { DOMAIN_READ_ONLY_MESSAGE } from '@artifactbin/contracts/domain-footer';
import { POST as graphqlPost } from '@/app/api/artifacts/[id]/graphql/route';
import { GET as functionRoute } from '@/app/api/artifacts/[id]/fn/[name]/route';
import { GET as rawGet, HEAD as rawHead } from '@/app/a/[id]/raw/route';
import { GET as eventsGet } from '@/app/a/[id]/events/route';
import { GET as eventsFrameGet } from '@/app/a/[id]/events/frame/route';
import { GET as resolveGet } from '@/app/a/[id]/resolve/route';
import { GET as assetsGet } from '@/app/a/[id]/assets/route';
import { GET as webAssetGet } from '@/app/assets/[hash]/route';
import { GET as exportGet } from '@/app/a/[id]/export/route';
import { GET as avatarGet } from '@/app/api/users/[id]/avatar/route';

type Handler = (request: Request, ctx: { params: Promise<{ id: string }> }) => Promise<Response> | Response;

/**
 * Static trees the served document and its runtime load from; passed on to the app's own static handlers.
 * Only the native runtime and public static resources are admitted.
 */
const STATIC = /^\/(?:fonts|libraries|geojson)\/|^\/favicon\.ico$|^\/af\/components\/[a-z][a-z0-9-]*\.js$|^\/af\/(?:apollo|reader)\.js$|^\/af\/styles\.css$|^\/af\/fonts\/[a-z0-9-]+\.woff2$/;
/** The app's built stylesheet and its fonts, at the address the app page links them or the manifest-checked one; never a script. */
const buildStyle = (path: string): boolean => isBuildAssetPath(path) && /\.(?:css|woff2)$/.test(path);
/** The dev shell stylesheet is public CSS, never Vite's executable source graph. */
export function userHostStaticPath(path:string):boolean {
 if (/%|\\/.test(path)) return false;
 return STATIC.test(path)||buildStyle(path)||(IS_DEV&&path==='/shell.css');
}
/** Credentials never reach a handler on an anonymous owner host: the reader is a guest, by construction. */
export const USER_HOST_CREDENTIAL_HEADERS = ['cookie', 'authorization', 'proxy-authorization', ACTOR_HEADER];

const NOT_FOUND_HTML = '<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Not found</title></head><body style="font:16px/1.6 system-ui,sans-serif;max-width:680px;margin:64px auto;padding:0 16px"><h1 style="font-size:20px">Not found</h1></body></html>';
const notFound = (): Response => new Response(NOT_FOUND_HTML, { status: 404, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'referrer-policy':'no-referrer' } });

/** The same response, without any Set-Cookie a handler may have added. */
function withoutCookies(response: Response): Response {
  if (!response.headers.has('set-cookie')) return response;
  const headers = new Headers(response.headers);
  headers.delete('set-cookie');
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

function privacy(response:Response,unlisted=true):Response {
 const headers=new Headers(response.headers);headers.set('referrer-policy','no-referrer');
 if(unlisted)headers.set('x-robots-tag','noindex, nofollow');
 headers.delete('set-cookie');headers.delete('access-control-allow-credentials');
 return new Response(response.body,{status:response.status,statusText:response.statusText,headers});
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
async function asGuest(request: Request, body?: Uint8Array<ArrayBuffer> | null): Promise<Request> {
  const headers = new Headers(request.headers);
  for (const name of USER_HOST_CREDENTIAL_HEADERS) headers.delete(name);
  const hasBody = request.method !== 'GET' && request.method !== 'HEAD';
  return new Request(request.url, { method: request.method, headers, body: hasBody ? body ?? await readBody(request) : undefined });
}

const parseJson = (bytes: Uint8Array): Record<string, unknown> | null => {
  try {
    const value: unknown = JSON.parse(new TextDecoder().decode(bytes));
    return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
  } catch { return null; }
};

const call = (handler: Handler, request: Request, id: string) =>
  runWithRequest(request, async () => handler(request, { params: Promise.resolve({ id }) }));

/** The owner's served page, as a guest, through the app's own raw handler; the app stays canonical (lib/document-serving). */
async function servePage(request: Request, id: string, hostname: string, owner: UserPagesOwner): Promise<Response> {
  const guest = await asGuest(request);
  const domain = { hostname, owner };
  return runWithRequest(guest, async () => (request.method === 'HEAD' ? rawHead : rawGet)(guest, { params: Promise.resolve({ id }), domain }));
}

/**
 * The root: the owner's "index" page in place, at `/` (serving homePageId), else a public-only listing,
 * read from the actual owner rather than creator attribution.
 */
async function home(request: Request, hostname: string, owner: UserPagesOwner, stylesheets: (url: string) => Promise<string[]>): Promise<Response> {
 const index = await homePageId(owner);
 if (index) return privacy(await servePage(request, index, hostname, owner), false);
 const [files, styles, user] = await Promise.all([publicHomeFiles(owner), stylesheets(request.url), owner.kind === 'user' ? getUserById(owner.id) : null]);
 const app=PUBLIC_BASE_URL.replace(/\/+$/,'');
 const profile:ProfileListingData={handle:owner.handle,files,...(owner.kind==='user'?{owner:{id:owner.id,image:user && 'image' in user && user.image?`/api/users/${owner.id}/avatar`:null}}:{})};
 const html=renderDomainHome({hostname,owner:{username:owner.handle,name:user?.name??null},profile,stylesheets:styles,footerHref:`${app}/@${owner.handle}`});
 return new Response(request.method==='HEAD'?null:html,{headers:{'content-type':'text/html; charset=utf-8','cache-control':'no-store','content-security-policy':DOMAIN_HOME_CSP,'x-content-type-options':'nosniff','referrer-policy':'no-referrer'}});
}

/** A post: `/<id>` or `/<id>-<slug>`; any other slug is redirected to the canonical one on this host. */
async function post(request: Request, segment: string, hostname: string): Promise<Response> {
  let decoded: string;
  try { decoded = decodeURIComponent(segment); } catch { return notFound(); }
  const id = artifactIdFromSegment(decoded);
  if (!id) return notFound();
  const row = await getArtifactById(id);
  if (!row || !eligibleDocument(row)) return notFound();
  const actual = await documentOwner(row);
  const origin = actual && userPagesOrigin(actual.handle);
  if (!actual || !origin) return notFound();
  const canonical = domainPostPath(row);
  if (new URL(origin).hostname !== hostname) return privacy(new Response(null, {status:301,headers:{location:origin+canonical+new URL(request.url).search,'cache-control':'no-store'}}),row.visibility==='unlisted');
  if (decoded !== id && `/${decoded}` !== canonical) {
    return privacy(new Response(null, { status: 302, headers: { location: canonical + new URL(request.url).search, 'cache-control': 'no-store' } }),row.visibility==='unlisted');
  }
  return privacy(await servePage(request, id, hostname, actual),row.visibility==='unlisted');
}

/** A served document's own read-side routes, on the same methods the app answers them with. */
async function documentRoute(request: Request, id: string, route: string, owner: UserPagesOwner): Promise<Response> {
  const method = request.method;
  const row = ID_RE.test(id) ? await getArtifactById(id) : null;
  if (!row || !servesDocument(owner, row)) return notFound();
  const get = method === 'GET';
  switch (route) {
    case 'events': return get ? call(eventsGet, await asGuest(request), id) : notFound();
    case 'events/frame': return get ? call(eventsFrameGet, await asGuest(request), id) : notFound();
    case 'resolve': {
      if(!get && method!=='HEAD')return notFound();
      const ref=new URL(request.url).searchParams.get('ref')??'';
      const target=ref.startsWith('ref:')&&ID_RE.test(ref.slice(4))?await getArtifactById(ref.slice(4)):null;
      return target&&await servesEmbeddedArtifact(owner,target)?call(resolveGet,await asGuest(request),id):notFound();
    }
    case 'assets': return get ? call(assetsGet, await asGuest(request), id) : notFound();
    default: return notFound();
  }
}

/**
 * The bytes a post embeds. An uploaded image renders as `/a/<id>/raw?v=<n>[&w=]`
 * (lib/dataflow/ref-data rawUrl), a web image as our copy at `/assets/<sha>`
 * (lib/document/asset-url). Each is served only when one of the owner's eligible
 * posts embeds it, through the app's own handler, to a guest.
 *
 * And the home page's two images: a public post's card thumbnail
 * and the owner's
 * picture (lib/avatars). Same rule: the app's handler, a guest, this owner's
 * public posts and nobody else's.
 */
async function embedded(request: Request, path: string, owner: UserPagesOwner): Promise<Response | null> {
  const raw = /^\/a\/([^/]+)\/raw$/.exec(path);
  if (raw) {
    const id = raw[1]!;
    const row = ID_RE.test(id) ? await getArtifactById(id) : null;
    if (!row || !(await servesEmbeddedArtifact(owner, row))) return notFound();
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
    if (!row || !servesDocument(owner, row)) return notFound();
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
    if (owner.kind !== 'user' || avatar[1] !== owner.id) return notFound();
    const guest = await asGuest(new Request(request.url, { method: 'GET', headers: request.headers }));
    const res = await runWithRequest(guest, async () => avatarGet(guest, { params: Promise.resolve({ id: owner.id }) }));
    return request.method === 'HEAD' ? bodiless(res) : res;
  }
  const asset = /^\/assets\/([0-9a-f]{64})$/.exec(path);
  if (asset) {
    const hash = asset[1]!;
    if (!(await servesWebAsset(owner, hash))) return notFound();
    const guest = await asGuest(request);
    return runWithRequest(guest, async () => {
      const res = await webAssetGet(guest, { params: Promise.resolve({ hash }) });
      return request.method === 'HEAD' ? bodiless(res) : res;
    });
  }
  return null;
}

/** Any origin may read a served page's data; never with credentials (the page is an opaque origin, and a guest). */
const READ_CORS = { 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-store' };
function withReadCors(response: Response): Response {
  const headers = new Headers(response.headers);
  headers.set('access-control-allow-origin', '*');
  headers.delete('access-control-allow-credentials');
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

/** A served page's dataset and backend reads (see the header): POST, a `query` operation, as a guest. */
async function pageReads(request: Request, id: string, owner: UserPagesOwner): Promise<Response> {
  if (request.method !== 'POST') return notFound();
  const row = ID_RE.test(id) ? await getArtifactById(id) : null;
  if (!row || !servesDocument(owner, row)) return notFound();
  const body = await readBody(request);
  const parsed = parseJson(body);
  const query = parsed?.query, operationName = parsed?.operationName;
  // Classified from the operation the text names, never from the body's own `operation` label.
  const kind = typeof query === 'string' ? pageOperationKind(query, typeof operationName === 'string' ? operationName : undefined) : null;
  if (kind === 'mutation') return json({ data: null, errors: [{ message: DOMAIN_READ_ONLY_MESSAGE }] }, 403, READ_CORS);
  if (kind !== 'query') return json({ error: 'invalid_graphql_operation' }, 400, READ_CORS);
  return withReadCors(await call(graphqlPost, await asGuest(request, body), id));
}
const PAGE_READS_ROUTE = /^\/api\/artifacts\/([^/]+)\/graphql$/;

/**
 * A served page's function calls (html-runtime/fn-fetch → domain-reads, lib/page-graphql `pageFunction`): GET or POST,
 * the owner's served page only, as a guest. The request reaches the app as an opaque origin's (`Origin: null`, every
 * credential dropped) whatever it claimed, so the app's own door reads it as nobody and runs reads only, as here.
 */
async function pageFunctionReads(request: Request, id: string, name: string, owner: UserPagesOwner): Promise<Response> {
  if (request.method !== 'GET' && request.method !== 'POST') return notFound();
  const row = ID_RE.test(id) ? await getArtifactById(id) : null;
  if (!row || !servesDocument(owner, row)) return notFound();
  const guest = await asGuest(request);
  const headers = new Headers(guest.headers);
  headers.set('origin', 'null');
  const opaque = new Request(guest.url, { method: guest.method, headers, ...(guest.method === 'POST' ? { body: await guest.arrayBuffer() } : {}) });
  return withReadCors(await runWithRequest(opaque, async () => functionRoute(opaque, { params: Promise.resolve({ id, name }) })));
}
const PAGE_FUNCTION_ROUTE = /^\/api\/artifacts\/([^/]+)\/fn\/([^/]+)$/;

const DOCUMENT_ROUTE = /^\/a\/([^/]+)\/(events|events\/frame|resolve|assets)$/;

/**
 * The boundary as Hono middleware. Mounted before every other route, so a
 * verified host never reaches the app behind it except for the static trees.
 */
interface UserHostOptions {
  /** The stylesheets the app page links (its index.html, as served for `url`), so the home page wears the same CSS. */
  stylesheets?: (url: string) => Promise<string[]>;
}

export function userHostBoundary(options: UserHostOptions = {}): MiddlewareHandler {
  const stylesheets = options.stylesheets ?? (async () => []);
  return async (c: Context, next) => {
    const named = requestHostname(c.req.raw);
    const hostname = named?.toLowerCase().replace(/\.$/,'');
    const base=USER_PAGES_HOST;
    if (!hostname || !isUserPagesHost(hostname,base)) return next();
    const handle=handleFromUserPagesHost(hostname,base);
    if(!handle)return notFound();
    const owner=await ownerForHandle(handle);
    // Posts resolve their true owner first, so renamed/reclaimed names cannot relabel a page.
    const request = c.req.raw;
    const path = new URL(request.url).pathname;
    if (/%|\\/.test(path)) return notFound();
    const readable = request.method === 'GET' || request.method === 'HEAD';

    if (userHostStaticPath(path) && readable) {
      for(const name of USER_HOST_CREDENTIAL_HEADERS)c.req.raw.headers.delete(name);
      await next();
      const passed = c.res;
      // Clear first: Hono's setter otherwise merges the old headers (Set-Cookie included) into the new response.
      c.res = undefined as unknown as Response;
      c.res = passed.status === 404 ? notFound() : withoutCookies(passed);
      return;
    }
    if (path === '/' && readable) return owner?withoutCookies(await home(request, hostname, owner, stylesheets)):notFound();
    if (readable && owner) {
      const bytes = await embedded(request, path, owner);
      if (bytes) return privacy(bytes);
    }
    const reads = PAGE_READS_ROUTE.exec(path);
    if (reads && owner) {
      try { return privacy(await pageReads(request, reads[1]!, owner)); }
      catch (error) { if (error instanceof PayloadTooLarge) return privacy(withReadCors(error.response())); throw error; }
    }
    const fn = PAGE_FUNCTION_ROUTE.exec(path);
    if (fn && owner) {
      try { return privacy(await pageFunctionReads(request, fn[1]!, fn[2]!, owner)); }
      catch (error) { if (error instanceof PayloadTooLarge) return privacy(withReadCors(error.response())); throw error; }
    }
    const document = DOCUMENT_ROUTE.exec(path);
    if (document && owner) {
      try { return privacy(await documentRoute(request, document[1]!, document[2]!, owner)); }
      catch (error) { if (error instanceof PayloadTooLarge) return privacy(withReadCors(error.response())); throw error; }
    }
    const segment = /^\/([^/]+)$/.exec(path)?.[1];
    if (segment && readable) return withoutCookies(await post(request, segment, hostname));
    return notFound();
  };
}

/** Single-process composition must bypass authentication before it can refresh a session cookie.
 * The app boundary remains the sole resource/ownership authority; this ingress only removes credentials.
 */
export function userHostIngress(app:{fetch:(request:Request)=>Response|Promise<Response>}):MiddlewareHandler {
 return async(c,next)=>{
  const hostname=requestHostname(c.req.raw)?.toLowerCase().replace(/\.$/,'');
  if(!hostname||!isUserPagesHost(hostname))return next();
  const headers=new Headers(c.req.raw.headers);
  for(const name of USER_HOST_CREDENTIAL_HEADERS)headers.delete(name);
  return withoutCookies(await app.fetch(new Request(c.req.raw,{headers})));
 };
}
