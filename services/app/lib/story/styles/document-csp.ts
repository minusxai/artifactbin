/**
 * THE POLICY OF A DOCUMENT ON ITS OWN ORIGIN (`<hex(id)>.<pages host>`, lib/serving/pages-origin).
 *
 * The response header of the standalone page the app frames when APP__PAGES_HOST is set. Its origin
 * is the document's alone, so the opaque-origin `sandbox` the in-app `/raw` copy relies on
 * (./markup-csp) is not needed: the author's script cannot reach the app's storage or cookies from
 * here, and the `afbin_pages` cookie it rides on is HttpOnly. What the policy still decides:
 *
 *  - code from this origin (the island build, the per-document module), `blob:` modules (the author
 *    script, lib/islands/page-runtime), WebAssembly (the page's SQLite engine) and the three module
 *    CDNs an author script may import from — never inline script or eval;
 *  - connections to this origin (its own doors, server/pages-host), this document's doors on the app
 *    origin path-exact, and the same CDNs — never the app's other routes;
 *  - frames: the default players (`FRAME_HOSTS`) and any host the document declares with `csp-frame`;
 *  - `frame-ancestors`: the app alone.
 *
 * `extensions` are the https origins a document declares in its Helmet (`csp-*` metas, lib/story/document/csp-extensions)
 * that this reader trusts (lib/trust/document-trust `cspExtensionsFor`), appended per directive — except `connect`: a
 * declared host is reached through the document's `/fetch` door. Each is re-checked with the publish grammar
 * (`parseCspOrigin`: an https origin, or a whole leading `*.` label); anything else is refused, never quoted into the header.
 */
import { assetsPath, mutatePath, queryPath } from './markup-csp';
import { FONT_FILES, FRAME_HOSTS, FONT_STYLES, MODULE_CDNS } from '@/lib/story-ui/document-sources';
import { EMPTY_CSP_EXTENSIONS, parseCspOrigin, type CspExtensions } from '@/lib/story/document/csp-extensions';

export interface DocumentCspInput {
  /** The document's own origin (`https://<hex>.<pages host>`). */
  self: string;
  /** The app's origin: the one framer, and where this document's doors also answer. */
  app: string;
  /** The document's id, for its app-origin doors. */
  id: string;
  /** A configured public asset origin (APP__ASSETS_ORIGIN), admitted for its bytes. */
  assetOrigin?: string | null;
  extensions?: CspExtensions;
}


const eventsPath = (id: string): string => `/a/${id}/events`;
/** The door a script reaches its declared hosts through (app/a/[id]/fetch). */
const fetchPath = (id: string): string => `/a/${id}/fetch`;

function httpsOrigins(list: readonly string[]): string[] {
  return list.map((entry) => {
    const parsed = parseCspOrigin(entry);
    // Canonical only: what the publish grammar writes back is exactly what may stand in the header.
    if (!parsed.ok || parsed.origin !== entry) throw new Error(`document CSP extension ${JSON.stringify(entry)} is not an https origin`);
    return parsed.origin;
  });
}

const join = (...parts: ReadonlyArray<string | readonly string[]>): string => parts.flat().filter(Boolean).join(' ');

export function buildDocumentCsp({ self, app, id, assetOrigin = null, extensions = EMPTY_CSP_EXTENSIONS }: DocumentCspInput): string {
  new URL(self); // a malformed origin is a thrown error, never a policy
  const appOrigin = new URL(app).origin;
  const asset = assetOrigin ? [new URL(assetOrigin).origin] : [];
  const ext = {
    connect: httpsOrigins(extensions.connect), script: httpsOrigins(extensions.script),
    style: httpsOrigins(extensions.style), img: httpsOrigins(extensions.img),
    frame: httpsOrigins(extensions.frame ?? []), media: httpsOrigins(extensions.media ?? []),
  };
  void ext.connect; // validated like the rest; reached through `/fetch`, never connected to
  const appDoors = [queryPath(id), mutatePath(id), eventsPath(id), fetchPath(id), ...(asset.length ? [assetsPath(id)] : [])].map((path) => `${appOrigin}${path}`);
  return [
    "default-src 'none'",
    join('script-src', "'self'", 'blob:', "'wasm-unsafe-eval'", MODULE_CDNS, asset, ext.script),
    // `blob:`/`data:`: the local URLs GLB loaders build — no network destination.
    // Never a declared host (`extensions.connect`): a script reaches those through its own `/fetch`
    // door (app/a/[id]/fetch), so the reader's address never leaves for them.
    join('connect-src', "'self'", appDoors, MODULE_CDNS, asset, 'blob: data:'),
    join('style-src', "'self'", "'unsafe-inline'", FONT_STYLES, ext.style),
    join('font-src', "'self'", 'data:', FONT_FILES, asset, ext.style),
    join('img-src', "'self'", 'https:', 'data:', 'blob:', `${appOrigin}/api/users/`, asset, ext.img),
    join('media-src', "'self'", 'https:', 'blob:', asset, ext.media),
    // An author `<iframe>` (lib/jsx/validate): the default players, then the hosts the document declares.
    join('frame-src', FRAME_HOSTS, ext.frame),
    "form-action 'none'",
    "base-uri 'none'",
    `frame-ancestors ${appOrigin}`,
  ].join('; ');
}
