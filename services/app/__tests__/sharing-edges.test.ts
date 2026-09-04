/**
 * Edge cases around the ACL, placement, and the agent surfaces — the ones the
 * happy-path suites don't reach: share rows outliving their artifact, the
 * bounds on a share list, a trailing segment that looks like a file id, the MCP
 * tool's own validation, and what the list/metadata surfaces disclose.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useAppHarness, request } from '@/__tests__/harness';
import { artifactMetadata, artifactPage as ArtifactPage, profilePage as UserPage } from '@/test/helpers/pages';
import { POST as mcp } from '@/app/mcp/route';
import { DELETE as deleteArtifactRoute, PUT as putArtifact } from '@/app/api/artifacts/[id]/route';
import { GET as listArtifactsRoute, POST as createArtifactRoute } from '@/app/api/artifacts/route';
import { GET as listMineRoute } from '@/app/api/my/artifacts/route';
import { DELETE as deleteMineRoute } from '@/app/api/my/artifacts/[id]/route';
import { PUT as putSharingRoute } from '@/app/api/my/artifacts/[id]/sharing/route';
import { getArtifactById } from '@/lib/artifacts';
import { mintToken } from '@/lib/tokens';
import { claimToken, createUser, ensureUsername, setUsername } from '@/lib/users';

const BASE = 'http://localhost:3000';
const harness = useAppHarness();
const sessionUser = { id: '', email: '' };
vi.mock('@/auth', () => ({
  auth: async () => (sessionUser.id ? { user: { id: sessionUser.id, email: sessionUser.email || null } } : null),
}));
const params = <T extends Record<string, string>>(p: T) => ({ params: Promise.resolve(p) });

const mcpCall = async (token: string, name: string, args: Record<string, unknown>) => {
  const res = await mcp(new Request(`${BASE}/mcp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
  }));
  const body = (await res.json()) as { result: { content: Array<{ text: string }>; isError?: boolean } };
  return { isError: body.result.isError ?? false, data: JSON.parse(body.result.content[0].text) as Record<string, unknown> };
};

async function outcome(p: Promise<unknown>): Promise<'render' | 'redirect' | 'notFound'> {
  try {
    // The pages answer as data now (test/helpers/pages): the outcome IS the value.
    const value = await p;
    if (value && typeof value === 'object' && 'kind' in (value as Record<string, unknown>)) return (value as { kind: 'render' | 'redirect' | 'notFound' }).kind;
    return 'render';
  } catch (error) {
    const digest = String((error as { digest?: string }).digest ?? '');
    if (digest.startsWith('NEXT_REDIRECT')) return 'redirect';
    if (digest.includes('NOT_FOUND') || digest.includes('404')) return 'notFound';
    throw error;
  }
}

async function ownerFixture() {
  const owner = await ensureUsername(await createUser({ email: 'edge@example.com' }));
  await setUsername(owner.id, 'edgeowner');
  const t = await mintToken('edge');
  await claimToken(owner.id, t.token);
  return { owner, token: t.token };
}

const create = async (token: string, body: Record<string, unknown>, expected = 201) => {
  const res = await createArtifactRoute(request('/api/artifacts', { method: 'POST', token: token, json: body }));
  expect(res.status).toBe(expected);
  return res.json() as Promise<Record<string, unknown> & { id: string }>;
};

beforeEach(async () => {
  sessionUser.id = '';
  sessionUser.email = '';
});

describe('share rows never outlive their artifact', () => {
  const sharesFor = async (id: string) =>
    (await (await harness.db()).query('SELECT 1 FROM artifact_shares WHERE artifact_id = $1', [id])).rows.length;

  it('the bearer DELETE takes the share list with it', async () => {
    const { owner, token } = await ownerFixture();
    const doc = await create(token, { title: 'x', markup: '<h1>x</h1>' });
    sessionUser.id = owner.id;
    sessionUser.email = owner.email;
    await putSharingRoute(request(`/api/my/artifacts/${doc.id}/sharing`, { method: 'PUT', json: { shares: ['a@b.com'] } }), params({ id: doc.id }));
    expect(await sharesFor(doc.id)).toBe(1);

    expect((await deleteArtifactRoute(request(`/api/artifacts/${doc.id}`, { method: 'DELETE', token: token }), params({ id: doc.id }))).status).toBe(200);
    // A recycled id must never inherit a stranger's grant.
    expect(await sharesFor(doc.id)).toBe(0);
  });

  it('the session DELETE does too', async () => {
    const { owner, token } = await ownerFixture();
    const doc = await create(token, { title: 'x', markup: '<h1>x</h1>' });
    sessionUser.id = owner.id;
    sessionUser.email = owner.email;
    await putSharingRoute(request(`/api/my/artifacts/${doc.id}/sharing`, { method: 'PUT', json: { shares: ['a@b.com'] } }), params({ id: doc.id }));
    expect((await deleteMineRoute(request(`/api/my/artifacts/${doc.id}`, { method: 'DELETE' }), params({ id: doc.id }))).status).toBe(200);
    expect(await sharesFor(doc.id)).toBe(0);
  });
});

describe('share-list bounds', () => {
  it('refuses an unbounded list rather than storing it', async () => {
    const { owner, token } = await ownerFixture();
    const doc = await create(token, { title: 'x', markup: '<h1>x</h1>' });
    sessionUser.id = owner.id;
    sessionUser.email = owner.email;
    const tooMany = Array.from({ length: 101 }, (_, i) => `u${i}@example.com`);
    const res = await putSharingRoute(request(`/api/my/artifacts/${doc.id}/sharing`, { method: 'PUT', json: { shares: tooMany } }), params({ id: doc.id }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('invalid_shares');
  });

  it('takes a list right at the bound, deduped case-insensitively', async () => {
    const { owner, token } = await ownerFixture();
    const doc = await create(token, { title: 'x', markup: '<h1>x</h1>' });
    sessionUser.id = owner.id;
    sessionUser.email = owner.email;
    const hundred = Array.from({ length: 100 }, (_, i) => `U${i}@Example.com`);
    const res = await putSharingRoute(request(`/api/my/artifacts/${doc.id}/sharing`, { method: 'PUT', json: { shares: hundred } }), params({ id: doc.id }));
    expect(res.status).toBe(200);
    expect((await res.json()).shares).toHaveLength(100);
  });
});

describe('a trailing segment that looks like a file id', () => {
  /*
   * There is no listing below the handle any more: a folder is an artifact
   * with its own id-anchored address, so nesting left the URL entirely. What
   * used to be "does the file win over the folder of the same name" is now the
   * simpler pair — an id resolves, and anything else is the uniform 404.
   */
  it('an id-shaped segment naming nothing is the uniform 404, never a listing', async () => {
    const { owner } = await ownerFixture();
    sessionUser.id = owner.id;
    sessionUser.email = owner.email;
    expect(await outcome(UserPage('@edgeowner', ['abc123']))).toBe('notFound');
  });

  it('a real file of that id resolves, and heals to its canonical address', async () => {
    const { owner, token } = await ownerFixture();
    const doc = await create(token, { title: 'the file', markup: '<h1>x</h1>', visibility: 'public' });
    sessionUser.id = owner.id;
    sessionUser.email = owner.email;
    // Resolving by id means the canonical redirect, not a listing render.
    expect(await outcome(UserPage('@edgeowner', [doc.id]))).toBe('redirect');
  });
});

