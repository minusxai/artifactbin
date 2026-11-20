/** Naming and clearing of retired ownership cookies; general cookie parsing. */
const AGENT_COOKIE = 'mx-agent-session';

export function cookieName(secure: boolean): string {
  return secure ? `__Host-${AGENT_COOKIE}` : AGENT_COOKIE;
}
