/**
 * Per-token quota: creation stops with 403 quota_exceeded
 * at ARTIFACT_QUOTA_PER_TOKEN artifacts; updates/deletes are never blocked
 * (a full token can still fix or clean up its artifacts). The env cap is
 * read through lib/config.ts only; tests drive the check via the injectable
 * override below rather than mutating process.env.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { PUT as putArtifact } from '@/app/api/artifacts/[id]/route';
import { POST as createArtifactRoute } from '@/app/api/artifacts/route';

import { setArtifactQuotaForTests } from '@/lib/artifacts';

import { mintToken } from '@/lib/tokens';
import { useAppHarness, request } from '@/__tests__/harness';

useAppHarness();

const BASE = 'http://localhost:3000';

const params = <T extends Record<string, string>>(p: T) => ({ params: Promise.resolve(p) });

afterEach(() => setArtifactQuotaForTests(null));

describe('per-token artifact quota', () => {
  it('403s creation at the cap; updates still work; another token is unaffected', async () => {
    setArtifactQuotaForTests(2);
    const t = await mintToken('t');
    const first = await (
      await createArtifactRoute(request('/api/artifacts', { method: 'POST', token: t.token, json: { markup: '<p>1</p>' } }))
    ).json();
    await createArtifactRoute(request('/api/artifacts', { method: 'POST', token: t.token, json: { markup: '<p>2</p>' } }));

    const third = await createArtifactRoute(
      request('/api/artifacts', { method: 'POST', token: t.token, json: { markup: '<p>3</p>' } }),
    );
    expect(third.status).toBe(403);
    expect(((await third.json()) as { error: string }).error).toBe('quota_exceeded');

    // A full token can still edit what it has.
    const put = await putArtifact(
      request(`/api/artifacts/${first.id}`, { method: 'PUT', token: t.token, json: { markup: '<p>1b</p>' } }),
      params({ id: first.id }),
    );
    expect(put.status).toBe(200);

    // The cap is per token, not global.
    const other = await mintToken('other');
    const ok = await createArtifactRoute(request('/api/artifacts', { method: 'POST', token: other.token, json: { markup: '<p>x</p>' } }));
    expect(ok.status).toBe(201);
  });

  it('0 disables the check', async () => {
    setArtifactQuotaForTests(0);
    const t = await mintToken('t');
    for (let i = 0; i < 3; i++) {
      const res = await createArtifactRoute(request('/api/artifacts', { method: 'POST', token: t.token, json: { markup: `<p>${i}</p>` } }));
      expect(res.status).toBe(201);
    }
  });
});
