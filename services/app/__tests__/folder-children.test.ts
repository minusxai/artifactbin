/**
 * P1 (seeded RED by the orchestrator) — a folder's children are a TABLE the dataflow reads,
 * computed on the server for ONE viewer. Plan: ~/projects/artifactbin-folders.md.
 */
import { describe, expect, it } from 'vitest';
import { agentCookie, request, useAppHarness } from './harness';
import { POST as createRoute } from '@/app/api/artifacts/route';
import { GET as queryGet, POST as queryPost } from '@/app/a/[id]/query/route';
import { subscribeToArtifact } from '@/lib/story/live';
import { mintToken } from '@/lib/tokens';
import { claimToken, createUser } from '@/lib/users';

useAppHarness();
const params = (id: string) => ({ params: Promise.resolve({ id }) });
const j = async (r: Response) => ({ status: r.status, body: (await r.json()) as Record<string, any> });
async function owner(name = 'owner') {
  const t = await mintToken(name);
  const u = await createUser({ email: `${name}@example.com` });
  await claimToken(u.id, t.token);
  return { token: t.token, tokenId: t.id, cookie: await agentCookie([t.id]) };
}
const create = async (token: string, body: Record<string, unknown>) => {
  const r = await j(await createRoute(request('/api/artifacts', { method: 'POST', json: body, token })));
  expect(r.status, JSON.stringify(r.body)).toBe(201);
  return r.body;
};
const q = JSON.stringify({ values: {}, only: ['children'] });
const anonymous = async (id: string) => j(await queryGet(request(`/a/${id}/query?q=${encodeURIComponent(q)}`), params(id)));
const asOwner = async (id: string, cookie: string) => j(await queryPost(request(`/a/${id}/query`, { method: 'POST', json: { values: {}, only: ['children'] }, cookie, origin: 'same' }), params(id)));

async function world() {
  const o = await owner();
  const f = await create(o.token, { format: 'folder', title: 'Reports', visibility: 'public' });
  const pub = await create(o.token, { markup: '<h1>Board update</h1>', title: 'Board update', visibility: 'public', parent_id: f.id });
  const priv = await create(o.token, { markup: '<h1>Hiring plan</h1>', title: 'Hiring plan', visibility: 'private', parent_id: f.id });
  const sub = await create(o.token, { format: 'folder', title: 'Q3', visibility: 'public', parent_id: f.id });
  return { o, f, pub, priv, sub };
}

describe('the children table', () => {
  it('a stranger on a public folder sees its public children, with no numbers and a thumbnail', async () => {
    const { f, pub, sub } = await world();
    const r = await anonymous(f.id);
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const rows: any[] = r.body.tables.children.rows;
    expect(rows.map((x) => x.id).sort()).toEqual([pub.id, sub.id].sort());
    const doc = rows.find((x) => x.id === pub.id);
    expect(doc).toMatchObject({ title: 'Board update', format: 'markup', level: 1, visibility: 'public', url: `/a/${pub.id}` });
    expect(doc.thumbnail).toContain(`/a/${pub.id}/export`);
    expect(doc.views).toBeNull();
    expect(doc.sparkline).toBeNull();
    expect(rows.find((x) => x.id === sub.id)).toMatchObject({ format: 'folder', thumbnail: null });
  });

  it('the owner sees every child, with view counts and a sparkline, and no thumbnail for a private one', async () => {
    const { o, f, pub, priv, sub } = await world();
    const r = await asOwner(f.id, o.cookie);
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const rows: any[] = r.body.tables.children.rows;
    expect(rows.map((x) => x.id).sort()).toEqual([pub.id, priv.id, sub.id].sort());
    const p = rows.find((x) => x.id === priv.id);
    expect(p.thumbnail).toBeNull();
    expect(typeof p.views).toBe('number');
    expect(typeof p.sparkline).toBe('string');
    expect(typeof rows.find((x) => x.id === pub.id).views).toBe('number');
  });

  it('a private folder answers the uniform 404 to the anonymous transport and its rows to its owner', async () => {
    const o = await owner();
    const f = await create(o.token, { format: 'folder', title: 'Secret', visibility: 'private' });
    await create(o.token, { markup: '<p>x</p>', parent_id: f.id });
    expect((await anonymous(f.id)).status).toBe(404);
    const mine = await asOwner(f.id, o.cookie);
    expect(mine.status).toBe(200);
    expect(mine.body.tables.children.rows).toHaveLength(1);
  });

  it('a child created under an open folder wakes the folder\'s own channel', async () => {
    const o = await owner();
    const f = await create(o.token, { format: 'folder', title: 'Live' });
    let woke = 0;
    const unsubscribe = await subscribeToArtifact(f.id, () => { woke += 1; });
    try {
      await create(o.token, { markup: '<p>new</p>', parent_id: f.id });
      const until = Date.now() + 5000;
      while (woke === 0 && Date.now() < until) await new Promise((r) => setTimeout(r, 50));
      expect(woke).toBeGreaterThan(0);
    } finally { await unsubscribe(); }
  });
});
