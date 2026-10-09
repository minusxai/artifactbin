/**
 * Fork an artifact, through the API.
 *
 * A fork is the same artifact under a new owner and a new id; everything else
 * stays the same. Bytes are shared by content-addressed key, never re-uploaded.
 * History, comments, shares and placement belong to the original's life and do not
 * travel. The door is a browser credential (a person's act from the page): you
 * may fork what you can READ, the miss is the uniform 404, and an anonymous
 * browser has no account to own the copy.
 *
 * Agents fork too: `fork_artifact` on the operations registry (merged from
 * fork-operation.test.ts). The registry entry IS the surface: the bearer route
 * translates it. An agent may fork what its token can READ; the copy is the
 * token's own (account-wide for a claimed token), with three optional overrides
 * applied after the copy; the reply is create-shaped plus `forked_from`.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { agentCookie, useAppHarness, setSession } from './harness';
import { POST as forkRoute } from '@/app/api/my/artifacts/[id]/fork/route';
import { POST as forkOpRoute } from '@/app/api/artifacts/[id]/fork/route';
import { OPERATIONS as operations } from '@/lib/operations/registry';
import { POST as createArtifactRoute } from '@/app/api/artifacts/route';
import { GET as rawRoute } from '@/app/a/[id]/raw/route';
import { GET as pageRoute } from '@/app/api/page/artifact/[id]/route';
import { GET as getMineRoute } from '@/app/api/my/artifacts/[id]/route';
import { GET as getSharingRoute, PUT as putSharingRoute } from '@/app/api/my/artifacts/[id]/sharing/route';
import { GET as versionsMineRoute } from '@/app/api/my/artifacts/[id]/versions/route';
import { getArtifactById, getSharingFor, listArtifactsFor } from '@/lib/artifacts';
import { getDb } from '@/lib/platform';
import { mintAccountToken as mintToken } from '@/__tests__/harness';
import { claimToken, createUser } from '@/lib/accounts';

const BASE = 'http://localhost:3000';
useAppHarness();
beforeEach(() => setSession(() => (sessionUser.id ? { user: { id: sessionUser.id, email: sessionUser.email || null } } : null)));
const sessionUser = { id: '', email: '' };

const params = (id: string) => ({ params: Promise.resolve({ id }) });
const jreq = (path: string, method: string, body?: unknown, token?: string, cookie?: string) =>
  new Request(`${BASE}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(cookie ? { Cookie: cookie, Origin: BASE } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
const create = async (token: string, body: Record<string, unknown>) => {
  const res = await createArtifactRoute(jreq('/api/artifacts', 'POST', body, token));
  expect(res.status, await res.clone().text()).toBe(201);
  return (await res.json()) as { id: string; edit_id: string; version: number };
};
const asSession = (u: { id: string; email: string }) => { sessionUser.id = u.id; sessionUser.email = u.email; };
const noSession = () => { sessionUser.id = ''; sessionUser.email = ''; };
const fork = (id: string, cookie?: string) => forkRoute(jreq(`/api/my/artifacts/${id}/fork`, 'POST', undefined, undefined, cookie), params(id));
const head = async (id: string) => (await getArtifactById(id))!;

const PROSE = '<div><h1>Payroll</h1><p data-annotation-anchor="a1b2c3d4e">hello</p></div>';

beforeEach(() => noSession());

async function world(markup = PROSE, visibility: 'public' | 'private' = 'public') {
  const owner = await createUser({ email: 'owner@x.com' });
  const ta = await mintToken('a', owner.id);
    await claimToken(owner.id, ta.token);
  const bob = await createUser({ email: 'bob@x.com' });
  const tb = await mintToken('b', bob.id);
    await claimToken(bob.id, tb.token);
  // `anon` is a legacy anonymous token (no account); `independent` is a token with an account of its own.
  const anon = await mintToken('anon',null);
  const independent = await mintToken('independent-account');
  const doc = await create(ta.token, { markup, visibility, title: 'The NBA payroll stack', description: 'for the dashboard', theme: 'industry', template: 'dashboard' });
  return { ta, tb, anon, independent, owner, bob, doc };
}
/** A folder of this token's own — placement on the wire is an id. */
const createFolder = async (token: string, title: string) => (await create(token, { format: 'folder', title })).id;
/** The bearer door: POST /api/artifacts/:id/fork, the registry's `fork_artifact`. */
const bearerFork = (id: string, token?: string, body: Record<string, unknown> = {}) =>
  forkOpRoute(jreq(`/api/artifacts/${id}/fork`, 'POST', body, token), params(id));
