/**
 * WHERE A PAGE RUNS AND WHICH SCREEN IT SHOWS — `seat` and `route`, exported by `@afbin/state` (./browser-state).
 *
 * `seat()` names the place this copy of the page runs, from facts the core already holds (the runtime config and the
 * window), never by asking the network: `app` (framed by the app at `/a/<id>`), `address` (its own address, unframed,
 * or an anonymous publishing host), `raw` (the `/a/<id>/raw` sandbox, an opaque origin), `offline` (a downloaded copy)
 * or `preview` (the toolbox's local preview). With it, what its data doors can do right now: `sql` reads, shared
 * writes, `fetch('/fn/NAME')` calls. The server still decides every call; this only says whether one can be made.
 *
 * `route` keeps a page's screen in the address's `$` values (`?$screen=detail&$id=42`), never in its path: a page has
 * one address, and a path under it is not the page anywhere it is served. `set` replaces them all, `push` making a new
 * history entry; `subscribe` hears every change, the reader's Back and Forward included; `href` is a link to this page
 * with exactly the given values. Framed, the frame never adds history of its own (the app's address is the reader's):
 * it rewrites its own address in place and tells the app (STORY_URL_VALUES_MESSAGE, `push` when asked), whose address
 * takes the values; the app answers Back and Forward with the values its address holds then, and the frame follows.
 */
import { STORY_URL_VALUES_MESSAGE } from '../html-reader/contract';

type PageSeatKind = 'app' | 'address' | 'raw' | 'offline' | 'preview';
export interface PageSeat {
  kind: PageSeatKind;
  pageId: string;
  /** `sql` reads answer here: through the app, a publishing host's guest reads, or a copy's carried rows. */
  sql: boolean;
  /** Shared writes can be sent (the dataset's rules still decide). Only the framed page has them. */
  writes: boolean;
  /** `fetch('/fn/NAME')` reaches the page's functions (GET only on a publishing host). */
  functions: boolean;
}
/** The runtime facts a seat is read from (./contract HtmlRuntimeConfig, ./browser-reader). */
export interface SeatFacts { pageId: string; appOrigin?: string; offline?: boolean; domainReads?: true; localPreview?: unknown; online(): boolean }

export function pageSeat(win: Window, facts: SeatFacts): PageSeat {
  const framed = win.parent !== win && !!facts.appOrigin && !facts.offline;
  const kind: PageSeatKind = facts.localPreview ? 'preview' : facts.offline ? 'offline' : framed ? 'app' : win.origin === 'null' ? 'raw' : 'address';
  const guest = !!facts.domainReads && !framed;
  return { kind, pageId: facts.pageId, sql: framed || guest || facts.online() || kind === 'offline', writes: framed, functions: framed || guest };
}

export type RouteValues = Record<string, string>;
export interface PageRoute {
  /** This address's `$` values, by name without the `$`. */
  get(): RouteValues;
  /** Replace every `$` value (empty, null or undefined leave one out); `push` adds a history entry. */
  set(values: Readonly<Record<string, unknown>>, options?: { push?: boolean }): void;
  /** Every change: `set`, and the reader's Back or Forward. Returns the unsubscribe. */
  subscribe(listener: (values: RouteValues) => void): () => void;
  /** A link to this page with exactly these values. */
  href(values: Readonly<Record<string, unknown>>): string;
}

const NAME = /^[_A-Za-z][_0-9A-Za-z]*$/;
/** The app page's bound on the values it takes (lib/html-reader/frame-bridge/parent). */
const MAX_SEARCH = 8192;
const decode = (part: string): string | null => { try { return decodeURIComponent(part.replace(/\+/g, ' ')); } catch { return null; } };
const pairs = (search: string) => (typeof search === 'string' ? search : '').replace(/^\?/, '').split('&').filter(Boolean);
const ours = (pair: string) => /^(?:\$|%24)/i.test(pair);

