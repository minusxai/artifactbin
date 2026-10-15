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
 */
import dns from 'node:dns';
import { isLoopbackName } from '@artifactbin/contracts/loopback-names';

type LookupCallback = (error: NodeJS.ErrnoException | null, address?: string | dns.LookupAddress[], family?: number) => void;
const INSTALLED = Symbol.for('artifactbin.loopbackLookup');

const LOOPBACK: readonly dns.LookupAddress[] = [{ address: '127.0.0.1', family: 4 }, { address: '::1', family: 6 }];

/** The requested family as a number (0 for either), from every shape `dns.lookup` accepts. */
function familyOf(options: unknown): number {
  const family = typeof options === 'number' ? options : (options as dns.LookupOptions | undefined)?.family;
  return family === 4 || family === 'IPv4' ? 4 : family === 6 || family === 'IPv6' ? 6 : 0;
}

/** A `dns.lookup` that answers the loopback names itself and asks `fallback` for every other name. */
export function loopbackLookup(fallback: typeof dns.lookup = dns.lookup): typeof dns.lookup {
  const lookup = (hostname: string, options: unknown, callback?: unknown): void => {
    const done = (typeof options === 'function' ? options : callback) as LookupCallback;
    if (typeof hostname !== 'string' || !isLoopbackName(hostname)) {
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
