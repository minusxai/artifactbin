/**
 * Multi-user editing: a share carries a ROLE.
 *
 * Two orthogonal axes on an artifact — `visibility` is who may read via the
 * link, `artifact_shares` is the named people and what they may do
 * (`viewer` | `editor`) — and they apply under EVERY visibility, which is what
 * lets a public document have editors at all. Three relationships to a row,
 * decided once by `roleFor`:
 *
 *   owner  — everything
 *   editor — reach + edits/PUT/revert/versions; never delete, share, move, access
 *   reader — the read ACL, nothing more
 *
 * Tested through the ROUTES, both credentials — the earlier hole
 * (`mutate-csrf`) lived in the untested one. Every write here runs against the
 * SQL predicate, so a route this file does not reach is guarded by the same
 * scope the reached ones are.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useAppHarness } from './harness';
import { GET as getArtifactRoute, PUT as putArtifactRoute } from '@/app/api/artifacts/[id]/route';
import { POST as editsRoute } from '@/app/api/artifacts/[id]/edits/route';
import { POST as createArtifactRoute } from '@/app/api/artifacts/route';
import { DELETE as deleteMineRoute, GET as getMineRoute, PATCH as patchMineRoute, PUT as putMineRoute } from '@/app/api/my/artifacts/[id]/route';
import { POST as editsMineRoute } from '@/app/api/my/artifacts/[id]/edits/route';
import { POST as revertMineRoute } from '@/app/api/my/artifacts/[id]/revert/route';
import { GET as getSharingRoute, PUT as putSharingRoute } from '@/app/api/my/artifacts/[id]/sharing/route';
import { GET as versionsMineRoute } from '@/app/api/my/artifacts/[id]/versions/route';
import { POST as createAnnotationRoute } from '@/app/api/my/artifacts/[id]/annotations/route';
import { DELETE as deleteAnnotationRoute, POST as actOnAnnotationRoute } from '@/app/api/my/artifacts/[id]/annotations/[annId]/route';
import { GET as eventsRoute } from '@/app/a/[id]/events/route';
import { GET as versionMineRoute } from '@/app/api/my/artifacts/[id]/versions/[version]/route';
import { POST as agentPromptRoute } from '@/app/api/my/artifacts/[id]/agent-prompt/route';
import { roleFor as requestRoleFor } from '@/lib/viewer';
import { canReadArtifact, effectiveRole as roleFor, getArtifactById } from '@/lib/artifacts';
import { mintToken } from '@/lib/tokens';
import { claimToken, createUser, ensureUsername } from '@/lib/users';

const BASE = 'http://localhost:3000';
const harness = useAppHarness();
const sessionUser = { id: '', email: '' };
vi.mock('@/auth', () => ({
  auth: async () => (sessionUser.id ? { user: { id: sessionUser.id, email: sessionUser.email || null } } : null),
}));

const params = <T extends Record<string, string>>(p: T) => ({ params: Promise.resolve(p) });
const jreq = (path: string, method: string, body?: unknown, token?: string) =>
  new Request(`${BASE}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
const create = async (token: string, body: Record<string, unknown>) => {
  const res = await createArtifactRoute(jreq('/api/artifacts', 'POST', body, token));
  expect(res.status, await res.clone().text()).toBe(201);
  return (await res.json()) as { id: string; edit_id: string; version: number };
};
const asSession = (u: { id: string; email: string }) => { sessionUser.id = u.id; sessionUser.email = u.email; };
const noSession = () => { sessionUser.id = ''; sessionUser.email = ''; };

const PROSE = '<div><p>hello</p></div>';
const PROSE2 = '<div><p>hello again</p></div>';
const ROWS = [{ choice: 'ramen' }];
const MUTATING = (ds: string) =>
  '<Helmet><Value name="choice" type="string" default="ramen" />'
  + `<Mutation name="vote">{\`insert into ref_${ds} (choice) values ($choice)\`}</Mutation></Helmet>`
  + '<div><Button run="$vote">Vote</Button></div>';
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

beforeEach(async () => {
  noSession();
});

/** Owner A with a public prose document; B and C are accounts with claimed tokens. */
async function world(markup = PROSE, visibility: 'public' | 'private' = 'public') {
  const ta = await mintToken('a');
  const owner = await createUser({ email: 'owner@x.com' });
  await claimToken(owner.id, ta.token);
  const tb = await mintToken('b');
  const bob = await createUser({ email: 'Bob@X.com' });
  const bobNamed = await ensureUsername(bob);
  await claimToken(bob.id, tb.token);
  const tc = await mintToken('c');
  const carol = await createUser({ email: 'carol@x.com' });
  await claimToken(carol.id, tc.token);
  const anon = await mintToken('anon');
  const doc = await create(ta.token, { markup, visibility });
  return { ta, tb, tc, anon, owner, bob: bobNamed, carol, doc };
}

