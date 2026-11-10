/**
 * FORKS, continued (fork.test.ts): the fork credit line, fork_artifact on the operations registry and the bearer door.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { nativeResponseIdentity } from './native-response-identity';
import { useAppHarness, setSession } from './harness';
import { POST as forkOpRoute } from '@/app/api/artifacts/[id]/fork/route';
import { OPERATIONS as operations } from '@/lib/operations/registry';
import { GET as rawRoute } from '@/app/a/[id]/raw/route';
import { GET as pageRoute } from '@/app/api/page/artifact/[id]/route';
import { PUT as putSharingRoute } from '@/app/api/my/artifacts/[id]/sharing/route';
import { listArtifactsFor } from '@/lib/artifacts/testing';
import { getDb } from '@/lib/platform';
import { mintAccountToken as mintToken } from '@/__tests__/harness';
import { firstSaveLinks } from '@/__tests__/stored-links';
import { identityForUser } from '@/lib/accounts';
import { BASE, sessionUser, params, jreq, create, asSession, noSession, fork, head, PROSE, world, createFolder, bearerFork } from './fork-fixture';

useAppHarness();
beforeEach(() => setSession(() => (sessionUser.id ? { user: { id: sessionUser.id, email: sessionUser.email || null } } : null)));
beforeEach(() => { noSession(); });

/**
 * THE CREDIT LINE — the copy says where it came from, in the app page's own
 * bar around the document's frame (solid/document/DocumentActions, from the
 * page answer's `surface.author.forkedFrom`), and says it WITHOUT becoming an
 * existence oracle. The served document itself (`/raw`, what the frame loads)
 * carries no chrome and never names the source at all.
 *
 * The provenance is a fact about the copy, so it is resolved at render from
 * `forked_from` rather than written into the html: an agent that rewrites
 * the document cannot delete the attribution, and nothing about the source is
 * baked into bytes that outlive its ACL.
 *
 * The test is VISIBILITY, and deliberately not "may a stranger read it".
 * `unlisted` is stranger-READABLE — that is the whole tier — but it exists to
 * be listed NOWHERE, and a credit line that names it republishes its canonical
 * address in every public fork, chosen by the forker rather than by the person
 * who picked the tier. So only `public` is named; `unlisted`, `private` and
 * GONE all produce the same neutral sentence with no link and no id, which is
 * also what keeps the line from being an existence oracle: there is no branch
 * for a reader to tell those three apart with.
 */
