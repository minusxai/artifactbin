/**
 * F8 — agents can fork: `fork_artifact` on the operations registry (SEEDED RED by the orchestrator).
 *
 * The registry entry IS the surface: the bearer route is a translation layer over
 * it and the MCP tool renders from it. An agent may fork what its token can READ;
 * the copy is the token's own (account-wide for a claimed token), with three
 * optional overrides applied after the copy; the reply is create-shaped plus
 * `forked_from`; every refusal is the existing vocabulary.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useAppHarness } from './harness';
import { POST as forkOpRoute } from '@/app/api/artifacts/[id]/fork/route';
import { POST as createArtifactRoute } from '@/app/api/artifacts/route';
import { PUT as putSharingRoute } from '@/app/api/my/artifacts/[id]/sharing/route';
import { OPERATIONS as operations } from '@/lib/operations/registry';
import { getArtifactById, listArtifactsFor } from '@/lib/artifacts';
import { mintToken } from '@/lib/tokens';
import { claimToken, createUser } from '@/lib/users';

const BASE = 'http://localhost:3000';
useAppHarness();
const sessionUser = { id: '', email: '' };
vi.mock('@/auth', () => ({
  auth: async () => (sessionUser.id ? { user: { id: sessionUser.id, email: sessionUser.email || null } } : null),
}));

const params = (id: string) => ({ params: Promise.resolve({ id }) });
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
/** A folder of this token's own — placement on the wire is an id. */
const createFolder = async (token: string, title: string) => (await create(token, { format: 'folder', title })).id;
const fork = (id: string, token?: string, body: Record<string, unknown> = {}) =>
  forkOpRoute(jreq(`/api/artifacts/${id}/fork`, 'POST', body, token), params(id));
const head = async (id: string) => (await getArtifactById(id))!;

const PROSE = '<div><h1>Payroll</h1><p data-annotation-anchor="a1b2c3d4e">hello</p></div>';
const MUTATING = (ds: string) =>
  '<Helmet><Value name="choice" type="string" default="ramen" />'
  + `<Mutation name="vote">{\`insert into ref_${ds} (choice) values ($choice)\`}</Mutation></Helmet>`
  + '<div><Button run="$vote">Vote</Button></div>';

beforeEach(() => { sessionUser.id = ''; sessionUser.email = ''; });

async function world(visibility: 'public' | 'private' = 'public') {
  const ta = await mintToken('a');
  const owner = await createUser({ email: 'owner@x.com' });
  await claimToken(owner.id, ta.token);
  const tb = await mintToken('b');
  const bob = await createUser({ email: 'bob@x.com' });
  await claimToken(bob.id, tb.token);
  const anon = await mintToken('anon');
  const doc = await create(ta.token, { markup: PROSE, visibility, title: 'The NBA payroll stack', description: 'for the dashboard', theme: 'industry' });
  return { ta, tb, anon, owner, bob, doc };
}

describe('fork_artifact on the operations registry', () => {
  it('carries the decided contract: address, a plain write, the three overrides, the shared error vocabulary', () => {
    const op = operations.find((o) => o.name === 'fork_artifact');
    expect(op).toBeDefined();
    expect(op!.http).toEqual({ method: 'POST', path: '/api/artifacts/{id}/fork' });
    expect(op!.annotations.readOnly ?? false).toBe(false);
    expect(op!.annotations.destructive ?? false).toBe(false);
    expect(Object.keys(op!.input).sort()).toEqual(['id', 'parent_id', 'title', 'visibility']);
    const codes = op!.errors.map((e) => e.code);
    expect(codes).toContain('not_found');
    expect(codes).toContain('quota_exceeded');
    // A folder's source names its own children table: a copy would list the
    // children of the original, so the door refuses by name.
    expect(codes).toContain('not_forkable');
    expect(op!.description.length).toBeGreaterThan(80);
    expect(op!.example.input).toMatchObject({ id: expect.any(String) });
  });
});

describe('POST /api/artifacts/:id/fork (bearer)', () => {
  it('a token forks a public document it can read: a create-shaped reply plus forked_from, the copy its own', async () => {
    const w = await world();
    const res = await fork(w.doc.id, w.anon.token);
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
    expect(copy.token_id).toBe(w.anon.id);
    expect(copy.user_id).toBeNull();
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
    const res = await fork(w.doc.id, w.tb.token, { title: 'My copy', visibility: 'unlisted', parent_id: box });
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
    const res = await fork(w.doc.id, w.tb.token, { parent_id: theirs });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe('invalid_parent');
  });

  it('an anonymous token cannot make the copy private: the existing visibility rule, never a silent downgrade', async () => {
    const w = await world();
    const res = await fork(w.doc.id, w.anon.token, { visibility: 'private' });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBeTruthy();
  });

  it('unreadable and unknown are the uniform 404; no credential is 401', async () => {
    const w = await world('private');
    expect((await fork(w.doc.id, w.tb.token)).status).toBe(404);
    expect((await fork(w.doc.id, w.anon.token)).status).toBe(404);
    expect((await fork('zzzzzz', w.tb.token)).status).toBe(404);
    expect((await fork(w.doc.id)).status).toBe(401);
  });

  it('a private document shared to the account is reachable through the account\'s token', async () => {
    const w = await world('private');
    sessionUser.id = w.owner.id; sessionUser.email = w.owner.email;
    const shared = await putSharingRoute(jreq(`/api/my/artifacts/${w.doc.id}/sharing`, 'PUT', { shares: [{ email: 'bob@x.com', role: 'viewer' }] }), params(w.doc.id));
    expect(shared.status, await shared.clone().text()).toBe(200);
    sessionUser.id = ''; sessionUser.email = '';
    const res = await fork(w.doc.id, w.tb.token);
    expect(res.status, await res.clone().text()).toBe(201);
    const copy = await head(((await res.json()) as { id: string }).id);
    expect(copy.user_id).toBe(w.bob.id);
    expect(copy.visibility).toBe('private');
  });

  it('a document that writes another owner\'s dataset is refused by name, not copied broken', async () => {
    const w = await world();
    const ds = await create(w.ta.token, { dataset: [{ choice: 'ramen' }], access: 'readwrite', visibility: 'public' });
    const doc = await create(w.ta.token, { markup: MUTATING(ds.id), visibility: 'public' });
    const res = await fork(doc.id, w.tb.token);
    expect(res.status).toBe(400);
    const text = await res.text();
    expect(text).toMatch(/invalid_refs/);
    expect(text).toMatch(/not yours to write/);
  });

  /*
   * ADDED (round 3). A fork's body is OPTIONAL — it holds nothing but the
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
    const res = await rawFork(w.doc.id, w.anon.token);
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
    const res = await fork(ds.id, w.tb.token);
    expect(res.status, await res.clone().text()).toBe(201);
    const copy = await head(((await res.json()) as { id: string }).id);
    const source = await head(ds.id);
    expect(copy.format).toBe('dataset');
    expect(copy.meta.objectKey).toBe(source.meta.objectKey);
    expect(copy.forked_from).toBe(ds.id);
  });
});