const share = async (id: string, shares: unknown) => {
  const res = await putSharingRoute(jreq(`/api/my/artifacts/${id}/sharing`, 'PUT', { shares }), params({ id }));
  return res;
};
const inviteEditor = async (w: Awaited<ReturnType<typeof world>>, email = 'bob@x.com') => {
  asSession({ id: w.owner.id, email: w.owner.email });
  const res = await share(w.doc.id, [{ email, role: 'editor' }]);
  expect(res.status, await res.clone().text()).toBe(200);
  noSession();
};
const head = async (id: string) => (await getArtifactById(id))!;

describe('a viewer share is read-only, exactly as before', () => {
  it('a legacy string[] share is a viewer: 404 on every /api/my write and on reach', async () => {
    const w = await world();
    asSession({ id: w.owner.id, email: w.owner.email });
    expect((await share(w.doc.id, ['bob@x.com'])).status).toBe(200);
    asSession({ id: w.bob.id, email: w.bob.email });
    const id = w.doc.id;
    expect((await getMineRoute(jreq(`/api/my/artifacts/${id}`, 'GET'), params({ id }))).status).toBe(404);
    expect((await editsMineRoute(jreq(`/api/my/artifacts/${id}/edits`, 'POST', { edit_id: w.doc.edit_id, source: PROSE2 }), params({ id }))).status).toBe(404);
    expect((await putMineRoute(jreq(`/api/my/artifacts/${id}`, 'PUT', { markup: PROSE2 }), params({ id }))).status).toBe(404);
    expect((await versionsMineRoute(jreq(`/api/my/artifacts/${id}/versions`, 'GET'), params({ id }))).status).toBe(404);
    // …and the same through B's claimed bearer token.
    expect((await getArtifactRoute(jreq(`/api/artifacts/${id}`, 'GET', undefined, w.tb.token), params({ id }))).status).toBe(404);
  });
});

