/**
 * EVERY DOCUMENT ON ITS OWN ORIGIN — the one place the app reads a pages hostname, a pages Origin or
 * the `afbin_pages` cookie (APP__PAGES_HOST, lib/serving/pages-origin).
 *
 * Mounted ahead of every other host boundary when the setting is on; with it off nothing here exists
 * and every request is answered as before. Three kinds of request are decided here:
 *
 *  1. HOST `<pages host>` (the apex): only the pages session exchange, `/pages-session`.
 *       GET ?ticket=&next=  spends the ticket the app page minted for its reader (lib/accounts/
 *                           pages-sessions) and sets `afbin_pages` for `.<pages host>`, then redirects
 *                           to `next` — which must be a document's own origin. No ticket (a guest page)
 *                           ends and clears a stale cookie instead.
 *       DELETE              logout's half, from the app origin (credentialed CORS): the row and the cookie go.
 *  2. HOST `<hex(id)>.<pages host>`: that document and nothing else — its standalone page at `/` (the
 *     `/raw` page under the document CSP, reader chrome off), its own doors (`/a/<id>/query`, `/mutate`,
 *     `/events`, …) and the public static runtime directories; and, anonymously, another artifact's
 *     `/a/<other>/raw` bytes the document embeds (a `ref:` image). Everything else is 404.
 *  3. ORIGIN `<hex(id)>.<pages host>` on any other host: the same doors of the SAME id with credentialed
 *     CORS for exactly that origin, the static directories, and 403 `forbidden_origin` for everything
 *     else. That last rule is load-bearing: a pages origin is SAME-SITE with the app, so the app's
 *     same-site guard (lib/http isCrossSiteRequest) would otherwise wave an author script's
 *     cookie-borne write to any app route straight through.
 *
 * On a door the actor is the pages session's (or nobody), attached to the Request as the proxy attaches
 * one (`attachActor`), so the handlers' own ACL decides exactly as it does for the app page. Requests
 * with no Origin, or the app's own, on the app's host keep today's behaviour; `Origin` and
 * `Sec-Fetch-*` reach the handlers untouched.
 */
import type { Context, MiddlewareHandler, Next } from 'hono';
import { attachActor, readCookie } from '@artifactbin/utils';
import { ANONYMOUS } from '@artifactbin/contracts';
import { endPagesSession, exchangePagesTicket, PAGES_COOKIE, pagesSessionOf } from '@/lib/accounts/pages-sessions';
import { runWithRequest } from '@/lib/platform';
import { idFromPagesHost, idFromPagesOrigin, isPagesApexHost, markPagesRequest, PAGES_SESSION_PATH, pagesOriginFor, type PagesSite } from '@/lib/serving/pages-origin';
import { GET as rawGet, HEAD as rawHead } from '@/app/a/[id]/raw/route';

/** A document's own sub-paths: the doors its page calls, and nothing else of the app. */
const DOORS = ['query', 'mutate', 'events', 'events/frame', 'story', 'viewer', 'assets', 'resolve', 'fetch'] as const;
/** Public, content-addressed (or static) bytes any origin may load: the runtime, fonts, boundaries, images. */
const STATIC = /^\/(?:islands|fonts|geojson|libraries|basemap|story|assets)\/|^\/favicon\.ico$/;

const NO_STORE = { 'cache-control': 'no-store' };

/** The host the client addressed (a proxy may rewrite `Host` and keep the original forwarded). */
const addressedHost = (request: Request): string =>
  request.headers.get('x-forwarded-host')?.split(',')[0]?.trim() || request.headers.get('host') || new URL(request.url).host;

/** Which door of `id` a path names, or null. */
function doorOf(pathname: string, id: string): string | null {
  const prefix = `/a/${id}/`;
  if (!pathname.startsWith(prefix)) return null;
  const rest = pathname.slice(prefix.length);
  return (DOORS as readonly string[]).includes(rest) ? rest : null;
}

const forbidden = (origin: string | null, detail: string): Response =>
  Response.json({ error: 'forbidden_origin', detail: `${origin ?? 'this origin'} ${detail}` }, { status: 403, headers: { ...NO_STORE, vary: 'Origin' } });
const notFound = (): Response => Response.json({ error: 'not_found' }, { status: 404, headers: { ...NO_STORE } });

function cookieLine(site: PagesSite, value: string, maxAgeSeconds: number): string {
  return `${PAGES_COOKIE}=${value}; Domain=.${site.host}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSeconds}${site.scheme === 'https:' ? '; Secure' : ''}`;
}