const MUTATING = (ds: string) =>
  '<Helmet><Value name="choice" type="string" default="ramen" />'
  + `<Import name="vote_data" src="ref:${ds}" /><Mutation name="vote">{\`insert into vote_data.rows (choice) values ($choice)\`}</Mutation></Helmet>`
  + '<div><Button run="$vote">Vote</Button></div>';

describe('POST /api/my/artifacts/:id/fork', () => {
  it('a signed-in reader forks a public document: same content, new id and owner, version 1, provenance kept', async () => {
    const w = await world();
    // GENERAL ACCESS is a VALUE on the row, not a named share, so it travels
    // with visibility and access. Set it before forking: with both sides at the
    // NULL default the `link_role` leg of the field loop below asserts nothing.
    asSession({ id: w.owner.id, email: w.owner.email });
    const general = await putSharingRoute(jreq(`/api/my/artifacts/${w.doc.id}/sharing`, 'PUT', { linkRole: 'editor' }), params(w.doc.id));
    expect(general.status, await general.clone().text()).toBe(200);
    expect(((await general.json()) as { linkRole: string }).linkRole).toBe('editor');

    asSession({ id: w.bob.id, email: w.bob.email });
    const res = await fork(w.doc.id);
    expect(res.status, await res.clone().text()).toBe(201);
    const body = (await res.json()) as { id: string; url: string };
    expect(body.id).not.toBe(w.doc.id);
    expect(body.url).toContain(body.id);

    const source = await head(w.doc.id);
    const copy = await head(body.id);
    expect(copy.user_id).toBe(w.bob.id);
    expect(copy.user_id).not.toBe(source.user_id);
    for (const field of ['format', 'title', 'description', 'visibility', 'access', 'link_role'] as const) {
      expect(copy[field], field).toEqual(source[field]);
    }
    expect(source.link_role, 'the source carries the role the loop compares against').toBe('editor');
    // …and on the surface its new owner actually reads it from.
    const sharing = await getSharingRoute(jreq(`/api/my/artifacts/${body.id}/sharing`, 'GET'), params(body.id));
    expect(sharing.status, await sharing.clone().text()).toBe(200);
    expect(((await sharing.json()) as { linkRole: string }).linkRole).toBe('editor');
    expect(copy.meta.theme).toBe(source.meta.theme);
    expect(copy.meta.template).toBe(source.meta.template);
    expect(copy.version).toBe(1);
    expect(copy.forked_from).toBe(w.doc.id);
    expect(source.forked_from).toBeNull();
    // The original is untouched by being forked.
    expect(source.version).toBe(w.doc.version);
    expect(source.edit_id).toBe(w.doc.edit_id);
  });

  it('refuses to copy a document stored in a retired shape, by name', async () => {
    const w = await world();
    const db = await getDb();
    await db.query("UPDATE artifacts SET document=NULL,source=$2 WHERE id=$1", [w.doc.id, '<p id="old">Legacy</p>']);
    asSession(w.bob);
    const response = await fork(w.doc.id);
    expect(response.status, await response.clone().text()).toBe(410);
    expect(((await response.json()) as { error: string }).error).toBe('unservable_document');
  });

  it('the retired anchor attribute does not travel, while source identity and prose do', async () => {
    const w = await world();
    const source = await head(w.doc.id);
    // Inert on the original: publish keeps it as written, and the node has its own id.
    expect(source.source).toMatch(/<p data-annotation-anchor="a1b2c3d4e" id="([A-Za-z0-9]+)">hello<\/p>/);
    const id = /data-annotation-anchor="a1b2c3d4e" id="([A-Za-z0-9]+)"/.exec(source.source!)![1];
    asSession({ id: w.bob.id, email: w.bob.email });
    const res = await fork(w.doc.id);
    expect(res.status, await res.clone().text()).toBe(201);
    const copy = await head(((await res.json()) as { id: string }).id);
    expect(copy.source).not.toContain('data-annotation-anchor');
    expect(copy.source).toContain(`<p id="${id}">hello</p>`);
    expect(copy.source).toContain('Payroll');
  });

  it('history does not travel: the copy has one version, its own', async () => {
    const w = await world();
    asSession({ id: w.bob.id, email: w.bob.email });
    const id = ((await (await fork(w.doc.id)).json()) as { id: string }).id;
    const res = await versionsMineRoute(jreq(`/api/my/artifacts/${id}/versions`, 'GET'), params(id));
    expect(res.status).toBe(200);
    const versions = (await res.json()) as { versions?: unknown[] } | unknown[];
    const list = Array.isArray(versions) ? versions : versions.versions ?? [];
    expect(list.length).toBeLessThanOrEqual(1);
  });

  it('the owner wire carries forked_from on the copy and null on the source', async () => {
    const w = await world();
    asSession({ id: w.bob.id, email: w.bob.email });
    const id = ((await (await fork(w.doc.id)).json()) as { id: string }).id;
    const mine = await getMineRoute(jreq(`/api/my/artifacts/${id}`, 'GET'), params(id));
    expect(mine.status).toBe(200);
    expect(((await mine.json()) as { forked_from: string | null }).forked_from).toBe(w.doc.id);
    asSession({ id: w.owner.id, email: w.owner.email });
    const theirs = await getMineRoute(jreq(`/api/my/artifacts/${w.doc.id}`, 'GET'), params(w.doc.id));
    expect(((await theirs.json()) as { forked_from: string | null }).forked_from).toBeNull();
  });

  it('a legacy token cookie and no credential both fail browser fork authentication', async () => {
    const w = await world();
    const res = await fork(w.doc.id, await agentCookie([w.anon.id]));
    expect(res.status, await res.clone().text()).toBe(401);
    expect(((await res.json()) as { error: string }).error).toBe('unauthorized');
    expect((await fork(w.doc.id)).status).toBe(401);
  });

  // The uniform 404, a viewer's share, a document that writes another owner's dataset and a dataset copy sharing
  // its object key are the registry's rules, not the cookie door's: the bearer describes below assert them.

});

