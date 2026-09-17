import {observedRequest} from '@/__tests__/conditional-request';
/** Both observed version and state are required; stale replacements never overwrite the head. */
import { describe, expect, it } from 'vitest';
import { GET as getArtifactRoute, PUT as putArtifact } from '@/app/api/artifacts/[id]/route';
import { GET as listVersionsRoute } from '@/app/api/artifacts/[id]/versions/route';
import { POST as createArtifactRoute } from '@/app/api/artifacts/route';


import { mintToken } from '@/lib/tokens';
import { useAppHarness, request } from '@/__tests__/harness';

useAppHarness();


const params = <T extends Record<string, string>>(p: T) => ({ params: Promise.resolve(p) });

async function createDoc(token: string) {
  const res = await createArtifactRoute(
    request('/api/artifacts', { method: 'POST', token: token, json: { markup: '<h1 className="text-2xl">v1</h1>' } }),
  );
  expect(res.status).toBe(201);
  return (await res.json()) as { id: string; version: number };
}

describe('expectedVersion on PUT', () => {
  it('interleaved edits: stale expectedVersion 409s, replay with the fresh version converges', async () => {
    const t = await mintToken('human');
    const doc = await createDoc(t.token);

    // The "agent" edits first (v1 → v2).
    const agentPut = await putArtifact(
      await observedRequest(`/api/artifacts/${doc.id}`, { method: 'PUT', token: t.token, json: { markup: '<h1 className="text-2xl">agent edit</h1>', expectedVersion: 1 } }),
      params({ id: doc.id }),
    );
    expect(agentPut.status).toBe(200);
    expect(((await agentPut.json()) as { version: number }).version).toBe(2);

    // The "human", still holding v1, saves — stale, must 409 and change nothing.
    const stale = await putArtifact(
      await observedRequest(`/api/artifacts/${doc.id}`, { method: 'PUT', token: t.token, json: { markup: '<h1 className="text-2xl">human edit</h1>', expectedVersion: 1 } }),
      params({ id: doc.id }),
    );
    expect(stale.status).toBe(409);
    const conflict = (await stale.json()) as { error: string; currentVersion: number };
    expect(conflict.error).toBe('version_conflict');
    expect(conflict.currentVersion).toBe(2);

    const unchanged = await getArtifactRoute(request(`/api/artifacts/${doc.id}`, { token: t.token }), params({ id: doc.id }));
    const wire = (await unchanged.json()) as { version: number; markup: string };
    expect(wire.version).toBe(2);
    expect(wire.markup).toContain('agent edit'); // the stale write left no trace

    // Replay against the version the 409 reported → converges as v3.
    const replay = await putArtifact(
      await observedRequest(`/api/artifacts/${doc.id}`, { method: 'PUT', token: t.token, json: { markup: '<h1 className="text-2xl">human edit</h1>', expectedVersion: conflict.currentVersion } }),
      params({ id: doc.id }),
    );
    expect(replay.status).toBe(200);
    expect(((await replay.json()) as { version: number }).version).toBe(3);

    // Both streams are in one history: v1 (create), v2 (agent), head v3 (human).
    const versions = await listVersionsRoute(request(`/api/artifacts/${doc.id}/versions`, { token: t.token }), params({ id: doc.id }));
    const list = (await versions.json()) as { versions: Array<{ version: number }> };
    expect(list.versions.map((v) => v.version).sort()).toEqual([1, 2, 3]);
  });

  it('omitted expectedVersion refuses replacement without changing the head', async () => {
    const t = await mintToken('t');const doc = await createDoc(t.token);
    const res = await putArtifact(request(`/api/artifacts/${doc.id}`, {method:'PUT',token:t.token,json:{markup:'<p>Changed</p>'}}),params({id:doc.id}));
    expect(res.status).toBe(400);expect((await res.json()).error).toBe('version_required');
    const read=await getArtifactRoute(request(`/api/artifacts/${doc.id}`,{token:t.token}),params({id:doc.id}));expect((await read.json()).version).toBe(1);
  });

  it('a non-numeric expectedVersion is a 400, not a silent overwrite', async () => {
    const t = await mintToken('t');
    const doc = await createDoc(t.token);
    const res = await putArtifact(
      await observedRequest(`/api/artifacts/${doc.id}`, { method: 'PUT', token: t.token, json: { markup: '<p className="p-1">x</p>', expectedVersion: 'one' } }),
      params({ id: doc.id }),
    );
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe('invalid_expected_version');
  });
});
