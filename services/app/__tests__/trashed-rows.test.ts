/**
 * P3 (seeded RED) — THE GATE. A trashed row is nonexistent to every public read path. Table-driven,
 * so a new reader is one line here; if a reader bypasses the row-loading seam this goes red.
 */
import { describe, expect, it } from 'vitest';
import { agentCookie, request, useAppHarness } from './harness';
import { POST as createRoute, GET as listRoute } from '@/app/api/artifacts/route';
import { GET as getRoute } from '@/app/api/artifacts/[id]/route';
import { GET as rawRoute } from '@/app/a/[id]/raw/route';
import { GET as pageRoute } from '@/app/api/page/artifact/[id]/route';
import { GET as queryRoute } from '@/app/a/[id]/query/route';
import { GET as exportRoute } from '@/app/a/[id]/export/route';
import { GET as frameRoute } from '@/app/a/[id]/events/frame/route';
import { GET as versionsRoute } from '@/app/api/my/artifacts/[id]/versions/route';
import { GET as mineRoute } from '@/app/api/my/artifacts/[id]/route';
import { GET as sharingRoute } from '@/app/api/my/artifacts/[id]/sharing/route';
import { GET as profileRoute } from '@/app/api/page/profile/[user]/[[...path]]/route';
import { countOpenAnnotations } from '@/lib/annotations';
import { getDb } from '@/lib/db';
import { mintToken } from '@/lib/tokens';
import { claimToken, createUser, ensureUsername } from '@/lib/users';

useAppHarness();
const params = (id: string) => ({ params: Promise.resolve({ id }) });
const q = encodeURIComponent(JSON.stringify({ values: {}, only: ['children'] }));

async function trashedWorld() {
  const t = await mintToken('o');
  const u = await ensureUsername(await createUser({ email: 'o@example.com' }));
  await claimToken(u.id, t.token);
  const cookie = await agentCookie([t.id]);
  const mk = async (body: Record<string, unknown>) => { const r = await createRoute(request('/api/artifacts', { method: 'POST', json: body, token: t.token })); expect(r.status).toBe(201); return (await r.json()) as { id: string }; };
  const folder = await mk({ format: 'folder', title: 'F', visibility: 'public' });
  const doc = await mk({ markup: '<h1>Doc</h1>', title: 'Doc', visibility: 'public', parent_id: folder.id });
  const db = await getDb();
  await db.query(`INSERT INTO annotations (id, artifact_id, body, author_kind, anchor_path, anchor_key, anchor_version, status, created_at, deleted_at)
                  VALUES ('ann_trashed0000000001', $1, 'gone', 'human', '0', 'k', 1, 'open', now(), now())`, [doc.id]).catch(async () => {
    // the annotations shape may differ; the assertion below only needs one trashed annotation row
    await db.query(`INSERT INTO annotations (id, artifact_id, body, author_kind, deleted_at) VALUES ('ann_trashed0000000001', $1, 'gone', 'human', now())`, [doc.id]);
  });
  await db.query('UPDATE artifacts SET deleted_at = now() WHERE id = $1', [doc.id]);
  return { token: t.token, cookie, folder, doc, handle: u.username as string };
}

describe('a trashed row is nonexistent to', () => {
  const READERS: Array<[string, (w: Awaited<ReturnType<typeof trashedWorld>>) => Promise<Response>]> = [
    ['GET /api/artifacts/:id (owner token)', (w) => getRoute(request(`/api/artifacts/${w.doc.id}`, { token: w.token }), params(w.doc.id))],
    ['GET /api/my/artifacts/:id (owner cookie)', (w) => mineRoute(request(`/api/my/artifacts/${w.doc.id}`, { cookie: w.cookie }), params(w.doc.id))],
    ['GET /a/:id/raw (anonymous, public doc)', (w) => rawRoute(request(`/a/${w.doc.id}/raw`), params(w.doc.id))],
    ['GET /a/:id/raw (owner cookie)', (w) => rawRoute(request(`/a/${w.doc.id}/raw`, { cookie: w.cookie }), params(w.doc.id))],
    ['GET /api/page/artifact/:id (owner cookie)', (w) => pageRoute(request(`/api/page/artifact/${w.doc.id}`, { cookie: w.cookie }), params(w.doc.id))],
    ['GET /a/:id/query (anonymous)', (w) => queryRoute(request(`/a/${w.doc.id}/query?q=${q}`), params(w.doc.id))],
    ['GET /a/:id/export (owner token)', (w) => exportRoute(request(`/a/${w.doc.id}/export`, { token: w.token }), params(w.doc.id))],
    ['GET /a/:id/events/frame (anonymous)', (w) => frameRoute(request(`/a/${w.doc.id}/events/frame`), params(w.doc.id))],
    ['GET /api/my/artifacts/:id/versions (owner cookie)', (w) => versionsRoute(request(`/api/my/artifacts/${w.doc.id}/versions`, { cookie: w.cookie }), params(w.doc.id))],
    ['GET /api/my/artifacts/:id/sharing (owner cookie)', (w) => sharingRoute(request(`/api/my/artifacts/${w.doc.id}/sharing`, { cookie: w.cookie }), params(w.doc.id))],
  ];
  for (const [name, call] of READERS) {
    it(`${name} → 404`, async () => {
      const w = await trashedWorld();
      expect((await call(w)).status).toBe(404);
    });
  }

  it('the owner list and the folder\'s children table omit it', async () => {
    const w = await trashedWorld();
    const list = (await (await listRoute(request('/api/artifacts', { token: w.token }))).json()) as { artifacts: Array<{ id: string }> };
    expect(list.artifacts.map((a) => a.id)).not.toContain(w.doc.id);
    const children = (await (await queryRoute(request(`/a/${w.folder.id}/query?q=${q}`), params(w.folder.id))).json()) as { tables?: { children?: { rows: Array<{ id: string }> } } };
    expect((children.tables?.children?.rows ?? []).map((r) => r.id)).not.toContain(w.doc.id);
  });

  it('the public profile listing omits it, and its pretty URL falls through to the listing', async () => {
    const w = await trashedWorld();
    const profileParams = (path?: string) => ({ params: Promise.resolve({ user: `@${w.handle}`, ...(path ? { path } : {}) }) });
    const listing = (await (await profileRoute(request(`/@${w.handle}`), profileParams())).json()) as { files?: Array<{ id: string }> };
    expect((listing.files ?? []).map((f) => f.id)).not.toContain(w.doc.id);
    // Id-anchored resolution asks the same seam, so a trashed id is exactly as
    // unknown as one that never existed: the uniform 404, never a redirect.
    const addressed = await profileRoute(request(`/@${w.handle}/${w.doc.id}-doc`), profileParams(`${w.doc.id}-doc`));
    expect(addressed.status).toBe(404);
  });

  it('a trashed annotation is not counted', async () => {
    const w = await trashedWorld();
    expect(await countOpenAnnotations(w.doc.id)).toBe(0);
  });
});
