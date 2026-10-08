import {artifactQuery} from '@/lib/artifacts';
import {observedRequest} from '@/__tests__/conditional-request';
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
import { describe, expect, it, vi } from 'vitest';
import { useAppHarness, request } from '@/__tests__/harness';
import { POST as actOnAnnotationRoute } from '@/app/api/artifacts/[id]/annotations/[annId]/route';
import { GET as listAnnotationsRoute } from '@/app/api/artifacts/[id]/annotations/route';
import { DELETE as deleteArtifactRoute, GET as getArtifactRoute, PUT as putArtifactRoute } from '@/app/api/artifacts/[id]/route';
import { POST as createArtifactRoute } from '@/app/api/artifacts/route';
import { DELETE as myDeleteAnnotationRoute, POST as myActOnAnnotationRoute } from '@/app/api/my/artifacts/[id]/annotations/[annId]/route';
import { GET as myListAnnotationsRoute, POST as myCreateAnnotationRoute } from '@/app/api/my/artifacts/[id]/annotations/route';
import { mintAccountToken as mintToken } from '@/__tests__/harness';
import { setUsername } from '@/lib/accounts';
import { countOpenAnnotations } from '@/lib/annotations';
import { avatarUrl } from '@/lib/accounts';

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

/** A private document with its owner's email bearer and verified browser session. */
async function publish() {
  const t = await mintToken('agent');
  const doc = await create(t.token, { markup: DOC });
  const actor = { credential: 'session' as const, userId: t.userId!, email: t.email!, emailVerified: true };
  return { t, doc, actor };
}

interface AnnotationWire {
  id: string;
  status: string;
  orphaned: boolean;
  anchor: { path: string; spanStart: number; spanEnd: number } | null;
  snippet: string;
  thread: Array<{ body: string; author: { kind: string; label: string | null; transport: string; user_id: string | null; image: string | null } }>;
}

const annotate = (id: string, actor: import('@artifactbin/contracts').Actor, body: Record<string, unknown>, origin?: string) =>
  myCreateAnnotationRoute(request(`/api/my/artifacts/${id}/annotations`, { method: 'POST', actor: actor, json: body, origin: origin }), params({ id }));

/** The current head pointer — a create may have bumped it (the anchor-key stamping edit). */
const headEditId = async (token: string, id: string) => {
  const res = await getArtifactRoute(request(`/api/artifacts/${id}`, { token: token }), params({ id }));
  return ((await res.json()) as { edit_id: string }).edit_id;
};

