/**
 * EVERY DOCUMENT ON ITS OWN ORIGIN — the hostname ⇄ id mapping (APP__PAGES_HOST, lib/platform/config).
 *
 * A document is served at `<label>.<pages host>`, where the label is the id's bytes as LOWERCASE hex:
 * ids are case-sensitive (`Ab3xK9` and `ab3xk9` are two documents) and every browser lowercases a
 * hostname, so the id cannot ride as itself. The apex (`<pages host>` alone) is not a document: it
 * answers only the pages session exchange (server/pages-host).
 *
 * The scheme and port are the public URL's, so development (`http://app.lvh.me:11001`) gets
 * `http://<hex>.lvh.me:11001` and production gets `https://<hex>.pages.example.com`. Hosts are matched
 * by hostname alone: behind a proxy the port the process sees is not the one the browser addressed.
 *
 * Pure: the site is an argument (tests build their own); `pagesSite()` is this deployment's.
 */
import { ID_RE } from '@/lib/platform/ids-shape';
import { PUBLIC_BASE_URL, requirePagesHost } from '@/lib/platform/config';

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

/** The apex pages origin, where the pages session is exchanged (`https://<pages host>`). */
export function pagesApexOrigin(site: PagesSite): string {
  return `${site.scheme}//${site.host}${suffix(site)}`;
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

/** The pages apex's session exchange (server/pages-host): a ticket in, the `afbin_pages` cookie out. */
export const PAGES_SESSION_PATH = '/pages-session';
/** The app page's `<meta name>` naming that address, which sign-out asks to end the session (lib/accounts/browser-session). */
export const PAGES_SESSION_META = 'mx-pages-session';

/**
 * The frame's first URL: the apex exchanges `ticket` for the pages cookie (or, with no ticket — a guest
 * page — clears a stale one) and redirects to `next`, the document's own origin.
 */
export function pagesSessionUrl(site: PagesSite, next: string, ticket: string | null): string {
  const url = new URL(PAGES_SESSION_PATH, pagesApexOrigin(site));
  if (ticket) url.searchParams.set('ticket', ticket);
  url.searchParams.set('next', next);
  return url.href;
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
