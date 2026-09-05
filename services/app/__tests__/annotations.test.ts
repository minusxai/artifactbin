/**
 * ANNOTATIONS — human/agent comments pinned to nodes, with reply/state transitions.
 *
 * The storage is a sidecar on the model of `visibility`: server-held artifact
 * state the write path never round-trips — a PUT can no more clobber a
 * comment than it can flip the read ACL. Colocation happens ON THE WIRE:
 * `GET /api/artifacts/:id` inlines the OPEN annotations (anchors in current
 * coordinates), and the agent's one mutation is
 * `POST /api/artifacts/:id/annotations/:annId { reply?, resolve?, reopen? }`.
 * Creation is browser-only (the owner's selection UX): the /api/my twin
 * takes `{ path, edit_id, body }` where `path` is the BODY path the frame
 * reported — the fixture carries a <Helmet> on purpose, because the
 * body→source first-index offset is invisible in pure prose.
 */
import { describe, expect, it } from 'vitest';
import { agentCookie, useAppHarness, request } from '@/__tests__/harness';
import { POST as actOnAnnotationRoute } from '@/app/api/artifacts/[id]/annotations/[annId]/route';
import { GET as listAnnotationsRoute } from '@/app/api/artifacts/[id]/annotations/route';
import { DELETE as deleteArtifactRoute, GET as getArtifactRoute, PUT as putArtifactRoute } from '@/app/api/artifacts/[id]/route';
import { POST as createArtifactRoute } from '@/app/api/artifacts/route';
import { DELETE as myDeleteAnnotationRoute, POST as myActOnAnnotationRoute } from '@/app/api/my/artifacts/[id]/annotations/[annId]/route';
import { GET as myListAnnotationsRoute, POST as myCreateAnnotationRoute } from '@/app/api/my/artifacts/[id]/annotations/route';
import { mintToken } from '@/lib/tokens';
import { claimToken, createUser, setUsername } from '@/lib/users';
import { countOpenAnnotations } from '@/lib/annotations';

const BASE = 'http://localhost:3000';
const harness = useAppHarness();
const params = <T extends Record<string, string>>(p: T) => ({ params: Promise.resolve(p) });

//   source index:      0 = Helmet, 1 = intro <p>, 2 = findings <div>
//   BODY path:                     0 = intro,     1 = findings
const DOC =
  '<Helmet><title>Report</title></Helmet>'
  + '<p>An introduction paragraph.</p>'
  + '<div>Revenue grew 40% in Q3.</div>';

const create = async (token: string, body: Record<string, unknown>) => {
  const res = await createArtifactRoute(request('/api/artifacts', { method: 'POST', token: token, json: body }));
  expect(res.status, await res.clone().text()).toBe(201);
  return (await res.json()) as { id: string; edit_id: string; version: number };
};

/** A doc + its owner's bearer token + the same token as a browser cookie. */
async function publish() {
  const t = await mintToken('agent');
  const doc = await create(t.token, { markup: DOC });
  const cookie = await agentCookie([t.id]);
  return { t, doc, cookie };
}

interface AnnotationWire {
  id: string;
  status: string;
  orphaned: boolean;
  anchor: { path: string; spanStart: number; spanEnd: number } | null;
  snippet: string;
  thread: Array<{ body: string; author: { kind: string; label: string | null; transport: string } }>;
}

const annotate = (id: string, cookie: string, body: Record<string, unknown>, origin?: string) =>
  myCreateAnnotationRoute(request(`/api/my/artifacts/${id}/annotations`, { method: 'POST', cookie: cookie, json: body, origin: origin }), params({ id }));

/** The current head pointer — a create may have bumped it (the anchor-key stamping edit). */
const headEditId = async (token: string, id: string) => {
  const res = await getArtifactRoute(request(`/api/artifacts/${id}`, { token: token }), params({ id }));
  return ((await res.json()) as { edit_id: string }).edit_id;
};

