/**
 * F1 (API half) — fork an artifact (SEEDED RED by the orchestrator).
 *
 * A fork is the same artifact under a new owner and a new id; everything else
 * stays the same. Bytes are shared by content-addressed key, never re-uploaded.
 * History, comments, shares and folder belong to the original's life and do not
 * travel. The door is a browser credential (a person's act from the page): you
 * may fork what you can READ, the miss is the uniform 404, and an anonymous
 * browser has no account to own the copy.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { agentCookie, useAppHarness } from './harness';
import { POST as forkRoute } from '@/app/api/my/artifacts/[id]/fork/route';
import { POST as createArtifactRoute } from '@/app/api/artifacts/route';
import { GET as rawRoute } from '@/app/a/[id]/raw/route';
import { GET as getMineRoute } from '@/app/api/my/artifacts/[id]/route';
import { GET as getSharingRoute, PUT as putSharingRoute } from '@/app/api/my/artifacts/[id]/sharing/route';
import { GET as versionsMineRoute } from '@/app/api/my/artifacts/[id]/versions/route';
import { getArtifactById, getSharingFor } from '@/lib/artifacts';
import { getDb } from '@/lib/db';
import { mintToken } from '@/lib/tokens';
import { claimToken, createUser } from '@/lib/users';

const BASE = 'http://localhost:3000';
useAppHarness();
const sessionUser = { id: '', email: '' };
vi.mock('@/auth', () => ({
  auth: async () => (sessionUser.id ? { user: { id: sessionUser.id, email: sessionUser.email || null } } : null),
}));

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
  const res = await createArtifactRoute(jreq('/api/artifacts?v=2', 'POST', body, token));
  expect(res.status, await res.clone().text()).toBe(201);
  return (await res.json()) as { id: string; edit_id: string; version: number };
};
const asSession = (u: { id: string; email: string }) => { sessionUser.id = u.id; sessionUser.email = u.email; };
const noSession = () => { sessionUser.id = ''; sessionUser.email = ''; };
const fork = (id: string, cookie?: string) => forkRoute(jreq(`/api/my/artifacts/${id}/fork`, 'POST', undefined, undefined, cookie), params(id));
const head = async (id: string) => (await getArtifactById(id))!;

const PROSE = '<div><h1>Payroll</h1><p data-annotation-anchor="a1b2c3d4e">hello</p></div>';
const MUTATING = (ds: string) =>
  '<Helmet><Value name="choice" type="string" default="ramen" />'
  + `<Mutation name="vote">{\`insert into ref_${ds} (choice) values ($choice)\`}</Mutation></Helmet>`
  + '<div><Button run="$vote">Vote</Button></div>';

beforeEach(() => noSession());

async function world(markup = PROSE, visibility: 'public' | 'private' = 'public') {
  const ta = await mintToken('a');
  const owner = await createUser({ email: 'owner@x.com' });
  await claimToken(owner.id, ta.token);
  const tb = await mintToken('b');
  const bob = await createUser({ email: 'bob@x.com' });
  await claimToken(bob.id, tb.token);
  const anon = await mintToken('anon');
  const doc = await create(ta.token, { markup, visibility, title: 'The NBA payroll stack', description: 'for the dashboard', theme: 'industry', template: 'dashboard' });
  return { ta, tb, anon, owner, bob, doc };
}

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

  it('comments do not travel: every annotation anchor is stripped from the copy, the prose is not', async () => {
    const w = await world();
    expect((await head(w.doc.id)).source).toContain('data-annotation-anchor');
    asSession({ id: w.bob.id, email: w.bob.email });
    const res = await fork(w.doc.id);
    expect(res.status, await res.clone().text()).toBe(201);
    const copy = await head(((await res.json()) as { id: string }).id);
    expect(copy.source).not.toContain('data-annotation-anchor');
    expect(copy.source).toContain('<p>hello</p>');
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

  it('a private document you cannot read is the uniform 404; shared as a viewer it forks', async () => {
    const w = await world(PROSE, 'private');
    asSession({ id: w.bob.id, email: w.bob.email });
    expect((await fork(w.doc.id)).status).toBe(404);
    expect((await fork('zzzzzz')).status).toBe(404);

    asSession({ id: w.owner.id, email: w.owner.email });
    const shared = await putSharingRoute(jreq(`/api/my/artifacts/${w.doc.id}/sharing`, 'PUT', { shares: [{ email: 'bob@x.com', role: 'viewer' }] }), params(w.doc.id));
    expect(shared.status, await shared.clone().text()).toBe(200);
    asSession({ id: w.bob.id, email: w.bob.email });
    const res = await fork(w.doc.id);
    expect(res.status, await res.clone().text()).toBe(201);
    // The copy is bob's and keeps the source's visibility; nobody is shared on it.
    const copy = await head(((await res.json()) as { id: string }).id);
    expect(copy.visibility).toBe('private');
    expect(copy.user_id).toBe(w.bob.id);
  });

  it('an anonymous browser cannot own a fork: 409 sign_in_required; no credential at all is 401', async () => {
    const w = await world();
    const res = await fork(w.doc.id, await agentCookie([w.anon.id]));
    expect(res.status, await res.clone().text()).toBe(409);
    expect(((await res.json()) as { error: string }).error).toBe('sign_in_required');
    expect((await fork(w.doc.id)).status).toBe(401);
  });

  it('a document that writes another owner\'s dataset is refused by name, not copied broken', async () => {
    const w = await world();
    const ds = await create(w.ta.token, { dataset: [{ choice: 'ramen' }], access: 'readwrite', visibility: 'public' });
    const doc = await create(w.ta.token, { markup: MUTATING(ds.id), visibility: 'public' });
    asSession({ id: w.bob.id, email: w.bob.email });
    const res = await fork(doc.id);
    expect(res.status).toBe(400);
    expect(await res.text()).toMatch(/not yours to write/);
  });

  it('every format forks; a dataset fork shares the object key rather than re-uploading', async () => {
    const w = await world();
    const ds = await create(w.ta.token, { dataset: [{ month: '2026-01', revenue: 120 }], visibility: 'public' });
    asSession({ id: w.bob.id, email: w.bob.email });
    const res = await fork(ds.id);
    expect(res.status, await res.clone().text()).toBe(201);
    const copy = await head(((await res.json()) as { id: string }).id);
    const source = await head(ds.id);
    expect(copy.format).toBe('dataset');
    expect(copy.meta.objectKey).toBe(source.meta.objectKey);
    expect(copy.meta.columns).toEqual(source.meta.columns);
    expect(copy.user_id).toBe(w.bob.id);
  });
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

  it('a folder does not travel: the copy is at the forker\'s root', async () => {
    const w = await world();
    const filed = await create(w.ta.token, { markup: '<div><p>filed</p></div>', visibility: 'public', folder: '2026/08' });
    expect((await head(filed.id)).folder).toBe('2026/08');
    asSession({ id: w.bob.id, email: w.bob.email });
    const res = await fork(filed.id);
    expect(res.status, await res.clone().text()).toBe(201);
    expect((await head(((await res.json()) as { id: string }).id)).folder).toBe('');
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
    expect((await crossSite(w.doc.id, await agentCookie([w.anon.id]))).status).toBe(403);
    // … and the LOGGED-IN one, which is the credential a tokenId-keyed guard
    // would wave straight through.
    asSession({ id: w.bob.id, email: w.bob.email });
    expect((await crossSite(w.doc.id)).status).toBe(403);
    // Same-site, the same session forks.
    expect((await fork(w.doc.id)).status).toBe(201);
  });
});

/**
 * THE CREDIT LINE — the copy says where it came from, in the served document's
 * own footer, and says it WITHOUT becoming an existence oracle.
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
  const served = async (id: string, query = '') =>
    (await rawRoute(new Request(`${BASE}/a/${id}/raw${query}`), params(id))).text();

  it('names and links a source anyone may read', async () => {
    const w = await world();
    asSession({ id: w.bob.id, email: w.bob.email });
    const copy = (await (await fork(w.doc.id)).json()) as { id: string };
    noSession();
    const html = await served(copy.id);
    expect(html).toContain('data-mx-forked-from');
    expect(html).toContain('forked from');
    // The source is NAMED and reachable — the canonical address it would be
    // shared at (the handle and slug are decoration the resolver adds when the
    // owner has them; the id is what makes it an address).
    expect(html).toMatch(new RegExp(`<a href="[^"]*${w.doc.id}[^"]*" target="_top" aria-label="Open the artifact this was forked from"`));
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
    const html = await served(copy.id);
    expect(html).toContain('forked from a document that is not public');
    expect(html).not.toContain(w.doc.id);
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
    const html = await served(copy.id);
    expect(html).toContain('forked from a document that is not public');
    expect(html).not.toContain(w.doc.id);

    // …and DELETED is byte-identical to private. One branch, so there is
    // nothing here for a reader to tell the two apart with.
    await db.query('DELETE FROM artifacts WHERE id = $1', [w.doc.id]);
    expect(await served(copy.id)).toBe(html);
  });

  it('a document nobody forked keeps the credits it always had', async () => {
    const w = await world();
    noSession();
    expect(await served(w.doc.id)).not.toContain('data-mx-forked-from');
  });
});
