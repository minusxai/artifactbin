/**
 * CONNECT AS THE VIEWER: a page function's database connection opened, for each viewer, by a service that accepts
 * this installation's identity tokens (./service-audiences), instead of with a stored login.
 *
 * A function file declares the name with this kind (`export const secrets = {SALES: 'viewer'}`); the page's author
 * binds it, server-side, to `{service, params}` (`ViewerBinding`): one of the services configured in
 * `DATA_SERVICES__TRUSTED` and parameters this product never interprets. When a run asks `caps.db(name)` for viewer
 * V, the server asks the identity module for a viewer token for V at that service's audience and calls the service's
 * session endpoint:
 *
 *   POST <session_url>   Authorization: Bearer <viewer token>   Content-Type: application/json
 *   body: the bound `params`, as a JSON object
 *   2xx → `ViewerSession`: an endpoint and a short-lived credential the runner connects to exactly as to a stored one
 *   401 / 403 → `data_access_denied` (this viewer may not); anything else, a timeout or a malformed answer →
 *   `data_unavailable`. Only the code and the connection's name reach the caller.
 *
 * The service verifies the token by introspection (its audience must be the service's own) and decides on its own
 * what the params let this viewer read. Nobody's credential is stored: the binding holds none, so a group-owned page
 * may carry it.
 */

import { isLocalDevelopmentHost } from './server-identity';

/** The `secrets` export kind of a name read through a configured data service, as each viewer. */
export const VIEWER_CONNECTION_KIND = 'viewer';

/** What the author bound a viewer connection name to: the configured service's id and its own parameters. */
export interface ViewerBinding { service: string; params: Record<string, unknown> }

/** A session endpoint's success answer. `tls` is `disable` only for a service that runs plaintext (development). */
export interface ViewerSession {
  protocol: 'postgres' | 'mysql';
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
  tls: 'verify-full' | 'disable';
  expires_at: string;
}

/** One trusted data service (`DATA_SERVICES__TRUSTED`): its id, its session endpoint, the identity audience it accepts. */
export interface DataService {
  id: string;
  sessionUrl: string;
  /** An id of IDENTITY__SERVICE_AUDIENCES: whose audience the viewer token is minted for. */
  audience: string;
}

/** At most this many bytes of JSON in a binding's `params`. */
const VIEWER_PARAMS_MAX_BYTES = 4096;

const ID = /^[a-z][a-z0-9-]{0,62}$/;
const WHAT = 'DATA_SERVICES__TRUSTED must be a JSON array of {"id": "<lower-case id>", "session_url": "<https URL>", "audience": "<an IDENTITY__SERVICE_AUDIENCES id>"}';

/** The setting, validated whole; empty by default (then a `'viewer'` declaration is refused at publish). */
export function parseDataServices(raw: string | undefined): readonly DataService[] {
  if (raw === undefined || raw.trim() === '') return Object.freeze([]);
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { throw new Error(WHAT); }
  if (!Array.isArray(parsed)) throw new Error(WHAT);
  const out: DataService[] = [];
  for (const entry of parsed) {
    const e = entry as Record<string, unknown> | null;
    if (!e || typeof e !== 'object' || Array.isArray(e) || Object.keys(e).some((key) => !['id', 'session_url', 'audience'].includes(key))) throw new Error(WHAT);
    let url: URL | null = null;
    try { url = typeof e.session_url === 'string' ? new URL(e.session_url) : null; } catch { url = null; }
    if (typeof e.id !== 'string' || !ID.test(e.id) || typeof e.audience !== 'string' || !ID.test(e.audience) || !url
      || !(url.protocol === 'https:' || (url.protocol === 'http:' && isLocalDevelopmentHost(url.hostname))) || url.username || url.password || url.hash) throw new Error(WHAT);
    if (out.some((other) => other.id === e.id)) throw new Error(`DATA_SERVICES__TRUSTED repeats ${JSON.stringify(e.id)}`);
    out.push({ id: e.id, sessionUrl: url.href, audience: e.audience });
  }
  return Object.freeze(out);
}

/** A stored binding, validated: exactly `{service, params}`, a configured-looking id and a bounded JSON object. */
export function parseViewerBinding(value: unknown): ViewerBinding {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('invalid_binding');
  const v = value as Record<string, unknown>;
  if (Object.keys(v).some((key) => key !== 'service' && key !== 'params') || typeof v.service !== 'string' || !ID.test(v.service)) throw Error('invalid_binding');
  const params = v.params ?? {};
  if (!params || typeof params !== 'object' || Array.isArray(params)) throw Error('invalid_binding');
  if (new TextEncoder().encode(JSON.stringify(params)).length > VIEWER_PARAMS_MAX_BYTES) throw Error('invalid_binding');
  return { service: v.service, params: params as Record<string, unknown> };
}
