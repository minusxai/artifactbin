/** Sandboxed document policy: explicit current document doors and public assets, never general API access. */
import { BASEMAP_PATH } from '@artifactbin/contracts';
import { FONT_FILES, FONT_STYLES, MODULE_CDNS } from '@/lib/html-reader/document-sources';
import { CSP_DIRECTIVES, EMPTY_CSP_EXTENSIONS, type CspDirective, type CspExtensions } from '@/lib/document';
/** Where each kind of subresource may come from — content-independent. */
const SOURCE_DIRECTIVES = [
  "default-src 'none'",
  // 'wasm-unsafe-eval': the runtime compiles its SQLite engine (WebAssembly
  // only — no eval). `blob:` and the module CDNs: the author's script is a module
  // of this document (lib/islands/page-runtime) and may import from them — the
  // same sources its own origin admits (./document-csp), never any https host.
  `script-src 'unsafe-inline' 'self' 'wasm-unsafe-eval' blob: ${MODULE_CDNS.join(' ')}`,
  `style-src 'unsafe-inline' ${FONT_STYLES}`,
  "img-src 'self' data: blob: https:",
  `font-src 'self' data: ${FONT_FILES}`,
  "media-src 'self' data: blob: https:",
  // Same-origin frames only: an author's <iframe> plays on the document's own
  // origin (./document-csp), never in this sandboxed copy.
  "frame-src 'self'",
] as const;

/** What the document may DO — content-independent. */
const BEHAVIOUR_DIRECTIVES = [
  "form-action 'none'",
  "base-uri 'none'",
  /*
   * Only this origin's own pages may FRAME a document.
   *
   * Whoever frames a document is its `window.parent`, and the parent is who
   * the runtime takes edit-mode, document-replacement and selection commands
   * from — it cannot tell one framer from another by looking. A third party
   * framing a public document gained nothing worth having (the sandbox travels
   * with the response, so anything they injected ran in the same opaque origin
   * the author's own script already owns, and the edits posted back to THEIR
   * window, so nothing was ever stored) — but "gained nothing" is a property of
   * today's protocol, not a guarantee about tomorrow's, and this is the cheap
   * half of not having to re-derive it every time the protocol grows.
   *
   * The reader is unaffected: a shared document is served TOP-LEVEL, and
   * frame-ancestors says nothing about a document that is not framed at all.
   * The owner's shell and the exporter are both same-origin.
   */
  "frame-ancestors 'self'",
  'sandbox allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox allow-top-navigation-by-user-activation',
] as const;

const resolvePath = (id: string): string => `/a/${id}/resolve`;

/**
 * …and the one it may LISTEN on: its own live stream, so a reader sees their
 * author write. Absolute
 * and path-exact, so nothing else on this origin is reachable — and the same
 * answer to "what can this leak": the stream carries this document, to someone
 * already reading this document, under the same read ACL as the page itself.
 */
const eventsPath = (id: string): string => `/a/${id}/events`;

/**
 * …and the document-scoped endpoint where a
 * document imports an image URL only its reader can compute
 * (app/a/[id]/assets). It belongs here because this is the registry of a
 * document's own addresses. Legacy images use it as their src; a configured
 * asset origin also adds it to connect-src.
 */
export const assetsPath = (id: string): string => `/a/${id}/assets`;

/** Public boundary files fetched by maps; the trailing slash confines the CSP source to this directory. */
const GEOJSON_DIRS = ['/af/geojson/'];

/** Public platform fonts used by pages and their diagrams. */
const FONTS_DIRS = ['/af/fonts/'];
/** The hosted libraries' directory. */
const LIBRARY_DIRS = ['/af/lib/'];

export function markupCsp(origin: string, id: string, assetOrigin?: string): string {
  // connect-src sits with the other source directives, before the behaviour
  // ones — the one per-document line in an otherwise fixed policy.
  const self = origin.replace(/\/+$/, '');
  // The frame endpoint is a separate, path-exact entry: CSP matches a path
  // without a trailing slash exactly, so `/events` does not cover `/events/frame`.
  // GLB loaders fetch embedded textures/buffers through local blob/data URLs;
  // these add no network destination or access to the application's APIs.
  const connect = `connect-src ${self}${eventsPath(id)} ${self}${eventsPath(id)}/frame ${self}${resolvePath(id)} ${self}/a/${id}/fetch ${[...GEOJSON_DIRS, BASEMAP_PATH, ...FONTS_DIRS].map((dir) => self + dir).join(' ')} blob: data: ${MODULE_CDNS.join(' ')}`;
  if(assetOrigin && (new URL(assetOrigin).origin!==assetOrigin||!/^https?:\/\//.test(assetOrigin)))throw Error('Invalid asset origin');
  const sources=SOURCE_DIRECTIVES.map(d=>{
    // The hosted library and component directories stay explicit for documents that
    // import them (`@afbin/<name>`). This grants neither API fetches nor navigation.
    const source=d.startsWith('script-src ')?d+` ${[...LIBRARY_DIRS, '/af/components/'].map((dir) => self + dir).join(' ')}`:d;
    return assetOrigin && /^(script|img|font|media)-src /.test(source)?source+' '+assetOrigin:source;
  });
  // Its own published files (lib/html-publication-bundle) are read at the address publish wrote into a link.
  const assetConnect=` ${self}${assetsPath(id)}`+(assetOrigin?` ${assetOrigin}`:'');
  return [...sources, connect+assetConnect, ...BEHAVIOUR_DIRECTIVES].join('; ');
}

/** The policy directives each declared set extends. Fonts ride on `csp-style`: a stylesheet host serves its faces. */
const EXTENDED_DIRECTIVES: Record<CspDirective, readonly string[]> = {
  connect: ['connect-src'], script: ['script-src'], style: ['style-src', 'font-src'], img: ['img-src'], frame: ['frame-src'], media: ['media-src'],
};

/**
 * The `/raw` copy's policy (`markupCsp`) with the hosts this reader trusts the document to reach (its Helmet `csp-*`
 * metas, lib/trust/document-trust `cspExtensionsFor`) appended per directive. Where APP__PAGES_HOST frames documents
 * on their own origin, that origin's policy (./document-csp `buildDocumentCsp`) takes them instead; this serves the
 * same consent to the app origin's standalone copy. Identity on an empty set. A directive the policy does not carry is
 * left alone: adding it would narrow its `default-src` fallback, never widen.
 */
export function appendCspExtensions(policy: string, extensions: CspExtensions = EMPTY_CSP_EXTENSIONS): string {
  if (CSP_DIRECTIVES.every((d) => extensions[d].length === 0)) return policy;
  return policy.split(/;\s*/).map((directive) => {
    const [name, ...sources] = directive.trim().split(/\s+/);
    const kinds = CSP_DIRECTIVES.filter((d) => EXTENDED_DIRECTIVES[d].includes(name ?? ''));
    if (!kinds.length) return directive;
    const added = [...new Set(kinds.flatMap((kind) => extensions[kind]))].filter((origin) => !sources.includes(origin));
    if (!added.length) return directive;
    // 'none' cannot stand beside a source: the declared origins replace it.
    return sources.length === 1 && sources[0] === "'none'" ? `${name} ${added.join(' ')}` : `${directive} ${added.join(' ')}`;
  }).join('; ');
}
