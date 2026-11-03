/**
 * The SSRF boundary of web ingestion — PURE (no sockets, no DNS), so every
 * rule is exhaustively unit-testable. The fetcher (./fetch) consults these at
 * the only two moments that matter: on the URL before anything moves, and on
 * every RESOLVED ADDRESS at connection time (a custom `lookup`, so the address
 * checked IS the address connected — no resolve-then-fetch race), re-run on
 * every redirect hop.
 *
 * Fail closed everywhere: an address we cannot parse is a forbidden address.
 * The metadata IP (169.254.169.254) sits in link-local space, which stays
 * forbidden even under the dev policy that admits loopback/RFC1918 — a dev
 * machine on a cloud box must still never be a metadata oracle.
 */

import { isAllowedAddress } from '@artifactbin/utils/public-address';

type WebIngestErrorCode =
  | 'invalid_url'        // not a parseable http(s) URL, or carries credentials / a custom port
  | 'forbidden_scheme'   // not https (or http where the policy allows it)
  | 'forbidden_host'     // outside the caller's allowHosts narrowing
  | 'forbidden_address'  // resolves to a private / reserved / link-local address
  | 'dns_failed'
  | 'fetch_failed'
  | 'bad_status'
  | 'too_large'
  | 'too_many_redirects'
  | 'timeout'
  | 'unsupported_type';  // the bytes are not what the caller ingests

export class WebIngestError extends Error {
  constructor(public readonly code: WebIngestErrorCode, message: string) {
    super(message);
    this.name = 'WebIngestError';
  }
}

export interface WebIngestPolicy {
  /** Admit loopback/RFC1918 targets — dev/CI only, where the interesting URLs ARE local. */
  allowPrivate: boolean;
  /** Admit plain http — rides the same dev switch; production is https-only. */
  allowHttp: boolean;
}

// ── address rules ────────────────────────────────────────────────────────────

/**
 * Whether an ADDRESS may never be fetched. The ranges live in `@artifactbin/utils` (`isAllowedAddress`),
 * shared with the resolver database tunnel. `allowPrivate` admits loopback and the private ranges (dev),
 * but never link-local or reserved space — see the module doc.
 */
export function isForbiddenIp(ip: string, policy?: WebIngestPolicy): boolean {
  return !isAllowedAddress(ip, { allowPrivate: !!policy?.allowPrivate });
}

// ── URL rules ────────────────────────────────────────────────────────────────

/**
 * Parse and vet a caller-supplied URL. WHATWG parsing runs FIRST, which is
 * what defeats IPv4 obfuscation: `0x7f000001`, `2130706433` and `0177.0.0.1`
 * all normalize to dotted-decimal before the address check sees them.
 */
export function parseWebUrl(raw: string, policy: WebIngestPolicy): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new WebIngestError('invalid_url', `"${raw}" is not a URL`);
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new WebIngestError('forbidden_scheme', `only https URLs can be imported (got ${url.protocol.replace(':', '')})`);
  }
  if (url.protocol === 'http:' && !policy.allowHttp) {
    throw new WebIngestError('forbidden_scheme', 'only https URLs can be imported');
  }
  if (url.username || url.password) {
    throw new WebIngestError('invalid_url', 'URLs with credentials cannot be imported');
  }
  // Default ports only — a custom port turns the fetcher into a port scanner.
  if (url.port && url.port !== '443' && !(policy.allowHttp && url.protocol === 'http:')) {
    throw new WebIngestError('invalid_url', 'URLs with non-default ports cannot be imported');
  }
  // A literal-IP host is judged here; named hosts are judged at connect time.
  const host = url.hostname.startsWith('[') && url.hostname.endsWith(']')
    ? url.hostname.slice(1, -1)
    : url.hostname;
  if (/^[\d.]+$/.test(host) || host.includes(':')) {
    if (isForbiddenIp(host, policy)) {
      throw new WebIngestError('forbidden_address', `"${host}" is not a fetchable address`);
    }
  }
  return url;
}
