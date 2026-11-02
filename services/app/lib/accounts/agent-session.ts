/** Clear the retired ownership cookie at sign-out without reading or authenticating it. */
import { cookieName, clearCookieHeader } from '@artifactbin/utils';
import { PUBLIC_BASE_URL } from '@/lib/platform';

const SECURE_COOKIE = PUBLIC_BASE_URL.startsWith('https://');
export const AGENT_COOKIE = cookieName(SECURE_COOKIE);
export function agentSessionClearCookie(): string {
  return clearCookieHeader(SECURE_COOKIE);
}
