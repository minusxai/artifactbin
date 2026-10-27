/**
 * EVERY DOCUMENT ON ITS OWN ORIGIN — the one place the app reads a pages hostname, a pages Origin or
 * the pages cookie (APP__PAGES_HOST, lib/http/pages-origin).
 *
 * Mounted ahead of every other host boundary when the setting is on; with it off nothing here exists
 * and every request is answered as before. Three kinds of request are decided here:
 *
 *  1. HOST `<pages host>` (the apex): nothing. It is not a document and mints no session; every path is 404.
 *  2. HOST `<hex(id)>.<pages host>`: that document and nothing else — its standalone page at `/` (the
 *     `/raw` page under the document CSP, reader chrome off), its own doors (`/a/<id>/query`, `/mutate`,
 *     `/events`, …) and the public static runtime directories; and, anonymously, another artifact's
 *     `/a/<other>/raw` bytes the document embeds (a `ref:` image). Everything else is 404.
 *     THE PAGE IS WHERE THE READER ARRIVES. The app page's frame is `https://<hex>.<pages host>/?…&_pt=<ticket>`:
 *     the ticket is spent here, before any byte of the document is produced, and the response that serves
 *     the document sets this document's own HOST-ONLY cookie (`__Host-afbin_pages` on https). Three cases:
 *       `_pt=<ticket>`  a ticket minted for THIS document and origin: a new session replaces whatever the browser
 *                       held — and serves the document in the same response, unless the browser held a live session of the
 *                       SAME reader (a repeat view), when it is a 302 to the same URL without `_pt` so the clean address
 *                       revalidates (304). The SAME browser asking again for that repeat view's URL within seconds (its
 *                       first response was lost: a retry, a prefetch) presents the live session it held then, and gets the
 *                       same answer with the same session (lib/accounts/pages-sessions). A replayed, expired or
 *                       foreign ticket mints nothing and renders as what the browser's own cookie says, or nobody (a back
 *                       navigation replaying the frame's first URL).
 *       `_pt=-`         the app page decided "nobody": the document renders as nobody even if a cookie is held,
 *                       and the same response ends and clears it.
 *       no `_pt`        a bookmark or a direct visit: whatever the browser's cookie for this host says, as it always did.
 *     The parameter never reaches the document's handlers, and the response is never cached or sent as a referrer.
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
import { endPagesSession, exchangePagesTicket, pagesSessionOf, type PagesSession } from '@/lib/accounts';
import { runWithRequest } from '@/lib/platform';
import { GUEST_TICKET, idFromPagesHost, idFromPagesOrigin, isPagesApexHost, markPagesRequest, PAGES_TICKET_PARAM, pagesCookieName, pagesOriginFor, withoutPagesTicket, type PagesSite } from '@/lib/http/pages-origin';
import { GET as rawGet, HEAD as rawHead } from '@/app/a/[id]/raw/route';
import { compressDynamic } from './content-encoding';

/** A document's own sub-paths: the doors its page calls, and nothing else of the app. */
const DOORS = ['query', 'mutate', 'events', 'events/frame', 'story', 'viewer', 'assets', 'resolve', 'fetch', 'css'] as const;
/** Public, content-addressed (or static) bytes any origin may load: the runtime, fonts, boundaries, images. */
const STATIC = /^\/(?:islands|fonts|geojson|libraries|basemap|story|assets)\/|^\/favicon\.ico$|^\/af\/(?:core|apollo|reader|chrome|portable|morph)\.js$|^\/af\/fonts\/[a-z0-9-]+\.woff2$|^\/af\/v1\/(?:core\.js|(?:apollo|reader)\/[a-f0-9]{64})$|^\/af\/styles\.css$/;

const NO_STORE = { 'cache-control': 'no-store' };

/** The host the client addressed (a proxy may rewrite `Host` and keep the original forwarded). */
const addressedHost = (request: Request): string =>
  request.headers.get('x-forwarded-host')?.split(',')[0]?.trim() || request.headers.get('host') || new URL(request.url).host;

/** Which door of `id` a path names, or null. */
function doorOf(pathname: string, id: string): string | null {
  const prefix = `/a/${id}/`;
  if (!pathname.startsWith(prefix)) return null;
  const rest = pathname.slice(prefix.length);
  return (DOORS as readonly string[]).includes(rest) || /^datasets\/[A-Za-z0-9]{6,12}\/(?:images|files)(?:\/[A-Za-z0-9]{10,30})?$/.test(rest) ? rest : null;
}

const forbidden = (origin: string | null, detail: string): Response =>
  Response.json({ error: 'forbidden_origin', detail: `${origin ?? 'this origin'} ${detail}` }, { status: 403, headers: { ...NO_STORE, vary: 'Origin' } });
const notFound = (): Response => Response.json({ error: 'not_found' }, { status: 404, headers: { ...NO_STORE } });

/**
 * The document origin's own cookie: host-only (no `Domain`), a session cookie (the row carries the 8 h), `Max-Age=0` to clear.
 * On https it is `SameSite=None; Partitioned`: when the pages host is its own site (not a subdomain of the app's), the framed
 * document is a third party, and only a partitioned cookie (CHIPS) is stored and sent there — keyed to the app page's site.
 */
