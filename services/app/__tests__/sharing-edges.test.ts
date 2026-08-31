/**
 * Edge cases around the ACL, folders, and the agent surfaces — the ones the
 * happy-path suites don't reach: share rows outliving their artifact, the
 * bounds on a share list, a folder whose NAME looks like a file id, the MCP
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

describe('a folder whose name looks like a file id', () => {
  it('falls through to the folder listing when no such file exists', async () => {
    const { owner, token } = await ownerFixture();
    // 'abc123' is a legal id shape AND a legal folder segment.
    await create(token, { title: 'inside', markup: '<h1>x</h1>', folder: 'abc123' });
    sessionUser.id = owner.id;
    sessionUser.email = owner.email;
    expect(await outcome(UserPage('@edgeowner', ['abc123']))).toBe('render');
  });

  it('but a real file of that id WINS over the folder of the same name', async () => {
    const { owner, token } = await ownerFixture();
    const doc = await create(token, { title: 'the file', markup: '<h1>x</h1>', visibility: 'public' });
    // Put another artifact in a folder named exactly like the first one's id.
    await create(token, { title: 'inside', markup: '<h1>y</h1>', folder: doc.id });
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

  it('both list surfaces carry visibility and folder', async () => {
    const { owner, token } = await ownerFixture();
    await create(token, { title: 'x', markup: '<h1>x</h1>', folder: 'reports/q3' });
    const byToken = await (await listArtifactsRoute(request('/api/artifacts', { token: token }))).json();
    expect(byToken.artifacts[0]).toMatchObject({ visibility: 'private', folder: 'reports/q3' });

    sessionUser.id = owner.id;
    sessionUser.email = owner.email;
    const byUser = await (await listMineRoute(request('/api/my/artifacts'))).json();
    expect(byUser.artifacts[0]).toMatchObject({ visibility: 'private', folder: 'reports/q3' });
  });

  it('an invalid visibility or folder on PUT is a 400, not a silent ignore', async () => {
    const { token } = await ownerFixture();
    const doc = await create(token, { title: 'x', markup: '<h1>x</h1>' });
    for (const [body, error] of [
      [{ markup: '<h1>y</h1>', visibility: 'hidden' }, 'invalid_visibility'],
      [{ markup: '<h1>y</h1>', folder: 'has space' }, 'invalid_folder'],
      [{ markup: '<h1>y</h1>', folder: 'a/'.repeat(9) }, 'invalid_folder'],
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

  it('update_artifact HONOURS visibility and folder — the doc tells agents to use it', async () => {
    const { token } = await ownerFixture();
    const made = await mcpCall(token, 'create_artifact', { title: 'x', markup: '<h1>x</h1>' });
    expect(made.data.visibility).toBe('private');

    // "make it shareable" — the agent's only lever, and it must actually pull.
    const updated = await mcpCall(token, 'update_artifact', {
      id: made.data.id as string, markup: '<h1>y</h1>', visibility: 'public', folder: 'shared/q3',
    });
    expect(updated.isError).toBe(false);
    expect(updated.data.visibility).toBe('public');

    const row = await (await harness.db()).query<{ visibility: string; folder: string }>(
      'SELECT visibility, folder FROM artifacts WHERE id = $1', [made.data.id],
    );
    expect(row.rows[0]).toEqual({ visibility: 'public', folder: 'shared/q3' });
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

  it('rejects a malformed folder instead of storing it', async () => {
    const { token } = await ownerFixture();
    const bad = await mcpCall(token, 'create_artifact', { title: 'x', markup: '<h1>x</h1>', folder: 'has space' });
    expect(bad.isError).toBe(true);
    expect(bad.data.error).toBe('invalid_folder');

    const good = await mcpCall(token, 'create_artifact', { title: 'x', markup: '<h1>x</h1>', folder: '/reports/q3/' });
    expect(good.isError).toBe(false);
  });
});