describe('creating (browser door, owner only)', () => {
  it('the owner annotates a node by BODY path; the stored anchor honours the Helmet offset', async () => {
    const { doc, cookie } = await publish();
    const res = await annotate(doc.id, cookie, { path: '1', edit_id: doc.edit_id, body: 'this number looks wrong' });
    expect(res.status, await res.clone().text()).toBe(201);
    const a = (await res.json()) as AnnotationWire;
    expect(a.status).toBe('open');
    expect(a.orphaned).toBe(false);
    expect(a.anchor?.path).toBe('1'); // echoed in BODY coords
    expect(a.snippet).toContain('Revenue grew 40%');
    expect(a.thread).toHaveLength(1);
    expect(a.thread[0]).toMatchObject({ body: 'this number looks wrong', author: { kind: 'human', transport: 'browser' } });
    // The span indexes the SOURCE (Helmet included): it must cover the <div>, which sits after the Helmet + intro.
    expect(a.anchor!.spanStart).toBeGreaterThan(DOC.indexOf('<div>') - 1);

    // Rows from the pre-human contract said `owner`; readers normalize them
    // without requiring a destructive data migration.
    const db = await harness.db();
    await db.query("UPDATE annotations SET author_kind = 'owner' WHERE id = $1", [a.id]);
    const legacy = await myListAnnotationsRoute(request(`/api/my/artifacts/${doc.id}/annotations`, { cookie: cookie }), params({ id: doc.id }));
    const legacyWire = (await legacy.json()) as { annotations: AnnotationWire[] };
    expect(legacyWire.annotations[0].thread[0].author.kind).toBe('human');
  });

  it('a stale base the log cannot carry answers 409 with head', async () => {
    const { doc, cookie } = await publish();
    const res = await annotate(doc.id, cookie, { path: '1', edit_id: 'not-a-real-edit-id', body: 'x' });
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: string; edit_id: string };
    expect(body.error).toBe('stale');
    expect(body.edit_id).toBe(doc.edit_id);
  });

  it('a path that names nothing is a 400; a non-markup artifact is a 400', async () => {
    const { t, doc, cookie } = await publish();
    const bad = await annotate(doc.id, cookie, { path: '9.9', edit_id: doc.edit_id, body: 'x' });
    expect(bad.status).toBe(400);
    const ds = await create(t.token, { dataset: [{ a: 1 }] });
    const notMarkup = await annotate(ds.id, cookie, { path: '0', edit_id: ds.edit_id, body: 'x' });
    expect(notMarkup.status).toBe(400);
  });

  it('does not mutate an invalid legacy document to create an anchor', async () => {
    const { doc, cookie } = await publish();
    const db = await harness.db();
    // Simulate a pre-existing row that does not satisfy today's no-inline-style rule. The
    // body path still resolves; it is the real anchor EDIT that publish refuses.
    await db.query('UPDATE artifacts SET source = $2 WHERE id = $1', [doc.id, '<p style="color:red">pre-existing</p>']);

    const res = await annotate(doc.id, cookie, { path: '0', edit_id: doc.edit_id, body: 'look here' });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string; details?: Array<{ message: string }> };
    expect(body.error).toBe('bad_path');
    expect((await db.query<{source:string}>('SELECT source FROM artifacts WHERE id=$1',[doc.id])).rows[0].source).toBe('<p style="color:red">pre-existing</p>');
  });

  it('a stranger\'s cookie gets the uniform 404; a cross-site owner cookie is refused', async () => {
    const { doc, cookie } = await publish();
    const stranger = await mintToken('other');
    const strangerCookie = await agentCookie([stranger.id]);
    const foreign = await annotate(doc.id, strangerCookie, { path: '1', edit_id: doc.edit_id, body: 'x' });
    expect(foreign.status).toBe(404);
    const crossSite = await annotate(doc.id, cookie, { path: '1', edit_id: doc.edit_id, body: 'x' }, 'https://evil.example');
    expect(crossSite.status).toBe(403);
  });
});

