/** Naming and clearing of retired ownership cookies; general cookie parsing. */
const AGENT_COOKIE = 'mx-agent-session';

export function cookieName(secure: boolean): string {
  return secure ? `__Host-${AGENT_COOKIE}` : AGENT_COOKIE;
}

export function clearCookieHeader(secure: boolean): string {
  return `${cookieName(secure)}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure ? '; Secure' : ''}`;
}

export function readCookie(header: string | null, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return v.join('=');
  }
  return undefined;
}
