/**
 * THE ANONYMOUS "MY DRAFTS" LISTING (tok-p2) — GET /api/page/home through the REAL handler.
 *
 * A browser that holds tokens in its agent cookie is shown what those tokens created and nobody has claimed,
 * newest first — in BOTH shapes: the actor the proxy attaches (heldTokenIds) and the in-process cookie.
 * A claimed artifact is not a draft. A browser holding nothing gets exactly today's answer. A signed-in
 * account's answer does not change.
 *
 * Seeded RED by the orchestrator; make it green without changing an expectation.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GET as homePage } from '@/app/api/page/home/route';
import { createArtifact } from '@/lib/artifacts';


import { mintToken, revokeToken } from '@/lib/tokens';
import { claimTokenById, createUser } from '@/lib/users';
import { agentCookie, request } from './harness';
import { useAppHarness } from '@/__tests__/harness';

const harness = useAppHarness();

const sessionUser = { id: '', email: '' };
vi.mock('@/auth', () => ({ auth: async () => (sessionUser.id ? { user: { id: sessionUser.id, email: sessionUser.email || null } } : null) }));

const body = (r: Response) => r.json() as Promise<Record<string, unknown>>;
const draft = (tokenId: string, title: string) =>
  createArtifact(tokenId, null, { format: 'markup', content: '', source: '<div />', meta: {}, title, description: null });
type Draft = { id: string; url: string; title: string | null };

beforeEach(async () => {
  sessionUser.id = ''; sessionUser.email = '';
});

describe('GET /api/page/home for a browser holding tokens', () => {
  it('lists the unclaimed drafts its held tokens created, newest first (proxy-attached actor)', async () => {
    const a = await mintToken('a');
    const b = await mintToken('b');
    const first = await draft(a.id, 'first');
    await (await harness.db()).query("UPDATE artifacts SET updated_at = updated_at - interval '1 second' WHERE id = $1", [first.id]);
    const second = await draft(b.id, 'second');
    const res = await homePage(request('/api/page/home', { actor: { credential: 'agent-cookie', tokenId: b.id, heldTokenIds: [a.id, b.id] } }));
    expect(res.status).toBe(200);
    const home = await body(res);
    expect(home.signedIn).toBe(false);
    const drafts = home.drafts as Draft[];
    expect(drafts.map((d) => d.id)).toEqual([second.id, first.id]);
    expect(drafts[0]).toMatchObject({ url: `/a/${second.id}`, title: 'second' });
  });

  it('reads the same held ids from the in-process cookie when no proxy is in front', async () => {
    const a = await mintToken('a');
    const first = await draft(a.id, 'first');
    const cookie = await agentCookie([a.id]);
    const home = await body(await homePage(request('/api/page/home', { cookie })));
    expect((home.drafts as Draft[]).map((d) => d.id)).toEqual([first.id]);
  });

  it('a claimed artifact is no longer a draft', async () => {
    const c = await mintToken('c');
    await draft(c.id, 'claimed');
    const user = await createUser({ email: 'mxmx_test_claimer@example.com' });
    expect((await claimTokenById(user.id, c.id))?.claimedArtifacts).toBe(1);
    const home = await body(await homePage(request('/api/page/home', { actor: { credential: 'agent-cookie', tokenId: c.id, heldTokenIds: [c.id] } })));
    expect(home.drafts).toEqual([]);
  });

  it('a REVOKED held token yields no drafts, even when a stale cookie still names it (found on production, 2026-08-31)', async () => {
    const a = await mintToken('a');
    await draft(a.id, 'was mine');
    const cookie = await agentCookie([a.id]);
    expect(((await body(await homePage(request('/api/page/home', { cookie })))).drafts as Draft[]).length).toBe(1);
    await revokeToken(a.id);
    const after = await body(await homePage(request('/api/page/home', { cookie })));
    expect(after.signedIn).toBe(false);
    expect(after.drafts ?? []).toEqual([]);
    const attached = await body(await homePage(request('/api/page/home', { actor: { credential: 'agent-cookie', tokenId: a.id, heldTokenIds: [a.id] } })));
    expect(attached.drafts ?? []).toEqual([]);
  });

  it('an EXPIRED held token yields no drafts either — expired is nothing, on every path', async () => {
    const a = await mintToken('a');
    await draft(a.id, 'was mine');
    await (await harness.db()).query("UPDATE tokens SET expires_at = now() - interval '1 minute' WHERE id = $1", [a.id]);
    const home = await body(await homePage(request('/api/page/home', { actor: { credential: 'agent-cookie', tokenId: a.id, heldTokenIds: [a.id] } })));
    expect(home.drafts ?? []).toEqual([]);
  });

  it('a browser holding nothing gets exactly today\'s answer', async () => {
    const home = await body(await homePage(request('/api/page/home')));
    expect(home).toEqual({ signedIn: false });
  });

  it('a signed-in account\'s answer does not change', async () => {
    const user = await createUser({ email: 'mxmx_test_owner@example.com' });
    sessionUser.id = user.id; sessionUser.email = user.email ?? '';
    const home = await body(await homePage(request('/api/page/home', { actor: { credential: 'session', userId: user.id, email: user.email ?? '', emailVerified: true } })));
    expect(home.signedIn).toBe(true);
    expect(home).not.toHaveProperty('drafts');
  });
});
