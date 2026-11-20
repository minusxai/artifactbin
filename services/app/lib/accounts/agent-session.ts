/** Clear the retired ownership cookie at sign-out without reading or authenticating it. */
import { cookieName } from '@artifactbin/utils/agent-session';
import { PUBLIC_BASE_URL } from '@/lib/platform';

function clearCookieHeader(secure: boolean): string {
  return `${cookieName(secure)}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure ? '; Secure' : ''}`;
}

const SECURE_COOKIE = PUBLIC_BASE_URL.startsWith('https://');
export const AGENT_COOKIE = cookieName(SECURE_COOKIE);
export function agentSessionClearCookie(): string {
  return clearCookieHeader(SECURE_COOKIE);
}