describe('what the surfaces disclose', () => {
  it('a private doc unfurls as nothing — no title for a stranger', async () => {
    const { token } = await ownerFixture();
    const doc = await create(token, { title: 'Secret Title', markup: '<h1>x</h1>' });
    const meta = await artifactMetadata(doc.id);
    expect(meta).toEqual({});
  });

  it('both list surfaces carry visibility and placement', async () => {
    const { owner, token } = await ownerFixture();
    const box = await create(token, { format: 'folder', title: 'Q3' });
    await create(token, { title: 'x', markup: '<h1>x</h1>', parent_id: box.id });
    const byToken = await (await listArtifactsRoute(request('/api/artifacts', { token: token }))).json();
    expect(byToken.artifacts.find((a: { id: string }) => a.id !== box.id)).toMatchObject({ visibility: 'private', parent_id: box.id, ancestor_ids: [box.id] });

    sessionUser.id = owner.id;
    sessionUser.email = owner.email;
    const byUser = await (await listMineRoute(request('/api/my/artifacts'))).json();
    expect(byUser.artifacts.find((a: { id: string }) => a.id !== box.id)).toMatchObject({ visibility: 'private', parent_id: box.id, ancestor_ids: [box.id] });
  });

  it('an invalid visibility or parent on PUT is a 400, not a silent ignore', async () => {
    const { token } = await ownerFixture();
    const doc = await create(token, { title: 'x', markup: '<h1>x</h1>' });
    const notAFolder = await create(token, { title: 'plain', markup: '<h1>z</h1>' });
    for (const [body, error] of [
      [{ markup: '<h1>y</h1>', visibility: 'hidden' }, 'invalid_visibility'],
      // Unknown, and not-a-folder: ONE refusal, because the parent must be
      // yours and telling them apart says whether an id exists.
      [{ markup: '<h1>y</h1>', parent_id: 'zzzzzz' }, 'invalid_parent'],
      [{ markup: '<h1>y</h1>', parent_id: notAFolder.id }, 'invalid_parent'],
      // The retired PATH field is answered by name, never as "invalid".
      [{ markup: '<h1>y</h1>', folder: 'reports/q3' }, 'folder_retired'],
    ] as const) {
      const res = await putArtifact(request(`/api/artifacts/${doc.id}`, { method: 'PUT', token: token, json: body }), params({ id: doc.id }));
      expect(res.status, JSON.stringify(body)).toBe(400);
      expect((await res.json()).error).toBe(error);
    }
  });
});