describe('the wire — colocation on GET', () => {
  it('GET /api/artifacts/:id inlines open annotations; resolved ones drop out', async () => {
    const { t, doc, cookie } = await publish();
    const a = (await (await annotate(doc.id, cookie, { path: '1', edit_id: doc.edit_id, body: 'check this' })).json()) as AnnotationWire;

    const got = await getArtifactRoute(request(`/api/artifacts/${doc.id}`, { token: t.token }), params({ id: doc.id }));
    expect(got.status).toBe(200);
    const wire = (await got.json()) as { annotations: AnnotationWire[] };
    expect(wire.annotations).toHaveLength(1);
    expect(wire.annotations[0]).toMatchObject({ id: a.id, status: 'open', snippet: expect.stringContaining('Revenue') });

    const done = await actOnAnnotationRoute(
      request(`/api/artifacts/${doc.id}/annotations/${a.id}`, { method: 'POST', token: t.token, json: { resolve: true } }),
      params({ id: doc.id, annId: a.id }),
    );
    expect(done.status).toBe(200);
    const after = (await (await getArtifactRoute(request(`/api/artifacts/${doc.id}`, { token: t.token }), params({ id: doc.id }))).json()) as { annotations: AnnotationWire[] };
    expect(after.annotations).toHaveLength(0);
  });

  it('a PUT cannot clobber annotations — they survive (orphaned, snippet intact) and the echo carries the open count', async () => {
    const { t, doc, cookie } = await publish();
    await annotate(doc.id, cookie, { path: '1', edit_id: doc.edit_id, body: 'keep me' });

    const put = await putArtifactRoute(
      request(`/api/artifacts/${doc.id}`, { method: 'PUT', token: t.token, json: { markup: '<p>totally new</p>' } }),
      params({ id: doc.id }),
    );
    expect(put.status, await put.clone().text()).toBe(200);
    expect(((await put.json()) as { open_annotations: number }).open_annotations).toBe(1);

    const list = await listAnnotationsRoute(request(`/api/artifacts/${doc.id}/annotations`, { token: t.token }), params({ id: doc.id }));
    const rows = (await list.json()) as { annotations: AnnotationWire[] };
    expect(rows.annotations).toHaveLength(1);
    expect(rows.annotations[0].orphaned).toBe(true); // a whole-document write destroys every anchor…
    expect(rows.annotations[0].anchor).toBeNull();
    expect(rows.annotations[0].snippet).toContain('Revenue'); // …but never the comment
  });

  it('the bearer list honours ?status=', async () => {
    const { t, doc, cookie } = await publish();
    const a = (await (await annotate(doc.id, cookie, { path: '1', edit_id: doc.edit_id, body: 'one' })).json()) as AnnotationWire;
    await actOnAnnotationRoute(
      request(`/api/artifacts/${doc.id}/annotations/${a.id}`, { method: 'POST', token: t.token, json: { resolve: true } }),
      params({ id: doc.id, annId: a.id }),
    );
    const two = await annotate(doc.id, cookie, { path: '0', edit_id: await headEditId(t.token, doc.id), body: 'two' });
    expect(two.status, await two.clone().text()).toBe(201);

    const open = (await (await listAnnotationsRoute(request(`/api/artifacts/${doc.id}/annotations`, { token: t.token }), params({ id: doc.id }))).json()) as { annotations: AnnotationWire[] };
    expect(open.annotations.map((x) => x.thread[0].body)).toEqual(['two']);
    const all = (await (await listAnnotationsRoute(request(`/api/artifacts/${doc.id}/annotations?status=all`, { token: t.token }), params({ id: doc.id }))).json()) as { annotations: AnnotationWire[] };
    expect(all.annotations).toHaveLength(2);
  });
});

