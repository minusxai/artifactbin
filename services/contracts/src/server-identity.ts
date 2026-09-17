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
 * WHAT A CLIENT MAY BELIEVE lives at the client (services/cli/src/server-identity):
 * this module only says what the document IS and what an origin may look like.
 * Both halves read it through here so there is exactly one origin rule.
 */

/** The public identity document's path. Spelled once. */
export const SERVER_IDENTITY_PATH = '/api/server';

export interface ServerIdentityDocument {
  /** The one origin this deployment calls itself. */
  origin: string;
  /** Other origins the same deployment answers at. Never contains `origin`. */
  aliases: string[];
}

/**
 * THE ORIGIN RULE, for every origin this product accepts from a person or a
 * server: HTTPS, or HTTP on loopback for development, and an origin only —
 * no path, query, fragment or userinfo. `null` when the value is not one, so a
 * caller chooses between refusing (the CLI's `normalizeServer`) and ignoring
 * (a malformed entry in a served document).
 */
export function normalizeOrigin(value: string): string | null {
  let url: URL;
  try { url = new URL(value); } catch { return null; }
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if ((url.protocol !== 'https:' && !(url.protocol === 'http:' && local))
    || url.username || url.password || url.search || url.hash || url.pathname !== '/') return null;
  return url.origin;
}

/**
 * STRICT READING of a served identity document. A server that answers
 * something else — an HTML error page parsed as JSON, `{}` from a catch-all
 * proxy, an origin with a path — is a server that said NOTHING, and a client
 * that reads `null` here behaves exactly as it did before this endpoint
 * existed. Anything less strict would let an unrelated 200 grant an alias.
 */
export function parseServerIdentityDocument(value: unknown): ServerIdentityDocument | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as {origin?: unknown; aliases?: unknown};
  if (typeof record.origin !== 'string') return null;
  const origin = normalizeOrigin(record.origin);
  if (!origin) return null;
  if (record.aliases !== undefined && !Array.isArray(record.aliases)) return null;
  const aliases: string[] = [];
  for (const entry of (record.aliases ?? []) as unknown[]) {
    if (typeof entry !== 'string') return null;
    const alias = normalizeOrigin(entry);
    if (!alias) return null;
    // A document naming its own origin among its aliases is redundant, not wrong.
    if (alias !== origin && !aliases.includes(alias)) aliases.push(alias);
  }
  return {origin, aliases};
}
