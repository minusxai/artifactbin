/**
 * Delete protection: deleting an artifact that other
 * documents reference answers 409 {has_dependents, dependents} — the caller
 * must pass force=true to break the links knowingly (the docs then degrade
 * to their empty fallbacks, pinned in missing-ref tests). Unreferenced
 * artifacts delete as before.
 */
import { describe, expect, it } from 'vitest';
import { DELETE as deleteRoute } from '@/app/api/artifacts/[id]/route';
import { POST as createArtifactRoute } from '@/app/api/artifacts/route';


import { mintToken } from '@/lib/tokens';
import { useAppHarness, request } from '@/__tests__/harness';

useAppHarness();

const BASE = 'http://localhost:3000';

const params = <T extends Record<string, string>>(p: T) => ({ params: Promise.resolve(p) });

async function seedDatasetWithDependent(token: string) {
  const ds = await (
    await createArtifactRoute(
      request('/api/artifacts', { method: 'POST', token: token, json: { title: 'The dataset', dataset: [{ region: 'EU', revenue: 837 }] } }),
    )
  ).json();
  const doc = await (
    await createArtifactRoute(
      request('/api/artifacts', { method: 'POST', token: token, json: { title: 'The doc', markup: `<Helmet><Query name="rows">{\`select * from ref_${ds.id}\`}</Query></Helmet><div data-design="tw" className="p-4"><Question data="$rows" title="Rev" /></div>` } }),
    )
  ).json();
  return { ds, doc };
}

describe('delete protection', () => {
  it('409s a referenced dataset and names the dependents', async () => {
    const t = await mintToken('t');
    const { ds, doc } = await seedDatasetWithDependent(t.token);

    const res = await deleteRoute(request(`/api/artifacts/${ds.id}`, { method: 'DELETE', token: t.token }), params({ id: ds.id }));
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: string; dependents: Array<{ id: string; title: string | null }> };
    expect(body.error).toBe('has_dependents');
    expect(body.dependents.map((d) => d.id)).toEqual([doc.id]);
    expect(body.dependents[0].title).toBe('The doc');
  });

  it('force=true deletes anyway (the informed break)', async () => {
    const t = await mintToken('t');
    const { ds } = await seedDatasetWithDependent(t.token);
    const res = await deleteRoute(
      request(`/api/artifacts/${ds.id}?force=true`, { method: 'DELETE', token: t.token }),
      params({ id: ds.id }),
    );
    expect(res.status).toBe(200);
    expect(((await res.json()) as { ok: boolean }).ok).toBe(true);
  });

  it('unreferenced artifacts delete without ceremony', async () => {
    const t = await mintToken('t');
    const ds = await (
      await createArtifactRoute(request('/api/artifacts', { method: 'POST', token: t.token, json: { dataset: [{ a: 1 }] } }))
    ).json();
    const res = await deleteRoute(request(`/api/artifacts/${ds.id}`, { method: 'DELETE', token: t.token }), params({ id: ds.id }));
    expect(res.status).toBe(200);
  });

  it('deleting the DOCUMENT (a dependent, not a dependency) needs no force', async () => {
    const t = await mintToken('t');
    const { doc } = await seedDatasetWithDependent(t.token);
    const res = await deleteRoute(request(`/api/artifacts/${doc.id}`, { method: 'DELETE', token: t.token }), params({ id: doc.id }));
    expect(res.status).toBe(200);
  });
});
