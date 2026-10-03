/**
 * The served markup document's Content-Security-Policy — the response header
 * that IS the sandbox (app/a/[id]/raw). One function, because the policy is
 * per document: `connect-src` admits that document's own query endpoint
 * (`<origin>/a/<id>/query`), its own live stream (`<origin>/a/<id>/events`) and
 * that stream's `/frame` sub-path, its own write endpoint
 * (`<origin>/a/<id>/mutate`), its anonymous asset resolver
 * (`<origin>/a/<id>/resolve`), the static `/geojson/` boundary files, and
 * `blob:`/`data:` for the local URLs GLB loaders build — and nothing else on the
 * origin. A configured asset origin adds itself and that document's own
 * `<origin>/a/<id>/assets` endpoint, and nothing else again.
 *
 * Why a path, not 'self': 'self' would open every `/api/*` route to the
 * author's script (minting tokens from a viewer's IP, for one). A CSP source
 * may carry a path — without a trailing slash it matches that path exactly,
 * and the query string is ignored — so the document can fetch its re-runs
 * (GET ?q=…, anonymous ACL, see app/a/[id]/query) and reach nothing else.
 * The origin must be ABSOLUTE for a path to be expressed, hence the argument
 * (lib/http baseUrl: the public origin behind the proxy).
 *
 * Everything else is content-independent: opaque origin
 * (`sandbox` without allow-same-origin), no form navigation, no base, no
 * third-party destinations of any kind. The two additions to the fixed source
 * directives are the pinned library directory on `script-src` and, when one is
 * configured, the asset origin on `script`/`img`/`font`/`media-src`. Guarded by
 * __tests__/raw-document.test.ts.
 */
import { BASEMAP_PATH } from '@/lib/serving/basemap';
import { storyFragmentPath } from '@/lib/compiled-page/story-fragment';
import { FONT_FILES, FONT_STYLES, MODULE_CDNS } from './document-sources';
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
  // Same-origin frames only; a raw <iframe> remains invalid markup.
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

/** The path the document may fetch: its own query endpoint. */
export const queryPath = (id: string): string => `/a/${id}/query`;
export const resolvePath = (id: string): string => `/a/${id}/resolve`;

/**
 * …and the one it may LISTEN on: its own live stream, so a reader sees their
 * author write. Same shape and the same reasoning as the query path — absolute
 * and path-exact, so nothing else on this origin is reachable — and the same
 * answer to "what can this leak": the stream carries this document, to someone
 * already reading this document, under the same read ACL as the page itself.
 */
const eventsPath = (id: string): string => `/a/${id}/events`;

/**
 * …and the one it may WRITE to: its own mutate endpoint, which performs the
 * `<Mutation>`s this document declares (app/a/[id]/mutate). Admitted on the
 * same terms as the two above — absolute and path-exact, so nothing else on
 * this origin is reachable — and safe on the same reasoning: the caller
 * supplies a mutation NAME and scalar values, the SQL is the stored one, and
 * the route answers a cookie-less caller as a stranger.
 */
export const mutatePath = (id: string): string => `/a/${id}/mutate`;

/**
 * …and the document-scoped endpoint where a
 * document imports an image URL only its reader can compute
 * (app/a/[id]/assets). It belongs here because this is the registry of a
 * document's own addresses. Legacy images use it as their src; a configured
 * asset origin also adds it to connect-src.
 */
export const assetsPath = (id: string): string => `/a/${id}/assets`;

/**
 * …and the one static directory: the boundary geometry the geo charts fetch
 * (`loadGeoFeatures` → `/geojson/<file>.json`, an allowlisted registry of
 * public files under `public/`). A trailing slash makes a CSP source a
 * directory-prefix match, so this admits exactly those files and nothing
 * else on the origin. Without it every choropleth/point map rendered inside
 * a served document failed its boundary fetch — connect-src governs fetch()
 * even same-origin.
 */
const GEOJSON_DIR_PATH = '/geojson/';

