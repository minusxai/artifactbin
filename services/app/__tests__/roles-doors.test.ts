/**
 * ROLES, editors through every door and artifact membership (the lattice and sharing: roles.test.ts; ./roles-fixture.ts).
 */
import { nativeAnchor } from './native-annotation-fixture';
import { nativeHtml } from '@/__tests__/native-html-fixture';
import { describe, expect, it, beforeEach } from 'vitest';
import { useAppHarness, mintAccountToken as mintToken, setSession, request } from '@/__tests__/harness';
import { canReadArtifact, changeMembership, getArtifactById, invitePeople, membershipState, mentionCandidates } from '@/lib/artifacts';
import { effectiveRole, effectiveRole as roleFor } from '@/lib/artifact-access';
import { ANONYMOUS_ACTOR, NO_IDENTITY, identityForUser, type RequestIdentity, createUser, ensureUsername } from '@/lib/accounts';
import { setRelationState, has, count, linked, link } from '@/lib/social';
import { createAnnotationFor } from '@/lib/annotations';
import { PUT as putArtifactRoute, GET as getArtifactRoute } from '@/app/api/artifacts/[id]/route';
import { POST as createArtifactRoute, GET as listArtifactsRoute } from '@/app/api/artifacts/route';
import { GET as getSharingRoute, PUT as putSharingRoute } from '@/app/api/my/artifacts/[id]/sharing/route';
import { observedRequest } from '@/__tests__/conditional-request';
import { PATCH as metadata, DELETE as deleteMineRoute, GET as getMineRoute, PUT as putMineRoute } from '@/app/api/my/artifacts/[id]/route';
import { attachActor } from '@artifactbin/utils';
import { POST as annotateBearerRoute } from '@/app/api/artifacts/[id]/annotations/route';
import { POST as revertMineRoute } from '@/app/api/my/artifacts/[id]/revert/route';
import { GET as versionsMineRoute } from '@/app/api/my/artifacts/[id]/versions/route';
import { POST as createAnnotationRoute } from '@/app/api/my/artifacts/[id]/annotations/route';
import { DELETE as deleteAnnotationRoute, POST as actOnAnnotationRoute } from '@/app/api/my/artifacts/[id]/annotations/[annId]/route';
import { GET as eventsRoute } from '@/app/a/[id]/events/route';
import { GET as versionMineRoute } from '@/app/api/my/artifacts/[id]/versions/[version]/route';
import { POST as agentPromptRoute } from '@/app/api/my/artifacts/[id]/agent-prompt/route';
import { getDb } from '@/lib/platform';
import { membershipInbox, updateMembershipInbox } from '@/lib/notifications';
import { POST } from '@/app/api/my/artifacts/[id]/members/route';
import { explicitlyJoined } from './roles-fixture';