describe('reply / resolve — the agent\'s one mutation', () => {
  it('an HTTP agent declares itself once; identity is remembered while transport is snapshotted per reply', async () => {
    const { t, doc, cookie } = await publish();
    const a = (await (await annotate(doc.id, cookie, { path: '1', edit_id: doc.edit_id, body: 'is this right?' })).json()) as AnnotationWire;

    const replied = await actOnAnnotationRoute(
      request(`/api/artifacts/${doc.id}/annotations/${a.id}`, { method: 'POST', token: t.token, json: { reply: 'checked — recomputing' }, headers: { 'User-Agent': 'curl/8.7.1', 'Artifactbin-Agent': 'codex' } }),
      params({ id: doc.id, annId: a.id }),
    );
    expect(replied.status).toBe(200);
    const r1 = (await replied.json()) as AnnotationWire;
    expect(r1.status).toBe('open');
    expect(r1.thread.map((c) => c.author.kind)).toEqual(['human', 'agent']);
    expect(r1.thread[1].author).toMatchObject({ kind: 'agent', label: 'Codex', transport: 'http' });

    const closed = await actOnAnnotationRoute(
      request(`/api/artifacts/${doc.id}/annotations/${a.id}`, { method: 'POST', token: t.token, json: { reply: 'fixed, was 34%', resolve: true }, headers: { 'User-Agent': 'node' } }),
      params({ id: doc.id, annId: a.id }),
    );
    const r2 = (await closed.json()) as AnnotationWire;
    expect(r2.status).toBe('resolved');
    expect(r2.thread).toHaveLength(3);
    expect(r2.thread[2].author).toMatchObject({ kind: 'agent', label: 'Codex', transport: 'http' });

    const reopened = await myActOnAnnotationRoute(
      request(`/api/my/artifacts/${doc.id}/annotations/${a.id}`, { method: 'POST', cookie: cookie, json: { reopen: true } }),
      params({ id: doc.id, annId: a.id }),
    );
    expect(reopened.status).toBe(200);
    expect(await reopened.json()).toMatchObject({ status: 'open', resolved_at: null });
  });

  it('a claimed account\'s comments carry its USERNAME as the label; an anonymous owner\'s carry none', async () => {
    const { t, doc, cookie } = await publish();
    const anon = (await (await annotate(doc.id, cookie, { path: '1', edit_id: doc.edit_id, body: 'from nobody' })).json()) as AnnotationWire;
    expect(anon.thread[0].author).toMatchObject({ kind: 'human', label: null, transport: 'browser' });

    const user = await createUser({ email: 'viv@example.com' });
    expect('ok' in (await setUsername(user.id, 'viv_tester'))).toBe(true);
    await claimToken(user.id, t.token);
    const named = (await (await annotate(doc.id, cookie, { path: '0', edit_id: await headEditId(t.token, doc.id), body: 'from viv' })).json()) as AnnotationWire;
    expect(named.thread[0].author).toMatchObject({ kind: 'human', label: 'viv_tester', transport: 'browser' });
  });

  it('the owner replies through the /api/my twin, attributed owner', async () => {
    const { doc, cookie } = await publish();
    const a = (await (await annotate(doc.id, cookie, { path: '1', edit_id: doc.edit_id, body: 'q' })).json()) as AnnotationWire;
    const res = await myActOnAnnotationRoute(
      request(`/api/my/artifacts/${doc.id}/annotations/${a.id}`, { method: 'POST', cookie: cookie, json: { reply: 'never mind' } }),
      params({ id: doc.id, annId: a.id }),
    );
    expect(res.status).toBe(200);
    const r = (await res.json()) as AnnotationWire;
    expect(r.thread[1].author).toMatchObject({ kind: 'human', transport: 'browser' });

    const my = (await (await myListAnnotationsRoute(request(`/api/my/artifacts/${doc.id}/annotations`, { cookie: cookie }), params({ id: doc.id }))).json()) as { annotations: AnnotationWire[] };
    expect(my.annotations[0].thread).toHaveLength(2);
  });

  it('unknown annotation id, foreign token, and an empty action are refused (404/404/400)', async () => {
    const { t, doc, cookie } = await publish();
    const a = (await (await annotate(doc.id, cookie, { path: '1', edit_id: doc.edit_id, body: 'q' })).json()) as AnnotationWire;

    const unknown = await actOnAnnotationRoute(
      request(`/api/artifacts/${doc.id}/annotations/ann_nope`, { method: 'POST', token: t.token, json: { resolve: true } }),
      params({ id: doc.id, annId: 'ann_nope' }),
    );
    expect(unknown.status).toBe(404);

    const stranger = await mintToken('other');
    const foreign = await actOnAnnotationRoute(
      request(`/api/artifacts/${doc.id}/annotations/${a.id}`, { method: 'POST', token: stranger.token, json: { resolve: true } }),
      params({ id: doc.id, annId: a.id }),
    );
    expect(foreign.status).toBe(404);

    const empty = await actOnAnnotationRoute(
      request(`/api/artifacts/${doc.id}/annotations/${a.id}`, { method: 'POST', token: t.token, json: {} }),
      params({ id: doc.id, annId: a.id }),
    );
    expect(empty.status).toBe(400);
  });
});

