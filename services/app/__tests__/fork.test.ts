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
import { GET as getMineRoute } from '@/app/api/my/artifacts/[id]/route';
import { PUT as putSharingRoute } from '@/app/api/my/artifacts/[id]/sharing/route';
import { GET as versionsMineRoute } from '@/app/api/my/artifacts/[id]/versions/route';
import { getArtifactById } from '@/lib/artifacts';
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
