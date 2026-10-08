import {documentPublicationBody,documentEditBody} from './prepared-document';
import {advanceGraph} from '@/lib/story/graph/document-graph-patch';
import {graphSource} from '@/lib/story/graph/document-graph';
import {request} from './harness';
import {observedRequest} from '@/__tests__/conditional-request';
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
import { beforeEach, describe, expect, it } from 'vitest';
import { attachActor } from '@artifactbin/utils';
import { useAppHarness, setSession } from './harness';
import { GET as getArtifactRoute, PUT as putArtifactRoute } from '@/app/api/artifacts/[id]/route';
import { POST as editsRoute } from '@/app/api/artifacts/[id]/edits/route';
import { POST as annotateBearerRoute } from '@/app/api/artifacts/[id]/annotations/route';
import { GET as listArtifactsRoute, POST as createArtifactRoute } from '@/app/api/artifacts/route';
import { DELETE as deleteMineRoute, GET as getMineRoute, PUT as putMineRoute } from '@/app/api/my/artifacts/[id]/route';
import { POST as editsMineRoute, POST as patchMineRoute } from '@/app/api/my/artifacts/[id]/edits/route';
import { POST as revertMineRoute } from '@/app/api/my/artifacts/[id]/edits/route';
import { GET as getSharingRoute, PUT as putSharingRoute } from '@/app/api/my/artifacts/[id]/sharing/route';
import { GET as versionsMineRoute } from '@/app/api/my/artifacts/[id]/versions/route';
import { POST as createAnnotationRoute } from '@/app/api/my/artifacts/[id]/annotations/route';
import { DELETE as deleteAnnotationRoute, POST as actOnAnnotationRoute } from '@/app/api/my/artifacts/[id]/annotations/[annId]/route';
import { GET as eventsRoute } from '@/app/a/[id]/events/route';
import { GET as versionMineRoute } from '@/app/api/my/artifacts/[id]/versions/[version]/route';
import { POST as agentPromptRoute } from '@/app/api/my/artifacts/[id]/agent-prompt/route';
import { roleFor as requestRoleFor } from '@/lib/accounts';
import { canReadArtifact, committedHeadsSettled, effectiveRole as roleFor, getArtifactById,getVersionFor } from '@/lib/artifacts';
import { mintAccountToken as mintToken } from '@/__tests__/harness';
import { getDb } from '@/lib/platform/db';
import { storedCompiledDataflow } from '@/lib/story/data/parsed-artifact-metadata';
import { claimToken, createUser, ensureUsername } from '@/lib/accounts';

const harness = useAppHarness();
beforeEach(() => setSession(() => (sessionUser.id ? { user: { id: sessionUser.id, email: sessionUser.email || null, emailVerified: true } } : null)));
const sessionUser = { id: '', email: '' };

