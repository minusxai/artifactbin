/**
 * NODE NEVER ASKS A RESOLVER FOR A LOCAL ORIGIN.
 *
 * `afbin serve`, the dev server and the gates' servers are addressed by name — `app.lvh.me` and the documents'
 * own origins `<hex id>.lvh.me`, or a name under `localhost` — and browsers resolve those themselves. Node does
 * not: `fetch` (undici) and `http` ask `dns.lookup`, which asks the system resolver, which asks public DNS for
 * `lvh.me` (and, in a container without systemd-resolved, cannot answer `*.localhost` at all). Offline, or on a
 * resolver that stalls, a CLI talking to the server on this machine fails with a connect timeout (PR #662).
 *
 * `loopbackLookup` answers the loopback names (contracts `isLoopbackName`) with loopback — IPv4 first, then
 * IPv6, as `net`'s family selection tries them — and hands every other name to the resolver it wraps,
 * unchanged. `useLoopbackLookup` installs it as `dns.lookup`, which `net` (and so `http`, `https` and `fetch`)
 * reads on every connection: each Node entry point (the CLI, the app server, the gate tooling) calls it once,
 * first thing, so every HTTP client in the process shares the one answer.
 *
 * A loopback name the machine's hosts file maps ELSEWHERE is the machine's own answer, not ours: a container routes
 * `app.lvh.me` to its host with `extra_hosts` (the server repo's runner boxes reach the proxy that way), and
 * loopback there is the container itself. Those names go to the resolver, which reads the hosts file locally,
 * so they still answer offline. A name the file maps to loopback (`localhost` in every hosts file) keeps this
 * answer: the same address, and the SSRF guards that refuse loopback see it without asking a resolver.
 */
import dns from 'node:dns';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { isLoopbackName } from '@artifactbin/contracts/loopback-names';

type LookupCallback = (error: NodeJS.ErrnoException | null, address?: string | dns.LookupAddress[], family?: number) => void;
const INSTALLED = Symbol.for('artifactbin.loopbackLookup');

const LOOPBACK: readonly dns.LookupAddress[] = [{ address: '127.0.0.1', family: 4 }, { address: '::1', family: 6 }];

/** The requested family as a number (0 for either), from every shape `dns.lookup` accepts. */
function familyOf(options: unknown): number {
  const family = typeof options === 'number' ? options : (options as dns.LookupOptions | undefined)?.family;
  return family === 4 || family === 'IPv4' ? 4 : family === 6 || family === 'IPv6' ? 6 : 0;
}

/** This machine's hosts file: `/etc/hosts`, or Windows' under `%SystemRoot%`. */
const HOSTS_FILE = process.platform === 'win32'
  ? path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'drivers', 'etc', 'hosts')
  : '/etc/hosts';

/** A loopback address: 127.0.0.0/8 or ::1 (as a hosts file spells them). */
const isLoopbackAddress = (address: string): boolean => /^127\./.test(address) || address === '::1' || address === '0:0:0:0:0:0:0:1';

/**
 * The names a hosts file maps to an address other than loopback (lowercased), or none when it cannot be read: a
 * name it maps to loopback is answered the same way here, so only the others are the file's to answer.
 */
export function hostsFileNames(file: string = HOSTS_FILE): ReadonlySet<string> {
  let text = '';
  try { text = readFileSync(file, 'utf8'); } catch { return new Set(); }
  const names = new Set<string>();
  for (const line of text.split(/\r?\n/)) {
    const [address, ...aliases] = line.replace(/#.*/, '').trim().split(/\s+/);
    if (!address || isLoopbackAddress(address)) continue;
    for (const name of aliases) if (name) names.add(name.toLowerCase());
  }
  return names;
}

/** Whether this machine's hosts file maps `hostname` elsewhere; the file is read once, on the first loopback name. */
let listedNames: ReadonlySet<string> | undefined;
const listedInHostsFile = (hostname: string): boolean => (listedNames ??= hostsFileNames()).has(hostname.toLowerCase());

/**
 * A `dns.lookup` that answers the loopback names itself and asks `fallback` for every other name, and for a loopback
 * name `listed` says the hosts file maps.
 */
export function loopbackLookup(fallback: typeof dns.lookup = dns.lookup, listed: (hostname: string) => boolean = listedInHostsFile): typeof dns.lookup {
  const lookup = (hostname: string, options: unknown, callback?: unknown): void => {
    const done = (typeof options === 'function' ? options : callback) as LookupCallback;
    if (typeof hostname !== 'string' || !isLoopbackName(hostname) || listed(hostname)) {
      (fallback as (...args: unknown[]) => void).call(dns, hostname, ...(typeof options === 'function' ? [options] : [options, callback]));
      return;
    }
    const family = familyOf(typeof options === 'function' ? undefined : options);
    const answers = LOOPBACK.filter((answer) => !family || answer.family === family);
    if ((options as dns.LookupOptions | undefined)?.all) process.nextTick(done, null, answers);
    else process.nextTick(done, null, answers[0]!.address, answers[0]!.family);
  };
  return lookup as unknown as typeof dns.lookup;
}

/** Install `loopbackLookup` as `dns.lookup`, wrapping whatever it is now; a second call changes nothing. */
export function useLoopbackLookup(): void {
  const current = dns.lookup as typeof dns.lookup & { [INSTALLED]?: true };
  if (current[INSTALLED]) return;
  const installed = Object.assign(loopbackLookup(current), { [INSTALLED]: true as const });
  dns.lookup = installed;
}
