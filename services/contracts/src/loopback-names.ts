/**
 * THE LOOPBACK NAMES: hostnames that mean "this machine" without asking anyone. `localhost` and every
 * name under it are reserved for loopback (RFC 6761: browsers resolve them themselves), and `lvh.me` and
 * every name under it answer 127.0.0.1 in public DNS — development's app and pages host
 * (`app.lvh.me`, `<hex id>.lvh.me`), which a machine without a network cannot look up.
 *
 * Every Node HTTP client resolves these names to loopback itself (utils/node/loopback-lookup), the auth
 * service serves their login codes from the local outbox, and the origin rule accepts them over plain
 * HTTP (server-identity `isLocalDevelopmentHost`). Import-free, so plain Node (the gate scripts) loads it.
 *
 * Takes a hostname as `URL.hostname` spells it (any case is accepted: a resolver may be handed one as typed).
 * Address literals are not names: `127.0.0.1` and `[::1]` are matched where an address is meant.
 */
export function isLoopbackName(hostname: string): boolean {
  const name = hostname.toLowerCase();
  return name === 'localhost' || name === 'lvh.me'
    || ((name.endsWith('.localhost') || name.endsWith('.lvh.me')) && !name.startsWith('.'));
}