describe('creating (browser door, owner only)', () => {
  it('persists optional review context through create and fresh list; old comments remain context-free', async () => {
    const { doc, actor } = await publish();
    const view_state = { v: 1, components: { checkout: { screen: 'payment', error: false } } };
    const res = await annotate(doc.id, actor, { path: '1', edit_id: doc.edit_id, body: 'Review this state', view_state });
    expect(res.status).toBe(201);
    expect((await res.json()).view_state).toEqual(view_state);
    const listed = await myListAnnotationsRoute(request(`/api/my/artifacts/${doc.id}/annotations`, { actor }), params({ id: doc.id }));
    expect((await listed.json()).annotations[0].view_state).toEqual(view_state);
    const plain = await annotate(doc.id, actor, { path: '0', edit_id: doc.edit_id, body: 'Ordinary text' });
    expect((await plain.json()).view_state).toBeUndefined();
    const bad = await annotate(doc.id, actor, { path: '0', edit_id: doc.edit_id, body: 'Invalid', view_state: { v: 2, components: {} } });
    expect(bad.status).toBe(400);
  });

  it('the owner annotates a node by BODY path; the stored anchor honours the Helmet offset', async () => {
    const { doc, actor } = await publish();
    const res = await annotate(doc.id, actor, { path: '1', edit_id: doc.edit_id, body: 'this number looks wrong' });
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
    await artifactQuery(db,"UPDATE annotations SET author_kind = 'owner' WHERE id = $1", [a.id]);
    const legacy = await myListAnnotationsRoute(request(`/api/my/artifacts/${doc.id}/annotations`, { actor: actor }), params({ id: doc.id }));
    const legacyWire = (await legacy.json()) as { annotations: AnnotationWire[] };
    expect(legacyWire.annotations[0].thread[0].author.kind).toBe('human');
  });

  it('a stale base the log cannot carry answers 409 with head', async () => {
    const { doc, actor } = await publish();
    const res = await annotate(doc.id, actor, { path: '1', edit_id: 'not-a-real-edit-id', body: 'x' });
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: string; edit_id: string };
    expect(body.error).toBe('stale');
    expect(body.edit_id).toBe(doc.edit_id);
  });

  it('a path that names nothing is a 400; a non-markup artifact is a 400', async () => {
    const { t, doc, actor } = await publish();
    const bad = await annotate(doc.id, actor, { path: '9.9', edit_id: doc.edit_id, body: 'x' });
    expect(bad.status).toBe(400);
    const ds = await create(t.token, { dataset: [{ a: 1 }] });
    const notMarkup = await annotate(ds.id, actor, { path: '0', edit_id: ds.edit_id, body: 'x' });
    expect(notMarkup.status).toBe(400);
  });

  it('does not mutate an invalid legacy document to create an anchor', async () => {
    const { doc, actor } = await publish();
    const db = await harness.db();
    // Simulate a pre-existing row that does not satisfy today's no-inline-style rule. The
    // body path still resolves; it is the real anchor EDIT that publish refuses.
    await artifactQuery(db,'UPDATE artifacts SET document=NULL,source= $2 WHERE id = $1', [doc.id, '<p style="color:red">pre-existing</p>']);

    const res = await annotate(doc.id, actor, { path: '0', edit_id: doc.edit_id, body: 'look here' });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string; details?: Array<{ message: string }> };
    expect(body.error).toBe('bad_path');
    expect((await artifactQuery<{source:string}>(db,'SELECT document,source FROM artifacts WHERE id=$1',[doc.id])).rows[0].source).toBe('<p style="color:red">pre-existing</p>');
  });

  it('a stranger is refused the private document; a cross-site owner session is refused', async () => {
    const { doc, actor } = await publish();
    const stranger = await mintToken('other');
    const strangerActor = { credential: 'session' as const, userId: stranger.userId!, email: stranger.email!, emailVerified: true };
    // Ownership remains private; a verified stranger still gets the uniform 404.
    const foreign = await annotate(doc.id, strangerActor, { path: '1', edit_id: doc.edit_id, body: 'x' });
    expect(foreign.status).toBe(404);
    expect((await foreign.json()).error).toBe('not_found');
    const crossSite = await annotate(doc.id, actor, { path: '1', edit_id: doc.edit_id, body: 'x' }, 'https://evil.example');
    expect(crossSite.status).toBe(403);
  });
});

