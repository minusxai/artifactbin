/**
 * The visibility ACL — the thing that makes a 6-char id safe to be short.
 *
 * Three states: 'public' (anyone with the link reads; lists on the owner's
 * public profile), 'unlisted' (reads like public, listed nowhere), and
 * 'private' (owner + an email share-list). Defaults: user-owned docs are
 * born private, anonymous docs are born public (no owner to anchor an ACL —
 * asking for private without an account is a 400, never a silent downgrade).
 * Denials are uniform 404s BEFORE any other work: a private doc must be
 * indistinguishable from a missing one.
 */
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAppHarness, request } from '@/__tests__/harness';
import { GET as rawRoute } from '@/app/a/[id]/raw/route';
import { GET as eventsRoute } from '@/app/a/[id]/events/route';
import { GET as exportRoute } from '@/app/a/[id]/export/route';
import { GET as getArtifactRoute, PUT as putArtifact } from '@/app/api/artifacts/[id]/route';
import { POST as createArtifactRoute } from '@/app/api/artifacts/route';
import { GET as getSharingRoute, PUT as putSharingRoute } from '@/app/api/my/artifacts/[id]/sharing/route';
import { resetLiveSubscriptions } from '@/lib/story/live';
import { mintToken } from '@/lib/tokens';
import { claimToken, createUser } from '@/lib/users';

const BASE = 'http://localhost:3000';
useAppHarness();

// Owns the session mock for this file: id + email, settable per test.
const sessionUser = { id: '', email: '' };
vi.mock('@/auth', () => ({
  auth: async () =>
    sessionUser.id ? { user: { id: sessionUser.id, email: sessionUser.email || null } } : null,
}));

const params = <T extends Record<string, string>>(p: T) => ({ params: Promise.resolve(p) });

async function create(token: string, body: Record<string, unknown>, expected = 201) {
  const res = await createArtifactRoute(request('/api/artifacts', { method: 'POST', token: token, json: body }));
  expect(res.status).toBe(expected);
  return res.json() as Promise<Record<string, unknown> & { id: string; visibility?: string; error?: string }>;
}

/** An anonymous token, and a user-owned token belonging to a fresh account. */
async function fixtures() {
  const anon = await mintToken('anon');
  const owner = await createUser({ email: 'owner@example.com' });
  const owned = await mintToken('owned');
  const claimed = await claimToken(owner.id, owned.token);
  expect(claimed).not.toBeNull();
  return { anonToken: anon.token, ownedToken: owned.token, owner };
}

beforeEach(async () => {
  await resetLiveSubscriptions();
  sessionUser.id = '';
  sessionUser.email = '';
});

afterAll(async () => {
  await resetLiveSubscriptions();
});

describe('defaults and validation', () => {
  it('anonymous docs are born public; user-owned docs are born private', async () => {
    const { anonToken, ownedToken } = await fixtures();
    const anonDoc = await create(anonToken, { title: 'a', markup: '<h1>a</h1>' });
    expect(anonDoc.visibility).toBe('public');
    const ownedDoc = await create(ownedToken, { title: 'o', markup: '<h1>o</h1>' });
    expect(ownedDoc.visibility).toBe('private');
  });

  it('an explicit visibility on create wins; private without an account is a 400', async () => {
    const { anonToken, ownedToken } = await fixtures();
    const openDoc = await create(ownedToken, { title: 'o', markup: '<h1>o</h1>', visibility: 'public' });
    expect(openDoc.visibility).toBe('public');
    const refused = await create(anonToken, { title: 'a', markup: '<h1>a</h1>', visibility: 'private' }, 400);
    expect(refused.error).toBe('private_requires_account');
    const garbage = await create(anonToken, { title: 'a', markup: '<h1>a</h1>', visibility: 'hidden' }, 400);
    expect(garbage.error).toBe('invalid_visibility');
  });

  it("'unlisted' creates for both token kinds — it acts as public, so no account is needed", async () => {
    const { anonToken, ownedToken } = await fixtures();
    const owned = await create(ownedToken, { title: 'u', markup: '<h1>u</h1>', visibility: 'unlisted' });
    expect(owned.visibility).toBe('unlisted');
    const anon = await create(anonToken, { title: 'u', markup: '<h1>u</h1>', visibility: 'unlisted' });
    expect(anon.visibility).toBe('unlisted');
  });

  it("strangers read an 'unlisted' doc exactly like a public one", async () => {
    const { ownedToken } = await fixtures();
    const doc = await create(ownedToken, { title: 'u', markup: '<h1>u</h1>', visibility: 'unlisted' });
    const res = await rawRoute(request(`/a/${doc.id}/raw`), params({ id: doc.id }));
    expect(res.status).toBe(200);
  });

  it("the sharing surface can flip to 'unlisted'", async () => {
    const { ownedToken, owner } = await fixtures();
    const doc = await create(ownedToken, { title: 'u', markup: '<h1>u</h1>' });
    sessionUser.id = owner.id;
    sessionUser.email = owner.email;
    const res = await putSharingRoute(
      request(`/api/my/artifacts/${doc.id}/sharing`, { method: 'PUT', json: { visibility: 'unlisted' } }),
      params({ id: doc.id }),
    );
    expect(res.status).toBe(200);
    expect(((await res.json()) as { visibility: string }).visibility).toBe('unlisted');
  });

  it('PUT may flip visibility; omitting it preserves the current value', async () => {
    const { ownedToken } = await fixtures();
    const doc = await create(ownedToken, { title: 'o', markup: '<h1>o</h1>' });
    const flipped = await (await putArtifact(
      request(`/api/artifacts/${doc.id}`, { method: 'PUT', token: ownedToken, json: { markup: '<h1>o2</h1>', visibility: 'public' } }),
      params({ id: doc.id }),
    )).json();
    expect(flipped.visibility).toBe('public');
    const kept = await (await putArtifact(
      request(`/api/artifacts/${doc.id}`, { method: 'PUT', token: ownedToken, json: { markup: '<h1>o3</h1>' } }),
      params({ id: doc.id }),
    )).json();
    expect(kept.visibility).toBe('public');
  });

  it('the wire shape carries visibility', async () => {
    const { anonToken } = await fixtures();
    const doc = await create(anonToken, { title: 'a', markup: '<h1>a</h1>' });
    const wire = await (await getArtifactRoute(request(`/api/artifacts/${doc.id}`, { token: anonToken }), params({ id: doc.id }))).json();
    expect(wire.visibility).toBe('public');
  });
});

