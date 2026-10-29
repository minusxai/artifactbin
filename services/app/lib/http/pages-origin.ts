/**
 * EVERY DOCUMENT ON ITS OWN ORIGIN — the hostname ⇄ id mapping (APP__PAGES_HOST, lib/platform/config).
 *
 * A document is served at `<label>.<pages host>`, where the label is the id's bytes as LOWERCASE hex:
 * ids are case-sensitive (`Ab3xK9` and `ab3xk9` are two documents) and every browser lowercases a
 * hostname, so the id cannot ride as itself. The apex (`<pages host>` alone) is not a document: it
 * answers nothing (server/pages-host).
 *
 * The scheme and port are the public URL's, so development (`http://app.lvh.me:11001`) gets
 * `http://<hex>.lvh.me:11001` and production gets `https://<hex>.pages.example.com`. Hosts are matched
 * by hostname alone: behind a proxy the port the process sees is not the one the browser addressed.
 *
 * Pure: the site is an argument (tests build their own); `pagesSite()` is this deployment's.
 */
import { ID_RE, PUBLIC_BASE_URL, requirePagesHost } from '@/lib/platform';

export interface PagesSite {
  /** The pages hostname, lowercase, no port (`pages.example.com`, `lvh.me`). */
  host: string;
  /** `https:` or `http:` — the public URL's. */
  scheme: string;
  /** The public URL's explicit port, or '' for the scheme's default. */
  port: string;
  /** The app's own origin (the public URL), which frames documents and calls nothing on them. */
  app: string;
}

/** The pages site for a pages host under a public URL. */
export function pagesSiteFor(host: string, publicBaseUrl: string): PagesSite {
  const url = new URL(publicBaseUrl);
  return { host, scheme: url.protocol, port: url.port, app: url.origin };
}

let deployed: PagesSite | null = null;
/** This deployment's pages site (APP__PAGES_HOST, required: unset throws, naming the setting). */
export function pagesSite(): PagesSite {
  return (deployed ??= pagesSiteFor(requirePagesHost(), PUBLIC_BASE_URL));
}

/** The DNS label a document id rides as: its UTF-8 bytes in lowercase hex. */
export const pagesLabel = (id: string): string => Buffer.from(id, 'utf8').toString('hex');

/** The id a label names, or null when it is not the hex of a valid id. */
export function idFromPagesLabel(label: string): string | null {
  if (!/^(?:[0-9a-f]{2}){1,32}$/.test(label)) return null;
  const id = Buffer.from(label, 'hex').toString('utf8');
  return ID_RE.test(id) ? id : null;
}

const suffix = (site: PagesSite): string => (site.port ? `:${site.port}` : '');

/** `https://<hex(id)>.<pages host>` (with the public URL's port when it names one). */
export function pagesOriginFor(id: string, site: PagesSite): string {
  return `${site.scheme}//${pagesLabel(id)}.${site.host}${suffix(site)}`;
}

/** A `Host` header's hostname: lowercase, without its port or a trailing dot. */
function hostnameOf(host: string): string {
  const trimmed = host.trim().toLowerCase();
  const bare = trimmed.startsWith('[') ? trimmed : trimmed.replace(/:\d+$/, '');
  return bare.replace(/\.$/, '');
}

/** The document id a `Host` (`<hex>.<pages host>[:port]`) names, or null for any other host. */
export function idFromPagesHost(host: string | null | undefined, site: PagesSite | null): string | null {
  if (!host || !site) return null;
  const name = hostnameOf(host);
  const tail = `.${site.host}`;
  if (!name.endsWith(tail)) return null;
  const label = name.slice(0, -tail.length);
  return label.includes('.') ? null : idFromPagesLabel(label);
}

/** Whether a `Host` is the pages apex itself. */
export function isPagesApexHost(host: string | null | undefined, site: PagesSite | null): boolean {
  return !!host && !!site && hostnameOf(host) === site.host;
}

/** The document id an `Origin` header names, or null for any other origin (the app's, a stranger's, `null`). */
export function idFromPagesOrigin(origin: string | null | undefined, site: PagesSite | null): string | null {
  if (!origin || !site) return null;
  let url: URL;
  try { url = new URL(origin); } catch { return null; }
  if (url.protocol !== site.scheme) return null;
  return idFromPagesHost(url.host, site);
}

/**
 * THE DOCUMENT'S FIRST URL. The ticket that hands the app page's reader across rides ON the document's own
 * address, in this reserved query parameter, and is spent by the document's origin in the same response that
 * serves the document (server/pages-host): there is no hop through another host. `GUEST_TICKET` is the app
 * page's explicit "nobody": the frame renders as nobody whatever cookie the browser holds and the response
 * clears it. A visit with no parameter at all (a bookmark, a direct link) reads whatever session the browser's
 * own host-only cookie names.
 */
export const PAGES_TICKET_PARAM = '_pt';
export const GUEST_TICKET = '-';

/**
 * The cookie a document's origin reads its reader from. HOST-ONLY (no `Domain`), so no other document's origin ever
 * receives it and no sibling can set it; on https the `__Host-` prefix makes the browser enforce that (Secure, Path=/,
 * no Domain), so a sibling's script cannot plant or shadow it. Development is http (lvh.me), where the prefix is
 * unavailable: the plain name, host-only all the same.
 */
export const pagesCookieName = (site: PagesSite): string => (site.scheme === 'https:' ? '__Host-afbin_pages' : 'afbin_pages');

/** The query with every `_pt` removed (the reader's own copy of one never reaches the frame), byte for byte otherwise. */
export function withoutPagesTicket(search: string): string {
  const kept = search.replace(/^\?/, '').split('&').filter((part) => part && part.split('=')[0] !== PAGES_TICKET_PARAM);
  return kept.length ? `?${kept.join('&')}` : '';
}

/**
 * The frame's first URL: the document's own origin, the reader's `$` selection (`search`) and the one-time ticket
 * (`GUEST_TICKET` when the app page has nothing to hand across).
 */
export function pagesFrameUrl(origin: string, search: string, ticket: string | null): string {
  const kept = withoutPagesTicket(search);
  return `${origin}/${kept}${kept ? '&' : '?'}${PAGES_TICKET_PARAM}=${encodeURIComponent(ticket ?? GUEST_TICKET)}`;
}

/** A request server/pages-host routed to a document on its own origin: which document, at which origin. */
interface PagesRequest {
  id: string;
  /** The document's origin, `pagesOriginFor(id, site)`. */
  self: string;
  site: PagesSite;
  /** What the app page carried across with the reader's ticket (lib/accounts/pages-sessions PagesCarried); `{}` for none. */
  carried?: Readonly<Record<string, unknown>>;
}
/** The mark rides ON the Request object (as `attachActor` does), so no header can forge it. */
const pagesRequests = new WeakMap<Request, PagesRequest>();
export function markPagesRequest<R extends Request>(request: R, mark: PagesRequest): R { pagesRequests.set(request, mark); return request; }
export function pagesRequestOf(request: Request): PagesRequest | null { return pagesRequests.get(request) ?? null; }