describe('the wire — colocation on GET', () => {
  it('GET /api/artifacts/:id inlines open annotations; resolved ones drop out', async () => {
    const { t, doc, actor } = await publish();
    const a = (await (await annotate(doc.id, actor, { path: '1', edit_id: doc.edit_id, body: 'check this' })).json()) as AnnotationWire;

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
    const { t, doc, actor } = await publish();
    await annotate(doc.id, actor, { path: '1', edit_id: doc.edit_id, body: 'keep me' });

    const put = await putArtifactRoute(
      await observedRequest(`/api/artifacts/${doc.id}`, { method: 'PUT', token: t.token, json: { markup: '<p>totally new</p>' } }),
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
    const { t, doc, actor } = await publish();
    const a = (await (await annotate(doc.id, actor, { path: '1', edit_id: doc.edit_id, body: 'one' })).json()) as AnnotationWire;
    await actOnAnnotationRoute(
      request(`/api/artifacts/${doc.id}/annotations/${a.id}`, { method: 'POST', token: t.token, json: { resolve: true } }),
      params({ id: doc.id, annId: a.id }),
    );
    const two = await annotate(doc.id, actor, { path: '0', edit_id: await headEditId(t.token, doc.id), body: 'two' });
    expect(two.status, await two.clone().text()).toBe(201);

    const open = (await (await listAnnotationsRoute(request(`/api/artifacts/${doc.id}/annotations`, { token: t.token }), params({ id: doc.id }))).json()) as { annotations: AnnotationWire[] };
    expect(open.annotations.map((x) => x.thread[0].body)).toEqual(['two']);
    const all = (await (await listAnnotationsRoute(request(`/api/artifacts/${doc.id}/annotations?status=all`, { token: t.token }), params({ id: doc.id }))).json()) as { annotations: AnnotationWire[] };
    expect(all.annotations).toHaveLength(2);
  });
});

describe('reply / resolve — the agent\'s one mutation', () => {
  it.each([['pi','Pi'],['opencode','OpenCode'],['custom-robot','custom-robot']])('accepts %s attribution without a connected session', async (agent, label) => {
    const {t,doc,actor}=await publish();
    const a=(await (await annotate(doc.id,actor,{path:'1',edit_id:doc.edit_id,body:'Review'})).json()) as AnnotationWire;
    const response=await actOnAnnotationRoute(request(`/api/artifacts/${doc.id}/annotations/${a.id}`,{method:'POST',token:t.token,json:{reply:'Checked'},headers:{'Artifactbin-Agent':agent}}),params({id:doc.id,annId:a.id}));
    expect(response.status).toBe(200);
    const result=await response.json() as AnnotationWire;
    expect(result.thread[1].author).toMatchObject({kind:'agent',label,transport:'http'});
  });

  it('an HTTP agent declares itself once; identity is remembered while transport is snapshotted per reply', async () => {
    const { t, doc, actor } = await publish();
    const a = (await (await annotate(doc.id, actor, { path: '1', edit_id: doc.edit_id, body: 'is this right?' })).json()) as AnnotationWire;

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
      request(`/api/my/artifacts/${doc.id}/annotations/${a.id}`, { method: 'POST', actor: actor, json: { reopen: true } }),
      params({ id: doc.id, annId: a.id }),
    );
    expect(reopened.status).toBe(200);
    expect(await reopened.json()).toMatchObject({ status: 'open', resolved_at: null });
  });

  it('a claimed account\'s comments carry its USERNAME as the label; a generated account username is replaced by its chosen label', async () => {
    const { t, doc, actor } = await publish();
    const anon = (await (await annotate(doc.id, actor, { path: '1', edit_id: doc.edit_id, body: 'from nobody' })).json()) as AnnotationWire;
    const generatedUsername = (await (await harness.db()).query<{username:string}>('SELECT username FROM users WHERE id=$1',[t.userId])).rows[0].username;
    expect(anon.thread[0].author).toMatchObject({ kind: 'human', label: generatedUsername, transport: 'browser' });

    const user = { id: t.userId! };
    expect('ok' in (await setUsername(user.id, 'viv_tester'))).toBe(true);
    const named = (await (await annotate(doc.id, actor, { path: '0', edit_id: await headEditId(t.token, doc.id), body: 'from viv' })).json()) as AnnotationWire;
    expect(named.thread[0].author).toMatchObject({ kind: 'human', label: 'viv_tester', transport: 'browser' });
  });

  it('a person\'s comments carry their account id and picture, read fresh with the comments; agents carry neither', async () => {
    const { t, doc, actor } = await publish();
    const anon = (await (await annotate(doc.id, actor, { path: '1', edit_id: doc.edit_id, body: 'from nobody' })).json()) as AnnotationWire;
    expect(anon.thread[0].author).toMatchObject({ kind: 'human', user_id: t.userId, image: null });

    const user = { id: t.userId! };
    expect('ok' in (await setUsername(user.id, 'face_tester'))).toBe(true);
    // No picture yet: the id (the colour key) and no address.
    const plain = (await (await annotate(doc.id, actor, { path: '0', edit_id: await headEditId(t.token, doc.id), body: 'no face yet' })).json()) as AnnotationWire;
    expect(plain.thread[0].author).toMatchObject({ kind: 'human', label: 'face_tester', user_id: user.id, image: null });

    const db = await harness.db();
    const imageKey = `avatar/${user.id}/abc123`;
    await artifactQuery(db,'UPDATE users SET image_key = $2 WHERE id = $1', [user.id, imageKey]);
    const image = avatarUrl({ id: user.id, image_key: imageKey });
    expect(image).toBeTruthy();

    // The create echo, a human reply and an agent reply all read the picture on the write path too.
    const withFace = (await (await annotate(doc.id, actor, { path: '1', edit_id: await headEditId(t.token, doc.id), body: 'with a face' })).json()) as AnnotationWire;
    expect(withFace.thread[0].author).toMatchObject({ kind: 'human', user_id: user.id, image });
    const humanReply = (await (await myActOnAnnotationRoute(
      request(`/api/my/artifacts/${doc.id}/annotations/${withFace.id}`, { method: 'POST', actor: actor, json: { reply: 'me again' } }),
      params({ id: doc.id, annId: withFace.id }),
    )).json()) as AnnotationWire;
    expect(humanReply.thread[1].author).toMatchObject({ kind: 'human', user_id: user.id, image });
    const agentReply = (await (await actOnAnnotationRoute(
      request(`/api/artifacts/${doc.id}/annotations/${withFace.id}`, { method: 'POST', token: t.token, json: { reply: 'on it' }, headers: { 'Artifactbin-Agent': 'codex' } }),
      params({ id: doc.id, annId: withFace.id }),
    )).json()) as AnnotationWire;
    expect(agentReply.thread[2].author).toEqual({ kind: 'agent', label: 'Codex', transport: 'http', user_id: null, image: null });

    // Every read that builds the wire: the owner's list, the bearer page and the GET's inline field.
    const query = vi.spyOn(db, 'query');
    try {
      const my = (await (await myListAnnotationsRoute(request(`/api/my/artifacts/${doc.id}/annotations`, { actor: actor }), params({ id: doc.id }))).json()) as { annotations: AnnotationWire[] };
      const page = (await (await listAnnotationsRoute(request(`/api/artifacts/${doc.id}/annotations`, { token: t.token }), params({ id: doc.id }))).json()) as { annotations: AnnotationWire[] };
      const inline = (await (await getArtifactRoute(request(`/api/artifacts/${doc.id}`, { token: t.token }), params({ id: doc.id }))).json()) as { annotations: AnnotationWire[] };
      for (const annotations of [my.annotations, page.annotations, inline.annotations]) {
        const byBody = new Map(annotations.flatMap((a) => a.thread).map((c) => [c.body, c.author]));
        expect(byBody.get('from nobody')).toMatchObject({ user_id: user.id, image });
        // Written before the picture existed, drawn with it now: the address is read, never snapshotted.
        expect(byBody.get('no face yet')).toMatchObject({ user_id: user.id, image });
        expect(byBody.get('with a face')).toMatchObject({ user_id: user.id, image });
        expect(byBody.get('me again')).toMatchObject({ user_id: user.id, image });
        expect(byBody.get('on it')).toMatchObject({ user_id: null, image: null });
        expect(JSON.stringify(annotations)).not.toContain('mxmx_test_face@example.com');
      }
      // Joined in the reads that fetch the comments — the roots and the replies,
      // two statements per read however many people wrote — never a picture
      // looked up on its own, per comment.
      const pictureReads = query.mock.calls.map(([sql]) => String(sql)).filter((sql) => sql.includes('image_key'));
      expect(pictureReads.every((sql) => /FROM annotations a LEFT JOIN users u ON u\.id = a\.author_user_id/.test(sql))).toBe(true);
      expect(pictureReads).toHaveLength(3 * 2);
    } finally { query.mockRestore(); }
  });

  it('the owner replies through the /api/my twin, attributed owner', async () => {
    const { doc, actor } = await publish();
    const a = (await (await annotate(doc.id, actor, { path: '1', edit_id: doc.edit_id, body: 'q' })).json()) as AnnotationWire;
    const res = await myActOnAnnotationRoute(
      request(`/api/my/artifacts/${doc.id}/annotations/${a.id}`, { method: 'POST', actor: actor, json: { reply: 'never mind' } }),
      params({ id: doc.id, annId: a.id }),
    );
    expect(res.status).toBe(200);
    const r = (await res.json()) as AnnotationWire;
    expect(r.thread[1].author).toMatchObject({ kind: 'human', transport: 'browser' });

    const my = (await (await myListAnnotationsRoute(request(`/api/my/artifacts/${doc.id}/annotations`, { actor: actor }), params({ id: doc.id }))).json()) as { annotations: AnnotationWire[] };
    expect(my.annotations[0].thread).toHaveLength(2);
  });

  it('unknown annotation id, foreign token, and an empty action are refused (404/404/400)', async () => {
    const { t, doc, actor } = await publish();
    const a = (await (await annotate(doc.id, actor, { path: '1', edit_id: doc.edit_id, body: 'q' })).json()) as AnnotationWire;

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
    // Account authentication never grants access to a private foreign document.
    expect(foreign.status).toBe(404);
    expect((await foreign.json()).error).toBe('not_found');

    const empty = await actOnAnnotationRoute(
      request(`/api/artifacts/${doc.id}/annotations/${a.id}`, { method: 'POST', token: t.token, json: {} }),
      params({ id: doc.id, annId: a.id }),
    );
    expect(empty.status).toBe(400);
  });
});