const harness = useAppHarness();

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
describe('editors through every door', () => {
  beforeEach(() => setSession(() => (sessionUser.id ? { user: { id: sessionUser.id, email: sessionUser.email || null, emailVerified: true } } : null)));
  const sessionUser = { id: '', email: '' };

  const params = <T extends Record<string, string>>(p: T) => ({ params: Promise.resolve(p) });
  const jreq = (path:string,method:string,body?:unknown,token?:string)=>observedRequest(path,{method,json:body,token});
  const create = async (token: string, body: Record<string, unknown>) => {
    const res = await createArtifactRoute(await jreq('/api/artifacts', 'POST', body, token));
    expect(res.status, await res.clone().text()).toBe(201);
    return (await res.json()) as { id: string; edit_id: string; version: number };
  };
  const asSession = (u: { id: string; email: string }) => { sessionUser.id = u.id; sessionUser.email = u.email; };
  const noSession = () => { sessionUser.id = ''; sessionUser.email = ''; };

  const PROSE = '<div id="root" data-af-id="root"><p>hello</p></div>';
  const PROSE2 = '<div id="root" data-af-id="root"><p>hello again</p></div>';
  const ROWS = [{ choice: 'ramen' }];
  const BOUND_DATASET = (ds:string) => `<link rel="af-dataset" data-af-name="vote_data" href="ref:${ds}"><p>Dataset page</p>`;
  const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

  beforeEach(async () => {
    noSession();
  });

  /** Owner A with a public prose document; B and C are accounts with claimed tokens. */
  async function world(body = PROSE, visibility: 'public' | 'private' = 'public') {
    const owner = await createUser({ email: 'owner@x.com' });
    const ta = await mintToken('a', owner.id);
    const bob = await createUser({ email: 'Bob@X.com' });
    const tb = await mintToken('b', bob.id);
    const bobNamed = await ensureUsername(bob);
    const carol = await createUser({ email: 'carol@x.com' });
    const tc = await mintToken('c', carol.id);
    const anon = await mintToken('anon', null);
    const doc = await create(ta.token, { html:nativeHtml(body), visibility });
    return { ta, tb, tc, anon, owner, bob: bobNamed, carol, doc };
  }

  const share = async (id: string, shares: unknown) => {
    const res = await putSharingRoute(await jreq(`/api/my/artifacts/${id}/sharing`, 'PUT', { shares }), params({ id }));
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
    it('an explicit viewer share is read-only: 404 on every /api/my write and on reach', async () => {
      const w = await world();
      asSession({ id: w.owner.id, email: w.owner.email });
      expect((await share(w.doc.id, [{email:'bob@x.com',role:'viewer'}])).status).toBe(200);
      asSession({ id: w.bob.id, email: w.bob.email });
      const id = w.doc.id;
      expect((await getMineRoute(await jreq(`/api/my/artifacts/${id}`, 'GET'), params({ id }))).status).toBe(404);
      expect((await putMineRoute(await jreq(`/api/my/artifacts/${id}`, 'PUT', {html:nativeHtml(PROSE2)}), params({ id }))).status).toBe(404);
      expect((await putMineRoute(await jreq(`/api/my/artifacts/${id}`, 'PUT', { html:nativeHtml(PROSE2) }), params({ id }))).status).toBe(404);
      expect((await versionsMineRoute(await jreq(`/api/my/artifacts/${id}/versions`, 'GET'), params({ id }))).status).toBe(404);
      // …and the same through B's claimed bearer token.
      expect((await getArtifactRoute(await jreq(`/api/artifacts/${id}`, 'GET', undefined, w.tb.token), params({ id }))).status).toBe(200);
    });
  });

  describe('an editor edits through every write door, and nothing else', () => {
    it('session: reach, edits, PUT, revert and versions answer; sharing answers too; delete and moving do not', async () => {
      const w = await world();
      await inviteEditor(w);
      asSession({ id: w.bob.id, email: w.bob.email });
      const id = w.doc.id;

      expect((await getMineRoute(await jreq(`/api/my/artifacts/${id}`, 'GET'), params({ id }))).status).toBe(200);

      const edited = await putMineRoute(await jreq(`/api/my/artifacts/${id}`, 'PUT', {html:nativeHtml(PROSE2)}), params({ id }));
      expect(edited.status, await edited.clone().text()).toBe(200);
      expect((await head(id)).source).toContain('hello again');

      const put = await putMineRoute(await jreq(`/api/my/artifacts/${id}`, 'PUT', { html:nativeHtml(PROSE) }), params({ id }));
      expect(put.status, await put.clone().text()).toBe(200);

      const versions = await versionsMineRoute(await jreq(`/api/my/artifacts/${id}/versions`, 'GET'), params({ id }));
      expect(versions.status).toBe(200);
      const listed = (await versions.json()) as { versions: Array<{ version: number; by: string | null }> };
      expect(listed.versions.length).toBeGreaterThan(0);

      const revert = await revertMineRoute(await jreq(`/api/my/artifacts/${id}/revert`, 'POST', { version: 1 }), params({ id }));
      expect(revert.status, await revert.clone().text()).toBe(200);

      // Owner-only surfaces: the uniform 404, never "exists but not yours".
      expect((await deleteMineRoute(await jreq(`/api/my/artifacts/${id}`, 'DELETE'), params({ id }))).status).toBe(404);
      expect((await getSharingRoute(await jreq(`/api/my/artifacts/${id}/sharing`, 'GET'), params({ id }))).status).toBe(200);
      expect((await share(id, [{email:w.bob.email,role:'editor'}, { email: 'carol@x.com', role: 'editor' }])).status).toBe(200);
      // An editor can patch content metadata, but receives owner_only for placement.
      expect((await metadata(await jreq(`/api/my/artifacts/${id}`, 'PATCH', { parent_id: null }), params({ id }))).status).toBe(403);
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
        const moved = await putMineRoute(await jreq(`/api/my/artifacts/${id}`, 'PUT', { html:nativeHtml(PROSE2), parent_id }), params({ id }));
        expect(moved.status, await moved.clone().text()).toBe(400);
        expect(await moved.json()).toMatchObject({ error: 'invalid_parent' });
      }
      expect((await head(id)).ancestor_ids).toEqual([]);
      expect((await head(id)).version).toBe(before);
    });

    it('editors change visibility through both content replacement credentials', async () => {
      const w = await world(PROSE, 'private');
      await inviteEditor(w);
      const id = w.doc.id;
      asSession({id:w.bob.id,email:w.bob.email});
      const browser = await putMineRoute(await jreq(`/api/my/artifacts/${id}`,'PUT',{html:nativeHtml(PROSE2),visibility:'unlisted'}),params({id}));
      expect(browser.status,await browser.clone().text()).toBe(200);
      noSession();
      const bearer = await putArtifactRoute(await jreq(`/api/artifacts/${id}`,'PUT',{html:nativeHtml(PROSE2),visibility:'public'},w.tb.token),params({id}));
      expect(bearer.status,await bearer.clone().text()).toBe(200);
      expect((await getArtifactById(id))!.visibility).toBe('public');
    });

    it('bearer: the editor\'s CLAIMED token edits; an anonymous token and a stranger\'s token do not', async () => {
      const w = await world();
      await inviteEditor(w);
      const id = w.doc.id;
      const read = await getArtifactRoute(await jreq(`/api/artifacts/${id}`, 'GET', undefined, w.tb.token), params({ id }));
      expect(read.status).toBe(200);
      const edited = await putArtifactRoute(await jreq(`/api/artifacts/${id}`, 'PUT', {html:nativeHtml(PROSE2)}, w.tb.token), params({ id }));
      expect(edited.status, await edited.clone().text()).toBe(200);
      const put = await putArtifactRoute(await jreq(`/api/artifacts/${id}`, 'PUT', { html:nativeHtml(PROSE) }, w.tb.token), params({ id }));
      expect(put.status, await put.clone().text()).toBe(200);

      expect((await getArtifactRoute(await jreq(`/api/artifacts/${id}`, 'GET', undefined, w.anon.token), params({ id }))).status).toBe(401);
      expect((await getArtifactRoute(await jreq(`/api/artifacts/${id}`, 'GET', undefined, w.tc.token), params({ id }))).status).toBe(200);
      expect((await putArtifactRoute(await jreq(`/api/artifacts/${id}`, 'PUT', {html:nativeHtml(PROSE2)}, w.tc.token), params({ id }))).status).toBe(404);
    });

    it('an editor\'s write resolves refs as the DOCUMENT\'s owner: a binding to the owner\'s dataset and a private image both publish', async () => {
      const w = await world();
      const ds = (await create(w.ta.token, { dataset: ROWS, columns: [{ name: 'choice', type: 'string' }], access: 'readwrite' })).id;
      const img = (await create(w.ta.token, { image: PNG, visibility: 'private' })).id;
      await inviteEditor(w);
      asSession({ id: w.bob.id, email: w.bob.email });
      const id = w.doc.id;

      const withDataset = await putMineRoute(await jreq(`/api/my/artifacts/${id}`, 'PUT', {html:nativeHtml(BOUND_DATASET(ds))}), params({ id }));
      expect(withDataset.status, await withDataset.clone().text()).toBe(200);

      const withImage = await putMineRoute(await jreq(`/api/my/artifacts/${id}`, 'PUT', { html:nativeHtml(`<div><img src="ref:${img}" alt="x" /></div>`) }), params({ id }));
      expect(withImage.status, await withImage.clone().text()).toBe(200);

      // The bearer door too — it parses before it loads the row.
      const bearerPut = await putArtifactRoute(await jreq(`/api/artifacts/${id}`, 'PUT', { html:nativeHtml(BOUND_DATASET(ds)) }, w.tb.token), params({ id }));
      expect(bearerPut.status, await bearerPut.clone().text()).toBe(200);
    });

    it('an image an editor pastes is imported for the DOCUMENT\'s owner, so the next edit still resolves it', async () => {
      const w = await world();
      await inviteEditor(w);
      asSession({ id: w.bob.id, email: w.bob.email });
      const id = w.doc.id;
      const img = await create(w.tb.token, { image: PNG }); // B's own upload (born unlisted) …
      const put = await putMineRoute(await jreq(`/api/my/artifacts/${id}`, 'PUT', { html:nativeHtml(`<div><img src="ref:${img.id}" alt="x" /></div>`) }), params({ id }));
      expect(put.status, await put.clone().text()).toBe(200); // … is link-readable to the owner's loader.
    });
  });

  describe('an editor on a PRIVATE document', () => {
    it('reaches, edits, reads one archived version and mints an agent prompt — through a session and through their token', async () => {
      const w = await world(PROSE, 'private');
      await inviteEditor(w);
      const id = w.doc.id;
      asSession({ id: w.bob.id, email: w.bob.email });
      expect((await getMineRoute(await jreq(`/api/my/artifacts/${id}`, 'GET'), params({ id }))).status).toBe(200);
      expect((await putMineRoute(await jreq(`/api/my/artifacts/${id}`, 'PUT', {html:nativeHtml(PROSE2)}), params({ id }))).status).toBe(200);
      const one = await versionMineRoute(await jreq(`/api/my/artifacts/${id}/versions/1`, 'GET'), params({ id, version: '1' }));
      expect(one.status).toBe(200);
      expect(await one.json()).toMatchObject({ version: 1 });
      const prompt = await agentPromptRoute(await jreq(`/api/my/artifacts/${id}/agent-prompt`, 'POST', {}), params({ id }));
      expect(prompt.status, await prompt.clone().text()).toBe(201); // it mints a token for the editor's own agent
      // The stranger and the anonymous token still see nothing.
      asSession({ id: w.carol.id, email: w.carol.email });
      expect((await getMineRoute(await jreq(`/api/my/artifacts/${id}`, 'GET'), params({ id }))).status).toBe(404);
      expect((await versionMineRoute(await jreq(`/api/my/artifacts/${id}/versions/1`, 'GET'), params({ id, version: '1' }))).status).toBe(404);
      noSession();
      expect((await getArtifactRoute(await jreq(`/api/artifacts/${id}`, 'GET', undefined, w.tb.token), params({ id }))).status).toBe(200);
      expect((await getArtifactRoute(await jreq(`/api/artifacts/${id}`, 'GET', undefined, w.anon.token), params({ id }))).status).toBe(401);
    });

    it('naming the OWNER\'s own email changes nothing — they stay the owner', async () => {
      const w = await world();
      asSession({ id: w.owner.id, email: w.owner.email });
      expect((await share(w.doc.id, [{ email: w.owner.email, role: 'viewer' }])).status).toBe(200);
      expect(await roleFor(await head(w.doc.id), identityForUser(w.owner.id, null))).toBe('owner');
      expect((await getSharingRoute(await jreq(`/api/my/artifacts/${w.doc.id}/sharing`, 'GET'), params({ id: w.doc.id }))).status).toBe(200);
    });

    it('decides a whole request identity (session, bearer, agent cookie, nobody) exactly as its actor', async () => {
      const w = await world();
      await inviteEditor(w);
      const row = await head(w.doc.id);
      const identity = (userId: string | null, tokenId: string | null, email: string | null, credential: RequestIdentity['credential']): RequestIdentity =>
        ({ ...identityForUser(userId, tokenId, email), credential, emailVerified: null });
      expect(await roleFor(row, identity(w.owner.id, null, w.owner.email, 'session'))).toBe('owner');
      expect(await roleFor(row, identity(w.bob.id, w.tb.id, null, 'bearer'))).toBe('editor');
      expect(await roleFor(row, identity(w.owner.id, w.ta.id, w.owner.email, 'bearer'))).toBe('owner');
      expect(await roleFor(row, identity(null, w.ta.id, null, 'agent-cookie'))).toBe('viewer');
      expect(await roleFor(row, identity(null, w.anon.id, null, 'agent-cookie'))).toBe('viewer');
      expect(await roleFor(row, NO_IDENTITY)).toBe('viewer');
    });
  });

  describe('who wrote: edits, versions and the head carry the actor', () => {
    it('stamps the editor on the edit log and the head; the archived version names the previous author by username', async () => {
      const w = await world();
      await inviteEditor(w);
      asSession({ id: w.bob.id, email: w.bob.email });
      const id = w.doc.id;
      const edited = await putMineRoute(await jreq(`/api/my/artifacts/${id}`, 'PUT', {html:nativeHtml(PROSE2)}), params({ id }));
      expect(edited.status).toBe(200);
      const db = await harness.db();
      const log = await db.query<{ actor_user_id: string | null }>('SELECT actor_user_id FROM artifact_edits WHERE artifact_id = $1 ORDER BY seq DESC LIMIT 1', [id]);
      expect(log.rows[0].actor_user_id).toBe(w.bob.id);
      expect((await head(id)).actor_user_id).toBe(w.bob.id);

      // The version archived by that edit is v1, whose author was the OWNER.
      const versions = await versionsMineRoute(await jreq(`/api/my/artifacts/${id}/versions`, 'GET'), params({ id }));
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
      expect((await putMineRoute(await jreq(`/api/my/artifacts/${id}`, 'PUT', {html:nativeHtml(PROSE2)}), params({ id }))).status).toBe(200);
      noSession();
      const res = await eventsRoute(await jreq(`/a/${id}/events`, 'GET'), params({ id }));
      expect(res.status).toBe(200);
      const reader = res.body!.getReader();
      const { value } = await reader.read();
      await reader.cancel();
      const frame = JSON.parse(new TextDecoder().decode(value).split('\n').find((l) => l.startsWith('data:'))!.slice(5));
      expect(frame).toMatchObject({ by: w.bob.username, version: 2 });
    });
  });

  describe('the share list carries roles', () => {
    it('GET returns entries; PUT requires explicit roles and rejects ambiguous grants', async () => {
      const w = await world();
      asSession({ id: w.owner.id, email: w.owner.email });
      const id = w.doc.id;
      expect((await share(id, [{ email:'Bob@X.com', role:'viewer' }, { email: 'carol@x.com', role: 'editor' }])).status).toBe(200);
      const got = await getSharingRoute(await jreq(`/api/my/artifacts/${id}/sharing`, 'GET'), params({ id }));
      expect(await got.json()).toMatchObject({
        visibility: 'public',
        shares: [{ email: 'bob@x.com', role: 'viewer' }, { email: 'carol@x.com', role: 'editor' }],
      });
      expect((await share(id, [{ email: 'bob@x.com', role: 'owner' }])).status).toBe(400);
      expect((await share(id, [{ email: 'nope', role: 'editor' }])).status).toBe(400);
      expect((await share(id, [{ role: 'editor' }])).status).toBe(400);
      // Conflicting duplicate roles are rejected; legacy strings are not accepted.
      expect((await share(id, ['bob@x.com'])).status).toBe(400);
      expect((await share(id, [{email:'bob@x.com',role:'viewer'}, { email: 'BOB@x.com', role: 'editor' }])).status).toBe(400);
      expect((await share(id, [{email:'bob@x.com',role:'editor'}, { email: 'BOB@x.com', role: 'editor' }])).status).toBe(200);
      const again = (await (await getSharingRoute(await jreq(`/api/my/artifacts/${id}/sharing`, 'GET'), params({ id }))).json()) as { shares: unknown[] };
      expect(again.shares).toEqual([{ email: 'bob@x.com', role: 'editor' }]);
    });

    it('demoting or removing an editor takes effect on their very next write', async () => {
      const w = await world();
      await inviteEditor(w);
      const id = w.doc.id;
      asSession({ id: w.owner.id, email: w.owner.email });
      expect((await share(id, [{ email: 'bob@x.com', role: 'viewer' }])).status).toBe(200);
      asSession({ id: w.bob.id, email: w.bob.email });
      expect((await putMineRoute(await jreq(`/api/my/artifacts/${id}`, 'PUT', {html:nativeHtml(PROSE2)}), params({ id }))).status).toBe(404);
      asSession({ id: w.owner.id, email: w.owner.email });
      expect((await share(id, [])).status).toBe(200);
      asSession({ id: w.bob.id, email: w.bob.email });
      expect((await getMineRoute(await jreq(`/api/my/artifacts/${id}`, 'GET'), params({ id }))).status).toBe(404);
    });

    it('an email account owner may name an editor through the owner scope', async () => {
      const anon = await mintToken('solo');
      const doc = await create(anon.token, { html:nativeHtml(PROSE) });
      const bob = await createUser({ email: 'bob@x.com' });
      const tb = await mintToken('b', bob.id);
      // The library call uses the same email account owner scope as browser sharing.
      const { updateSharingFor } = await import('@/lib/artifacts');
      const state = await updateSharingFor(identityForUser(anon.userId, anon.id), doc.id, { shares: [{ email: 'bob@x.com', role: 'editor' }] });
      expect(state?.shares).toEqual([{ email: 'bob@x.com', role: 'editor' }]);
      const id = doc.id;
      expect((await putArtifactRoute(await jreq(`/api/artifacts/${id}`, 'PUT', {html:nativeHtml(PROSE2)}, tb.token), params({ id }))).status).toBe(200);
    });
  });

  /*
   * A document two people may WRITE should not be a document only one may
   * DISCUSS. Creation was owner-only by accident, not by decision: it reads the
   * artifact through `actorScope`, which is `ownerScope`, so a collaborator's
   * session met the uniform 404 on the way in.
   */
  describe('a named editor may comment; deletion stays narrower', () => {
    const annotate = async (id: string, body: unknown) =>
      createAnnotationRoute(await jreq(`/api/my/artifacts/${id}/annotations`, 'POST', body), params({ id }));

    it('an editor creates and replies; a viewer and a stranger get the uniform 404', async () => {
      const w = await world();
      await inviteEditor(w);
      const id = w.doc.id;

      // The editor comments on the document's only paragraph.
      asSession({ id: w.bob.id, email: w.bob.email });
      const made = await annotate(id, { anchor:nativeAnchor('root'), edit_id: (await head(id)).edit_id, body: 'is this the right number?' });
      expect(made.status, await made.clone().text()).toBe(201);
      const ann = (await made.json()) as { id: string; thread: Array<{ author: { label: string | null } }> };
      // The author snapshot is the EDITOR, not the document's owner.
      expect(ann.thread[0].author.label).toBe(w.bob.username);

      // …and replies to it.
      const replied = await actOnAnnotationRoute(
        await jreq(`/api/my/artifacts/${id}/annotations/${ann.id}`, 'POST', { reply: 'checked, it is' }),
        params({ id, annId: ann.id }),
      );
      expect(replied.status, await replied.clone().text()).toBe(200);

      // A viewer share may read the document and nothing else.
      asSession({ id: w.owner.id, email: w.owner.email });
      expect((await share(id, [{ email: 'bob@x.com', role: 'editor' }, { email: 'carol@x.com', role: 'viewer' }])).status).toBe(200);
      asSession({ id: w.carol.id, email: w.carol.email });
      expect((await annotate(id, { anchor:nativeAnchor('root'), edit_id: (await head(id)).edit_id, body: 'nope' })).status).toBe(404);

      // A stranger with no share at all.
      noSession();
      expect((await annotate(id, { anchor:nativeAnchor('root'), edit_id: (await head(id)).edit_id, body: 'nope' })).status).toBe(401);
    });

    it('the owner erases any thread; an editor erases only their own', async () => {
      const w = await world();
      await inviteEditor(w);
      const id = w.doc.id;

      asSession({ id: w.owner.id, email: w.owner.email });
      const byOwner = (await (await annotate(id, { anchor:nativeAnchor('root'), edit_id: (await head(id)).edit_id, body: 'owner note' })).json()) as { id: string };
      const ownerReplyResponse = await actOnAnnotationRoute(
        await jreq(`/api/my/artifacts/${id}/annotations/${byOwner.id}`, 'POST', { reply: 'owner reply' }),
        params({ id, annId: byOwner.id }),
      );
      const ownerReply = (await ownerReplyResponse.json() as { thread: Array<{ id: string }> }).thread[1]!;

      asSession({ id: w.bob.id, email: w.bob.email });
      const byEditor = (await (await annotate(id, { anchor:nativeAnchor('root'), edit_id: (await head(id)).edit_id, body: 'editor note' })).json()) as { id: string };
      const editorReplyResponse = await actOnAnnotationRoute(
        await jreq(`/api/my/artifacts/${id}/annotations/${byOwner.id}`, 'POST', { reply: 'editor reply' }),
        params({ id, annId: byOwner.id }),
      );
      const editorReply = (await editorReplyResponse.json() as { thread: Array<{ id: string }> }).thread[2]!;

      // A reply is independently deletable, with the same author check as a root.
      const refusedReply = await deleteAnnotationRoute(
        await jreq(`/api/my/artifacts/${id}/annotations/${ownerReply.id}`, 'DELETE'), params({ id, annId: ownerReply.id }),
      );
      expect(refusedReply.status).toBe(404);
      const ownReply = await deleteAnnotationRoute(
        await jreq(`/api/my/artifacts/${id}/annotations/${editorReply.id}`, 'DELETE'), params({ id, annId: editorReply.id }),
      );
      expect(ownReply.status, await ownReply.clone().text()).toBe(200);

      // The editor may not erase the owner's words…
      const refused = await deleteAnnotationRoute(
        await jreq(`/api/my/artifacts/${id}/annotations/${byOwner.id}`, 'DELETE'), params({ id, annId: byOwner.id }),
      );
      expect(refused.status).toBe(404);

      // …but may take back their own.
      const own = await deleteAnnotationRoute(
        await jreq(`/api/my/artifacts/${id}/annotations/${byEditor.id}`, 'DELETE'), params({ id, annId: byEditor.id }),
      );
      expect(own.status, await own.clone().text()).toBe(200);

      // The owner erases anything on their document.
      asSession({ id: w.owner.id, email: w.owner.email });
      const ownerDeletes = await deleteAnnotationRoute(
        await jreq(`/api/my/artifacts/${id}/annotations/${byOwner.id}`, 'DELETE'), params({ id, annId: byOwner.id }),
      );
      expect(ownerDeletes.status, await ownerDeletes.clone().text()).toBe(200);
    });
  });

  describe('roleFor and the read ACL', () => {
    it('names owner / editor / viewer for both credential shapes; an anonymous token is never an editor', async () => {
      const w = await world();
      await inviteEditor(w);
      const row = await head(w.doc.id);
      expect(await roleFor(row, identityForUser(w.owner.id, null))).toBe('owner');
      expect(await roleFor(row, identityForUser(w.owner.id, w.ta.id))).toBe('owner');
      expect(await roleFor(row, identityForUser(null, w.ta.id))).toBe('viewer');
      expect(await roleFor(row, identityForUser(w.bob.id, null))).toBe('editor');
      expect(await roleFor(row, identityForUser(w.bob.id, w.tb.id))).toBe('editor');
      expect(await roleFor(row, identityForUser(w.carol.id, null)), 'a public link grants a view').toBe('viewer');
      expect(await roleFor(row, identityForUser(null, w.anon.id))).toBe('viewer');
      expect(await roleFor(row, identityForUser(null, null))).toBe('viewer');
    });

    it('a private document shared to an email is readable by that account\'s TOKEN viewer too (email: null)', async () => {
      const w = await world(PROSE, 'private');
      asSession({ id: w.owner.id, email: w.owner.email });
      expect((await share(w.doc.id, [{email:'bob@x.com',role:'viewer'}])).status).toBe(200);
      const row = await head(w.doc.id);
      expect(await canReadArtifact(row, identityForUser(w.bob.id, null, null))).toBe(true);
      expect(await canReadArtifact(row, identityForUser(w.bob.id, null, 'bob@x.com'))).toBe(true);
      expect(await canReadArtifact(row, identityForUser(w.carol.id, null, null))).toBe(false);
      expect(await canReadArtifact(row, ANONYMOUS_ACTOR)).toBe(false);
    });
  });

  /**
   * Invited email accounts can use their complete grant through a bearer alone.
   * Token issuance establishes the email account before any artifact API call;
   * these callers never need a browser session to list, read, edit, or comment.
   */
  describe('an invited account that has only ever presented a bearer token', () => {
    /** The pair a CLI request really carries: the bearer header AND the proxy's verdict on it. */
    async function cliCaller(userId: string, email: string) {
      const db = await harness.db();
      await db.query("INSERT INTO users (id,email,kind) VALUES ($1,$2,'account')", [userId, email]);
      const minted = await mintToken('cli', userId);
      return async (path: string, method = 'GET', body?: unknown) =>
        attachActor(
          await observedRequest(path, { method, token: minted.token, ...(body === undefined ? {} : { json: body }) }),
          { credential: 'bearer', tokenId: minted.id, userId, email, emailVerified: true },
        );
    }

    // lib/profiles remembers what it has already written, per process — so each
    // case names its own person rather than sharing one across a wiped database.
    let people = 0;

    /** Owner A's PRIVATE document, invited to an email account with no browser session. */
    async function invitedTo(role: 'viewer' | 'commenter' | 'editor') {
      const who = `cli${people++}`, userId = `usr_${who}`, email = `${who}@invited.example`;
      const w = await world(PROSE, 'private');
      asSession({ id: w.owner.id, email: w.owner.email });
      expect((await share(w.doc.id, [{ email, role }])).status).toBe(200);
      noSession();
      const call = await cliCaller(userId, email);
      // Issuance already established the email account; no browser visit is needed.
      const db = await harness.db();
      expect((await db.query<{ email: string }>('SELECT email FROM users WHERE id = $1', [userId])).rows).toEqual([{ email }]);
      return { w, call, id: w.doc.id, userId, email };
    }

    const listedIds = async (response: Response) =>
      ((await response.json()) as { artifacts: Array<{ id: string }> }).artifacts.map((a) => a.id);

    it('an EDITOR lists, reads and writes the document using its issued email account', async () => {
      const { call, id, userId, email } = await invitedTo('editor');

      // The pull FIRST: an editor's read rechecks the edit predicate
      // (artifact-read readArtifactSnapshot), which is where it used to 404 while
      // a commenter's read of the same document answered.
      const read = await getArtifactRoute(await call(`/api/artifacts/${id}`), params({ id }));
      expect(read.status, await read.clone().text()).toBe(200);

      const listed = await listArtifactsRoute(await call('/api/artifacts'));
      expect(listed.status).toBe(200);
      expect(await listedIds(listed)).toEqual([id]);

      const put = await putArtifactRoute(await call(`/api/artifacts/${id}`, 'PUT', { html:nativeHtml(PROSE2) }), params({ id }));
      expect(put.status, await put.clone().text()).toBe(200);
      expect((await head(id)).source).toContain('hello again');

      const db = await harness.db();
      expect((await db.query<{ email: string }>('SELECT email FROM users WHERE id = $1', [userId])).rows[0]?.email).toBe(email);
    });

    it('a COMMENTER comments, and still may not rewrite the document', async () => {
      const { call, id } = await invitedTo('commenter');

      const made = await annotateBearerRoute(await call(`/api/artifacts/${id}/annotations`, 'POST', { anchor:nativeAnchor('root',1,'hello'), body: 'looks right to me' }), params({ id }));
      expect(made.status, await made.clone().text()).toBe(201);

      expect((await putArtifactRoute(await call(`/api/artifacts/${id}`, 'PUT', { html:nativeHtml(PROSE2) }), params({ id }))).status).toBe(404);
    });

    it('a VIEWER reads and lists, but neither writes nor comments', async () => {
      const { call, id } = await invitedTo('viewer');

      expect(await listedIds(await listArtifactsRoute(await call('/api/artifacts')))).toEqual([id]);
      expect((await getArtifactRoute(await call(`/api/artifacts/${id}`), params({ id }))).status).toBe(200);
      expect((await putArtifactRoute(await call(`/api/artifacts/${id}`, 'PUT', { html:nativeHtml(PROSE2) }), params({ id }))).status).toBe(404);
      expect((await annotateBearerRoute(await call(`/api/artifacts/${id}/annotations`, 'POST', { quote: 'hello', body: 'nope' }), params({ id }))).status).toBe(404);
    });

    it('an account nobody invited keeps the uniform 404 and an empty listing', async () => {
      const { id } = await invitedTo('editor');
      const stranger = await cliCaller('usr_cli_stranger', 'cli-stranger@invited.example');

      expect(await listedIds(await listArtifactsRoute(await stranger('/api/artifacts')))).toEqual([]);
      expect((await getArtifactRoute(await stranger(`/api/artifacts/${id}`), params({ id }))).status).toBe(404);
      expect((await putArtifactRoute(await stranger(`/api/artifacts/${id}`, 'PUT', { html:nativeHtml(PROSE2) }), params({ id }))).status).toBe(404);
      expect((await annotateBearerRoute(await stranger(`/api/artifacts/${id}/annotations`, 'POST', { quote: 'hello', body: 'no' }), params({ id }))).status).toBe(404);
    });
  });

  // Browser graph patch echoes/replays were retired; native CAS/history has its own behavioral suite.
});