function cookieLine(site: PagesSite, value: string, clear = false): string {
  const https = site.scheme === 'https:';
  return `${pagesCookieName(site)}=${value}; Path=/; HttpOnly; SameSite=${https ? 'None' : 'Lax'}${clear ? '; Max-Age=0' : ''}${https ? '; Secure; Partitioned' : ''}`;
}

export function pagesHost(site: PagesSite): MiddlewareHandler {
  const cookieName = pagesCookieName(site);
  const held = (request: Request): string | undefined => readCookie(request.headers.get('cookie'), cookieName);

  /** Hand the request to the document's own handlers as `session`'s reader (nobody when there is none). */
  const asSession = (request: Request, id: string, session: PagesSession | null): void => {
    attachActor(request, session?.actor ?? ANONYMOUS);
    markPagesRequest(request, { id, self: pagesOriginFor(id, site), site, carried: session?.carried ?? {} });
  };
  /** Hand the request to the document's own handlers as the reader the browser's own cookie names for THIS document. */
  const asReader = async (request: Request, id: string): Promise<void> => asSession(request, id, await pagesSessionOf(held(request), Date.now(), id));

  /** A door of `id`: the reader attached, and credentialed CORS for exactly the caller's pages origin. */
  const door = async (c: Context, next: Next, id: string, origin: string | null): Promise<Response | void> => {
    const cors: Record<string, string> = origin ? { 'access-control-allow-origin': origin, 'access-control-allow-credentials': 'true' } : {};
    if (c.req.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: {
        ...cors, ...NO_STORE, vary: 'Origin', 'access-control-allow-methods': 'GET, POST, OPTIONS',
        'access-control-allow-headers': 'content-type, idempotency-key, last-event-id, x-edit-id, x-filename', 'access-control-max-age': '600',
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

  /**
   * The standalone page, at the document origin's root — and where the app page's ticket is spent (see the header).
   * The reader is decided BEFORE the document is produced, and the Set-Cookie rides the document's own response.
   */
  const page = async (request: Request, id: string): Promise<Response> => {
    if (request.method !== 'GET' && request.method !== 'HEAD') return notFound();
    const url = new URL(request.url);
    const marker = url.searchParams.get(PAGES_TICKET_PARAM);
    let forwarded = request;
    let session: PagesSession | null;
    let setCookie: string | null = null;
    if (marker === null) {
      session = await pagesSessionOf(held(request), Date.now(), id);
    } else {
      // The handlers never see the parameter: neither the ticket nor the marker is part of the document's address.
      url.search = withoutPagesTicket(url.search);
      forwarded = new Request(url, request);
      const cookie = held(request);
      if (marker === GUEST_TICKET) {
        // The app page decided "nobody": whoever this browser was signed in as before, this document reads as nobody now.
        session = null;
        if (cookie) { await endPagesSession(cookie); setCookie = cookieLine(site, '', true); }
      } else if (request.method === 'GET') {
        // The new session replaces whatever the browser held (ended in the same step), and carries the app page's current
        // decisions. A repeat view asked again (its first response was lost) is handed the same session.
        const minted = await exchangePagesTicket(marker, { artifactId: id, origin: pagesOriginFor(id, site), held: cookie });
        if (minted) {
          const line = cookieLine(site, minted.cookie);
          // A repeat view of the SAME reader: the browser very likely holds this document under its clean address, which
          // revalidates (document-revalidation) — but only if the frame ends there.
          if (minted.repeat) {
            // Relative: behind the TLS-terminating proxy `url` is http://, and an http Location in an https frame is refused.
            return new Response(null, { status: 302, headers: { location: `${url.pathname}${url.search}`, 'set-cookie': line, ...NO_STORE, 'referrer-policy': 'no-referrer' } });
          }
          session = minted;
          setCookie = line;
        } else {
          // Spent, expired or foreign (a back navigation replaying the frame's first URL): what the browser's own cookie says, or nobody.
          session = await pagesSessionOf(cookie, Date.now(), id);
        }
      } else {
        // A HEAD never spends a ticket.
        session = await pagesSessionOf(cookie, Date.now(), id);
      }
    }
    asSession(forwarded, id, session);
    const ctx = { params: Promise.resolve({ id }) };
    const response = await runWithRequest(forwarded, () => (forwarded.method === 'HEAD' ? rawHead(forwarded, ctx) : rawGet(forwarded, ctx)));
    // Brotli for a client that takes it, like the app page (server/content-encoding); identity otherwise. The reader was decided
    // above, BEFORE the document's own handler could answer a 304 for it: the validator names who is asking (document-revalidation).
    const answer = await compressDynamic(forwarded, response);
    if (!setCookie) return answer;
    const headers = new Headers(answer.headers);
    headers.append('set-cookie', setCookie);
    return new Response(answer.body, { status: answer.status, statusText: answer.statusText, headers });
  };

  /** The apex is not a document and mints nothing. */
  const apex = (): Response => notFound();

  return async (c, next) => {
    const request = c.req.raw;
    const host = addressedHost(request);
    if (isPagesApexHost(host, site)) return apex();
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
      // lib/dataflow/ref-data `/a/<id>/raw?v=`), answered to nobody — what anyone with the link may fetch,
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
