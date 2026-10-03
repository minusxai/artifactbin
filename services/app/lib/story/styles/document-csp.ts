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
 *  - `frame-ancestors`: the app alone.
 *
 * `extensions` are https origins a document declares for itself (brief C supplies them), appended
 * per directive — except `connect`: a declared host is reached through the document's `/fetch` door. Anything that is not a bare https origin is refused, never quoted into the header.
 */
import { assetsPath, mutatePath, queryPath } from './markup-csp';
import { EMBED_HOSTS, FONT_FILES, FONT_STYLES, MODULE_CDNS } from './document-sources';

/**
 * Extra https origins per directive, appended after the fixed sources. Structurally brief C's
 * `CspExtensions` (lib/story/document/csp-extensions), which replaces this declaration at merge.
 */
export interface DocumentCspExtensions {
  /** Reached through the document's `/fetch` door (app/a/[id]/fetch), never added to `connect-src`. */
  connect: readonly string[];
  script: readonly string[];
  /** Stylesheets, and the fonts they load (`style-src` and `font-src`). */
  style: readonly string[];
  img: readonly string[];
  frame: readonly string[];
  media: readonly string[];
}

export const NO_DOCUMENT_CSP_EXTENSIONS: DocumentCspExtensions = Object.freeze({ connect: [], script: [], style: [], img: [], frame: [], media: [] });

export interface DocumentCspInput {
  /** The document's own origin (`https://<hex>.<pages host>`). */
  self: string;
  /** The app's origin: the one framer, and where this document's doors also answer. */
  app: string;
  /** The document's id, for its app-origin doors. */
  id: string;
  /** A configured public asset origin (APP__ASSETS_ORIGIN), admitted for its bytes. */
  assetOrigin?: string | null;
  extensions?: DocumentCspExtensions;
}


const eventsPath = (id: string): string => `/a/${id}/events`;
/** The door a script reaches its declared hosts through (app/a/[id]/fetch). */
export const fetchPath = (id: string): string => `/a/${id}/fetch`;

function httpsOrigins(list: readonly string[]): string[] {
  return list.map((entry) => {
    let origin: string | null = null;
    try { const url = new URL(entry); origin = url.protocol === 'https:' && url.origin === entry ? url.origin : null; } catch { /* refused below */ }
    if (!origin || origin.includes('*')) throw new Error(`document CSP extension ${JSON.stringify(entry)} is not an https origin`);
    return origin;
  });
}

const join = (...parts: ReadonlyArray<string | readonly string[]>): string => parts.flat().filter(Boolean).join(' ');

export function buildDocumentCsp({ self, app, id, assetOrigin = null, extensions = NO_DOCUMENT_CSP_EXTENSIONS }: DocumentCspInput): string {
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
    join('img-src', "'self'", 'https:', 'data:', 'blob:', asset, ext.img),
    join('media-src', "'self'", 'https:', 'blob:', asset, ext.media),
    join('frame-src', EMBED_HOSTS, ext.frame),
    "form-action 'none'",
    "base-uri 'none'",
    `frame-ancestors ${appOrigin}`,
  ].join('; ');
}
