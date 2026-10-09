/**
 * WHERE A SESSION'S BROWSER MAY GO — and the one cookie the trusted side keeps for it.
 *
 * The app page frames every document on the document's own origin (`<hex id>.<pages host>`, with the
 * public URL's scheme and port), reached through the pages apex's session exchange: the frame's first URL
 * spends the one-time ticket the app page minted for its reader, the apex answers with the pages cookie
 * and a redirect to the document's origin. So a session admits three kinds of origin and nothing else: the
 * app's own, the pages apex, and one document origin (one hex label under the pages host).
 *
 * The pages cookie never enters the worker. The parent holds it per session (`createPagesCookieJar`),
 * captures it from the exchange's answer and attaches it to the session's own requests to the pages site —
 * exactly as the browser would, minus the browser ever holding a credential.
 */

export interface SessionOrigins {
  /** The app's origin, the pages apex or one document's origin; never a URL carrying userinfo. */
  allows(url: URL): boolean;
  /** The pages site (the apex or a document origin): where the pages cookie is sent. */
  pages(url: URL): boolean;
}

/** A document's label: its id's bytes in lowercase hex (lib/http/pages-origin `pagesLabel`). */
const DOCUMENT_LABEL = /^(?:[0-9a-f]{2}){1,32}$/;

export function sessionOrigins(baseURL: string, pagesHost?: string): SessionOrigins {
  const app = new URL(baseURL);
  const host = pagesHost?.toLowerCase();
  const pages = (url: URL): boolean => {
    if (!host || url.username || url.password || url.origin === app.origin) return false;
    if (url.protocol !== app.protocol || url.port !== app.port) return false;
    if (url.hostname === host) return true;
    return url.hostname.endsWith(`.${host}`) && DOCUMENT_LABEL.test(url.hostname.slice(0, -host.length - 1));
  };
  return {
    allows: url => !url.username && !url.password && (url.origin === app.origin || pages(url)),
    pages,
  };
}

/**
 * The Chromium switches a session's browser needs for these origins: a development pages host
 * (`lvh.me`, `localhost`, `*.localhost`) maps to loopback outright, exactly as the gates' own browser does
 * (scripts/gates/lib/browser.mjs), so no name the session uses waits on a resolver the sandbox lacks.
 */
export function sessionBrowserArgs(pagesHost?: string): string[] {
  const host = pagesHost?.toLowerCase();
  if (!host || !(host === 'lvh.me' || host === 'localhost' || host.endsWith('.localhost'))) return [];
  return [`--host-resolver-rules=MAP *.${host} 127.0.0.1, MAP ${host} 127.0.0.1`];
}

export interface PagesCookieJar {
  /** The `cookie` header for a request to `url`, or null when none applies. */
  headerFor(url: URL): string | null;
  /** Keep what an answer from the pages site set for the whole pages domain. */
  store(url: URL, response: Response): void;
}

const MAX_COOKIES = 8;
const MAX_COOKIE_BYTES = 4096;
const COOKIE_NAME = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;

/**
 * The parent's cookie store for one session: only cookies the pages site sets for its whole domain
 * (`Domain=<pages host>`, as the pages session is), bounded, expiring as the browser would expire them.
 * Anything else a response sets is dropped, as it always was.
 */
export function createPagesCookieJar(origins: SessionOrigins, pagesHost?: string, now: () => number = Date.now): PagesCookieJar {
  const host = pagesHost?.toLowerCase();
  const cookies = new Map<string, { value: string; expires: number }>();
  const live = () => { for (const [name, cookie] of cookies) if (cookie.expires <= now()) cookies.delete(name); return cookies; };
  return {
    headerFor(url) {
      if (!origins.pages(url)) return null;
      const pairs = [...live()].map(([name, cookie]) => `${name}=${cookie.value}`);
      return pairs.length ? pairs.join('; ') : null;
    },
    store(url, response) {
      if (!host || !origins.pages(url)) return;
      for (const line of response.headers.getSetCookie()) {
        if (line.length > MAX_COOKIE_BYTES) continue;
        const [pair = '', ...attributes] = line.split(';');
        const split = pair.indexOf('=');
        if (split < 1) continue;
        const name = pair.slice(0, split).trim(), value = pair.slice(split + 1).trim();
        if (!COOKIE_NAME.test(name) || /[\s;,]/.test(value)) continue;
        let domain: string | undefined;
        let expires = Number.POSITIVE_INFINITY;
        for (const attribute of attributes) {
          const [key = '', ...rest] = attribute.split('=');
          const field = key.trim().toLowerCase(), text = rest.join('=').trim();
          if (field === 'domain') domain = text.replace(/^\./, '').toLowerCase();
          if (field === 'max-age' && /^-?\d+$/.test(text)) expires = now() + Number(text) * 1000;
          if (field === 'expires' && expires === Number.POSITIVE_INFINITY && !Number.isNaN(Date.parse(text))) expires = Date.parse(text);
        }
        if (domain !== host) continue;
        if (!value || expires <= now()) { cookies.delete(name); continue; }
        if (!cookies.has(name) && live().size >= MAX_COOKIES) continue;
        cookies.set(name, { value, expires });
      }
    },
  };
}
