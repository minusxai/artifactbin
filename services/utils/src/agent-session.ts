/**
 * The agent cookie: a browser holding token IDS (never the secret), signed.
 * The LAST id is the primary — the token a write acts as; earlier ids are
 * still held (what a sign-up may claim) but do not authorize.
 *
 * Moved from packages/proxy/src/agent-cookie.ts (behaviour byte-for-byte);
 * the app's lib/agent-session and the proxy both bind it now.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';
import type { AgentSession } from '@artifactbin/contracts';

export const AGENT_COOKIE = 'mx-agent-session';
export const AGENT_COOKIE_MAX_AGE = 30 * 24 * 60 * 60;

const canonical = (s: AgentSession) => JSON.stringify({ tokenIds: s.tokenIds });
const sig = (payload: string, secret: string) => createHmac('sha256', `agent:${secret}`).update(payload).digest('base64url');

export function encodeAgentSession(session: AgentSession, secret: string): string {
  const payload = Buffer.from(canonical(session)).toString('base64url');
  return `${payload}.${sig(payload, secret)}`;
}

export function decodeAgentSession(value: string | undefined | null, secret: string): AgentSession | null {
  if (!value) return null;
  const dot = value.indexOf('.');
  if (dot <= 0) return null;
  const payload = value.slice(0, dot);
  const a = Buffer.from(value.slice(dot + 1));
  const b = Buffer.from(sig(payload, secret));
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as AgentSession;
    if (!Array.isArray(parsed.tokenIds) || !parsed.tokenIds.every((t) => typeof t === 'string')) return null;
    return { tokenIds: parsed.tokenIds };
  } catch {
    return null;
  }
}

export function withToken(session: AgentSession | null, tokenId: string): AgentSession {
  const ids = (session?.tokenIds ?? []).filter((t) => t !== tokenId);
  return { tokenIds: [...ids, tokenId].slice(-8) };
}

/**
 * The inverse of withToken (tok-p1, reject): drop ONE held id, preserving the order of the rest — the last
 * entry stays the primary. Returns null when nothing remains, which the caller turns into a cleared cookie.
 */
export function withoutToken(session: AgentSession | null, tokenId: string): AgentSession | null {
  const tokenIds = (session?.tokenIds ?? []).filter((id) => id !== tokenId);
  return tokenIds.length ? { tokenIds } : null;
}

export function cookieName(secure: boolean): string {
  return secure ? `__Host-${AGENT_COOKIE}` : AGENT_COOKIE;
}

export function setCookieHeader(value: string, secure: boolean): string {
  return `${cookieName(secure)}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${AGENT_COOKIE_MAX_AGE}${secure ? '; Secure' : ''}`;
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
