/** P3 (seeded RED) — visibility and access are the OWNER's; an editor's PUT carrying either is refused whole. */
import { describe, expect, it } from 'vitest';
import { request, useAppHarness } from './harness';
import { POST as createRoute } from '@/app/api/artifacts/route';
import { PUT as putRoute } from '@/app/api/artifacts/[id]/route';
import { getArtifactById } from '@/lib/artifacts';
import { getDb } from '@/lib/db';
import { mintToken } from '@/lib/tokens';
import { claimToken, createUser } from '@/lib/users';

useAppHarness();
const params = (id: string) => ({ params: Promise.resolve({ id }) });
async function person(name: string) { const t = await mintToken(name); const u = await createUser({ email: `${name}@example.com` }); await claimToken(u.id, t.token); return { token: t.token, email: `${name}@example.com` }; }

describe('governance on the replace door', () => {
  it('a named editor may replace the content but not the visibility or the access', async () => {
    const owner = await person('owner');
    const editor = await person('editor');
    const r = await createRoute(request('/api/artifacts', { method: 'POST', json: { markup: '<p>v1</p>', visibility: 'private' }, token: owner.token }));
    const { id } = (await r.json()) as { id: string };
    await (await getDb()).query(`INSERT INTO artifact_shares (artifact_id, email, role) VALUES ($1, $2, 'editor')`, [id, editor.email]);
    const ok = await putRoute(request(`/api/artifacts/${id}`, { method: 'PUT', json: { markup: '<p>v2</p>' }, token: editor.token }), params(id));
    expect(ok.status, await ok.clone().text()).toBe(200);
    const refused = await putRoute(request(`/api/artifacts/${id}`, { method: 'PUT', json: { markup: '<p>v3</p>', visibility: 'unlisted' }, token: editor.token }), params(id));
    expect(refused.status).toBe(403);
    expect(((await refused.json()) as { error: string }).error).toBe('owner_only');
    const row = (await getArtifactById(id))!;
    expect(row.visibility).toBe('private');
    expect(row.source).toContain('v2');
    const mine = await putRoute(request(`/api/artifacts/${id}`, { method: 'PUT', json: { markup: '<p>v4</p>', visibility: 'unlisted' }, token: owner.token }), params(id));
    expect(mine.status).toBe(200);
    expect((await getArtifactById(id))!.visibility).toBe('unlisted');
  });
});