describe('an editor edits through every write door, and nothing else', () => {
  it('session: reach, edits, PUT, revert and versions answer; delete, sharing, moving do not', async () => {
    const w = await world();
    await inviteEditor(w);
    asSession({ id: w.bob.id, email: w.bob.email });
    const id = w.doc.id;

    expect((await getMineRoute(jreq(`/api/my/artifacts/${id}`, 'GET'), params({ id }))).status).toBe(200);

    const edited = await editsMineRoute(jreq(`/api/my/artifacts/${id}/edits`, 'POST', { edit_id: w.doc.edit_id, source: PROSE2 }), params({ id }));
    expect(edited.status, await edited.clone().text()).toBe(200);
    expect((await head(id)).source).toContain('hello again');

    const put = await putMineRoute(jreq(`/api/my/artifacts/${id}`, 'PUT', { markup: PROSE }), params({ id }));
    expect(put.status, await put.clone().text()).toBe(200);

    const versions = await versionsMineRoute(jreq(`/api/my/artifacts/${id}/versions`, 'GET'), params({ id }));
    expect(versions.status).toBe(200);
    const listed = (await versions.json()) as { versions: Array<{ version: number; by: string | null }> };
    expect(listed.versions.length).toBeGreaterThan(0);

    const revert = await revertMineRoute(jreq(`/api/my/artifacts/${id}/revert`, 'POST', { version: 1 }), params({ id }));
    expect(revert.status, await revert.clone().text()).toBe(200);

    // Owner-only surfaces: the uniform 404, never "exists but not yours".
    expect((await deleteMineRoute(jreq(`/api/my/artifacts/${id}`, 'DELETE'), params({ id }))).status).toBe(404);
    expect((await getSharingRoute(jreq(`/api/my/artifacts/${id}/sharing`, 'GET'), params({ id }))).status).toBe(404);
    expect((await share(id, [{ email: 'carol@x.com', role: 'editor' }])).status).toBe(404);
    // The PATCH is OWNER-scoped, so an editor meets the uniform 404 before the
    // parent is ever looked at — which is also the ordering rule itself.
    expect((await patchMineRoute(jreq(`/api/my/artifacts/${id}`, 'PATCH', { parent_id: null }), params({ id }))).status).toBe(404);
    expect(await head(id)).toBeTruthy();

    /*
     * …and PLACEMENT is the same verb through the REPLACE door, which an
     * editor DOES reach. `parent_id` on a PUT is owner-only (lib/artifacts
     * ownerScope: "delete, sharing, folder, dataset access, listing"), so the
     * editor's write is refused whole — `invalid_parent`, the one refusal
     * that already means "not a folder you may file into" — and the document
     * neither moves nor gains the version the rest of the body would have
     * bought. Without this the editor could file the owner's document into
     * any folder of theirs they can name, and `ancestor_ids` is in the
     * read-back, so naming one is free.
     */
    asSession({ id: w.owner.id, email: w.owner.email });
    const box = await create(w.ta.token, { format: 'folder', title: 'the owner\'s box' });
    asSession({ id: w.bob.id, email: w.bob.email });
    const before = (await head(id)).version;
    for (const parent_id of [box.id, null]) {
      const moved = await putMineRoute(jreq(`/api/my/artifacts/${id}`, 'PUT', { markup: PROSE2, parent_id }), params({ id }));
      expect(moved.status, await moved.clone().text()).toBe(400);
      expect(await moved.json()).toMatchObject({ error: 'invalid_parent' });
    }
    expect((await head(id)).ancestor_ids).toEqual([]);
    expect((await head(id)).version).toBe(before);
  });

  it('governance is the owner\'s on the replace door too — both credentials', async () => {
    /*
     * `visibility` and `access` sit on canGovern's list beside sharing and
     * placement: they decide WHO MAY READ the document and who may write its
     * rows, and an editor was invited to write the document, not to change who
     * else can. The replace door is the only one they could reach — it runs
     * under editorScope, where every other governance surface is owner-scoped
     * and answers them the uniform 404 — so it is the only door that has to
     * say this out loud.
     *
     * Refused WHOLE, before the content is even parsed: a 403 that had already
     * published the new markup would be an editor's write landing under a
     * refusal, and the caller could not tell what took.
     */
    const w = await world(PROSE, 'private');
    await inviteEditor(w);
    const id = w.doc.id;
    const before = (await head(id)).version;
    asSession({ id: w.bob.id, email: w.bob.email });
    for (const governing of [{ visibility: 'unlisted' }, { access: 'readwrite' }]) {
      const refused = await putMineRoute(jreq(`/api/my/artifacts/${id}`, 'PUT', { markup: PROSE2, ...governing }), params({ id }));
      expect(refused.status, await refused.clone().text()).toBe(403);
      expect(await refused.json()).toMatchObject({ error: 'owner_only' });
    }
    noSession();
    const refusedBearer = await putArtifactRoute(jreq(`/api/artifacts/${id}`, 'PUT', { markup: PROSE2, visibility: 'unlisted' }, w.tb.token), params({ id }));
    expect(refusedBearer.status, await refusedBearer.clone().text()).toBe(403);
    expect(await refusedBearer.json()).toMatchObject({ error: 'owner_only' });
    // Nothing took: not the visibility it asked for, and not the markup it rode in on.
    const row = (await getArtifactById(id))!;
    expect([row.visibility, row.version]).toEqual(['private', before]);
    expect(row.source).toContain('hello');
    expect(row.source).not.toContain('again');
    // The same body from the OWNER is the ordinary write it always was.
    asSession({ id: w.owner.id, email: w.owner.email });
    const mine = await putMineRoute(jreq(`/api/my/artifacts/${id}`, 'PUT', { markup: PROSE2, visibility: 'unlisted' }), params({ id }));
    expect(mine.status, await mine.clone().text()).toBe(200);
    expect((await getArtifactById(id))!.visibility).toBe('unlisted');
  });

  it('bearer: the editor\'s CLAIMED token edits; an anonymous token and a stranger\'s token do not', async () => {
    const w = await world();
    await inviteEditor(w);
    const id = w.doc.id;
    const read = await getArtifactRoute(jreq(`/api/artifacts/${id}`, 'GET', undefined, w.tb.token), params({ id }));
    expect(read.status).toBe(200);
    const edited = await editsRoute(jreq(`/api/artifacts/${id}/edits`, 'POST', { edit_id: w.doc.edit_id, source: PROSE2 }, w.tb.token), params({ id }));
    expect(edited.status, await edited.clone().text()).toBe(200);
    const put = await putArtifactRoute(jreq(`/api/artifacts/${id}`, 'PUT', { markup: PROSE }, w.tb.token), params({ id }));
    expect(put.status, await put.clone().text()).toBe(200);

    expect((await getArtifactRoute(jreq(`/api/artifacts/${id}`, 'GET', undefined, w.anon.token), params({ id }))).status).toBe(404);
    expect((await getArtifactRoute(jreq(`/api/artifacts/${id}`, 'GET', undefined, w.tc.token), params({ id }))).status).toBe(404);
    const h = await head(id);
    expect((await editsRoute(jreq(`/api/artifacts/${id}/edits`, 'POST', { edit_id: h.edit_id, source: PROSE2 }, w.tc.token), params({ id }))).status).toBe(404);
  });

  it('an editor\'s write resolves refs as the DOCUMENT\'s owner: a <Mutation> on the owner\'s dataset and a private image both publish', async () => {
    const w = await world();
    const ds = (await create(w.ta.token, { dataset: ROWS, columns: [{ name: 'choice', type: 'string' }], access: 'readwrite' })).id;
    const img = (await create(w.ta.token, { image: PNG, visibility: 'private' })).id;
    await inviteEditor(w);
    asSession({ id: w.bob.id, email: w.bob.email });
    const id = w.doc.id;

    const withMutation = await editsMineRoute(jreq(`/api/my/artifacts/${id}/edits`, 'POST', { edit_id: w.doc.edit_id, source: MUTATING(ds) }), params({ id }));
    expect(withMutation.status, await withMutation.clone().text()).toBe(200);

    const withImage = await putMineRoute(jreq(`/api/my/artifacts/${id}`, 'PUT', { markup: `<div><img src="ref:${img}" alt="x" /></div>` }), params({ id }));
    expect(withImage.status, await withImage.clone().text()).toBe(200);

    // The bearer door too — it parses before it loads the row.
    const bearerPut = await putArtifactRoute(jreq(`/api/artifacts/${id}`, 'PUT', { markup: MUTATING(ds) }, w.tb.token), params({ id }));
    expect(bearerPut.status, await bearerPut.clone().text()).toBe(200);
  });

  it('an image an editor pastes is imported for the DOCUMENT\'s owner, so the next edit still resolves it', async () => {
    const w = await world();
    await inviteEditor(w);
    asSession({ id: w.bob.id, email: w.bob.email });
    const id = w.doc.id;
    const img = await create(w.tb.token, { image: PNG }); // B's own upload (born unlisted) …
    const put = await putMineRoute(jreq(`/api/my/artifacts/${id}`, 'PUT', { markup: `<div><img src="ref:${img.id}" alt="x" /></div>` }), params({ id }));
    expect(put.status, await put.clone().text()).toBe(200); // … is link-readable to the owner's loader.
  });
});

