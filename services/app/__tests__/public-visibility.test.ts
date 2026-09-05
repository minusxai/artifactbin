/**
 * `public` IS A SETTING A DEPLOYMENT OPENS, AND IT HAS TO ACTUALLY BE ONE.
 *
 * The doors are closed by default so a self-hoster who changes nothing is safe
 * — anonymous minting at 0, and `public` behind `ARTIFACTS__ALLOW_PUBLIC=1`.
 * `ALLOW_PUBLIC_VISIBILITY` existed, was documented, and was read by NOTHING:
 * every deployment allowed public documents, including the listing on a public
 * profile, whatever its env said. A default that only the documentation
 * enforces is not a default.
 *
 * Two behaviours, deliberately different. An EXPLICIT ask is refused by name
 * (`public_not_enabled`), the way `private` without an account is — an agent
 * that asked for public and silently got something else would publish a link
 * believing something untrue about who can find it. The anonymous DEFAULT
 * falls to `unlisted` instead, because there is nothing to refuse: nobody
 * asked, and the two differ only in profile listing, which an ownerless
 * document never had.
 */
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useAppHarness } from '@/__tests__/harness';

useAppHarness();



const BASE = 'http://localhost:3000';
/** The wide-open policy file: this suite is about visibility, not about a mint ceiling. */
const DEV_POLICY_FILE = path.resolve(__dirname, '../../proxy/dev_rate_limits.yml');
const SECRET = 'test-secret';

/** Re-import the world with the flag in a given state — config reads env at module load. */
async function withPublic(enabled: boolean) {
  vi.resetModules();
  vi.stubEnv('NODE_ENV', 'production');
  vi.stubEnv('ARTIFACTS__ALLOW_PUBLIC', enabled ? '1' : '');
  if (!enabled) delete process.env.ARTIFACTS__ALLOW_PUBLIC;
  vi.stubEnv('PROXY__RATE_LIMIT_CONFIG_FILE', DEV_POLICY_FILE);
  const [{ POST: createArtifact }, { POST: mint }] = await Promise.all([
    import('@/app/api/artifacts/route'),
    import('@/app/api/tokens/route'),
  ]);
  const token = ((await (await mint(new Request(`${BASE}/api/tokens`, {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-shared-secret': SECRET }, body: JSON.stringify({ name: 't' }),
  }))).json()) as { token: string }).token;
  return {
    token,
    create: (body: Record<string, unknown>) => createArtifact(new Request(`${BASE}/api/artifacts`, {
      method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: JSON.stringify(body),
    })),
  };
}
afterEach(() => { vi.unstubAllEnvs(); vi.resetModules(); });

describe('a deployment that has not opened public visibility', () => {
  it('refuses an EXPLICIT public by name, and says which setting opens it', async () => {
    const w = await withPublic(false);
    const res = await w.create({ title: 'p', markup: '<div><p>x</p></div>', visibility: 'public' });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string; hint?: string };
    expect(body.error).toBe('public_not_enabled');
    expect(`${body.hint ?? ''}`).toMatch(/ARTIFACTS__ALLOW_PUBLIC/);
  });

  it('still takes unlisted — "anyone with the link" was never the part behind the setting', async () => {
    const w = await withPublic(false);
    const res = await w.create({ title: 'u', markup: '<div><p>x</p></div>', visibility: 'unlisted' });
    expect(res.status).toBe(201);
    expect((await res.json()).visibility).toBe('unlisted');
  });

  it('lands an anonymous document on unlisted rather than refusing it — nobody asked for public', async () => {
    const w = await withPublic(false);
    const res = await w.create({ title: 'a', markup: '<div><p>x</p></div>' });
    expect(res.status).toBe(201);
    expect((await res.json()).visibility).toBe('unlisted');
  });
});

describe('a deployment that HAS opened it (this suite, and the public one)', () => {
  it('takes public, and an anonymous document is born public as before', async () => {
    const w = await withPublic(true);
    expect((await (await w.create({ title: 'p', markup: '<div><p>x</p></div>', visibility: 'public' })).json()).visibility).toBe('public');
    expect((await (await w.create({ title: 'a', markup: '<div><p>x</p></div>' })).json()).visibility).toBe('public');
  });
});