const params = <T extends Record<string, string>>(p: T) => ({ params: Promise.resolve(p) });
const jreq = async(path:string,method:string,body?:unknown,token?:string)=>{
 const match=path.match(/^\/api\/(?:my\/)?artifacts\/([^/]+)(?:\/(edits|revert))?$/);
 if(match&&body&&typeof body==='object'&&!Array.isArray(body)){
  const row=await getArtifactById(match[1]);
  if(row?.format==='markup'&&(match[2]||method==='PATCH')){
   let input=body as Record<string,unknown>;
   if(match[2]==='revert'){
    const archived=await getVersionFor({tokenId:row.token_id,userId:row.user_id},row.id,Number(input.version));
    if(!archived)throw new Error('Fixture archive missing');input={source:archived.source};
   }
   return request(path,{method:'POST',token,json:documentPublicationBody(row,input,match[2]==='revert')});
  }
 }
 return observedRequest(path,{method,json:body,token});
};
const create = async (token: string, body: Record<string, unknown>) => {
  const res = await createArtifactRoute(await jreq('/api/artifacts', 'POST', body, token));
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
  + `<Import name="vote_data" src="ref:${ds}" /><Mutation name="vote">{\`insert into vote_data.rows (choice) values ($choice)\`}</Mutation></Helmet>`
  + '<div><Button run="$vote">Vote</Button></div>';
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

beforeEach(async () => {
  noSession();
});

/** Owner A with a public prose document; B and C are accounts with claimed tokens. */
async function world(markup = PROSE, visibility: 'public' | 'private' = 'public') {
  const owner = await createUser({ email: 'owner@x.com' });
  const ta = await mintToken('a', owner.id);
    await claimToken(owner.id, ta.token);
  const bob = await createUser({ email: 'Bob@X.com' });
  const tb = await mintToken('b', bob.id);
  const bobNamed = await ensureUsername(bob);
  await claimToken(bob.id, tb.token);
  const carol = await createUser({ email: 'carol@x.com' });
  const tc = await mintToken('c', carol.id);
    await claimToken(carol.id, tc.token);
  const anon = await mintToken('anon', null);
  const doc = await create(ta.token, { markup, visibility });
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
    expect((await editsMineRoute(await jreq(`/api/my/artifacts/${id}/edits`, 'POST', { edit_id: w.doc.edit_id, source: PROSE2 }), params({ id }))).status).toBe(404);
    expect((await putMineRoute(await jreq(`/api/my/artifacts/${id}`, 'PUT', { markup: PROSE2 }), params({ id }))).status).toBe(404);
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

    const edited = await editsMineRoute(await jreq(`/api/my/artifacts/${id}/edits`, 'POST', { edit_id: w.doc.edit_id, source: PROSE2 }), params({ id }));
    expect(edited.status, await edited.clone().text()).toBe(200);
    expect((await head(id)).source).toContain('hello again');

    const put = await putMineRoute(await jreq(`/api/my/artifacts/${id}`, 'PUT', { markup: PROSE }), params({ id }));
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
    expect((await patchMineRoute(await jreq(`/api/my/artifacts/${id}`, 'PATCH', { parent_id: null }), params({ id }))).status).toBe(403);
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
      const moved = await putMineRoute(await jreq(`/api/my/artifacts/${id}`, 'PUT', { markup: PROSE2, parent_id }), params({ id }));
      expect(moved.status, await moved.clone().text()).toBe(403);
      expect(await moved.json()).toMatchObject({ error: 'owner_only' });
    }
    expect((await head(id)).ancestor_ids).toEqual([]);
    expect((await head(id)).version).toBe(before);
  });

  it('editors change visibility through both content replacement credentials', async () => {
    const w = await world(PROSE, 'private');
    await inviteEditor(w);
    const id = w.doc.id;
    asSession({id:w.bob.id,email:w.bob.email});
    const browser = await putMineRoute(await jreq(`/api/my/artifacts/${id}`,'PUT',{markup:PROSE2,visibility:'unlisted'}),params({id}));
    expect(browser.status,await browser.clone().text()).toBe(200);
    noSession();
    const bearer = await putArtifactRoute(await jreq(`/api/artifacts/${id}`,'PUT',{markup:PROSE2,visibility:'public'},w.tb.token),params({id}));
    expect(bearer.status,await bearer.clone().text()).toBe(200);
    expect((await getArtifactById(id))!.visibility).toBe('public');
  });

  it('bearer: the editor\'s CLAIMED token edits; an anonymous token and a stranger\'s token do not', async () => {
    const w = await world();
    await inviteEditor(w);
    const id = w.doc.id;
    const read = await getArtifactRoute(await jreq(`/api/artifacts/${id}`, 'GET', undefined, w.tb.token), params({ id }));
    expect(read.status).toBe(200);
    const edited = await editsRoute(await jreq(`/api/artifacts/${id}/edits`, 'POST', { edit_id: w.doc.edit_id, source: PROSE2 }, w.tb.token), params({ id }));
    expect(edited.status, await edited.clone().text()).toBe(200);
    const put = await putArtifactRoute(await jreq(`/api/artifacts/${id}`, 'PUT', { markup: PROSE }, w.tb.token), params({ id }));
    expect(put.status, await put.clone().text()).toBe(200);

    expect((await getArtifactRoute(await jreq(`/api/artifacts/${id}`, 'GET', undefined, w.anon.token), params({ id }))).status).toBe(401);
    expect((await getArtifactRoute(await jreq(`/api/artifacts/${id}`, 'GET', undefined, w.tc.token), params({ id }))).status).toBe(200);
    const h = await head(id);
    expect((await editsRoute(await jreq(`/api/artifacts/${id}/edits`, 'POST', { edit_id: h.edit_id, source: PROSE2 }, w.tc.token), params({ id }))).status).toBe(404);
  });

  it('an editor\'s write resolves refs as the DOCUMENT\'s owner: a <Mutation> on the owner\'s dataset and a private image both publish', async () => {
    const w = await world();
    const ds = (await create(w.ta.token, { dataset: ROWS, columns: [{ name: 'choice', type: 'string' }], access: 'readwrite' })).id;
    const img = (await create(w.ta.token, { image: PNG, visibility: 'private' })).id;
    await inviteEditor(w);
    asSession({ id: w.bob.id, email: w.bob.email });
    const id = w.doc.id;

    const withMutation = await editsMineRoute(await jreq(`/api/my/artifacts/${id}/edits`, 'POST', { edit_id: w.doc.edit_id, source: MUTATING(ds) }), params({ id }));
    expect(withMutation.status, await withMutation.clone().text()).toBe(200);

    const withImage = await putMineRoute(await jreq(`/api/my/artifacts/${id}`, 'PUT', { markup: `<div><img src="ref:${img}" alt="x" /></div>` }), params({ id }));
    expect(withImage.status, await withImage.clone().text()).toBe(200);

    // The bearer door too — it parses before it loads the row.
    const bearerPut = await putArtifactRoute(await jreq(`/api/artifacts/${id}`, 'PUT', { markup: MUTATING(ds) }, w.tb.token), params({ id }));
    expect(bearerPut.status, await bearerPut.clone().text()).toBe(200);
  });

  it('an image an editor pastes is imported for the DOCUMENT\'s owner, so the next edit still resolves it', async () => {
    const w = await world();
    await inviteEditor(w);
    asSession({ id: w.bob.id, email: w.bob.email });
    const id = w.doc.id;
    const img = await create(w.tb.token, { image: PNG }); // B's own upload (born unlisted) …
    const put = await putMineRoute(await jreq(`/api/my/artifacts/${id}`, 'PUT', { markup: `<div><img src="ref:${img.id}" alt="x" /></div>` }), params({ id }));
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
    expect((await editsMineRoute(await jreq(`/api/my/artifacts/${id}/edits`, 'POST', { edit_id: w.doc.edit_id, source: PROSE2 }), params({ id }))).status).toBe(200);
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
    expect(await roleFor(await head(w.doc.id), { userId: w.owner.id, tokenId: null })).toBe('owner');
    expect((await getSharingRoute(await jreq(`/api/my/artifacts/${w.doc.id}/sharing`, 'GET'), params({ id: w.doc.id }))).status).toBe(200);
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
    const edited = await editsMineRoute(await jreq(`/api/my/artifacts/${id}/edits`, 'POST', { edit_id: w.doc.edit_id, source: PROSE2 }), params({ id }));
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
    expect((await editsMineRoute(await jreq(`/api/my/artifacts/${id}/edits`, 'POST', { edit_id: w.doc.edit_id, source: PROSE2 }), params({ id }))).status).toBe(200);
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
    expect((await editsMineRoute(await jreq(`/api/my/artifacts/${id}/edits`, 'POST', { edit_id: w.doc.edit_id, source: PROSE2 }), params({ id }))).status).toBe(404);
    asSession({ id: w.owner.id, email: w.owner.email });
    expect((await share(id, [])).status).toBe(200);
    asSession({ id: w.bob.id, email: w.bob.email });
    expect((await getMineRoute(await jreq(`/api/my/artifacts/${id}`, 'GET'), params({ id }))).status).toBe(404);
  });

  it('an email account owner may name an editor through the owner scope', async () => {
    const anon = await mintToken('solo');
    const doc = await create(anon.token, { markup: PROSE });
    const bob = await createUser({ email: 'bob@x.com' });
    const tb = await mintToken('b', bob.id);
    await claimToken(bob.id, tb.token);
    // The library call uses the same email account owner scope as browser sharing.
    const { updateSharingFor } = await import('@/lib/artifacts');
    const state = await updateSharingFor({ tokenId:anon.id,userId:anon.userId }, doc.id, { shares: [{ email: 'bob@x.com', role: 'editor' }] });
    expect(state?.shares).toEqual([{ email: 'bob@x.com', role: 'editor' }]);
    const id = doc.id;
    expect((await editsRoute(await jreq(`/api/artifacts/${id}/edits`, 'POST', { edit_id: doc.edit_id, source: PROSE2 }, tb.token), params({ id }))).status).toBe(200);
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
    const made = await annotate(id, { path: '0', edit_id: (await head(id)).edit_id, body: 'is this the right number?' });
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
    expect((await share(w.doc.id, [{email:'bob@x.com',role:'viewer'}])).status).toBe(200);
    const row = await head(w.doc.id);
    expect(await canReadArtifact(row, { userId: w.bob.id, email: null })).toBe(true);
    expect(await canReadArtifact(row, { userId: w.bob.id, email: 'bob@x.com' })).toBe(true);
    expect(await canReadArtifact(row, { userId: w.carol.id, email: null })).toBe(false);
    expect(await canReadArtifact(row, null)).toBe(false);
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

    const put = await putArtifactRoute(await call(`/api/artifacts/${id}`, 'PUT', { markup: PROSE2 }), params({ id }));
    expect(put.status, await put.clone().text()).toBe(200);
    expect((await head(id)).source).toContain('hello again');

    const db = await harness.db();
    expect((await db.query<{ email: string }>('SELECT email FROM users WHERE id = $1', [userId])).rows[0]?.email).toBe(email);
  });

  it('a COMMENTER comments, and still may not rewrite the document', async () => {
    const { call, id } = await invitedTo('commenter');

    const made = await annotateBearerRoute(await call(`/api/artifacts/${id}/annotations`, 'POST', { quote: 'hello', body: 'looks right to me' }), params({ id }));
    expect(made.status, await made.clone().text()).toBe(201);

    expect((await putArtifactRoute(await call(`/api/artifacts/${id}`, 'PUT', { markup: PROSE2 }), params({ id }))).status).toBe(404);
  });

  it('a VIEWER reads and lists, but neither writes nor comments', async () => {
    const { call, id } = await invitedTo('viewer');

    expect(await listedIds(await listArtifactsRoute(await call('/api/artifacts')))).toEqual([id]);
    expect((await getArtifactRoute(await call(`/api/artifacts/${id}`), params({ id }))).status).toBe(200);
    expect((await putArtifactRoute(await call(`/api/artifacts/${id}`, 'PUT', { markup: PROSE2 }), params({ id }))).status).toBe(404);
    expect((await annotateBearerRoute(await call(`/api/artifacts/${id}/annotations`, 'POST', { quote: 'hello', body: 'nope' }), params({ id }))).status).toBe(404);
  });

  it('an account nobody invited keeps the uniform 404 and an empty listing', async () => {
    const { id } = await invitedTo('editor');
    const stranger = await cliCaller('usr_cli_stranger', 'cli-stranger@invited.example');

    expect(await listedIds(await listArtifactsRoute(await stranger('/api/artifacts')))).toEqual([]);
    expect((await getArtifactRoute(await stranger(`/api/artifacts/${id}`), params({ id }))).status).toBe(404);
    expect((await putArtifactRoute(await stranger(`/api/artifacts/${id}`, 'PUT', { markup: PROSE2 }), params({ id }))).status).toBe(404);
    expect((await annotateBearerRoute(await stranger(`/api/artifacts/${id}/annotations`, 'POST', { quote: 'hello', body: 'no' }), params({ id }))).status).toBe(404);
  });
});

