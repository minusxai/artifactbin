/** Legacy cookie clearing follows the scheme so host-only secure cookies are removed correctly. */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cookieName } from '@artifactbin/utils';

afterEach(() => { vi.unstubAllEnvs(); vi.resetModules(); });

/** The app's constant, re-read under a given environment. */
async function appCookieName(nodeEnv: string, baseUrl: string): Promise<string> {
  vi.resetModules();
  vi.stubEnv('NODE_ENV', nodeEnv);
  vi.stubEnv('APP__PUBLIC_BASE_URL', baseUrl);
  return (await import('@/lib/accounts/agent-session')).AGENT_COOKIE;
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

  it('clears the cookie with host-only secure attributes when required', async () => {
    vi.resetModules();
    vi.stubEnv('APP__PUBLIC_BASE_URL', 'https://app.example.test');
    const mod = await import('@/lib/accounts/agent-session');
    expect(mod.agentSessionClearCookie()).toBe('__Host-mx-agent-session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0; Secure');
  });
});
