/**
 * ONE COOKIE, ONE NAME — the app and the proxy must agree, or the browser
 * holds a session neither side can read.
 *
 * The proxy SETS this cookie and the app READS it, and they decided its name
 * from different questions: the app from `NODE_ENV`, the proxy from whether
 * the base URL is https. Over https in production they happen to agree. Over
 * HTTP in production they do not — the proxy writes `mx-agent-session` (a
 * `__Host-` cookie cannot exist without Secure) while the app looks for
 * `__Host-mx-agent-session` and finds nothing. That is the README's own
 * self-host default (`http://localhost:3030`), where it cost the whole claim
 * flow: a person published anonymously, signed up, and was never offered
 * their drafts — measured against the built image, silently, because the
 * endpoint answers an empty list rather than an error.
 *
 * The rule is the one the prefix itself imposes: the name follows SECURE.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cookieName } from '@artifactbin/proxy/agent-cookie';

afterEach(() => { vi.unstubAllEnvs(); vi.resetModules(); });

/** The app's constant, re-read under a given environment. */
async function appCookieName(nodeEnv: string, baseUrl: string): Promise<string> {
  vi.resetModules();
  vi.stubEnv('NODE_ENV', nodeEnv);
  vi.stubEnv('APP__PUBLIC_BASE_URL', baseUrl);
  return (await import('@/lib/agent-session')).AGENT_COOKIE;
}

describe('the agent cookie is named by ONE rule', () => {
  it('agrees with the proxy over https in production', async () => {
    expect(await appCookieName('production', 'https://artifactbin.dev')).toBe(cookieName(true));
  });

  it('agrees over HTTP in production — the self-host default', async () => {
    expect(await appCookieName('production', 'http://localhost:3030')).toBe(cookieName(false));
  });

  it('agrees in development', async () => {
    expect(await appCookieName('development', 'http://localhost:3000')).toBe(cookieName(false));
  });

  it('marks the cookie Secure exactly when its name demands it', async () => {
    vi.resetModules();
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('APP__PUBLIC_BASE_URL', 'http://localhost:3030');
    const mod = await import('@/lib/agent-session');
    expect(mod.AGENT_COOKIE.startsWith('__Host-')).toBe(false);
    expect(mod.agentCookieOptions().secure).toBe(false);

    vi.resetModules();
    vi.stubEnv('APP__PUBLIC_BASE_URL', 'https://artifactbin.dev');
    const secure = await import('@/lib/agent-session');
    expect(secure.AGENT_COOKIE.startsWith('__Host-')).toBe(true);
    expect(secure.agentCookieOptions().secure).toBe(true);
  });
});
