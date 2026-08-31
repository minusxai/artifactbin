/**
 * ANONYMOUS MINTING IS CLOSED BY DEFAULT — the one door only a STRANGER uses,
 * so a self-hoster who changes nothing has it shut; the public deployment
 * opens it explicitly (`RATE_LIMITER__ANON_MINT_MAX`). Development relaxes
 * it so a gate run cannot exhaust it, and the test suite pins the public
 * deployment's shape from vitest.config.ts. There is ONE spelling of the
 * setting — see lib/__tests__/env-namespacing.test.ts.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';

async function loadConfig(nodeEnv: string, env: Record<string, string | undefined> = {}) {
  vi.resetModules();
  vi.stubEnv('NODE_ENV', nodeEnv);
  for (const k of ['ANON_MINT_MAX', 'RATE_LIMITER__ANON_MINT_MAX']) {
    if (env[k] === undefined) { vi.stubEnv(k, ''); delete process.env[k]; } else vi.stubEnv(k, env[k]!);
  }
  return import('@/lib/config');
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe('ANON_MINT_MAX default by environment', () => {
  it('is CLOSED (0) in production unless the deployment opens it', async () => {
    const { ANON_MINT_MAX } = await loadConfig('production');
    expect(ANON_MINT_MAX).toBe(0);
  });

  it('is relaxed under `next dev` so a gate run cannot exhaust it', async () => {
    const { ANON_MINT_MAX } = await loadConfig('development');
    expect(ANON_MINT_MAX).toBeGreaterThanOrEqual(1000);
  });

  it('an explicit namespaced value wins, in development and production', async () => {
    expect((await loadConfig('development', { RATE_LIMITER__ANON_MINT_MAX: '3' })).ANON_MINT_MAX).toBe(3);
    expect((await loadConfig('production', { RATE_LIMITER__ANON_MINT_MAX: '25' })).ANON_MINT_MAX).toBe(25);
  });

});

describe('TRUSTED_PROXY_HOPS', () => {
  it('defaults to one proxy, the shape docker-compose.yml documents', async () => {
    const { TRUSTED_PROXY_HOPS } = await loadConfig('production');
    expect(TRUSTED_PROXY_HOPS).toBe(1);
  });
});
