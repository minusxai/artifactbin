/**
 * ONE DEPLOYMENT, SEVERAL ADDRESSES.
 *
 * A deployment may answer at more than one hostname — an app origin and a
 * marketing origin that proxies non-HTML requests to the same process. Nothing
 * on the wire says those are one server, so a client that compares origins as
 * strings treats them as two: a link copied from one is refused against the
 * other, a folder tracked against one refuses the other, and a saved host that
 * is the "wrong" one can no longer sign in at all.
 *
 * The server says who it is instead. `GET /api/server` is public,
 * unauthenticated and cacheable, and answers ONE document: the canonical
 * origin and the other origins the same deployment answers at.
 *
 * WHAT A CLIENT MAY BELIEVE lives at the client:
 * this module only says what the document IS and what an origin may look like.
 * Both halves read it through here so there is exactly one origin rule.
 */

import { isLoopbackName } from './loopback-names';

export interface ServerIdentityDocument {
  /** The one origin this deployment calls itself. */
  origin: string;
  /** Other origins the same deployment answers at. Never contains `origin`. */
  aliases: string[];
  /** Combined mode only (MinusX configured): this installation's stable id. */
  installation_id?: string;
  /** Combined mode only: where this installation's MinusX control API is. A client sends no credential there it was not given for it. */
  minusx?: { base_url: string };
}

/**
 * THE LOCAL DEVELOPMENT HOSTS, the only names plain HTTP is accepted on: loopback
 * (`localhost`, `127.0.0.1`, `[::1]`), and the names reserved for or resolving
 * to loopback — `*.localhost` (RFC 6761), `lvh.me` and `*.lvh.me` (127.0.0.1 in
 * public DNS; development's pages host, SETUP.md) and `*.test` (RFC 6761).
 * Takes a WHATWG `URL.hostname`, so IPv6 arrives bracketed and names lowercased.
 */
export function isLocalDevelopmentHost(hostname: string): boolean {
  return isLoopbackName(hostname) || hostname === '127.0.0.1' || hostname === '[::1]'
    || (hostname.length > '.test'.length && hostname.endsWith('.test'));
}

/**
 * THE ORIGIN RULE, for every origin this product accepts from a person or a
 * server: HTTPS, or HTTP on a local development host (`isLocalDevelopmentHost`),
 * and an origin only — no path, query, fragment or userinfo. `null` when the
 * value is not one, so a caller chooses between refusing (the CLI's
 * `normalizeServer`) and ignoring (a malformed entry in a served document).
 */
export function normalizeOrigin(value: string): string | null {
  let url: URL;
  try { url = new URL(value); } catch { return null; }
  if ((url.protocol !== 'https:' && !(url.protocol === 'http:' && isLocalDevelopmentHost(url.hostname)))
    || url.username || url.password || url.search || url.hash || url.pathname !== '/') return null;
  return url.origin;
}

/** APP__ALIAS_ORIGINS: the comma-separated origins one deployment also answers at, each by `normalizeOrigin`. A malformed entry throws. */
export function parseAliasOrigins(value: string | undefined): readonly string[] {
  if (value === undefined || value.trim() === '') return Object.freeze([]);
  const origins: string[] = [];
  for (const entry of value.split(',')) {
    const origin = normalizeOrigin(entry.trim());
    if (!origin) throw new Error('APP__ALIAS_ORIGINS must be a comma-separated list of origins this deployment also answers at (HTTPS, or HTTP on a local development host such as localhost or *.lvh.me), without a path, query, fragment or credentials.');
    if (!origins.includes(origin)) origins.push(origin);
  }
  return Object.freeze(origins);
}

