/**
 * NODE NEVER ASKS A RESOLVER FOR A LOCAL ORIGIN.
 *
 * `afbin serve`, the dev server and the gates' servers are addressed by name — `app.lvh.me` and the documents'
 * own origins `<hex id>.lvh.me`, or a name under `localhost` — and browsers resolve those themselves. Node does
 * not: `fetch` (undici) and `http` ask `dns.lookup`, which asks the system resolver, which asks public DNS for
 * `lvh.me` (and, in a container without systemd-resolved, cannot answer `*.localhost` at all). Offline, or on a
 * resolver that stalls, a CLI talking to the server on this machine fails with a connect timeout (PR #662).
 *
 * `loopbackLookup` asks the resolver it wraps first, even for the loopback names (contracts `isLoopbackName`):
 * a hosts file or a container's own mapping (a hosted agent's `app.lvh.me` is the HOST, not the container) must
 * win. Only when the resolver cannot answer one of those names — an error, no address, or no answer within
 * `RESOLVER_WAIT_MS` (a stalled resolver) — does it answer loopback itself, IPv4 first, then IPv6, as `net`'s
 * family selection tries them. Every other name is the wrapped resolver's, unchanged. `useLoopbackLookup` installs it as `dns.lookup`, which `net` (and so `http`, `https` and `fetch`)
 * reads on every connection: each Node entry point (the CLI, the app server, the gate tooling) calls it once,
 * first thing, so every HTTP client in the process shares the one answer.
 */
import dns from 'node:dns';
import { isLoopbackName } from '@artifactbin/contracts/loopback-names';

type LookupCallback = (error: NodeJS.ErrnoException | null, address?: string | dns.LookupAddress[], family?: number) => void;
const INSTALLED = Symbol.for('artifactbin.loopbackLookup');

const LOOPBACK: readonly dns.LookupAddress[] = [{ address: '127.0.0.1', family: 4 }, { address: '::1', family: 6 }];
/** How long a loopback name waits on the resolver before loopback answers instead (a hosts file answers at once). */
export const RESOLVER_WAIT_MS = 1500;

/** The requested family as a number (0 for either), from every shape `dns.lookup` accepts. */
function familyOf(options: unknown): number {
  const family = typeof options === 'number' ? options : (options as dns.LookupOptions | undefined)?.family;
  return family === 4 || family === 'IPv4' ? 4 : family === 6 || family === 'IPv6' ? 6 : 0;
}

/** A `dns.lookup` that asks `fallback` first and answers the loopback names itself only when it cannot. */
export function loopbackLookup(fallback: typeof dns.lookup = dns.lookup, waitMs = RESOLVER_WAIT_MS): typeof dns.lookup {
  const lookup = (hostname: string, options: unknown, callback?: unknown): void => {
    const done = (typeof options === 'function' ? options : callback) as LookupCallback;
    const opts = typeof options === 'function' ? undefined : options;
    if (typeof hostname !== 'string' || !isLoopbackName(hostname)) {
      (fallback as (...args: unknown[]) => void).call(dns, hostname, ...(typeof options === 'function' ? [options] : [options, callback]));
      return;
    }
    let settled = false;
    const loopback = (): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      const family = familyOf(opts);
      const answers = LOOPBACK.filter((answer) => !family || answer.family === family);
      if ((opts as dns.LookupOptions | undefined)?.all) done(null, answers);
      else done(null, answers[0]!.address, answers[0]!.family);
    };
    const timer = setTimeout(loopback, waitMs);
    timer.unref?.();
    const resolved: LookupCallback = (error, address, family) => {
      if (settled) return;
      if (error || address === undefined || (Array.isArray(address) && address.length === 0)) { loopback(); return; }
      settled = true;
      clearTimeout(timer);
      done(null, address, family);
    };
    (fallback as (...args: unknown[]) => void).call(dns, hostname, ...(opts === undefined ? [resolved] : [opts, resolved]));
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