describe('the MCP tool validates the same way the REST route does', () => {
  it('an anonymous token cannot publish private; an account-owned one defaults to it', async () => {
    const anon = await mintToken('anon');
    const refused = await mcpCall(anon.token, 'create_artifact', { title: 'x', markup: '<h1>x</h1>', visibility: 'private' });
    expect(refused.isError).toBe(true);
    expect(refused.data.error).toBe('private_requires_account');

    const anonDefault = await mcpCall(anon.token, 'create_artifact', { title: 'x', markup: '<h1>x</h1>' });
    expect(anonDefault.data.visibility).toBe('public');

    const { token } = await ownerFixture();
    const owned = await mcpCall(token, 'create_artifact', { title: 'x', markup: '<h1>x</h1>' });
    expect(owned.data.visibility).toBe('private');
  });

  it('update_artifact HONOURS visibility and parent_id — the doc tells agents to use it', async () => {
    const { token } = await ownerFixture();
    const box = await mcpCall(token, 'create_artifact', { format: 'folder', title: 'Shared' });
    expect(box.isError).toBe(false);
    const made = await mcpCall(token, 'create_artifact', { title: 'x', markup: '<h1>x</h1>' });
    expect(made.data.visibility).toBe('private');

    // "make it shareable" — the agent's only lever, and it must actually pull.
    const updated = await mcpCall(token, 'update_artifact', {
      id: made.data.id as string, markup: '<h1>y</h1>', visibility: 'public', parent_id: box.data.id as string,
    });
    expect(updated.isError).toBe(false);
    expect(updated.data.visibility).toBe('public');

    const row = await (await harness.db()).query<{ visibility: string; ancestor_ids: string[] }>(
      'SELECT visibility, ancestor_ids FROM artifacts WHERE id = $1', [made.data.id],
    );
    expect(row.rows[0]).toEqual({ visibility: 'public', ancestor_ids: [box.data.id] });
  });

  it('update_artifact refuses private on an anonymous token, like the REST route', async () => {
    const anon = await mintToken('anon2');
    const made = await mcpCall(anon.token, 'create_artifact', { title: 'x', markup: '<h1>x</h1>' });
    const refused = await mcpCall(anon.token, 'update_artifact', {
      id: made.data.id as string, markup: '<h1>y</h1>', visibility: 'private',
    });
    expect(refused.isError).toBe(true);
    expect(refused.data.error).toBe('private_requires_account');
  });

  it('rejects an unreachable parent instead of storing it, and names the retired field', async () => {
    const { token } = await ownerFixture();
    const bad = await mcpCall(token, 'create_artifact', { title: 'x', markup: '<h1>x</h1>', parent_id: 'zzzzzz' });
    expect(bad.isError).toBe(true);
    expect(bad.data.error).toBe('invalid_parent');

    /*
     * The RETIRED field over MCP: the tool's own schema no longer declares
     * `folder`, so the SDK strips it before the operation runs and the document
     * lands at the root. That is the same thing every other retired input
     * (`markdown`, `html`, `jsx`) already does over this transport — a JSON-RPC
     * tool call is validated against a declared schema, where an HTTP body is
     * not — and REST, which sees the raw body, answers `folder_retired` by name
     * (asserted above, on PUT).
     */
    const retired = await mcpCall(token, 'create_artifact', { title: 'x', markup: '<h1>x</h1>', folder: 'reports/q3' });
    expect(retired.isError).toBe(false);
    expect((await getArtifactById(retired.data.id as string))!.ancestor_ids).toEqual([]);

    const box = await mcpCall(token, 'create_artifact', { format: 'folder', title: 'Reports' });
    const good = await mcpCall(token, 'create_artifact', { title: 'x', markup: '<h1>x</h1>', parent_id: box.data.id as string });
    expect(good.isError).toBe(false);
  });
});