/**
 * What the seed does not reach: the sidecar state that must NOT travel, the
 * provenance event, and the same-site rule the browser door owes.
 */
describe('POST /api/my/artifacts/:id/fork — what does not travel', () => {
  it('shares do not travel: the copy is shared with nobody', async () => {
    const w = await world(PROSE, 'private');
    asSession({ id: w.owner.id, email: w.owner.email });
    const shared = await putSharingRoute(jreq(`/api/my/artifacts/${w.doc.id}/sharing`, 'PUT', { shares: [{ email: 'bob@x.com', role: 'editor' }] }), params(w.doc.id));
    expect(shared.status, await shared.clone().text()).toBe(200);

    asSession({ id: w.bob.id, email: w.bob.email });
    const res = await fork(w.doc.id);
    expect(res.status, await res.clone().text()).toBe(201);
    const copyId = ((await res.json()) as { id: string }).id;

    const bob = { tokenId: '', userId: w.bob.id };
    expect((await getSharingFor(bob, copyId))?.shares).toEqual([]);
    // The original's list is untouched by being forked.
    const owner = { tokenId: '', userId: w.owner.id };
    expect((await getSharingFor(owner, w.doc.id))?.shares).toEqual([{ email: 'bob@x.com', role: 'editor' }]);
  });

  it('placement does not travel: the copy is at the forker\'s root', async () => {
    const w = await world();
    const box = await create(w.ta.token, { format: 'folder', title: 'August' });
    const filed = await create(w.ta.token, { markup: '<div><p>filed</p></div>', visibility: 'public', parent_id: box.id });
    expect((await head(filed.id)).ancestor_ids).toEqual([box.id]);
    asSession({ id: w.bob.id, email: w.bob.email });
    const res = await fork(filed.id);
    expect(res.status, await res.clone().text()).toBe(201);
    // The source's folder is somebody ELSE's tree — the copy lands at the
    // forker's root, the only place they could have filed it.
    expect((await head(((await res.json()) as { id: string }).id)).ancestor_ids).toEqual([]);
  });

  it('a FOLDER is not forkable: its source names its own children table', async () => {
    const w = await world();
    const box = await create(w.ta.token, { format: 'folder', title: 'Reports', visibility: 'public' });
    asSession({ id: w.bob.id, email: w.bob.email });
    const res = await fork(box.id);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('not_forkable');
  });

  it('records a fork event against the SOURCE, with the forker as the user', async () => {
    const w = await world();
    asSession({ id: w.bob.id, email: w.bob.email });
    const res = await fork(w.doc.id);
    expect(res.status, await res.clone().text()).toBe(201);
    const copyId = ((await res.json()) as { id: string }).id;

    // trackEvent is fire-and-forget (never awaited by a route), so poll.
    const db = await getDb();
    let rows: Array<{ artifact_id: string; user_id: string | null }> = [];
    for (let i = 0; i < 40 && rows.length === 0; i++) {
      rows = (await db.query<{ artifact_id: string; user_id: string | null }>(
        "SELECT artifact_id, user_id FROM analytics_events WHERE event = 'fork'",
      )).rows;
      if (rows.length === 0) await new Promise((r) => setTimeout(r, 25));
    }
    expect(rows).toEqual([{ artifact_id: w.doc.id, user_id: w.bob.id }]);
    expect(rows[0].artifact_id).not.toBe(copyId);
  });

  it('a cookie-authorized fork must be SAME-SITE — both browser credentials', async () => {
    const w = await world();
    const crossSite = (id: string, cookie?: string) =>
      forkRoute(new Request(`${BASE}/api/my/artifacts/${id}/fork`, {
        method: 'POST',
        headers: { Origin: 'https://evil.example', ...(cookie ? { Cookie: cookie } : {}) },
      }), params(id));

    // The anonymous browser (agent cookie) …
    expect((await crossSite(w.doc.id, await agentCookie([w.anon.id]))).status).toBe(401);
    // … and the LOGGED-IN one, which is the credential a tokenId-keyed guard
    // would wave straight through.
    asSession({ id: w.bob.id, email: w.bob.email });
    expect((await crossSite(w.doc.id)).status).toBe(403);
    // Same-site, the same session forks.
    expect((await fork(w.doc.id)).status).toBe(201);
  });
});

