/**
 * TEST USERS: minted by an account, capped, erased with everything they own.
 * The operation family is the surface; `afbin testuser` and `--as` translate to it.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { agentCookie, useAppHarness } from './harness';
import { POST as createArtifactRoute } from '@/app/api/artifacts/route';
import { POST as forkOpRoute } from '@/app/api/artifacts/[id]/fork/route';
import { POST as likeRoute } from '@/app/api/my/artifacts/[id]/like/route';
import { POST as followRoute } from '@/app/api/users/[id]/follow/route';
import { POST as mutateRoute } from '@/app/a/[id]/mutate/route';
import { POST as newTestUser, GET as listTestUsers } from '@/app/api/testusers/route';
import { DELETE as deleteTestUser } from '@/app/api/testusers/[id]/route';
import { getArtifactById } from '@/lib/artifacts';
import { getUserById } from '@/lib/users';
import { mintToken } from '@/lib/tokens';
import { claimToken, createUser } from '@/lib/users';
import { TESTUSER_LIMITS } from '@artifactbin/contracts';

const BASE = 'http://localhost:3000';
useAppHarness();
const sessionUser = { id: '', email: '' };
vi.mock('@/auth', () => ({
  auth: async () => (sessionUser.id ? { user: { id: sessionUser.id, email: sessionUser.email || null } } : null),
}));
beforeEach(() => { sessionUser.id = ''; sessionUser.email = ''; });
const params = (id: string) => ({ params: Promise.resolve({ id }) });
const jreq = (path: string, method: string, body?: unknown, token?: string, cookie?: string) =>
  new Request(`${BASE}${path}`, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(cookie ? { Cookie: cookie, Origin: BASE } : {}) }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });

async function account(name: string) {
  const t = await mintToken(name); const u = await createUser({ email: `mxmx_test_${name}@example.com` }); await claimToken(u.id, t.token);
  return { token: t.token, tokenId: t.id, user: u };
}
const mint = async (token: string) => { const r = await newTestUser(jreq('/api/testusers', 'POST', {}, token)); expect(r.status, await r.clone().text()).toBe(201); return (await r.json()) as { id: string; label: string; expires_at: string }; };

describe('minting', () => {
  it(`mints up to ${TESTUSER_LIMITS.perAccount} per account, each a testuser with a parent, and refuses the next by name`, async () => {
    const a = await account('a');
    const made = [] as string[];
    for (let i = 0; i < TESTUSER_LIMITS.perAccount; i++) made.push((await mint(a.token)).id);
    for (const id of made) { const u = (await getUserById(id))!; expect(u.kind).toBe('testuser'); expect(u.parent_user_id).toBe(a.user.id); expect(u.email).toBeNull(); }
    const r = await newTestUser(jreq('/api/testusers', 'POST', {}, a.token));
    expect(r.status).toBe(409);
    expect((await r.json()).error).toBe('testuser_limit');
    const list = await listTestUsers(jreq('/api/testusers', 'GET', undefined, a.token));
    expect((await list.json()).testusers.map((t: { id: string }) => t.id).sort()).toEqual([...made].sort());
  });
  it('a guest cannot mint one', async () => {
    const { createGuestOwner } = await import('@/lib/guest-owner');
    const g = await createGuestOwner();
    const cookie = await agentCookie([g.tokenId]);
    const r = await newTestUser(jreq('/api/testusers', 'POST', {}, undefined, cookie));
    expect([401, 403]).toContain(r.status);
  });
});

describe('the sandbox', () => {
  it('fork --as <testuser> copies an account artifact into the test user, and deleting the test user erases it', async () => {
    const a = await account('owner');
    const page = await createArtifactRoute(jreq('/api/artifacts', 'POST', { markup: '<p>hello</p>', visibility: 'unlisted', title: 'Hello' }, a.token));
    const { id } = (await page.json()) as { id: string };
    const tu = await mint(a.token);
    const forked = await forkOpRoute(jreq(`/api/artifacts/${id}/fork`, 'POST', { as: { testuser: tu.id } }, a.token), params(id));
    expect(forked.status, await forked.clone().text()).toBe(201);
    const copy = (await forked.json()) as { id: string; owner?: string };
    expect((await getArtifactById(copy.id))!.user_id).toBe(tu.id);
    // Another account's test user is not yours to fork as.
    const b = await account('other');
    const refused = await forkOpRoute(jreq(`/api/artifacts/${id}/fork`, 'POST', { as: { testuser: tu.id } }, b.token), params(id));
    expect(refused.status).toBe(403);
    expect((await refused.json()).error).toBe('not_your_testuser');
    const gone = await deleteTestUser(jreq(`/api/testusers/${tu.id}`, 'DELETE', undefined, a.token), params(tu.id));
    expect(gone.status, await gone.clone().text()).toBe(200);
    expect(await getArtifactById(copy.id)).toBeNull();               // erased, not trashed
    expect(await getUserById(tu.id)).toBeNull();
    expect(await getArtifactById(id)).not.toBeNull();                 // the original is untouched
  });
});

describe('guests at the doors', () => {
  it('a guest liking, following or writing $_me is sent to sign in', async () => {
    const a = await account('host');
    const ds = await createArtifactRoute(jreq('/api/artifacts', 'POST', { dataset: [{ who: null }], columns: [{ name: 'who', type: 'user' }], access: 'readwrite', visibility: 'unlisted' }, a.token));
    const dsId = ((await ds.json()) as { id: string }).id;
    const page = await createArtifactRoute(jreq('/api/artifacts', 'POST', { markup: `<Helmet><Import name="join_data" src="ref:${dsId}" /><Mutation name="join">{\`insert into join_data.rows (who) select $_me.id\`}</Mutation></Helmet><Button run="$join">Join</Button>`, visibility: 'unlisted' }, a.token));
    const pageId = ((await page.json()) as { id: string }).id;
    const { createGuestOwner } = await import('@/lib/guest-owner');
    const g = await createGuestOwner();
    const cookie = await agentCookie([g.tokenId]);
    sessionUser.id = g.userId; sessionUser.email = '';
    for (const [name, res] of [
      ['like', await likeRoute(jreq(`/api/my/artifacts/${pageId}/like`, 'POST', undefined, undefined, cookie), params(pageId))],
      ['follow', await followRoute(jreq(`/api/users/${a.user.id}/follow`, 'POST', undefined, undefined, cookie), params(a.user.id))],
      ['join', await mutateRoute(jreq(`/a/${pageId}/mutate`, 'POST', { mutation: 'join' }, undefined, cookie), params(pageId))],
    ] as const) {
      expect([401, 403], name).toContain(res.status);
      expect((await res.json()).error, name).toBe('sign_in_required');
    }
  });
});