export function pagesHost(site: PagesSite): MiddlewareHandler {
  /** Hand the request to the document's own handlers as its pages session's reader. */
  const asReader = async (request: Request, id: string): Promise<void> => {
    const session = await pagesSessionOf(readCookie(request.headers.get('cookie'), PAGES_COOKIE));
    attachActor(request, session?.actor ?? ANONYMOUS);
    markPagesRequest(request, { id, self: pagesOriginFor(id, site), site, carried: session?.carried ?? {} });
  };

  /** A door of `id`: the reader attached, and credentialed CORS for exactly the caller's pages origin. */
  const door = async (c: Context, next: Next, id: string, origin: string | null): Promise<Response | void> => {
    const cors: Record<string, string> = origin ? { 'access-control-allow-origin': origin, 'access-control-allow-credentials': 'true' } : {};
    if (c.req.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: {
        ...cors, ...NO_STORE, vary: 'Origin', 'access-control-allow-methods': 'GET, POST, OPTIONS',
        'access-control-allow-headers': 'content-type, idempotency-key, last-event-id', 'access-control-max-age': '600',
      } });
    }
    await asReader(c.req.raw, id);
    await next();
    // The handler's own `*` (an anonymous answer) never stands beside credentials: the caller's origin replaces it.
    const headers = c.res.headers;
    headers.delete('access-control-allow-origin');
    for (const [name, value] of Object.entries(cors)) headers.set(name, value);
    if (!/(^|,\s*)origin(\s*,|$)/i.test(headers.get('vary') ?? '')) headers.append('vary', 'Origin');
  };

  /** The standalone page, at the document origin's root. */
  const page = async (request: Request, id: string): Promise<Response> => {
    if (request.method !== 'GET' && request.method !== 'HEAD') return notFound();
    await asReader(request, id);
    const ctx = { params: Promise.resolve({ id }) };
    return runWithRequest(request, () => (request.method === 'HEAD' ? rawHead(request, ctx) : rawGet(request, ctx)));
  };

  /** The apex: the pages session exchange and logout, nothing else. */
  const apex = async (c: Context): Promise<Response> => {
    const request = c.req.raw;
    const url = new URL(request.url);
    if (url.pathname !== PAGES_SESSION_PATH) return notFound();
    const held = readCookie(request.headers.get('cookie'), PAGES_COOKIE);
    const origin = request.headers.get('origin');
    const appCors: Record<string, string> = origin === site.app ? { 'access-control-allow-origin': site.app, 'access-control-allow-credentials': 'true', vary: 'Origin' } : { vary: 'Origin' };
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: { ...appCors, ...NO_STORE, 'access-control-allow-methods': 'DELETE', 'access-control-max-age': '600' } });
    }
    if (request.method === 'DELETE') {
      // Logout is the app page's to ask for: a document's own script may not end its reader's session.
      if (origin && origin !== site.app) return forbidden(origin, 'may not end the pages session');
      await endPagesSession(held);
      return new Response(null, { status: 204, headers: { ...appCors, ...NO_STORE, 'set-cookie': cookieLine(site, '', 0) } });
    }
    if (request.method !== 'GET') return notFound();
    // Only ever onward to a document's own origin: never an open redirect.
    let next: URL;
    try { next = new URL(url.searchParams.get('next') ?? ''); } catch { return Response.json({ error: 'invalid_next' }, { status: 400, headers: NO_STORE }); }
    const id = idFromPagesOrigin(next.origin, site);
    if (!id || next.origin !== pagesOriginFor(id, site) || next.username || next.password) return Response.json({ error: 'invalid_next' }, { status: 400, headers: NO_STORE });
    const headers = new Headers({ location: next.href, ...NO_STORE, 'referrer-policy': 'no-referrer' });
    const ticket = url.searchParams.get('ticket');
    if (ticket) {
      const session = await exchangePagesTicket(ticket);
      // A spent or expired ticket (a back navigation replaying the frame's first URL) keeps what the browser holds.
      if (session) {
        await endPagesSession(held);
        headers.append('set-cookie', cookieLine(site, session.cookie, session.maxAgeSeconds));
      }
    } else if (held) {
      // A guest page: whoever this browser was signed in as before, the frame reads as nobody now.
      await endPagesSession(held);
      headers.append('set-cookie', cookieLine(site, '', 0));
    }
    return new Response(null, { status: 302, headers });
  };

  return async (c, next) => {
    const request = c.req.raw;
    const host = addressedHost(request);
    if (isPagesApexHost(host, site)) return apex(c);
    const pathname = new URL(request.url).pathname;
    const origin = request.headers.get('origin');
    const hostId = idFromPagesHost(host, site);
    const originId = idFromPagesOrigin(origin, site);
    if (hostId) {
      if (STATIC.test(pathname)) return next();
      // Its own origin, or none (a same-origin GET): any other caller is refused before a cookie is read.
      if (origin !== null && originId !== hostId) return forbidden(origin, `may not call the document at ${pagesOriginFor(hostId, site)}`);
      if (pathname === '/') return page(request, hostId);
      if (doorOf(pathname, hostId)) return door(c, next, hostId, origin);
      // The one exception: ANOTHER artifact's bytes a document embeds (`ref:` images and PDF cards,
      // lib/story/data/ref-data `/a/<id>/raw?v=`), answered to nobody — what anyone with the link may fetch,
      // never with this document's reader.
      const embedded = /^\/a\/([^/]+)\/raw$/.exec(pathname)?.[1];
      if (embedded && embedded !== hostId && (request.method === 'GET' || request.method === 'HEAD')) {
        attachActor(request, ANONYMOUS);
        return next();
      }
      return notFound();
    }
    if (originId) {
      if (STATIC.test(pathname)) return next();
      const target = /^\/a\/([^/]+)\//.exec(pathname)?.[1];
      if (target && target !== originId) return forbidden(origin, `may not call the document ${target}`);
      if (doorOf(pathname, originId)) return door(c, next, originId, origin);
      return forbidden(origin, 'may call only its own document\'s doors');
    }
    return next();
  };
}
