/**
 * Which network addresses the host may connect to on a page's behalf: web ingestion and `caps.fetch`
 * (services/app lib/web-ingest) and the resolver database tunnel (services/runner). PURE: no sockets, no
 * DNS, so every range is unit-testable. Callers resolve a name once, judge every answer here and connect to
 * the exact address judged.
 *
 * Fail closed: an address that does not parse is not public. IPv6 is admitted only inside 2000::/3 (global
 * unicast) outside the special-purpose blocks below; IPv4-mapped and NAT64 (64:ff9b::/96) forms are judged by
 * the IPv4 address they embed, and IPv4-compatible, 6to4 and Teredo forms are refused outright.
 */
export type AddressClass = 'public' | 'loopback' | 'private' | 'link_local' | 'reserved';

/** `loopback` admits 127/8 and ::1; `private` admits loopback, RFC1918, CGNAT and ULA. Link-local (cloud metadata) never. */
export interface AddressPolicy { allowLoopback?: boolean; allowPrivate?: boolean }

/** Canonical dotted-decimal only: four decimal octets without leading zeros (getaddrinfo reads `010` as octal). */
export function parseIPv4(text: string): number[] | null {
  const parts = text.split('.');
  if (parts.length !== 4) return null;
  const octets: number[] = [];
  for (const part of parts) {
    if (!/^(?:0|[1-9]\d{0,2})$/.test(part)) return null;
    const n = Number(part);
    if (n > 255) return null;
    octets.push(n);
  }
  return octets;
}

/** Eight 16-bit groups, or null. Accepts `::` compression and a dotted IPv4 tail; refuses zone IDs and brackets. */
export function parseIPv6(text: string): number[] | null {
  const ip = text.toLowerCase();
  if (!ip.includes(':') || !/^[0-9a-f:.]+$/.test(ip)) return null;
  const halves = ip.split('::');
  if (halves.length > 2) return null;
  const groups = (part: string): number[] | null => {
    if (part === '') return [];
    const out: number[] = [];
    const pieces = part.split(':');
    for (let i = 0; i < pieces.length; i++) {
      const piece = pieces[i]!;
      if (i === pieces.length - 1 && piece.includes('.')) {
        const v4 = parseIPv4(piece);
        if (!v4) return null;
        out.push((v4[0]! << 8) | v4[1]!, (v4[2]! << 8) | v4[3]!);
      } else if (/^[0-9a-f]{1,4}$/.test(piece)) out.push(parseInt(piece, 16));
      else return null;
    }
    return out;
  };
  const head = groups(halves[0]!);
  const tail = halves.length === 2 ? groups(halves[1]!) : [];
  if (!head || !tail) return null;
  // A dotted tail is only valid as the address's last 32 bits.
  if (halves.length === 2 && halves[0]!.includes('.')) return null;
  if (halves.length === 1) return head.length === 8 ? head : null;
  const missing = 8 - head.length - tail.length;
  if (missing < 1) return null;
  return [...head, ...Array<number>(missing).fill(0), ...tail];
}

function classifyV4(o: readonly number[]): AddressClass {
  const [a, b, c] = o as [number, number, number, number];
  if (a === 127) return 'loopback';
  if (a === 169 && b === 254) return 'link_local';                   // includes 169.254.169.254, the cloud metadata IP
  if (a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)) return 'private';   // RFC1918
  if (a === 100 && b >= 64 && b <= 127) return 'private';            // CGNAT 100.64/10
  if (a === 0) return 'reserved';                                    // "this network" 0/8
  if (a === 192 && b === 0 && (c === 0 || c === 2)) return 'reserved'; // IETF assignments, TEST-NET-1
  if (a === 192 && b === 88 && c === 99) return 'reserved';           // 6to4 relay anycast
  if (a === 198 && (b === 18 || b === 19)) return 'reserved';         // benchmarking
  if (a === 198 && b === 51 && c === 100) return 'reserved';          // TEST-NET-2
  if (a === 203 && b === 0 && c === 113) return 'reserved';           // TEST-NET-3
  if (a >= 224) return 'reserved';                                   // multicast, 240/4, broadcast
  return 'public';
}

const embeddedV4 = (g: readonly number[]) => [g[6]! >> 8, g[6]! & 0xff, g[7]! >> 8, g[7]! & 0xff];

function classifyV6(g: readonly number[]): AddressClass {
  const zeroUntil = (n: number) => g.slice(0, n).every((x) => x === 0);
  if (zeroUntil(7) && g[7] === 1) return 'loopback';
  if (zeroUntil(5) && g[5] === 0xffff) return classifyV4(embeddedV4(g));       // ::ffff:a.b.c.d mapped
  if (zeroUntil(6)) return 'reserved';                                          // :: and ::a.b.c.d compatible
  if (g[0] === 0x64 && g[1] === 0xff9b && g.slice(2, 6).every((x) => x === 0)) return classifyV4(embeddedV4(g)); // NAT64 64:ff9b::/96
  const h = g[0]!;
  if ((h & 0xfe00) === 0xfc00) return 'private';                                // fc00::/7 unique-local
  if ((h & 0xffc0) === 0xfe80) return 'link_local';                             // fe80::/10
  if ((h & 0xe000) !== 0x2000) return 'reserved';                               // outside 2000::/3: multicast, site-local, 64:ff9b:1::/48, 100::/64 …
  if (h === 0x2001 && g[1]! < 0x0200) return 'reserved';                         // 2001::/23 IETF protocol (Teredo, benchmarking, ORCHID)
  if (h === 0x2001 && g[1] === 0x0db8) return 'reserved';                        // documentation
  if (h === 0x2002) return 'reserved';                                          // 6to4 embeds an IPv4 address
  if (h === 0x3fff && g[1]! < 0x1000) return 'reserved';                         // 3fff::/20 documentation
  return 'public';
}

/** The class of an IP literal (no brackets), or `reserved` when it does not parse. */
export function addressClass(ip: string): AddressClass {
  const text = ip.trim();
  const v4 = parseIPv4(text);
  if (v4) return classifyV4(v4);
  const v6 = parseIPv6(text);
  return v6 ? classifyV6(v6) : 'reserved';
}

/** Whether the host may connect to this address under the policy. */
export function isAllowedAddress(ip: string, policy: AddressPolicy = {}): boolean {
  const kind = addressClass(ip);
  if (kind === 'public') return true;
  if (kind === 'loopback') return !!(policy.allowLoopback || policy.allowPrivate);
  if (kind === 'private') return !!policy.allowPrivate;
  return false;
}

const LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
/**
 * A host a page owner may name for a connection, lowercased, or null: a canonical IPv4 address, an IPv6
 * literal (brackets optional) or a DNS name of two or more labels whose last label starts with a letter, or
 * `localhost`. That refuses the numeric forms getaddrinfo reads as addresses (`2130706433`, `0x7f.1`, `127.1`,
 * `1.0x7f`, `010.0.0.1`) before any lookup. Syntax only: the resolved addresses are judged separately.
 */
export function hostNameSyntax(raw: string): string | null {
  if (typeof raw !== 'string' || raw.length > 253) return null;
  let host = raw.toLowerCase();
  if (host.startsWith('[') && host.endsWith(']')) host = host.slice(1, -1);
  if (parseIPv4(host)) return host;
  if (host.includes(':')) return parseIPv6(host) ? host : null;
  if (host.endsWith('.')) host = host.slice(0, -1);
  if (host === 'localhost') return host;
  const labels = host.split('.');
  if (labels.length < 2 || !labels.every((label) => LABEL.test(label))) return null;
  return /^[a-z]/.test(labels.at(-1)!) ? host : null;
}
