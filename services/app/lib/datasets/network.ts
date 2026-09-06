import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { isForbiddenIp } from '@/lib/web-ingest/guard';

const DNS_TIMEOUT_MS = 3000;
let pendingLookups = 0;

/** dns.lookup cannot cancel its native getaddrinfo job. Keep its reservation
 * until that job settles, even after the caller's deadline, so repeated slow
 * requests cannot fill libuv's queue without bound. Literal IPs bypass DNS. */
async function boundedLookup(name: string) {
  if (pendingLookups >= 8) throw new Error('PostgreSQL host resolver is busy.');
  pendingLookups++;
  const operation = lookup(name, { all: true, verbatim: true }).finally(() => { pendingLookups--; });
  const timeout = new Error('PostgreSQL host resolution timed out.');
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(timeout), DNS_TIMEOUT_MS); }),
    ]);
  } catch (error) {
    throw error === timeout ? timeout : new Error('PostgreSQL host could not be resolved.');
  } finally { clearTimeout(timer); }
}

/** The operator override admits database networks, never metadata or multicast. */
function privateV4(address: string): boolean {
  const [a, b] = address.split('.').map(Number);
  return a === 127 || a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
}

function permittedAddress(address: string, allowPrivate: boolean): boolean {
  // net.isIP accepts scoped IPv6; zone identifiers are outside this API's
  // host vocabulary and must not reach a local network interface.
  if (typeof address !== 'string' || address.includes('%')) return false;
  const family = isIP(address);
  if (family === 4) return !isForbiddenIp(address) || (allowPrivate && privateV4(address));
  if (family !== 6) return false;

  // WHATWG canonicalization collapses expanded zero groups and converts
  // dotted mapped tails to hex. Judge the embedded IPv4 in ALL spellings;
  // the shared web guard alone recognizes only the dotted mapped spelling.
  const canonical = new URL(`http://[${address}]/`).hostname.slice(1, -1);
  const mapped = /^::ffff:([\da-f]+):([\da-f]+)$/.exec(canonical);
  if (mapped) {
    const high = Number.parseInt(mapped[1], 16);
    const low = Number.parseInt(mapped[2], 16);
    return permittedAddress(`${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`, allowPrivate);
  }
  const [first, second] = canonical.split(':');
  const head = Number.parseInt(first || '0', 16);
  if (allowPrivate && (canonical === '::1' || (head & 0xfe00) === 0xfc00)) return true;

  // Public IPv6 uses global unicast space. Exclude transition/special space
  // too: IPv4-compatible, NAT64, 6to4 and Teredo must not tunnel a private
  // IPv4 destination past the IPv4 check above.
  if ((head & 0xe000) !== 0x2000 || head === 0x2002) return false;
  if (head === 0x2001 && Number.parseInt(second || '0', 16) < 0x200) return false;
  return !isForbiddenIp(canonical);
}

/** Reject paths/connection strings before lookup can interpret the host. */
function socketHost(host: string): string {
  const invalid = () => new Error('Enter a valid hostname or IP address for PostgreSQL.');
  if (typeof host !== 'string' || !host || /[\s/\\@?#%\u0000]/.test(host)) throw invalid();
  if (host.startsWith('[') && host.endsWith(']')) {
    const address = host.slice(1, -1);
    if (isIP(address) !== 6) throw invalid();
    return address;
  }
  if (isIP(host)) return host;
  const name = host.endsWith('.') ? host.slice(0, -1) : host;
  if (name.length > 253 || !name.split('.').every(label => /^[a-z\d_](?:[a-z\d_-]{0,61}[a-z\d_])?$/i.test(label))) throw invalid();
  return host;
}

/**
 * Resolve once, vet EVERY answer, then return the first approved IP. The
 * caller must use this returned address as the socket host (not resolve the
 * original name again), and retain the original hostname for TLS identity.
 * An operator may explicitly allow loopback/RFC1918/ULA for self-hosted DBs.
 */
export async function resolvePostgresHost(host: string, allowPrivate = false, dnsServers: readonly string[] = []): Promise<string> {
  const name = socketHost(host);
  const permitted = (address: string) => permittedAddress(address, allowPrivate === true);
  const forbidden = () => new Error('PostgreSQL host resolves to an address that is not permitted.');
  if (isIP(name)) {
    if (!permitted(name)) throw forbidden();
    return name;
  }
  const addresses = await boundedLookup(name);
  if (!Array.isArray(addresses) || !addresses.length) throw new Error('PostgreSQL host could not be resolved.');
  if (addresses.some(({ address, family }) => !permitted(address) || isIP(address) !== family)) throw forbidden();
  return addresses[0].address;
}