describe('the fork credit line', () => {
  it('preserves page provenance for anonymous authors and redacts every non-public source', async () => {
    const w = await world();
    asSession({ id: w.bob.id, email: w.bob.email });
    const copy = (await (await fork(w.doc.id)).json()) as { id: string };
    const db = await getDb();
    await db.query('UPDATE artifacts SET user_id = NULL, visibility = $2 WHERE id = $1', [copy.id, 'public']);
    noSession();
    const author = async () => (await (await pageRoute(new Request(`${BASE}/api/page/artifact/${copy.id}`), params(copy.id))).json()).surface.author;
    expect(await author()).toMatchObject({ username: null, forkedFrom: { href: expect.stringContaining(w.doc.id) } });
    for (const visibility of ['unlisted', 'private']) {
      await db.query('UPDATE artifacts SET visibility = $2 WHERE id = $1', [w.doc.id, visibility]);
      expect(await author()).toEqual({ username: null, id: null, image: null, forkedFrom: { label: 'a document that is not public', href: null } });
    }
    await db.query('DELETE FROM artifacts WHERE id = $1', [w.doc.id]);
    expect(await author()).toEqual({ username: null, id: null, image: null, forkedFrom: { label: 'a document that is not public', href: null } });
  });
  const served = async (id: string, query = '') =>
    (await rawRoute(new Request(`${BASE}/a/${id}/raw${query}`), params(id))).text();
  const credit = async (id: string) =>
    (await (await pageRoute(new Request(`${BASE}/api/page/artifact/${id}`), params(id))).json()).surface.author.forkedFrom;

  it('names and links a source anyone may read', async () => {
    const w = await world();
    asSession({ id: w.bob.id, email: w.bob.email });
    const copy = (await (await fork(w.doc.id)).json()) as { id: string };
    noSession();
    // The source is NAMED and reachable — the canonical address it would be
    // shared at (the handle and slug are decoration the resolver adds when the
    // owner has them; the id is what makes it an address).
    const named = await credit(copy.id);
    expect(named.href).toContain(w.doc.id);
    expect(named.label).toBe(named.href.replace(/^\//, ''));
    // The document's own bytes carry no credit: the line is the app's, drawn around the frame.
    const html = await served(copy.id);
    expect(html).not.toContain('data-mx-forked-from');
    expect(html).not.toContain(w.doc.id);
  });

  it('says nothing about an UNLISTED source — a fork is not a listing surface', async () => {
    const w = await world();
    asSession({ id: w.bob.id, email: w.bob.email });
    const copy = (await (await fork(w.doc.id)).json()) as { id: string };
    // The owner narrows the source AFTER the fork — the copy is public and its
    // credits must stop naming it, because `unlisted` means listed nowhere and
    // the forker is not the person who chose that.
    const db = await getDb();
    await db.query('UPDATE artifacts SET visibility = $2 WHERE id = $1', [w.doc.id, 'unlisted']);
    noSession();
    expect(await credit(copy.id)).toEqual({ label: 'a document that is not public', href: null });
    expect(await served(copy.id)).not.toContain(w.doc.id);
  });

  it('says the SAME thing for a private source, and for one that is gone', async () => {
    const w = await world(PROSE, 'private');
    // The owner's own agent may still fork what it created…
    asSession({ id: w.owner.id, email: w.owner.email });
    const copy = (await (await fork(w.doc.id)).json()) as { id: string };
    // …and the copy, made public, must not become a way to learn the id exists.
    const db = await getDb();
    await db.query('UPDATE artifacts SET visibility = $2 WHERE id = $1', [copy.id, 'public']);
    noSession();
    const said = await credit(copy.id);
    expect(said).toEqual({ label: 'a document that is not public', href: null });
    const html = await served(copy.id);
    expect(html).not.toContain(w.doc.id);

    // …and DELETED is identical to private. One branch, so there is
    // nothing here for a reader to tell the two apart with.
    await db.query('DELETE FROM artifacts WHERE id = $1', [w.doc.id]);
    expect(await credit(copy.id)).toEqual(said);
    const deleted=nativeResponseIdentity(await served(copy.id)),privateSource=nativeResponseIdentity(html);
    expect(deleted.nonce).not.toBe(privateSource.nonce);
    expect(deleted.html).toBe(privateSource.html);
  });

  it('a document nobody forked keeps the credits it always had', async () => {
    const w = await world();
    noSession();
    expect(await credit(w.doc.id)).toBeNull();
    expect(await served(w.doc.id)).not.toContain('data-mx-forked-from');
  });
});

describe('fork_artifact on the operations registry', () => {
  it('carries the decided contract: address, a plain write, the three overrides, the shared error vocabulary', () => {
    const op = operations.find((o) => o.name === 'fork_artifact');
    expect(op).toBeDefined();
    expect(op!.http).toEqual({ method: 'POST', path: '/api/artifacts/{id}/fork' });
    expect(op!.annotations.readOnly ?? false).toBe(false);
    expect(op!.annotations.destructive ?? false).toBe(false);
    expect(Object.keys(op!.input).sort()).toEqual(['as', 'destination', 'dry_run', 'id', 'parent_id', 'title', 'visibility']);
    const codes = op!.errors.map((e) => e.code);
    expect(codes).toContain('not_found');
    expect(codes).toContain('quota_exceeded');
    // A folder's source names its own children table: a copy would list the
    // children of the original, so the door refuses by name.
    expect(codes).toContain('not_forkable');
    expect(codes).not.toContain('connection_owner_only');
    expect(op!.description).toMatch(/Folders are not forkable/);
    expect(op!.description).not.toMatch(/Postgres/);
    expect(op!.description.length).toBeGreaterThan(80);
    expect(op!.example.input).toMatchObject({ id: expect.any(String) });
  });
});

describe('POST /api/artifacts/:id/fork (bearer)', () => {
  it('a token forks a public document it can read: a create-shaped reply plus forked_from, the copy its own', async () => {
    const w = await world();
    const res = await bearerFork(w.doc.id, w.independent.token);
    expect(res.status, await res.clone().text()).toBe(201);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.id).not.toBe(w.doc.id);
    expect(body.forked_from).toBe(w.doc.id);
    expect(typeof body.edit_id).toBe('string');
    expect(body.version).toBe(1);
    expect(String(body.url)).toContain(String(body.id));
    expect(String(body.html)).toContain('Payroll');
    expect(String(body.html)).toContain('data-af-id=');
    const copy = await head(String(body.id));
    expect(copy.token_id).toBe(w.independent.id);
    expect(copy.user_id).toBe(w.independent.userId);
    expect(copy.title).toBe('The NBA payroll stack');
    const source = await head(w.doc.id);
    expect(source.version).toBe(w.doc.version);
    expect(source.edit_id).toBe(w.doc.edit_id);
  });

  it('a claimed token forks account-wide, and the three overrides land on the copy only', async () => {
    const w = await world();
    // The COPY's parent is one of the FORKER's own folders — nothing about the
    // source's tree is carried, because it is somebody else's.
    const box = await createFolder(w.tb.token, 'Forks');
    const res = await bearerFork(w.doc.id, w.tb.token, { title: 'My copy', visibility: 'unlisted', parent_id: box });
    expect(res.status, await res.clone().text()).toBe(201);
    const body = (await res.json()) as { id: string; visibility: string; title: string; parent_id: string | null };
    expect(body.title).toBe('My copy');
    expect(body.visibility).toBe('unlisted');
    expect(body.parent_id).toBe(box);
    const copy = await head(body.id);
    expect(copy.user_id).toBe(w.bob.id);
    expect(copy.title).toBe('My copy');
    expect(copy.visibility).toBe('unlisted');
    expect(copy.ancestor_ids).toEqual([box]);
    const source = await head(w.doc.id);
    expect(source.title).toBe('The NBA payroll stack');
    expect(source.ancestor_ids).toEqual([]);
  });

  it('a folder of somebody else\'s is not a parent this forker may name: one refusal', async () => {
    const w = await world();
    const theirs = await createFolder(w.ta.token, 'Theirs');
    const res = await bearerFork(w.doc.id, w.tb.token, { parent_id: theirs });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe('invalid_parent');
  });

  it('a legacy anonymous token cannot authenticate to make a private copy', async () => {
    const w = await world();
    const legacy = await mintToken('legacy', null);
    const res = await bearerFork(w.doc.id, legacy.token, { visibility: 'private' });
    expect(res.status).toBe(401);
    expect((await res.json()).error).toBe('unauthorized');
  });

  it('unreadable and unknown are the uniform 404; no credential is 401', async () => {
    const w = await world(PROSE, 'private');
    expect((await bearerFork(w.doc.id, w.tb.token)).status).toBe(404);
    expect((await bearerFork(w.doc.id, w.independent.token)).status).toBe(404);
    expect((await bearerFork('zzzzzz', w.tb.token)).status).toBe(404);
    expect((await bearerFork(w.doc.id)).status).toBe(401);
  });

  it('a private document shared to the account is reachable through the account\'s token', async () => {
    const w = await world(PROSE, 'private');
    sessionUser.id = w.owner.id; sessionUser.email = w.owner.email;
    const shared = await putSharingRoute(jreq(`/api/my/artifacts/${w.doc.id}/sharing`, 'PUT', { shares: [{ email: 'bob@x.com', role: 'viewer' }] }), params(w.doc.id));
    expect(shared.status, await shared.clone().text()).toBe(200);
    sessionUser.id = ''; sessionUser.email = '';
    const res = await bearerFork(w.doc.id, w.tb.token);
    expect(res.status, await res.clone().text()).toBe(201);
    const copy = await head(((await res.json()) as { id: string }).id);
    expect(copy.user_id).toBe(w.bob.id);
    expect(copy.visibility).toBe('private');
  });

  /*
   * A document that WRITES another owner's dataset used to be refused here by
   * name ("not yours to write"), which meant an app could not be forked by
   * anybody but its author. It is copied instead: the dataset comes along under
   * the forker, and the answer says which copies it made.
   */
  it('native dataset links retain their original live identity and grant no copied write authority', async () => {
    const w=await world();const ds=await create(w.ta.token,{dataset:[{choice:'ramen'}],visibility:'public'});
    const html=`<html><head><link rel="af-dataset" data-af-name="votes" href="ref:${ds.id}"></head><body>Votes</body></html>`;
    const doc=await create(w.ta.token,{html,visibility:'public'});
    const res=await bearerFork(doc.id,w.tb.token);expect(res.status).toBe(201);const body=await res.json();expect(body.datasets).toEqual([]);
    // The fork keeps the source's stored links (API included), which are the first save's.
    const copy=await head(body.id);expect(copy.source).toContain(`ref:${ds.id}`);expect(copy.meta.htmlLinks).toEqual((await head(doc.id)).meta.htmlLinks);expect(copy.meta.htmlLinks).toEqual(firstSaveLinks(html));
  });

  it('native dry_run creates neither a page nor dataset copies',async()=>{
    const w=await world();const before=(await listArtifactsFor(identityForUser(w.bob.id,w.tb.id))).length;
    const res=await bearerFork(w.doc.id,w.tb.token,{dry_run:true});expect(res.status).toBe(200);expect(await res.json()).toEqual({datasets:[]});
    expect((await listArtifactsFor(identityForUser(w.bob.id,w.tb.id))).length).toBe(before);
  });

  it('an ordinary document copies no datasets: the answer says so with an empty list', async () => {
    const w = await world();
    const res = await bearerFork(w.doc.id, w.tb.token);
    expect(res.status, await res.clone().text()).toBe(201);
    expect(((await res.json()) as { datasets: unknown[] }).datasets).toEqual([]);
  });

  /*
   * A fork's body is OPTIONAL — it holds nothing but the
   * three overrides — so an ABSENT body means "keep everything". A body that
   * was SENT and does not parse is a different fact and must not collapse
   * into the same answer: the JSON the caller meant may have been
   * `{"visibility":"private"}`, and publishing the copy at the source's
   * visibility with a 201 is exactly the silent downgrade
   * `private_requires_account` exists to refuse.
   */
  const rawFork = (id: string, token: string, body?: string) =>
    forkOpRoute(new Request(`${BASE}/api/artifacts/${id}/fork`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
      ...(body !== undefined ? { body } : {}),
    }), params(id));

  it('a fork with NO body is the ordinary fork: nothing to override, everything kept', async () => {
    const w = await world();
    const res = await rawFork(w.doc.id, w.independent.token);
    expect(res.status, await res.clone().text()).toBe(201);
    const body = (await res.json()) as { id: string; title: string; visibility: string; forked_from: string };
    expect(body.forked_from).toBe(w.doc.id);
    expect(body.title).toBe('The NBA payroll stack');
    expect(body.visibility).toBe('public');
  });

  it('a body that was SENT and does not parse is invalid_json, and nothing is created', async () => {
    const w = await world();
    expect(await listArtifactsFor(identityForUser(w.bob.id, w.tb.id))).toHaveLength(0);
    const res = await rawFork(w.doc.id, w.tb.token, '{"visibility":"private"');
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('invalid_json');
    // Not a copy at the SOURCE's visibility — the refusal is the whole point.
    expect(await listArtifactsFor(identityForUser(w.bob.id, w.tb.id))).toHaveLength(0);
  });

  it('every format forks; a dataset copy shares the object key', async () => {
    const w = await world();
    const ds = await create(w.ta.token, { dataset: [{ month: '2026-01', revenue: 120 }], visibility: 'public' });
    const res = await bearerFork(ds.id, w.tb.token);
    expect(res.status, await res.clone().text()).toBe(201);
    const copy = await head(((await res.json()) as { id: string }).id);
    const source = await head(ds.id);
    expect(copy.format).toBe('dataset');
    expect(copy.meta.objectKey).toBe(source.meta.objectKey);
    expect(copy.meta.columns).toEqual(source.meta.columns);
    expect(copy.forked_from).toBe(ds.id);
  });
});
