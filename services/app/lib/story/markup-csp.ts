/**
 * The served markup document's Content-Security-Policy — the response header
 * that IS the sandbox (app/a/[id]/raw). One function, because the policy is
 * per document: `connect-src` admits that document's own query endpoint
 * (`<origin>/a/<id>/query`), its own live stream (`<origin>/a/<id>/events`),
 * its own write endpoint (`<origin>/a/<id>/mutate`), the static `/geojson/`
 * boundary files — and nothing else on the origin.
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
 * (`sandbox` without allow-same-origin), no forms, no base, no third-party
 * destinations of any kind. Guarded by __tests__/raw-document.test.ts.
 */
/** Where each kind of subresource may come from — content-independent. */
const SOURCE_DIRECTIVES = [
  "default-src 'none'",
  "script-src 'unsafe-inline' 'self'",
  "style-src 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "media-src 'self' data: blob:",
  // No network frame destinations: raw <iframe> is banned in markup. The
  // trusted runtime creates only an inline srcdoc author-script sandbox.
  // Keep default-src 'none' as the navigation boundary until trusted-control
  // destinations have their own explicit, tested policy.
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
  'sandbox allow-scripts allow-popups allow-popups-to-escape-sandbox allow-top-navigation-by-user-activation',
] as const;

/** The path the document may fetch: its own query endpoint. */
export const queryPath = (id: string): string => `/a/${id}/query`;

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
 * …and the one document endpoint deliberately ABSENT from this policy: where a
 * document imports an image URL only its reader can compute
 * (app/a/[id]/assets). It belongs here because this is the registry of a
 * document's own addresses, and it is missing from `connect-src` because it is
 * never fetched — it is the `src` of an `<img>`, which `img-src 'self'` already
 * admits. A policy entry for it would state the opposite of what is true.
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

export function markupCsp(origin: string, id: string): string {
  // connect-src sits with the other source directives, before the behaviour
  // ones — the one per-document line in an otherwise fixed policy.
  const self = origin.replace(/\/+$/, '');
  // The frame endpoint is a separate, path-exact entry: CSP matches a path
  // without a trailing slash exactly, so `/events` does not cover `/events/frame`.
  const connect = `connect-src ${self}${queryPath(id)} ${self}${eventsPath(id)} ${self}${eventsPath(id)}/frame ${self}${mutatePath(id)} ${self}${GEOJSON_DIR_PATH}`;
  return [...SOURCE_DIRECTIVES, connect, ...BEHAVIOUR_DIRECTIVES].join('; ');
}