describe('artifact membership', () => {
  async function world() {
    const owner = await createUser({ email: 'mxmx_test_members_owner@example.com' });
    const bob = await createUser({ email: 'mxmx_test_members_bob@example.com' });
    const eve = await createUser({ email: 'mxmx_test_members_eve@example.com' });
    const db = await getDb();
    for (const [user, username] of [[owner,'member_owner'],[bob,'member_bob'],[eve,'member_eve']] as const) await db.query('UPDATE users SET username=$2 WHERE id=$1',[user.id,username]);
    await db.query("INSERT INTO artifacts(id,token_id,user_id,format,visibility,link_role) VALUES('a1B2c3','owner-token',$1,'html','public','commenter')",[owner.id]);
    return { db, owner, bob, eve, actor: (user: {id:string}) => (identityForUser(user.id, null)) };
  }
  it('joins an owner immediately; readers request and only an editor can approve', async () => {
    const w=await world();
    expect((await changeMembership(w.actor(w.owner),'a1B2c3',{action:'join'})).self?.status).toBe('accepted');
    expect((await changeMembership(w.actor(w.bob),'a1B2c3',{action:'join'})).self?.status).toBe('pending');
    await expect(changeMembership(w.actor(w.bob),'a1B2c3',{action:'approve',userId:w.bob.id})).rejects.toThrow(/approve/i);
    await changeMembership(w.actor(w.owner),'a1B2c3',{action:'approve',userId:w.bob.id});
    expect((await membershipState(w.actor(w.bob),'a1B2c3')).self?.joined_at).toBeTruthy();
    await changeMembership(w.actor(w.bob),'a1B2c3',{action:'leave'});
    expect((await membershipState(w.actor(w.bob),'a1B2c3')).members.map(m=>m.user_id)).not.toContain(w.bob.id);
  });
  it('uses recipient-follows-sender direction for candidates and autoaccept, including agents', async () => {
    const w=await world();
    await link(w.bob.id,'follow',w.owner.id);
    await link(w.owner.id,'follow',w.eve.id);
    expect(await mentionCandidates(w.actor(w.owner),'a1B2c3','member')).toEqual(expect.arrayContaining([expect.objectContaining({ user_id:w.bob.id })]));
    expect(await mentionCandidates(w.actor(w.owner),'a1B2c3','member_eve')).toEqual([]);
    await changeMembership({...w.actor(w.owner),tokenId:'agent-token'},'a1B2c3',{action:'invite',usernames:['@member_bob']});
    expect((await membershipState(w.actor(w.bob),'a1B2c3')).self?.status).toBe('accepted');
    expect((await changeMembership(w.actor(w.owner),'a1B2c3',{action:'invite',usernames:['@member_eve']})).pending).toEqual([expect.objectContaining({user_id:w.eve.id})]);
  });
  it('keeps invitations pending when autoaccept is disabled; only the recipient accepts', async () => {
    const w=await world();
    await w.db.query('UPDATE users SET auto_accept_mentions=false WHERE id=$1',[w.bob.id]);
    await link(w.bob.id,'follow',w.owner.id);
    await changeMembership(w.actor(w.owner),'a1B2c3',{action:'invite',usernames:['@member_bob']});
    await expect(changeMembership(w.actor(w.owner),'a1B2c3',{action:'approve',userId:w.bob.id})).rejects.toThrow(/recipient/i);
    expect((await changeMembership(w.actor(w.bob),'a1B2c3',{action:'accept'})).self?.status).toBe('accepted');
  });
  it('keeps repeated requests idempotent and pending identities private', async () => {
    const w=await world();
    await changeMembership(w.actor(w.bob),'a1B2c3',{action:'join'});
    await changeMembership(w.actor(w.bob),'a1B2c3',{action:'join'});
    expect((await membershipState(w.actor(w.eve),'a1B2c3')).pending).toEqual([]);
    expect((await membershipState(w.actor(w.owner),'a1B2c3')).pending).toHaveLength(1);
    expect((await w.db.query('SELECT * FROM member_notifications WHERE recipient_id=$1',[w.owner.id])).rows).toHaveLength(1);
  });
  it('rechecks access before approving and refuses anonymous participation', async () => {
    const w=await world();
    await expect(changeMembership(identityForUser(null, null),'a1B2c3',{action:'join'})).rejects.toThrow(/sign in/i);
    await changeMembership(w.actor(w.bob),'a1B2c3',{action:'join'});
    await w.db.query("UPDATE artifacts SET visibility='private',sharing_revision=sharing_revision+1 WHERE id='a1B2c3'");
    await expect(changeMembership(w.actor(w.owner),'a1B2c3',{action:'approve',userId:w.bob.id})).rejects.toThrow(/access/i);
  });
  it('caps outstanding requests across artifacts and frees slots on withdrawal', async () => {
    const w=await world();
    for(let i=0;i<30;i++) {
      const id=`cap${String(i).padStart(3,'0')}`;
      await w.db.query("INSERT INTO artifacts(id,token_id,user_id,format,visibility) VALUES($1,'owner-token',$2,'html','public')",[id,w.owner.id]);
      await changeMembership(w.actor(w.bob),id,{action:'join'});
    }
    await expect(changeMembership(w.actor(w.bob),'a1B2c3',{action:'join'})).rejects.toThrow(/30/);
    await changeMembership(w.actor(w.bob),'cap000',{action:'leave'});
    expect((await changeMembership(w.actor(w.bob),'a1B2c3',{action:'join'})).self?.status).toBe('pending');
  });

  it('the browser handler keeps comment access independent and refuses cross-site membership changes', async () => {
    const w=await world();
    const ctx={params:Promise.resolve({id:'a1B2c3'})};
    const actor={credential:'session' as const,userId:w.bob.id,email:w.bob.email!,emailVerified:true};
    const response=await POST(request('/api/my/artifacts/a1B2c3/members',{method:'POST',origin:'same',actor,json:{action:'join'}}),ctx);
    expect(response.status).toBe(200);
    expect((await response.json()).self.status).toBe('pending');
    expect(await effectiveRole((await getArtifactById('a1B2c3'))!,w.actor(w.bob))).toBe('commenter');
    const cross=await POST(request('/api/my/artifacts/a1B2c3/members',{method:'POST',origin:'https://outside.example',actor,json:{action:'leave'}}),ctx);
    expect(cross.status).toBe(403);
  });

  it('commits resolved mentions once, reuses pending requests, and refuses blocked recipients',async()=>{
   const w=await world();await link(w.bob.id,'follow',w.owner.id);
   await w.db.query('UPDATE users SET auto_accept_mentions=false WHERE id=$1',[w.bob.id]);
   const mention=(source:string)=>w.db.transaction(async tx=>{const row=(await tx.query<any>("SELECT * FROM artifacts WHERE id='a1B2c3' FOR UPDATE")).rows[0];await invitePeople(tx,row,w.actor(w.owner),[w.bob.id],source);});
   await mention('comment:one');await mention('comment:one');await mention('comment:two');
   expect((await w.db.query("SELECT * FROM member_notifications WHERE kind<>'follow'")).rows).toHaveLength(1);
   await changeMembership(w.actor(w.bob),'a1B2c3',{action:'accept'});
   await mention('comment:three');await mention('comment:three');
   expect((await w.db.query("SELECT * FROM member_notifications WHERE kind='mention'")).rows).toHaveLength(1);
   await w.db.query('INSERT INTO user_blocks(user_id,blocked_user_id) VALUES($1,$2)',[w.bob.id,w.owner.id]);
   expect(await mentionCandidates(w.actor(w.owner),'a1B2c3','')).toEqual([]);
   await expect(mention('comment:blocked')).rejects.toThrow('eligible');
  });

  it('posts resolved comment mentions atomically for agents and ignores examples in code',async()=>{
   const w=await world();await link(w.bob.id,'follow',w.owner.id);
   await w.db.query(`UPDATE artifacts SET source='<html><body><p data-af-id="mark">Hello</p></body></html>' WHERE id='a1B2c3'`);
   const actor=identityForUser(w.owner.id, 'owner-token');
   const post=(body:string)=>createAnnotationFor(actor,'a1B2c3',{anchor:nativeAnchor('mark'),body},{kind:'agent',label:'test',transport:'http'});
   expect(await post('`[@member_bob](/people/'+w.bob.id+')`')).not.toBeNull();
   expect((await membershipInbox(w.actor(w.bob))).notifications).toHaveLength(0);
   const result=await post('[@member_bob](/people/'+w.bob.id+')');expect(result).not.toBeInstanceOf(Response);
   expect((await membershipState(w.actor(w.bob),'a1B2c3')).self?.status).toBe('accepted');
   const inbox=await membershipInbox(w.actor(w.bob));expect(inbox.notifications).toHaveLength(1);
   expect(inbox.notifications[0].source).toMatch(/^comment:/);
   await updateMembershipInbox(w.actor(w.bob),{autoAccept:false,block:w.owner.id});
   expect((await membershipInbox(w.actor(w.bob))).autoAccept).toBe(false);
   const refused=await post('[@member_bob](/people/'+w.bob.id+')');expect(refused).toBeInstanceOf(Response);expect((refused as Response).status).toBe(403);
   expect((await w.db.query('SELECT * FROM annotations')).rows).toHaveLength(2);
  });

  it('permits explicit invitations without a follow',async()=>{
   const w=await world();
   expect((await changeMembership(w.actor(w.owner),'a1B2c3',{action:'invite',usernames:['@member_bob']})).pending).toHaveLength(1);
  });
  it('refuses another unsolicited invitation after dismissal',async()=>{
   const w=await world();await link(w.bob.id,'follow',w.owner.id);
   await w.db.query('UPDATE users SET auto_accept_mentions=false WHERE id=$1',[w.bob.id]);
   await changeMembership(w.actor(w.owner),'a1B2c3',{action:'invite',usernames:['@member_bob']});
   await changeMembership(w.actor(w.bob),'a1B2c3',{action:'dismiss'});
   await expect(changeMembership(w.actor(w.owner),'a1B2c3',{action:'invite',usernames:['@member_bob']})).rejects.toThrow();
  });
  it('gives an existing requester instant membership after receiving edit access',async()=>{
   const w=await world();await changeMembership(w.actor(w.bob),'a1B2c3',{action:'join'});
   await w.db.query("INSERT INTO artifact_shares(artifact_id,user_id,email,role) VALUES('a1B2c3',$1,$2,'editor')",[w.bob.id,w.bob.email]);
   expect((await changeMembership(w.actor(w.bob),'a1B2c3',{action:'join'})).self?.status).toBe('accepted');
  });
  it('includes viewing access atomically only when explicitly requested by an editor',async()=>{
   const w=await world();await w.db.query("UPDATE artifacts SET visibility='private' WHERE id='a1B2c3'");
   await expect(changeMembership(w.actor(w.owner),'a1B2c3',{action:'invite',usernames:['@member_bob']})).rejects.toThrow(/access/);
   await changeMembership(w.actor(w.owner),'a1B2c3',{action:'invite',usernames:['@member_bob'],includeAccess:true});
   expect(await effectiveRole((await getArtifactById('a1B2c3'))!,w.actor(w.bob))).toBe('viewer');
   expect((await membershipState(w.actor(w.bob),'a1B2c3')).self?.status).toBe('pending');
   await expect(changeMembership(w.actor(w.bob),'a1B2c3',{action:'invite',usernames:['@member_eve'],includeAccess:true})).rejects.toThrow(/owners and editors/);
   await expect(changeMembership(w.actor(w.owner),'a1B2c3',{action:'invite',usernames:['@member_eve','@missing'],includeAccess:true})).rejects.toThrow();
   expect(await effectiveRole((await getArtifactById('a1B2c3'))!,w.actor(w.eve))).toBe('none');
  });
  it('keeps mention autocomplete restricted while explicit invitations can find non-followers',async()=>{
   const w=await world();
   expect(await mentionCandidates(w.actor(w.owner),'a1B2c3','member_bob')).toEqual([]);
   expect(await mentionCandidates(w.actor(w.owner),'a1B2c3','member_bob','invite')).toEqual([expect.objectContaining({user_id:w.bob.id})]);
  });

  it('does not let a new artifact bypass a dismissed invitation',async()=>{
   const w=await world();
   await changeMembership(w.actor(w.owner),'a1B2c3',{action:'invite',usernames:['@member_bob']});
   await changeMembership(w.actor(w.bob),'a1B2c3',{action:'dismiss'});
   await w.db.query("INSERT INTO artifacts(id,token_id,user_id,format,visibility,link_role) VALUES('d4E5f6','owner-token',$1,'html','public','commenter')",[w.owner.id]);
   await expect(changeMembership(w.actor(w.owner),'d4E5f6',{action:'invite',usernames:['@member_bob']})).rejects.toThrow(/declined/);
  });

  it('stores the complete join lifecycle in one relation without changing a follow',async()=>{
   const w=await world();
   await link(w.bob.id,'follow',w.owner.id);
   await changeMembership(w.actor(w.owner),'a1B2c3',{action:'invite',usernames:['@member_eve']});
   const read=async()=> (await w.db.query("SELECT status,direction,initiated_by,accepted_at,revision,deleted_at FROM relations WHERE subject_id=$1 AND verb='join' AND object_id='a1B2c3'",[w.eve.id])).rows[0];
   expect(await read()).toMatchObject({status:'pending',direction:'invitation',initiated_by:w.owner.id,accepted_at:null,revision:1,deleted_at:null});
   await changeMembership(w.actor(w.eve),'a1B2c3',{action:'accept'});
   expect(await read()).toMatchObject({status:'accepted',revision:2,accepted_at:expect.any(String)});
   await changeMembership(w.actor(w.eve),'a1B2c3',{action:'leave'});
   expect(await read()).toMatchObject({status:'left',revision:3,deleted_at:expect.any(String)});
   expect((await w.db.query("SELECT status FROM relations WHERE subject_id=$1 AND verb='follow'",[w.bob.id])).rows).toEqual([{status:'accepted'}]);
  });

  it('does not treat pending follows as followers or autoaccept invitations',async()=>{
   const w=await world();
   await w.db.transaction(tx=>setRelationState(tx,w.bob.id,'follow',w.owner.id,{status:'pending',direction:'request',initiatedBy:w.bob.id,revision:1}));
   expect(await has(w.bob.id,'follow',w.owner.id)).toBe(false);
   expect(await count('follow',w.owner.id)).toBe(0);
   expect(await linked(w.bob.id,'follow')).toEqual([]);
   expect(await mentionCandidates(w.actor(w.owner),'a1B2c3','member_bob')).toEqual([]);
   await changeMembership(w.actor(w.owner),'a1B2c3',{action:'invite',usernames:['@member_bob']});
   expect((await membershipState(w.actor(w.bob),'a1B2c3')).self?.status).toBe('pending');
  });

  it('requires artifact-specific consent even after an autoaccepted invitation',async()=>{
   const w=await world();
   const eligible=()=>explicitlyJoined(w.db,'a1B2c3',w.bob.id);
   expect(await eligible()).toBe(false);
   await link(w.bob.id,'follow',w.owner.id);
   await changeMembership(w.actor(w.owner),'a1B2c3',{action:'invite',usernames:['@member_bob']});
   expect(await eligible()).toBe(false);
   await changeMembership(w.actor(w.bob),'a1B2c3',{action:'accept'});
   expect(await eligible()).toBe(true);
   await changeMembership(w.actor(w.bob),'a1B2c3',{action:'leave'});
   expect(await eligible()).toBe(false);
   await changeMembership(w.actor(w.owner),'a1B2c3',{action:'invite',usernames:['@member_bob']});
   expect(await eligible()).toBe(false);
   await changeMembership(w.actor(w.bob),'a1B2c3',{action:'join'});
   expect(await eligible()).toBe(true);
  });
  it('records self requests and explicit invitation acceptance without granting pending eligibility',async()=>{
   const w=await world();
   const eligible=(id:string)=>explicitlyJoined(w.db,'a1B2c3',id);
   await changeMembership(w.actor(w.owner),'a1B2c3',{action:'join'});
   expect(await eligible(w.owner.id)).toBe(true);
   await changeMembership(w.actor(w.bob),'a1B2c3',{action:'join'});
   expect(await eligible(w.bob.id)).toBe(false);
   await changeMembership(w.actor(w.owner),'a1B2c3',{action:'approve',userId:w.bob.id});
   expect(await eligible(w.bob.id)).toBe(true);
   await changeMembership(w.actor(w.owner),'a1B2c3',{action:'invite',usernames:['@member_eve']});
   expect(await eligible(w.eve.id)).toBe(false);
   await changeMembership(w.actor(w.eve),'a1B2c3',{action:'accept'});
   expect(await eligible(w.eve.id)).toBe(true);
  });
});