/** The `$` values a search carries (undecodable or misnamed pairs are none). */
export function routeValuesOf(search: string): RouteValues {
  const values: RouteValues = {};
  for (const pair of pairs(search)) {
    const at = pair.indexOf('='), key = decode(at < 0 ? pair : pair.slice(0, at)), value = decode(at < 0 ? '' : pair.slice(at + 1));
    if (key?.startsWith('$') && NAME.test(key.slice(1)) && value !== null && !(key.slice(1) in values)) values[key.slice(1)] = value;
  }
  return values;
}

/** The `$` query for these values, `''` for none; a bad name, or a query past the app's bound, is a TypeError. */
export function routeSearch(values: Readonly<Record<string, unknown>>): string {
  if (!values || typeof values !== 'object') throw new TypeError('route values must be an object');
  const parts: string[] = [];
  for (const [name, value] of Object.entries(values)) {
    if (!NAME.test(name)) throw new TypeError(`route value name ${JSON.stringify(name)} is not a name`);
    if (value === null || value === undefined || value === '') continue;
    parts.push(`$${name}=${encodeURIComponent(String(value))}`);
  }
  const search = parts.length ? `?${parts.join('&')}` : '';
  if (search.length > MAX_SEARCH) throw new TypeError(`route values too long for an address: the limit is ${MAX_SEARCH} characters`);
  return search;
}

const withValues = (search: string, values: string) => {
  const kept = [...pairs(search).filter((pair) => !ours(pair)), ...pairs(values)];
  return kept.length ? `?${kept.join('&')}` : '';
};
const same = (a: RouteValues, b: RouteValues) => JSON.stringify(a) === JSON.stringify(b);

export function createPageRoute(win: Window, facts: Pick<SeatFacts, 'pageId' | 'appOrigin' | 'offline'>): PageRoute {
  const appOrigin = facts.appOrigin;
  const framed = win.parent !== win && !!appOrigin && !facts.offline;
  const listeners = new Set<(values: RouteValues) => void>();
  /** Where an address cannot be rewritten (a file a browser will not rewrite), the values live here for this visit. */
  let held: string | null = null;
  let current = routeValuesOf(win.location.search);
  const search = () => held ?? win.location.search;
  const write = (next: string, push: boolean) => {
    const { pathname, hash } = win.location;
    try { win.history[push ? 'pushState' : 'replaceState'](win.history.state, '', `${pathname}${next}${hash}`); held = null; } catch { held = next; }
  };
  const changed = () => {
    const values = routeValuesOf(search());
    if (same(values, current)) return;
    current = values;
    for (const listener of [...listeners]) try { listener({ ...values }); } catch { /* subscriptions are independent */ }
  };
  if (framed) {
    // The app's Back and Forward: the values its address holds now. Only from the parent, at the origin that frames us.
    win.addEventListener('message', (event: MessageEvent) => {
      const data = event.data as { type?: unknown; search?: unknown } | null;
      if (event.source !== win.parent || event.origin !== appOrigin || data?.type !== STORY_URL_VALUES_MESSAGE || typeof data.search !== 'string') return;
      write(withValues(search(), routeSearch(routeValuesOf(data.search))), false);
      changed();
    });
  } else win.addEventListener('popstate', changed);
  return {
    get: () => ({ ...routeValuesOf(search()) }),
    set(values, options = {}) {
      const next = routeSearch(values), push = options.push === true;
      // Framed, history is the app's: this address moves in place and the app's takes the values (and the entry).
      write(withValues(search(), next), push && !framed);
      if (framed) try { win.parent.postMessage({ type: STORY_URL_VALUES_MESSAGE, search: next, ...(push ? { push: true } : {}) }, appOrigin!); } catch { /* the app went away */ }
      changed();
    },
    subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    href(values) {
      const next = routeSearch(values);
      if (framed) return `${appOrigin}/a/${encodeURIComponent(facts.pageId)}${next}`;
      const url = new URL(win.location.href);
      url.search = next; url.hash = '';
      return url.href;
    },
  };
}