describe('an editor on a PRIVATE document', () => {
  it('reaches, edits, reads one archived version and mints an agent prompt — through a session and through their token', async () => {
    const w = await world(PROSE, 'private');
    await inviteEditor(w);
    const id = w.doc.id;
    asSession({ id: w.bob.id, email: w.bob.email });
    expect((await getMineRoute(jreq(`/api/my/artifacts/${id}`, 'GET'), params({ id }))).status).toBe(200);
    expect((await editsMineRoute(jreq(`/api/my/artifacts/${id}/edits`, 'POST', { edit_id: w.doc.edit_id, source: PROSE2 }), params({ id }))).status).toBe(200);
    const one = await versionMineRoute(jreq(`/api/my/artifacts/${id}/versions/1`, 'GET'), params({ id, version: '1' }));
    expect(one.status).toBe(200);
    expect(await one.json()).toMatchObject({ version: 1 });
    const prompt = await agentPromptRoute(jreq(`/api/my/artifacts/${id}/agent-prompt`, 'POST', {}), params({ id }));
    expect(prompt.status, await prompt.clone().text()).toBe(201); // it mints a token for the editor's own agent
    // The stranger and the anonymous token still see nothing.
    asSession({ id: w.carol.id, email: w.carol.email });
    expect((await getMineRoute(jreq(`/api/my/artifacts/${id}`, 'GET'), params({ id }))).status).toBe(404);
    expect((await versionMineRoute(jreq(`/api/my/artifacts/${id}/versions/1`, 'GET'), params({ id, version: '1' }))).status).toBe(404);
    noSession();
    expect((await getArtifactRoute(jreq(`/api/artifacts/${id}`, 'GET', undefined, w.tb.token), params({ id }))).status).toBe(200);
    expect((await getArtifactRoute(jreq(`/api/artifacts/${id}`, 'GET', undefined, w.anon.token), params({ id }))).status).toBe(404);
  });

  it('naming the OWNER\'s own email changes nothing — they stay the owner', async () => {
    const w = await world();
    asSession({ id: w.owner.id, email: w.owner.email });
    expect((await share(w.doc.id, [{ email: w.owner.email, role: 'viewer' }])).status).toBe(200);
    expect(await roleFor(await head(w.doc.id), { userId: w.owner.id, tokenId: null })).toBe('owner');
    expect((await getSharingRoute(jreq(`/api/my/artifacts/${w.doc.id}/sharing`, 'GET'), params({ id: w.doc.id }))).status).toBe(200);
  });

  it('lib/viewer wraps the same decision for a request actor (session, agent cookie, nobody)', async () => {
    const w = await world();
    await inviteEditor(w);
    const row = await head(w.doc.id);
    expect(await requestRoleFor(row, { viewer: { userId: w.owner.id, email: w.owner.email }, tokenId: null, credential: 'session' })).toBe('owner');
    expect(await requestRoleFor(row, { viewer: { userId: w.bob.id, email: null }, tokenId: w.tb.id, credential: 'bearer' })).toBe('editor');
    expect(await requestRoleFor(row, { viewer: null, tokenId: w.ta.id, credential: 'agent-cookie' })).toBe('owner');
    expect(await requestRoleFor(row, { viewer: null, tokenId: w.anon.id, credential: 'agent-cookie' })).toBe('viewer');
    expect(await requestRoleFor(row, { viewer: null, tokenId: null, credential: 'none' })).toBe('viewer');
  });
});