describe('the browser edit answer', () => {
  it('is the patch when it landed where it was prepared: advancing the editor graph by it gives exactly the stored document', async () => {
    const w = await world('<div id="d"><p id="a">one</p><p id="b">two</p></div>');
    asSession({ id: w.owner.id, email: w.owner.email });
    const id = w.doc.id;
    const base = await head(id);
    const sent = documentEditBody(base, { source: '<div id="d"><p id="a">one, typed</p><p id="b">two</p></div>' });
    const res = await editsMineRoute(await request(`/api/my/artifacts/${id}/edits`, { method: 'POST', json: sent }), params({ id }));
    expect(res.status, await res.clone().text()).toBe(200);
    const answer = await res.json();
    expect(answer.document).toBeUndefined();
    expect(answer.markup).toBeUndefined();
    expect(answer).toMatchObject({ version: base.version + 1, patch: sent.document_update.patch });
    const read = await (await getMineRoute(await request(`/api/my/artifacts/${id}`, {}), params({ id }))).json();
    const advanced = advanceGraph(base.document as never, base.version, answer.patch)!;
    expect(advanced).toEqual(read.document);
    expect(graphSource(advanced)).toBe(read.markup);
    expect(answer.edit_id).toBe(read.edit_id);

    // ?echo=full keeps the bearer route's answer for any caller that wants the document.
    const now = await head(id);
    const echoed = await editsMineRoute(await request(`/api/my/artifacts/${id}/edits?echo=full`, { method: 'POST', json: documentEditBody(now, { source: (now.source as string).replace('one, typed', 'one') }) }), params({ id }));
    expect(echoed.status).toBe(200);
    expect((await echoed.json()).document.kind).toBe('graph');
  });

  it('a patch on a newer head answers without the document: replaying the patches between and its own gives exactly the stored head', async () => {
    const w = await world('<div id="d"><p id="a">one</p><p id="b">two</p><p id="c">three</p></div>');
    asSession({ id: w.owner.id, email: w.owner.email });
    const id = w.doc.id;
    const base = await head(id);
    // Two collaborators commit to other nodes first; the editor's save was prepared on `base`.
    for (const [from, to] of [['one', 'one, remote'], ['three', 'three, remote']]) {
      const now = await head(id);
      const res = await editsMineRoute(await request(`/api/my/artifacts/${id}/edits`, { method: 'POST', json: documentEditBody(now, { source: (now.source as string).replace(from, to) }) }), params({ id }));
      expect(res.status, await res.clone().text()).toBe(200);
    }
    const sent = documentEditBody(base, { source: '<div id="d"><p id="a">one</p><p id="b">two, typed</p><p id="c">three</p></div>' });
    const res = await editsMineRoute(await request(`/api/my/artifacts/${id}/edits`, { method: 'POST', json: sent }), params({ id }));
    expect(res.status, await res.clone().text()).toBe(200);
    const text = await res.text();
    const answer = JSON.parse(text);
    for (const key of ['document', 'markup', 'state', 'mutations']) expect(answer, key).not.toHaveProperty(key);
    expect(answer).toMatchObject({ version: base.version + 3, patch: sent.document_update.patch });
    expect(answer.remote_patches.map((step: { version: number }) => step.version)).toEqual([base.version + 1, base.version + 2]);
    let graph = base.document as never;
    for (const step of [...answer.remote_patches, { version: answer.version, patch: answer.patch }]) graph = advanceGraph(graph, step.version - 1, step.patch)! as never;
    const read = await (await getMineRoute(await request(`/api/my/artifacts/${id}`, {}), params({ id }))).json();
    expect(graph).toEqual(read.document);
    expect(graphSource(graph)).toBe(read.markup);
    expect(read.markup).toContain('one, remote');
    expect(read.markup).toContain('three, remote');
    expect(read.markup).toContain('two, typed');
    expect(answer.edit_id).toBe(read.edit_id);

    // A version between with no logged patch (a replacement, a conversion) leaves nothing to replay: the answer still
    // withholds the document, and says nothing about the versions between, so the editor reads the head itself.
    const from = await head(id);
    const remote = await editsMineRoute(await request(`/api/my/artifacts/${id}/edits`, { method: 'POST', json: documentEditBody(from, { source: (from.source as string).replace('three, remote', 'three, again') }) }), params({ id }));
    expect(remote.status, await remote.clone().text()).toBe(200);
    await (await getDb()).query(`DELETE FROM artifact_edits WHERE artifact_id=$1 AND (document_state->>'version')::int=$2`, [id, from.version + 1]);
    const late = await editsMineRoute(await request(`/api/my/artifacts/${id}/edits`, { method: 'POST', json: documentEditBody(from, { source: (from.source as string).replace('two, typed', 'two, typed again') }) }), params({ id }));
    expect(late.status, await late.clone().text()).toBe(200);
    const lateAnswer = await late.json();
    expect(lateAnswer.document).toBeUndefined();
    expect(lateAnswer.remote_patches).toBeUndefined();
    expect(lateAnswer.version).toBe(from.version + 2);
  });

  it('withholds the new document: no markup, state or mutations, and the head is settled after the answer exactly as an answered commit settles it', async () => {
    const DATA = (n: number) => `<Helmet><Value name="n" type="number" default={${n}} /><Query name="q">{\`select $n * 21 as n\`}</Query></Helmet><div><p id="a">Answer <Number data="$q" col="n" /></p><Mermaid title="D0" code={${JSON.stringify('flowchart LR\n  a[Request] --> b[Read]')}} /></div>`;
    const w = await world(DATA(2));
    asSession({ id: w.owner.id, email: w.owner.email });
    const twin = await create(w.ta.token, { markup: DATA(2), visibility: 'public' });
    const edit = async (id: string, echo: string) => {
      const base = await head(id);
      const res = await editsMineRoute(await request(`/api/my/artifacts/${id}/edits${echo}`, { method: 'POST', json: documentEditBody(base, { source: (base.source as string).replace('default={2}', 'default={3}') }) }), params({ id }));
      expect(res.status, await res.clone().text()).toBe(200);
      return { base, text: await res.text() };
    };
    const { base, text } = await edit(w.doc.id, '');
    const answer = JSON.parse(text);
    for (const key of ['document', 'markup', 'state', 'mutations']) expect(answer, key).not.toHaveProperty(key);
    expect(answer).toMatchObject({ id: w.doc.id, version: base.version + 1, edit_id: expect.any(String) });
    expect(answer).toHaveProperty('theme');
    expect(answer.patch).toBeDefined();
    expect(text.length).toBeLessThan(JSON.stringify(base.document).length);

    // The twin takes the same edit on the answered path, which settles inline; both heads end the same.
    // The withheld answer is the full answer's head, every other key included (a new column rides along).
    const full = JSON.parse((await edit(twin.id, '?echo=full')).text);
    const without = (keys: string[], drop: string[]) => keys.filter((k) => !drop.includes(k)).sort();
    expect(without(Object.keys(answer), ['patch'])).toEqual(without(Object.keys(full), ['document', 'markup', 'state', 'mutations']));
    await committedHeadsSettled();
    const [settled, answered] = [await getArtifactById(w.doc.id), await getArtifactById(twin.id)];
    // The two documents differ only in their stamped node ids (same length), so the stored records are the same
    // compiled dataflow, each certified against its own head's source.
    const record = (row: typeof settled) => storedCompiledDataflow(row!.meta, row!.source!);
    expect(record(settled)).not.toBeNull();
    expect(record(settled)).toEqual(record(answered));
    const db = await getDb();
    const harvests = async (id: string) => (await db.query<{ version: number }>('SELECT version FROM mermaid_harvests WHERE artifact_id=$1 ORDER BY version', [id])).rows.map((r) => r.version);
    expect(await harvests(w.doc.id)).toContain(settled!.version);
    expect(await harvests(twin.id)).toContain(answered!.version);

    // The first edit after a quiet spell archives the version it replaced, copied as stored: the archive is exactly
    // the pre-edit head, document and all.
    const archived = await getVersionFor({ userId: base.user_id, tokenId: base.token_id }, w.doc.id, base.version);
    expect(archived?.source).toBe(base.source);
    expect((await db.query<{ document: unknown }>('SELECT document FROM artifact_versions WHERE artifact_id=$1 AND version=$2', [w.doc.id, base.version])).rows[0]?.document).toEqual(base.document);
  });
});
