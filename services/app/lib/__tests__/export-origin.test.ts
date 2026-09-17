/**
 * THE EXPORT BROWSER REACHES THIS PROCESS, NOT ITS PUBLIC NAME.
 *
 * `/a/<id>/export` drives a headless browser at this same server. It was
 * pointed at the host the CALLER used, so the screenshot went out through
 * public DNS, TLS and whatever proxy is in front, and came back in — and any
 * certificate that browser does not trust ends the render. Measured behind a
 * TLS reverse proxy: `net::ERR_CERT_AUTHORITY_INVALID`, every export a 500,
 * and (before the log below it) nothing anywhere saying why. A self-signed or
 * internal-CA deployment is the ordinary self-host case.
 *
 * So the default is internal, and `EXPORT__INTERNAL_ORIGIN` stays the override
 * a deployment needs when the browser is somewhere else (BROWSER__SERVICE_URL),
 * where the origin must resolve from THAT machine.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => { vi.unstubAllEnvs(); vi.resetModules(); });

async function origin(env: Record<string, string>): Promise<string | undefined> {
  vi.resetModules();
  for (const [k, v] of Object.entries(env)) vi.stubEnv(k, v);
  return (await import('@/lib/config')).EXPORT_INTERNAL_ORIGIN;
}

describe('where the export browser is sent', () => {
  it('defaults to this process on this host', async () => {
    expect(await origin({ APP__PORT: '3456', APP__PUBLIC_BASE_URL: 'https://artifactbin.dev' })).toBe('http://127.0.0.1:3456');
  });

  it('takes the explicit origin when the browser lives elsewhere', async () => {
    expect(await origin({ 'EXPORT__INTERNAL_ORIGIN': 'http://app.internal:3000' })).toBe('http://app.internal:3000');
  });

  it.each(['', '   '])('uses the local port when the override is blank (%j)', async (value) => {
    const base = await origin({ APP__PORT: '3040', EXPORT__INTERNAL_ORIGIN: value });
    expect(new URL('/a/example/raw?chrome=0', base).toString()).toBe('http://127.0.0.1:3040/a/example/raw?chrome=0');
  });

  it('never falls back to the public name', async () => {
    const url = await origin({ APP__PUBLIC_BASE_URL: 'https://artifactbin.dev' });
    expect(url).toBeTruthy();
    expect(url).not.toContain('artifactbin.dev');
  });
});
