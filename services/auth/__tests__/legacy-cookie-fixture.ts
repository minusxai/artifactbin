import { createHmac } from 'node:crypto';
/** Historical input fixture; production no longer reads this wire format. */
export function encodeAgentSession(session: { tokenIds: string[]; sessionId?: string }, secret: string): string {
  const payload = Buffer.from(JSON.stringify(session)).toString('base64url');
  return `${payload}.${createHmac('sha256', `agent:${secret}`).update(payload).digest('base64url')}`;
}
export const setCookieHeader = (value: string, secure: boolean) => `${secure ? '__Host-' : ''}mx-agent-session=${value}; Path=/; HttpOnly`;