describe('who wrote: edits, versions and the head carry the actor', () => {
  it('stamps the editor on the edit log and the head; the archived version names the previous author by username', async () => {
    const w = await world();
    await inviteEditor(w);
    asSession({ id: w.bob.id, email: w.bob.email });
    const id = w.doc.id;
    const edited = await editsMineRoute(jreq(`/api/my/artifacts/${id}/edits`, 'POST', { edit_id: w.doc.edit_id, source: PROSE2 }), params({ id }));
    expect(edited.status).toBe(200);
    const db = await harness.db();
    const log = await db.query<{ actor_user_id: string | null }>('SELECT actor_user_id FROM artifact_edits WHERE artifact_id = $1 ORDER BY seq DESC LIMIT 1', [id]);
    expect(log.rows[0].actor_user_id).toBe(w.bob.id);
    expect((await head(id)).actor_user_id).toBe(w.bob.id);

    // The version archived by that edit is v1, whose author was the OWNER.
    const versions = await versionsMineRoute(jreq(`/api/my/artifacts/${id}/versions`, 'GET'), params({ id }));
    const listed = (await versions.json()) as { versions: Array<{ version: number; by: string | null }> };
    expect(listed.versions[0].version).toBe(1);
    expect(listed.versions[0].by).toBeNull(); // the owner has no username yet — by is a handle, never an email
  });
});

describe('the live stream says who moved the document', () => {
  it('the first frame after an editor\'s write carries their handle in `by`', async () => {
    const w = await world();
    await inviteEditor(w);
    asSession({ id: w.bob.id, email: w.bob.email });
    const id = w.doc.id;
    expect((await editsMineRoute(jreq(`/api/my/artifacts/${id}/edits`, 'POST', { edit_id: w.doc.edit_id, source: PROSE2 }), params({ id }))).status).toBe(200);
    noSession();
    const res = await eventsRoute(jreq(`/a/${id}/events`, 'GET'), params({ id }));
    expect(res.status).toBe(200);
    const reader = res.body!.getReader();
    const { value } = await reader.read();
    await reader.cancel();
    const frame = JSON.parse(new TextDecoder().decode(value).split('\n').find((l) => l.startsWith('data:'))!.slice(5));
    expect(frame).toMatchObject({ by: w.bob.username, version: 2 });
  });
});

