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

export type WebIngestErrorCode =
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

/** Forbidden even when `allowPrivate` is on: nothing ever softens these. */
const ALWAYS_FORBIDDEN_V4 = [
  [169, 254], // link-local — includes the cloud metadata IP
] as const;

const isAlwaysForbiddenV4 = (o: number[]): boolean =>
  ALWAYS_FORBIDDEN_V4.some((prefix) => prefix.every((p, i) => o[i] === p));

const isPrivateV4 = (o: number[]): boolean =>
  o[0] === 0 ||                                     // "this network"
  o[0] === 10 ||                                    // RFC1918
  (o[0] === 100 && o[1] >= 64 && o[1] <= 127) ||    // CGNAT
  o[0] === 127 ||                                   // loopback
  (o[0] === 172 && o[1] >= 16 && o[1] <= 31) ||     // RFC1918
  (o[0] === 192 && o[1] === 0 && o[2] === 0) ||     // IETF assignments
  (o[0] === 192 && o[1] === 0 && o[2] === 2) ||     // TEST-NET-1
  (o[0] === 192 && o[1] === 168) ||                 // RFC1918
  (o[0] === 198 && (o[1] === 18 || o[1] === 19)) || // benchmarking
  (o[0] === 198 && o[1] === 51 && o[2] === 100) ||  // TEST-NET-2
  (o[0] === 203 && o[1] === 0 && o[2] === 113) ||   // TEST-NET-3
  o[0] >= 224;                                      // multicast + reserved + broadcast

const parseV4 = (ip: string): number[] | null => {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;
  const octets = parts.map((p) => (/^\d{1,3}$/.test(p) ? Number(p) : NaN));
  return octets.every((n) => Number.isInteger(n) && n >= 0 && n <= 255) ? octets : null;
};

/** First hextet of a normalized v6 address ('' pieces from `::` count as 0). */
const v6Head = (ip: string): number | null => {
  const head = ip.split(':', 1)[0];
  if (head === '') return 0; // starts with '::'
  return /^[0-9a-f]{1,4}$/.test(head) ? parseInt(head, 16) : null;
};

const forbiddenV6 = (ip: string): boolean => {
  if (ip === '::' || ip === '::1') return true;
  // v4-mapped (::ffff:a.b.c.d) — the classic bypass: judge the embedded v4.
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(ip);
  if (mapped) return isForbiddenIp(mapped[1]);
  // NAT64 embeds a v4 we cannot see through — forbid the whole prefix.
  if (ip.startsWith('64:ff9b:')) return true;
  if (ip.startsWith('2001:db8:')) return true; // documentation
  const head = v6Head(ip);
  if (head === null) return true; // unparseable — fail closed
  if ((head & 0xfe00) === 0xfc00) return true; // fc00::/7 unique-local
  if ((head & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
  if ((head & 0xff00) === 0xff00) return true; // multicast
  return false;
};

/**
 * Whether an ADDRESS may never be fetched. `allowPrivate` admits the private
 * ranges (dev), but never link-local — see the module doc.
 */
export function isForbiddenIp(ip: string, policy?: WebIngestPolicy): boolean {
  const trimmed = ip.trim().toLowerCase();
  if (!trimmed) return true;
  if (trimmed.includes(':')) {
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(trimmed);
    if (mapped) return isForbiddenIp(mapped[1], policy);
    if (policy?.allowPrivate && (trimmed === '::1')) return false;
    return forbiddenV6(trimmed);
  }
  const octets = parseV4(trimmed);
  if (!octets) return true; // fail closed
  if (isAlwaysForbiddenV4(octets)) return true;
  if (policy?.allowPrivate) return false;
  return isPrivateV4(octets);
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
