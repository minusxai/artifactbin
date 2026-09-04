/**
 * P1 (seeded RED by the orchestrator) — a folder's children are a TABLE the dataflow reads,
 * computed on the server for ONE viewer. Plan: ~/projects/artifactbin-folders.md.
 */
import { describe, expect, it } from 'vitest';
import { agentCookie, request, useAppHarness } from './harness';
import { POST as createRoute } from '@/app/api/artifacts/route';
import { GET as queryGet, POST as queryPost } from '@/app/a/[id]/query/route';
import { getArtifactById, updateSharing } from '@/lib/artifacts';
import { childrenTableFor } from '@/lib/folders';
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
  return { token: t.token, tokenId: t.id, userId: u.id, cookie: await agentCookie([t.id]) };
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
  // UNLISTED means listed nowhere: readable by link, absent from every listing a stranger sees.
  const quiet = await create(o.token, { markup: '<h1>Quiet</h1>', title: 'Quiet', visibility: 'unlisted', parent_id: f.id });
  return { o, f, pub, priv, sub, quiet };
}

describe('the children table', () => {
  it('a stranger on a public folder sees its PUBLIC children only (never unlisted, never private), with no numbers and a thumbnail', async () => {
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
    const { o, f, pub, priv, sub, quiet } = await world();
    const r = await asOwner(f.id, o.cookie);
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const rows: any[] = r.body.tables.children.rows;
    expect(rows.map((x) => x.id).sort()).toEqual([pub.id, priv.id, sub.id, quiet.id].sort());
    expect(rows.find((x) => x.id === quiet.id).thumbnail).toContain(`/a/${quiet.id}/export`);
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

  /*
   * THE OWNER MAY BE A TOKEN, NOT AN ACCOUNT. `sessionActor` answers an account
   * session as a `viewer` and the AGENT COOKIE as a bare `tokenId`, so a route
   * that threads only the viewer hands an ANONYMOUS owner the stranger's view
   * of their own listing — no private children, no counts. Found on the dev
   * walk, where every artifact belongs to an unclaimed token.
   */
  it('an anonymous owner sees their OWN folder through the agent cookie: the numbers, which a stranger never gets', async () => {
    const t = await mintToken('bare');
    const cookie = await agentCookie([t.id]);
    const f = await create(t.token, { format: 'folder', title: 'Mine', visibility: 'unlisted' });
    // One PUBLIC child, so the two viewers see the same row and the only thing
    // that differs is the numbers — which is what this test is about — and one
    // UNLISTED beside it, because an anonymous owner's shelf obeys the listing
    // rule like everyone else's.
    const child = await create(t.token, { markup: '<p>open</p>', title: 'Open', visibility: 'public', parent_id: f.id });
    const quiet = await create(t.token, { markup: '<p>quiet</p>', title: 'Quiet', visibility: 'unlisted', parent_id: f.id });

    const mine = await asOwner(f.id, cookie);
    expect(mine.status, JSON.stringify(mine.body)).toBe(200);
    const rows: any[] = mine.body.tables.children.rows;
    expect(rows.map((x) => x.id).sort()).toEqual([child.id, quiet.id].sort());
    const open = rows.find((x) => x.id === child.id);
    expect(typeof open.views).toBe('number');
    expect(typeof open.sparkline).toBe('string');

    // The anonymous transport is a stranger on the same folder: the PUBLIC row
    // only, and none of the owner's numbers.
    const theirs = await anonymous(f.id);
    expect(theirs.status).toBe(200);
    const strangerRows: any[] = theirs.body.tables.children.rows;
    expect(strangerRows.map((x) => x.id)).toEqual([child.id]);
    expect(strangerRows[0].views).toBeNull();
    expect(strangerRows[0].sparkline).toBeNull();
  });

  /*
   * The BOUNDARY of the read fast path: the listing asks the LINK first and
   * only pays for a share lookup on a row the link does not already open
   * (lib/folders). That is exact — `maxRole` can only raise, and the anonymous
   * ceiling is `viewer`, the rank the read question asks for — and this is the
   * case that would break if it were ever approximated the other way: a
   * private child the link refuses, which a named person must still see.
   */
  it('a person named on a private child sees it in the listing; a signed-in stranger does not', async () => {
    const { o, f, pub, priv, sub } = await world();
    const guest = await createUser({ email: 'guest@example.com' });
    const bystander = await createUser({ email: 'bystander@example.com' });
    await updateSharing(o.userId, priv.id, { shares: [{ email: 'guest@example.com', role: 'viewer' }] });
    const folder = (await getArtifactById(f.id))!;
    const seen = async (u: { id: string; email: string }) =>
      (await childrenTableFor(folder, { userId: u.id, tokenId: null, email: u.email })).rows.map((r) => r.id).sort();
    expect(await seen(guest)).toEqual([priv.id, pub.id, sub.id].sort());
    expect(await seen(bystander)).toEqual([pub.id, sub.id].sort());
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