describe('the share list carries roles', () => {
  it('GET returns entries; PUT takes legacy strings (viewer) or {email, role}; a bad role is 400', async () => {
    const w = await world();
    asSession({ id: w.owner.id, email: w.owner.email });
    const id = w.doc.id;
    expect((await share(id, ['Bob@X.com', { email: 'carol@x.com', role: 'editor' }])).status).toBe(200);
    const got = await getSharingRoute(jreq(`/api/my/artifacts/${id}/sharing`, 'GET'), params({ id }));
    expect(await got.json()).toMatchObject({
      visibility: 'public',
      shares: [{ email: 'bob@x.com', role: 'viewer' }, { email: 'carol@x.com', role: 'editor' }],
    });
    expect((await share(id, [{ email: 'bob@x.com', role: 'owner' }])).status).toBe(400);
    expect((await share(id, [{ email: 'nope', role: 'editor' }])).status).toBe(400);
    expect((await share(id, [{ role: 'editor' }])).status).toBe(400);
    // Duplicates collapse to ONE row, the last role given wins.
    expect((await share(id, ['bob@x.com', { email: 'BOB@x.com', role: 'editor' }])).status).toBe(200);
    const again = (await (await getSharingRoute(jreq(`/api/my/artifacts/${id}/sharing`, 'GET'), params({ id }))).json()) as { shares: unknown[] };
    expect(again.shares).toEqual([{ email: 'bob@x.com', role: 'editor' }]);
  });

  it('demoting or removing an editor takes effect on their very next write', async () => {
    const w = await world();
    await inviteEditor(w);
    const id = w.doc.id;
    asSession({ id: w.owner.id, email: w.owner.email });
    expect((await share(id, [{ email: 'bob@x.com', role: 'viewer' }])).status).toBe(200);
    asSession({ id: w.bob.id, email: w.bob.email });
    expect((await editsMineRoute(jreq(`/api/my/artifacts/${id}/edits`, 'POST', { edit_id: w.doc.edit_id, source: PROSE2 }), params({ id }))).status).toBe(404);
    asSession({ id: w.owner.id, email: w.owner.email });
    expect((await share(id, [])).status).toBe(200);
    asSession({ id: w.bob.id, email: w.bob.email });
    expect((await getMineRoute(jreq(`/api/my/artifacts/${id}`, 'GET'), params({ id }))).status).toBe(404);
  });

  it('an anonymous owner may name an editor (the row is email-keyed; nothing needs the owner\'s account)', async () => {
    const anon = await mintToken('solo');
    const doc = await create(anon.token, { markup: PROSE });
    const bob = await createUser({ email: 'bob@x.com' });
    const tb = await mintToken('b');
    await claimToken(bob.id, tb.token);
    // The sharing surface is browser-only; the anonymous owner reaches it with the agent cookie —
    // covered by the sharing route's own tests. Here the lib call, through the same owner scope.
    const { updateSharingFor } = await import('@/lib/artifacts');
    const state = await updateSharingFor({ tokenId: anon.id, userId: null }, doc.id, { shares: [{ email: 'bob@x.com', role: 'editor' }] });
    expect(state?.shares).toEqual([{ email: 'bob@x.com', role: 'editor' }]);
    const id = doc.id;
    expect((await editsRoute(jreq(`/api/artifacts/${id}/edits`, 'POST', { edit_id: doc.edit_id, source: PROSE2 }, tb.token), params({ id }))).status).toBe(200);
  });
});

/*
 * A document two people may WRITE should not be a document only one may
 * DISCUSS. Creation was owner-only by accident, not by decision: it reads the
 * artifact through `actorScope`, which is `ownerScope`, so a collaborator's
 * session met the uniform 404 on the way in.
 */