/**
 * THE CREDIT LINE — the copy says where it came from, in the app page's own
 * bar around the document's frame (solid/document/DocumentActions, from the
 * page answer's `surface.author.forkedFrom`), and says it WITHOUT becoming an
 * existence oracle. The served document itself (`/raw`, what the frame loads)
 * carries no chrome and never names the source at all.
 *
 * The provenance is a fact about the copy, so it is resolved at render from
 * `forked_from` rather than written into the markup: an agent that rewrites
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
    expect(await served(copy.id)).toBe(html);
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
    expect(Object.keys(op!.input).sort()).toEqual(['as', 'dry_run', 'id', 'parent_id', 'title', 'visibility']);
    const codes = op!.errors.map((e) => e.code);
    expect(codes).toContain('not_found');
    expect(codes).toContain('quota_exceeded');
    // A folder's source names its own children table: a copy would list the
    // children of the original, so the door refuses by name.
    expect(codes).toContain('not_forkable');
    expect(codes).not.toContain('connection_owner_only');
    expect(op!.description).toMatch(/Postgres secret remains bound to the original dataset/);
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
    expect(String(body.markup)).toContain('Payroll');
    expect(String(body.markup)).not.toContain('data-annotation-anchor');
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
  it('a document that writes another owner\'s dataset is copied WITH that dataset, and the answer names the copies', async () => {
    const w = await world();
    const ds = await create(w.ta.token, { dataset: [{ choice: 'ramen' }], access: 'readwrite', visibility: 'public' });
    const doc = await create(w.ta.token, { markup: MUTATING(ds.id), visibility: 'public' });
    const res = await bearerFork(doc.id, w.tb.token);
    expect(res.status, await res.clone().text()).toBe(201);
    const body = (await res.json()) as { id: string; forked_from: string; datasets: Array<{ id: string; forked_from: string }> };
    expect(body.forked_from).toBe(doc.id);
    expect(body.datasets).toHaveLength(1);
    expect(body.datasets[0]!.forked_from).toBe(ds.id);
    const copiedDataset = await head(body.datasets[0]!.id);
    expect(copiedDataset.user_id).toBe(w.bob.id);
    expect(copiedDataset.access).toBe('readwrite');
    // The page is repointed at the copy, and nothing still names the original.
    const copy = await head(body.id);
    expect(copy.source).toContain(`ref:${body.datasets[0]!.id}`);
    expect(copy.source).not.toContain(`ref:${ds.id}`);
    expect((copy.meta.refs as Array<{ id: string }>).map((r) => r.id)).toEqual([body.datasets[0]!.id]);
  });

  it('dry_run answers what the fork would copy and creates nothing', async () => {
    const w = await world();
    const ds = await create(w.ta.token, { dataset: [{ choice: 'ramen' }], access: 'readwrite', visibility: 'public', title: 'votes' });
    const doc = await create(w.ta.token, { markup: MUTATING(ds.id), visibility: 'public' });
    const before = (await listArtifactsFor({ tokenId: w.tb.id, userId: w.bob.id })).length;
    const res = await bearerFork(doc.id, w.tb.token, { dry_run: true });
    expect(res.status, await res.clone().text()).toBe(200);
    expect(await res.json()).toEqual({ datasets: [{ id: ds.id, title: 'votes' }] });
    expect((await listArtifactsFor({ tokenId: w.tb.id, userId: w.bob.id })).length).toBe(before);
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
    expect(await listArtifactsFor({ tokenId: w.tb.id, userId: w.bob.id })).toHaveLength(0);
    const res = await rawFork(w.doc.id, w.tb.token, '{"visibility":"private"');
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('invalid_json');
    // Not a copy at the SOURCE's visibility — the refusal is the whole point.
    expect(await listArtifactsFor({ tokenId: w.tb.id, userId: w.bob.id })).toHaveLength(0);
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
