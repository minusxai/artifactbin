/**
 * WHERE A SESSION'S BROWSER MAY GO — and the one cookie the trusted side keeps for it.
 *
 * The app page frames every document on the document's own origin (`<hex id>.<pages host>`, with the
 * public URL's scheme and port): the frame's first URL carries the one-time ticket the app page minted for its
 * reader, and that origin answers with the document AND its own host-only pages cookie. So a session admits two
 * kinds of origin and nothing else: the app's own, and document origins (one hex label under the pages host).
 *
 * The pages cookie never enters the worker. The parent holds it per session (`createPagesCookieJar`),
 * captures it from the document's answer and attaches it to the session's own requests to that same host —
 * exactly as the browser would for a host-only cookie, minus the browser ever holding a credential.
 */

interface SessionOrigins {
  /** The app's origin or a document's origin; never a URL carrying userinfo. */
  allows(url: URL): boolean;
  /** A document origin: where its host-only pages cookie is sent. */
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
 *
 * `devSocketPort` (development only, the app's Vite HMR socket): every response a session sees is fulfilled by the
 * worker's route, so Chromium gives its pages no local address space, and Local Network Access refuses the app shell's
 * one unrouted connection, the HMR WebSocket to loopback (net::ERR_BLOCKED_BY_LOCAL_NETWORK_ACCESS_CHECKS, a console
 * error that fails a hosted check's smoke). That ONE loopback port is declared public, so the check stays on for
 * every other local address. A real pages host gets neither switch.
 */
export function sessionBrowserArgs(pagesHost?: string, devSocketPort?: number): string[] {
  const host = pagesHost?.toLowerCase();
  if (!host || !(host === 'lvh.me' || host === 'localhost' || host.endsWith('.localhost'))) return [];
  const socket = devSocketPort !== undefined && Number.isInteger(devSocketPort) && devSocketPort > 0 && devSocketPort < 65536
    ? [`--ip-address-space-overrides=127.0.0.1:${devSocketPort}=public`] : [];
  return [`--host-resolver-rules=MAP *.${host} 127.0.0.1, MAP ${host} 127.0.0.1`, ...socket];
}

export interface PagesCookieJar {
  /** The `cookie` header for a request to `url`, or null when none applies. */
  headerFor(url: URL): string | null;
  /** Keep what an answer from the pages site set for the whole pages domain. */
  store(url: URL, response: Response): void;
}

const MAX_COOKIES = 64;
const MAX_COOKIE_BYTES = 4096;
const COOKIE_NAME = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;

/**
 * The parent's cookie store for one session: only HOST-ONLY cookies a document origin sets for itself (no `Domain`,
 * as the pages session is), kept per host and sent back to that host alone, bounded, expiring as the browser would
 * expire them. A cookie naming a domain, and anything an app-origin answer sets, is dropped, as it always was.
 */
export function createPagesCookieJar(origins: SessionOrigins, pagesHost?: string, now: () => number = Date.now): PagesCookieJar {
  const host = pagesHost?.toLowerCase();
  const cookies = new Map<string, { host: string; name: string; value: string; expires: number }>();
  const live = () => { for (const [key, cookie] of cookies) if (cookie.expires <= now()) cookies.delete(key); return cookies; };
  return {
    headerFor(url) {
      if (!origins.pages(url)) return null;
      const pairs = [...live().values()].filter((cookie) => cookie.host === url.hostname).map((cookie) => `${cookie.name}=${cookie.value}`);
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
        const key = `${url.hostname}\n${name}`;
        let expires = Number.POSITIVE_INFINITY;
        for (const attribute of attributes) {
          const [key = '', ...rest] = attribute.split('=');
          const field = key.trim().toLowerCase(), text = rest.join('=').trim();
          if (field === 'domain') domain = text.replace(/^\./, '').toLowerCase();
          if (field === 'max-age' && /^-?\d+$/.test(text)) expires = now() + Number(text) * 1000;
          if (field === 'expires' && expires === Number.POSITIVE_INFINITY && !Number.isNaN(Date.parse(text))) expires = Date.parse(text);
        }
        if (domain !== undefined) continue;
        if (!value || expires <= now()) { cookies.delete(key); continue; }
        if (!cookies.has(key) && live().size >= MAX_COOKIES) continue;
        cookies.set(key, { host: url.hostname, name, value, expires });
      }
    },
  };
}
