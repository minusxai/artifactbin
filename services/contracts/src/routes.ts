/** The OAuth breadcrumb (`wwwAuthenticate`, `PROTECTED_RESOURCE_PATH`) lives in @artifactbin/utils. */

/**
 * THE INTERNAL SURFACE. Everything under this prefix is the app answering the
 * PROXY, never a client: the proxy refuses the prefix outright (parts
 * `internalBoundary`, which sits in front of `application`), so the only way in is
 * a call the proxy makes on its own upstream seam — a Request the parts never
 * saw. One prefix rather than a list, so the boundary cannot drift from what
 * is behind it.
 *
 * `INTERNAL_MINT_PATH` is the only credential mint in that surface: the token
 * mint the CLI's device approval spends (proxy routes/oauth `mintFor`). Other
 * internal calls have their own constants and no public request reaches them.
 */
const INTERNAL_API_PREFIX = '/api/internal';
export const INTERNAL_MINT_PATH = `${INTERNAL_API_PREFIX}/tokens`;
export const INTERNAL_ARTIFACT_APPROVAL_PATH = `${INTERNAL_API_PREFIX}/artifact-approval`;
/** API audience allows an existing CLI connection to request an additional grant. */
export const ARTIFACT_APPROVAL_PATH = '/api/agent-approvals';
export function isInternalApiPath(pathname: string): boolean {
  return pathname === INTERNAL_API_PREFIX || pathname.startsWith(`${INTERNAL_API_PREFIX}/`);
}

/**
 * WHERE THE CLIENT THINKS IT IS. The app builds absolute URLs from these — a
 * document's `connect-src`, an `og:image`, the links in an operation's answer —
 * and behind a proxy the host it listens on is not the host anyone typed.
 *
 * They are the PROXY's for the same reason `x-forwarded-for` is: inbound, they
 * are text the caller chose, and an app that trusts them will happily publish a
 * CSP and a set of links pointing at an origin an attacker picked. The proxy
 * sets both from what it actually received and discards whatever arrived.
 */
export const FORWARDED_FOR = 'x-forwarded-for';
export const FORWARDED_HOST = 'x-forwarded-host';
export const FORWARDED_PROTO = 'x-forwarded-proto';
/** Shared-secret header for optional authentication of split internal services. */
export const SERVICE_AUTH_HEADER = 'x-artifactbin-service-secret';