describe('lifecycle', () => {
  it('the owner deletes a thread outright — root and replies; a stranger gets the uniform 404', async () => {
    const { t, doc, actor } = await publish();
    const a = (await (await annotate(doc.id, actor, { path: '1', edit_id: doc.edit_id, body: 'erase me' })).json()) as AnnotationWire;
    await actOnAnnotationRoute(
      request(`/api/artifacts/${doc.id}/annotations/${a.id}`, { method: 'POST', token: t.token, json: { reply: 'noted' } }),
      params({ id: doc.id, annId: a.id }),
    );

    const stranger = await mintToken('other');
    const strangerActor = { credential: 'session' as const, userId: stranger.userId!, email: stranger.email!, emailVerified: true };
    const refused = await myDeleteAnnotationRoute(
      request(`/api/my/artifacts/${doc.id}/annotations/${a.id}`, { method: 'DELETE', actor: strangerActor }),
      params({ id: doc.id, annId: a.id }),
    );
    expect(refused.status).toBe(404);

    const deleted = await myDeleteAnnotationRoute(
      request(`/api/my/artifacts/${doc.id}/annotations/${a.id}`, { method: 'DELETE', actor: actor }),
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
    const rows = await artifactQuery<{ id: string; deleted_at: string | null }>(db,
      'SELECT id, deleted_at FROM annotations WHERE id = $1 OR root_id = $1', [a.id]);
    expect(rows.rows, 'the root and its reply are both still there').toHaveLength(2);
    for (const r of rows.rows) expect(r.deleted_at, r.id).not.toBeNull();
    // …and gone from every reader, which is what "deleted" means here.
    expect(await countOpenAnnotations(doc.id)).toBe(0);
    const list = (await (await getArtifactRoute(request(`/api/artifacts/${doc.id}`, { token: t.token }), params({ id: doc.id }))).json()) as { annotations?: unknown[] };
    expect(list.annotations ?? []).toHaveLength(0);
  });

  it('a deleted artifact KEEPS its annotation rows, and keeps them forever', async () => {
    const { t, doc, actor } = await publish();
    await annotate(doc.id, actor, { path: '1', edit_id: doc.edit_id, body: 'x' });
    const del = await deleteArtifactRoute(request(`/api/artifacts/${doc.id}`, { method: 'DELETE', token: t.token }), params({ id: doc.id }));
    expect(del.status).toBe(200);
    const db = await harness.db();
    // Still there, and that is the point: a restore has to bring the
    // conversation back with the document. They are unreachable meanwhile —
    // the artifact is (trashed-rows.test.ts), so everything hanging off it is.
    // And there is no sweep to take them later: nothing is ever erased.
    expect((await artifactQuery(db,'SELECT 1 FROM annotations WHERE artifact_id = $1', [doc.id])).rows).toHaveLength(1);
    await artifactQuery(db,`UPDATE artifacts SET deleted_at = now() - interval '400 days' WHERE id = $1`, [doc.id]);
    expect((await artifactQuery(db,'SELECT 1 FROM annotations WHERE artifact_id = $1', [doc.id])).rows).toHaveLength(1);
  });
});
