/**
 * Which paths the proxy must treat as CREDENTIAL-OPTIONAL: forward whatever
 * credential is present, never require one, never remove one.
 *
 * Every path under a served document. The sandboxed document itself calls
 * these with NO credential by design (opaque origin); the owner's shell and a
 * private document's invited readers call the same paths WITH cookies — and
 * the relay through `POST /a/<id>/query` is the only way a private document's
 * queries run for its readers. Stripping would break the latter; requiring
 * would break the former.
 *
 * Also: a DOCUMENT RESPONSE (anything the app answers under /a/<id>) must
 * reach the client with the app's headers untouched — the per-row CSP on
 * `/raw` IS the sandbox — and with nothing added, `Set-Cookie` included.
 *
 * Moved from packages/contract/src/routes.ts (verbatim); that file re-exports
 * this one until the package dissolves. The OAuth breadcrumb
 * (`wwwAuthenticate`, `PROTECTED_RESOURCE_PATH`) lives in @artifactbin/utils.
 */
const DOCUMENT_PATH = /^\/a\/[A-Za-z0-9]{6,12}(\/|$|\?)/;
const PRETTY_PATH = /^\/@[a-z0-9_]{3,32}(\/|$)/;

export function isCredentialOptionalPath(pathname: string): boolean {
  return DOCUMENT_PATH.test(pathname) || PRETTY_PATH.test(pathname);
}

/** A response the proxy may add nothing to and remove nothing from. */
export function isDocumentPath(pathname: string): boolean {
  return isCredentialOptionalPath(pathname);
}

/** The header the proxy owns besides the actor: it sets this from the socket, never trusts inbound. */
export const FORWARDED_FOR = 'x-forwarded-for';
/**
 * WHERE THE CLIENT THINKS IT IS. The app builds absolute URLs from these — a
 * document's `connect-src`, an `og:image`, the links in an MCP tool's answer —
 * and behind a proxy the host it listens on is not the host anyone typed.
 *
 * They are the PROXY's for the same reason `x-forwarded-for` is: inbound, they
 * are text the caller chose, and an app that trusts them will happily publish a
 * CSP and a set of links pointing at an origin an attacker picked. The proxy
 * sets both from what it actually received and discards whatever arrived.
 */
export const FORWARDED_HOST = 'x-forwarded-host';
export const FORWARDED_PROTO = 'x-forwarded-proto';
/** Headers the proxy sets on the way in; everything else passes through untouched. */
export const PROXY_OWNED_REQUEST_HEADERS = ['x-mx-actor', FORWARDED_FOR, FORWARDED_HOST, FORWARDED_PROTO] as const;
/** Shared-secret header for optional authentication of split internal services. */
export const SERVICE_AUTH_HEADER = 'x-artifactbin-service-secret';
