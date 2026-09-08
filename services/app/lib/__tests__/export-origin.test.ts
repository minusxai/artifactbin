/**
 * Capture must address the proxy's admitted canonical host. A default
 * loopback alias was rejected with 421 and photographed as a tiny error page.
 * Internal routing is deployment-owned, never a second browser authority.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => { vi.unstubAllEnvs(); vi.resetModules(); });

async function origin(env: Record<string, string>): Promise<string | undefined> {
  vi.resetModules();
  for (const [k, v] of Object.entries(env)) vi.stubEnv(k, v);
  return (await import('@/lib/config')).EXPORT_INTERNAL_ORIGIN;
}

describe('where the export browser is sent', () => {
  it('defaults to the admitted public authority, not a rejected loopback alias', async () => {
    expect(await origin({ APP__PORT: '3456', APP__PUBLIC_BASE_URL: 'https://artifactbin.dev', EXPORT__INTERNAL_ORIGIN:'' })).toBe('https://artifactbin.dev');
  });

  it('takes the explicit origin when the browser lives elsewhere', async () => {
    expect(await origin({ APP__PUBLIC_BASE_URL:'https://artifactbin.dev', EXPORT__INTERNAL_ORIGIN: 'http://artifactbin.dev' })).toBe('http://artifactbin.dev');
  });

  it.each(['', '   '])('uses the configured public origin when the override is blank (%j)', async (value) => {
    const base = await origin({ APP__PORT: '3040', APP__PUBLIC_BASE_URL:'http://localhost:3040', EXPORT__INTERNAL_ORIGIN: value });
    expect(new URL('/a/example/raw?chrome=0', base).toString()).toBe('http://localhost:3040/a/example/raw?chrome=0');
  });

  it.each(['http://127.0.0.1:3040','http://i.artifactbin.dev','https://artifactbin.dev:444','https://user@artifactbin.dev','https://artifactbin.dev/path','data:text/html,no'])('rejects an override that cannot safely address the admitted host: %s', async value => {
    await expect(origin({APP__PUBLIC_BASE_URL:'https://artifactbin.dev',EXPORT__INTERNAL_ORIGIN:value})).rejects.toThrow('EXPORT__INTERNAL_ORIGIN');
  });
});