describe('read enforcement — uniform 404, decided before serving', () => {
  it('a private doc 404s for no-session, strangers, and wrong emails; serves for the owner and invited emails', async () => {
    const { ownedToken, owner } = await fixtures();
    const doc = await create(ownedToken, { title: 'secret', markup: '<h1>secret</h1>' });

    // No session.
    expect((await rawRoute(request(`/a/${doc.id}/raw`), params({ id: doc.id }))).status).toBe(404);
    expect((await eventsRoute(request(`/a/${doc.id}/events`), params({ id: doc.id }))).status).toBe(404);
    expect((await exportRoute(request(`/a/${doc.id}/export`), params({ id: doc.id }))).status).toBe(404);

    // A different account.
    const stranger = await createUser({ email: 'stranger@example.com' });
    sessionUser.id = stranger.id;
    sessionUser.email = stranger.email;
    expect((await rawRoute(request(`/a/${doc.id}/raw`), params({ id: doc.id }))).status).toBe(404);

    // The owner.
    sessionUser.id = owner.id;
    sessionUser.email = owner.email;
    const ownerRead = await rawRoute(request(`/a/${doc.id}/raw`), params({ id: doc.id }));
    expect(ownerRead.status).toBe(200);
    expect(await ownerRead.text()).toContain('secret');

    // Share with an email that has no account yet, then log in as it.
    const shared = await putSharingRoute(
      request(`/api/my/artifacts/${doc.id}/sharing`, { method: 'PUT', json: { shares: ['Invitee@Example.com'] } }),
      params({ id: doc.id }),
    );
    expect(shared.status).toBe(200);

    const invitee = await createUser({ email: 'invitee@example.com' });
    sessionUser.id = invitee.id;
    sessionUser.email = invitee.email;
    expect((await rawRoute(request(`/a/${doc.id}/raw`), params({ id: doc.id }))).status).toBe(200);
    expect((await eventsRoute(request(`/a/${doc.id}/events`), params({ id: doc.id }))).status).toBe(200);

    // An uninvited email still 404s.
    const outsider = await createUser({ email: 'outsider@example.com' });
    sessionUser.id = outsider.id;
    sessionUser.email = outsider.email;
    expect((await rawRoute(request(`/a/${doc.id}/raw`), params({ id: doc.id }))).status).toBe(404);
  });

  it('public docs serve with no session at all', async () => {
    const { anonToken } = await fixtures();
    const doc = await create(anonToken, { title: 'open', markup: '<h1>open</h1>' });
    expect((await rawRoute(request(`/a/${doc.id}/raw`), params({ id: doc.id }))).status).toBe(200);
    expect((await eventsRoute(request(`/a/${doc.id}/events`), params({ id: doc.id }))).status).toBe(200);
  });
});

describe('the sharing surface (session-only, owner-only)', () => {
  it('GET reports visibility + shares; PUT updates either; both answer uniform 404 off-owner', async () => {
    const { ownedToken, owner } = await fixtures();
    const doc = await create(ownedToken, { title: 'secret', markup: '<h1>s</h1>' });

    // No session → 401 (the /api/my surface).
    expect((await getSharingRoute(request(`/api/my/artifacts/${doc.id}/sharing`), params({ id: doc.id }))).status).toBe(401);

    sessionUser.id = owner.id;
    sessionUser.email = owner.email;
    const initial = await (await getSharingRoute(request(`/api/my/artifacts/${doc.id}/sharing`), params({ id: doc.id }))).json();
    expect(initial).toMatchObject({ visibility: 'private', shares: [] });

    // Shares are normalized to lowercase and deduped; visibility flips ride the same PUT.
    const updated = await (await putSharingRoute(
      request(`/api/my/artifacts/${doc.id}/sharing`, { method: 'PUT', json: { visibility: 'public', shares: ['A@B.com', 'a@b.com', 'c@d.com'] } }),
      params({ id: doc.id }),
    )).json();
    expect(updated).toMatchObject({ visibility: 'public', shares: [{ email: 'a@b.com', role: 'viewer' }, { email: 'c@d.com', role: 'viewer' }] });

    // A malformed email is rejected, not silently dropped.
    const bad = await putSharingRoute(
      request(`/api/my/artifacts/${doc.id}/sharing`, { method: 'PUT', json: { shares: ['not-an-email'] } }),
      params({ id: doc.id }),
    );
    expect(bad.status).toBe(400);

    // A stranger gets the uniform 404 — never confirmation the doc exists.
    const stranger = await createUser({ email: 'stranger@example.com' });
    sessionUser.id = stranger.id;
    sessionUser.email = stranger.email;
    expect((await getSharingRoute(request(`/api/my/artifacts/${doc.id}/sharing`), params({ id: doc.id }))).status).toBe(404);
    expect((await putSharingRoute(
      request(`/api/my/artifacts/${doc.id}/sharing`, { method: 'PUT', json: { visibility: 'public' } }),
      params({ id: doc.id }),
    )).status).toBe(404);
  });
});
