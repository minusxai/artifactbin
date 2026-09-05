/**
 * P3 (seeded RED) — THE GATE. A trashed row is nonexistent to every public read path. Table-driven,
 * so a new reader is one line here; if a reader bypasses the row-loading seam this goes red.
 */
import { describe, expect, it } from 'vitest';
import { ensureTable } from '@artifactbin/utils';
import { EVENTS_TABLES } from '@artifactbin/events';
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
import { GET as likeRoute } from '@/app/api/my/artifacts/[id]/like/route';
import { GET as homeRoute } from '@/app/api/page/home/route';
import { countOpenAnnotations } from '@/lib/annotations';
import { EVENTS_SCHEMA } from '@/lib/config';
import { getDb } from '@/lib/db';
import { dailyViewsByUser, decorateFeed, followFeed, ownerFeed, viewSeriesByUser } from '@/lib/feed';
import { link } from '@/lib/relations';
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
  return { token: t.token, cookie, folder, doc, handle: u.username as string, userId: u.id };
}

/** The log, with one sentence about the trashed document and one about the folder that outlived it. */
async function withLog(w: Awaited<ReturnType<typeof trashedWorld>>) {
  const db = await getDb();
  await db.query(`CREATE SCHEMA IF NOT EXISTS ${EVENTS_SCHEMA}`);
  await ensureTable(db, EVENTS_TABLES, { schema: EVENTS_SCHEMA });
  const say = async (id: string, verb: string, objectId: string, subject: [string, string]) =>
    db.query(
      `INSERT INTO ${EVENTS_SCHEMA}.events (id, at, source, subject_kind, subject_id, verb, object_kind, object_id, payload)
       VALUES ($1, now(), 'app', $2, $3, $4, 'artifact', $5, '{}'::jsonb) ON CONFLICT (id) DO NOTHING`,
      [id, subject[0], subject[1], verb, objectId],
    );
  await say('t1', 'viewed', w.doc.id, ['visitor', 'v'.repeat(32)]);
  await say('t2', 'created', w.doc.id, ['user', w.userId]);
  await say('t3', 'liked', w.doc.id, ['user', w.userId]);
  await say('t4', 'viewed', w.folder.id, ['visitor', 'w'.repeat(32)]);
  await say('t5', 'created', w.folder.id, ['user', w.userId]);
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
    // The like door reads the row through the same seam before it answers, so
    // a trashed document has no likes to ask about — including for its owner.
    ['GET /api/my/artifacts/:id/like (owner cookie)', (w) => likeRoute(request(`/api/my/artifacts/${w.doc.id}/like`, { cookie: w.cookie }), params(w.doc.id))],
    ['GET /api/my/artifacts/:id/like (anonymous, public doc)', (w) => likeRoute(request(`/api/my/artifacts/${w.doc.id}/like`), params(w.doc.id))],
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

  /*
   * THE LOG'S READERS. lib/feed builds its own SQL — every query joins
   * `artifacts`, and none of them comes through the row-loading seam — so each
   * one names the gate itself. Without that a trashed document keeps
   * narrating itself on its owner's dashboard, keeps its views in the
   * sparkline totals, and keeps its title in every follower's feed.
   */
  it('the owner feed omits its events and keeps the folder that outlived it', async () => {
    const w = await trashedWorld();
    await withLog(w);
    const feed = await ownerFeed(w.userId);
    // Containment, not an exact list: the suite runs the REAL events writer
    // (test/setup), so the fixture's own creates land in this table too — and
    // fire-and-forget, so WHEN they land is not this test's business.
    expect(feed.map((e) => e.object_id)).not.toContain(w.doc.id);
    expect(feed.map((e) => e.id)).toEqual(expect.arrayContaining(['t4', 't5']));
  });

  it('the follow feed never carries it, however public it was', async () => {
    const w = await trashedWorld();
    await withLog(w);
    const follower = await createUser({ email: 'mxmx_test_trash_follower@example.com' });
    await link(follower.id, 'follow', w.userId);
    const feed = await followFeed(follower.id);
    expect(feed.map((e) => e.object_id)).not.toContain(w.doc.id);
    expect(feed.map((e) => e.id)).toContain('t5');
  });

  it('the view series and the daily totals do not count its views', async () => {
    const w = await trashedWorld();
    await withLog(w);
    const keys = [...(await viewSeriesByUser(w.userId)).keys()];
    expect(keys).not.toContain(w.doc.id);
    expect(keys).toContain(w.folder.id);
    const daily = await dailyViewsByUser(w.userId);
    expect(daily.at(-1)?.views, 'the folder\'s view, never the trashed document\'s').toBe(1);
  });

  it('decoration does not hand back its title either', async () => {
    const w = await trashedWorld();
    const [item] = await decorateFeed([
      { id: 'x', at: new Date().toISOString(), source: 'app', subject_kind: 'user', subject_id: w.userId, verb: 'viewed', object_kind: 'artifact', object_id: w.doc.id, payload: {} },
    ]);
    expect(item!.object.title).toBeNull();
  });

  it('the dashboard\'s own activity lists are built from those, so they omit it too', async () => {
    const w = await trashedWorld();
    await withLog(w);
    const home = await (await homeRoute(request('/api/page/home', { actor: { credential: 'session', userId: w.userId, email: 'o@example.com', emailVerified: true } }))).json() as { feed: { mine: Array<{ object: { id: string } }> } };
    expect(home.feed.mine.map((i) => i.object.id)).not.toContain(w.doc.id);
  });

  it('a trashed annotation is not counted', async () => {
    const w = await trashedWorld();
    expect(await countOpenAnnotations(w.doc.id)).toBe(0);
  });
});
