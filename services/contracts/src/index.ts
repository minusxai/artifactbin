/**
 * @artifactbin/contracts is entered by topic: each file here is its own entry (`@artifactbin/contracts/<file>`, the
 * package's `./*` export), so a caller names the one contract it speaks. This root entry is the seam every service
 * shares: who is calling (the actor and its header), a part and the upstream it mounts over, a queryable database,
 * and the headers a forwarding proxy and a calling service set.
 */
export { ACTOR_HEADER, ANONYMOUS, HUMAN_SESSION_LIVE_PATH, type Actor } from './actor';
export type { Queryable } from './db';
export type { Part, Upstream } from './part';
export { FORWARDED_HOST, FORWARDED_PROTO, SERVICE_AUTH_HEADER } from './routes';