describe('lifecycle', () => {
  it('the owner deletes a thread outright — root and replies; a stranger gets the uniform 404', async () => {
    const { t, doc, cookie } = await publish();
    const a = (await (await annotate(doc.id, cookie, { path: '1', edit_id: doc.edit_id, body: 'erase me' })).json()) as AnnotationWire;
    await actOnAnnotationRoute(
      request(`/api/artifacts/${doc.id}/annotations/${a.id}`, { method: 'POST', token: t.token, json: { reply: 'noted' } }),
      params({ id: doc.id, annId: a.id }),
    );

    const stranger = await mintToken('other');
    const strangerCookie = await agentCookie([stranger.id]);
    const refused = await myDeleteAnnotationRoute(
      request(`/api/my/artifacts/${doc.id}/annotations/${a.id}`, { method: 'DELETE', cookie: strangerCookie }),
      params({ id: doc.id, annId: a.id }),
    );
    expect(refused.status).toBe(404);

    const deleted = await myDeleteAnnotationRoute(
      request(`/api/my/artifacts/${doc.id}/annotations/${a.id}`, { method: 'DELETE', cookie: cookie }),
      params({ id: doc.id, annId: a.id }),
    );
    expect(deleted.status).toBe(200);
    /*
     * SOFT, like every other delete in this product: the root AND its replies
     * are stamped rather than removed. Nothing is erased anywhere here, and a
     * conversation is the last thing that should be the exception — the words
     * survive, and the five gated readers are what make the thread gone.
     */
    const db = await harness.db();
    const rows = await db.query<{ id: string; deleted_at: string | null }>(
      'SELECT id, deleted_at FROM annotations WHERE id = $1 OR root_id = $1', [a.id]);
    expect(rows.rows, 'the root and its reply are both still there').toHaveLength(2);
    for (const r of rows.rows) expect(r.deleted_at, r.id).not.toBeNull();
    // …and gone from every reader, which is what "deleted" means here.
    expect(await countOpenAnnotations(doc.id)).toBe(0);
    const list = (await (await getArtifactRoute(request(`/api/artifacts/${doc.id}`, { token: t.token }), params({ id: doc.id }))).json()) as { annotations?: unknown[] };
    expect(list.annotations ?? []).toHaveLength(0);
  });

  it('a deleted artifact KEEPS its annotation rows, and keeps them forever', async () => {
    const { t, doc, cookie } = await publish();
    await annotate(doc.id, cookie, { path: '1', edit_id: doc.edit_id, body: 'x' });
    const del = await deleteArtifactRoute(request(`/api/artifacts/${doc.id}`, { method: 'DELETE', token: t.token }), params({ id: doc.id }));
    expect(del.status).toBe(200);
    const db = await harness.db();
    // Still there, and that is the point: a restore has to bring the
    // conversation back with the document. They are unreachable meanwhile —
    // the artifact is (trashed-rows.test.ts), so everything hanging off it is.
    // And there is no sweep to take them later: nothing is ever erased.
    expect((await db.query('SELECT 1 FROM annotations WHERE artifact_id = $1', [doc.id])).rows).toHaveLength(1);
    await db.query(`UPDATE artifacts SET deleted_at = now() - interval '400 days' WHERE id = $1`, [doc.id]);
    expect((await db.query('SELECT 1 FROM annotations WHERE artifact_id = $1', [doc.id])).rows).toHaveLength(1);
  });
});
