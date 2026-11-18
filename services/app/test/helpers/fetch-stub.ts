/**
 * THE fetch stub for UI tests: a table of routes instead of an if-chain over URLs. `stubFetch(routes, options)` installs
 * a `vi.fn` as the global `fetch` (undone by `vi.unstubAllGlobals()`) and returns it, so a test still reads
 * `.mock.calls` or asserts `toHaveBeenCalledWith`.
 *
 * - A key is `'/path?query'` (any method) or `'METHOD /path?query'`, matched against the requested URL exactly, as a
 *   prefix when it ends in `*` (`'/api/page/home*'`), as a suffix when it starts with one (`*` then `/policy`), or as a
 *   substring between two (`'*part=kind*'`); `'*'` alone matches everything. Keys are tried in order; the first match
 *   answers.
 * - A value is a function `(url, init) => Response` (for state, status codes, delays, or reading the body), or any
 *   other value, answered as `Response.json(value)`.
 * - `session` answers `/api/page/session` (the app's one session read) with that body, before any route.
 * - `fallback` answers what no route matches (default: 404 `{}`); `onCall(url, init)` sees every request first.
 * `fetchRoutes` is the same table as a plain handler, for a test that wraps it before stubbing.
 */
import { vi } from 'vitest';

type Answer = Response | Promise<Response>;
type FetchRoute = ((url: string, init?: RequestInit) => Answer) | object | null;
interface FetchStubOptions {
  session?: unknown;
  fallback?: (url: string, init?: RequestInit) => Answer;
  onCall?: (url: string, init?: RequestInit) => void;
}

const matches = (key: string, url: string, method: string) => {
  const spaced = /^([A-Z]+) (.+)$/.exec(key);
  if (spaced && spaced[1] !== method) return false;
  const path = spaced ? spaced[2] : key;
  if (path === '*') return true;
  if (path.length > 1 && path.startsWith('*') && path.endsWith('*')) return url.includes(path.slice(1, -1));
  if (path.endsWith('*')) return url.startsWith(path.slice(0, -1));
  return path.startsWith('*') ? url.endsWith(path.slice(1)) : url === path;
};

/** The route table as a fetch handler, for a test that wraps it before stubbing (home-bootstrap-fetch.ts). */
export function fetchRoutes(routes: Record<string, FetchRoute>, { session, fallback = () => Response.json({}, { status: 404 }), onCall }: FetchStubOptions = {}) {
  const table = Object.entries(session === undefined ? routes : { '/api/page/session': session, ...routes });
  // Typed as the app calls it (a string URL), so tests read `mock.calls` URLs as strings; a Request is read by its URL.
  return async (input: string, init?: RequestInit): Promise<Response> => {
    const url = (input as unknown) instanceof Request ? (input as unknown as Request).url : String(input);
    onCall?.(url, init);
    const route = table.find(([key]) => matches(key, url, init?.method ?? 'GET'));
    if (!route) return fallback(url, init);
    const answer = route[1];
    return typeof answer === 'function' ? answer(url, init) : Response.json(answer);
  };
}

export function stubFetch(routes: Record<string, FetchRoute>, options: FetchStubOptions = {}) {
  const handle = fetchRoutes(routes, options);
  const fetcher = vi.fn(handle);
  vi.stubGlobal('fetch', fetcher);
  return fetcher;
}