describe('a named editor may comment; deletion stays narrower', () => {
  const annotate = (id: string, body: unknown) =>
    createAnnotationRoute(jreq(`/api/my/artifacts/${id}/annotations`, 'POST', body), params({ id }));

  it('an editor creates and replies; a viewer and a stranger get the uniform 404', async () => {
    const w = await world();
    await inviteEditor(w);
    const id = w.doc.id;

    // The editor comments on the document's only paragraph.
    asSession({ id: w.bob.id, email: w.bob.email });
    const made = await annotate(id, { path: '0', edit_id: (await head(id)).edit_id, body: 'is this the right number?' });
    expect(made.status, await made.clone().text()).toBe(201);
    const ann = (await made.json()) as { id: string; thread: Array<{ author: { label: string | null } }> };
    // The author snapshot is the EDITOR, not the document's owner.
    expect(ann.thread[0].author.label).toBe(w.bob.username);

    // …and replies to it.
    const replied = await actOnAnnotationRoute(
      jreq(`/api/my/artifacts/${id}/annotations/${ann.id}`, 'POST', { reply: 'checked, it is' }),
      params({ id, annId: ann.id }),
    );
    expect(replied.status, await replied.clone().text()).toBe(200);

    // A viewer share may read the document and nothing else.
    asSession({ id: w.owner.id, email: w.owner.email });
    expect((await share(id, [{ email: 'bob@x.com', role: 'editor' }, { email: 'carol@x.com', role: 'viewer' }])).status).toBe(200);
    asSession({ id: w.carol.id, email: w.carol.email });
    expect((await annotate(id, { path: '0', edit_id: (await head(id)).edit_id, body: 'nope' })).status).toBe(404);

    // A stranger with no share at all.
    noSession();
    expect((await annotate(id, { path: '0', edit_id: (await head(id)).edit_id, body: 'nope' })).status).toBe(401);
  });

  it('the owner erases any thread; an editor erases only their own', async () => {
    const w = await world();
    await inviteEditor(w);
    const id = w.doc.id;

    asSession({ id: w.owner.id, email: w.owner.email });
    const byOwner = (await (await annotate(id, { path: '0', edit_id: (await head(id)).edit_id, body: 'owner note' })).json()) as { id: string };

    asSession({ id: w.bob.id, email: w.bob.email });
    const byEditor = (await (await annotate(id, { path: '0', edit_id: (await head(id)).edit_id, body: 'editor note' })).json()) as { id: string };

    // The editor may not erase the owner's words…
    const refused = await deleteAnnotationRoute(
      jreq(`/api/my/artifacts/${id}/annotations/${byOwner.id}`, 'DELETE'), params({ id, annId: byOwner.id }),
    );
    expect(refused.status).toBe(404);

    // …but may take back their own.
    const own = await deleteAnnotationRoute(
      jreq(`/api/my/artifacts/${id}/annotations/${byEditor.id}`, 'DELETE'), params({ id, annId: byEditor.id }),
    );
    expect(own.status, await own.clone().text()).toBe(200);

    // The owner erases anything on their document.
    asSession({ id: w.owner.id, email: w.owner.email });
    const ownerDeletes = await deleteAnnotationRoute(
      jreq(`/api/my/artifacts/${id}/annotations/${byOwner.id}`, 'DELETE'), params({ id, annId: byOwner.id }),
    );
    expect(ownerDeletes.status, await ownerDeletes.clone().text()).toBe(200);
  });
});

describe('roleFor and the read ACL', () => {
  it('names owner / editor / viewer for both credential shapes; an anonymous token is never an editor', async () => {
    const w = await world();
    await inviteEditor(w);
    const row = await head(w.doc.id);
    expect(await roleFor(row, { userId: w.owner.id, tokenId: null })).toBe('owner');
    expect(await roleFor(row, { userId: null, tokenId: w.ta.id })).toBe('owner');
    expect(await roleFor(row, { userId: w.bob.id, tokenId: null })).toBe('editor');
    expect(await roleFor(row, { userId: w.bob.id, tokenId: w.tb.id })).toBe('editor');
    expect(await roleFor(row, { userId: w.carol.id, tokenId: null }), 'a public link grants a view').toBe('viewer');
    expect(await roleFor(row, { userId: null, tokenId: w.anon.id })).toBe('viewer');
    expect(await roleFor(row, { userId: null, tokenId: null })).toBe('viewer');
  });

  it('a private document shared to an email is readable by that account\'s TOKEN viewer too (email: null)', async () => {
    const w = await world(PROSE, 'private');
    asSession({ id: w.owner.id, email: w.owner.email });
    expect((await share(w.doc.id, ['bob@x.com'])).status).toBe(200);
    const row = await head(w.doc.id);
    expect(await canReadArtifact(row, { userId: w.bob.id, email: null })).toBe(true);
    expect(await canReadArtifact(row, { userId: w.bob.id, email: 'bob@x.com' })).toBe(true);
    expect(await canReadArtifact(row, { userId: w.carol.id, email: null })).toBe(false);
    expect(await canReadArtifact(row, null)).toBe(false);
  });
});