/**
 * …and the island build directory, for the one file the runtime
 * FETCHES rather than imports: the page's SQLite wasm, content-addressed
 * there (StoryIslandData.sqliteWasm). Public build output, like /geojson/.
 */
const ISLANDS_DIR_PATH = '/islands/';

/**
 * …and the bundled font files (public/fonts, the manifest's faces): the kit
 * reads the files the page already loaded — from the HTTP cache — to put them
 * into its Mermaid drawings, which an `<img>` shows and which cannot reach the
 * page's fonts otherwise (lib/mermaid-images/mermaid-fonts). Public, immutable
 * files, like /geojson/ and /story/.
 */
const FONTS_DIR_PATH = '/fonts/';

/**
 * …and, on a COMPILED page only (lib/compiled-page, docs/phase2-architecture.md §9),
 * the viewer overlay door: what only this reader decides, fetched after paint
 * under the same read ACL as the query door (app/a/[id]/viewer).
 */
const viewerPath = (id: string): string => `/a/${id}/viewer`;

/**
 * …and, on a compiled page only, its STORY FRAGMENT (app/a/[id]/story): the document's newest version as
 * this very page is served it, which the live morph draws in place (lib/islands/morph/engine). The same
 * read ACL as the page and the same answer a reload would give, to someone already reading it.
 */

/**
 * The compiled page's `script-src`: NO `'unsafe-inline'`. The compiled reader
 * emits no inline script at all — its code is the shared island chunks and the
 * per-document module, same-origin files — and its data is an
 * `application/json` island, which is not script. `'self'` leads, so the policy
 * says first what the page runs.
 */
const COMPILED_SCRIPT_SRC = `script-src 'self' 'wasm-unsafe-eval' blob: ${MODULE_CDNS.join(' ')}`;

export interface MarkupCspOptions {
  /** The response is the compiled reader's (x-mx-reader: compiled): no inline script is admitted. */
  compiled?: boolean;
}

export function markupCsp(origin: string, id: string, assetOrigin?: string, options: MarkupCspOptions = {}): string {
  // connect-src sits with the other source directives, before the behaviour
  // ones — the one per-document line in an otherwise fixed policy.
  const self = origin.replace(/\/+$/, '');
  // The frame endpoint is a separate, path-exact entry: CSP matches a path
  // without a trailing slash exactly, so `/events` does not cover `/events/frame`.
  // GLB loaders fetch embedded textures/buffers through local blob/data URLs;
  // these add no network destination or access to the application's APIs.
  const viewer = options.compiled ? ` ${self}${viewerPath(id)} ${self}${storyFragmentPath(id)}` : '';
  const connect = `connect-src ${self}${queryPath(id)} ${self}${eventsPath(id)} ${self}${eventsPath(id)}/frame ${self}${mutatePath(id)} ${self}${resolvePath(id)}${viewer} ${self}${GEOJSON_DIR_PATH} ${self}${BASEMAP_PATH} ${self}${ISLANDS_DIR_PATH} ${self}${FONTS_DIR_PATH} blob: data: ${MODULE_CDNS.join(' ')}`;
  if(assetOrigin && (new URL(assetOrigin).origin!==assetOrigin||!/^https?:\/\//.test(assetOrigin)))throw Error('Invalid asset origin');
  const sources=SOURCE_DIRECTIVES.map(d=>{
    // The hosted library directory stays explicit for documents that import a
    // pinned bundle by URL. This grants neither API fetches nor navigation.
    const script=options.compiled&&d.startsWith('script-src ')?COMPILED_SCRIPT_SRC:d;
    const source=script.startsWith('script-src ')?script+` ${self}/libraries/`:script;
    return assetOrigin && /^(script|img|font|media)-src /.test(source)?source+' '+assetOrigin:source;
  });
  const assetConnect=assetOrigin?` ${assetOrigin} ${self}${assetsPath(id)}`:'';
  return [...sources, connect+assetConnect, ...BEHAVIOUR_DIRECTIVES].join('; ');
}
