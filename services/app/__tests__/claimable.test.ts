/**
 * What the login banner is allowed to offer, through the REAL handler.
 *
 * This endpoint decides whether someone is shown "add these drafts to your
 * account". Everything it must REFUSE is a way to put another person's work in
 * front of the wrong user, so each exclusion gets its own test rather than
 * riding on one happy path:
 *
 *   - already claimed by someone else  → not yours to be offered
 *   - already claimed by YOU           → nothing to do, would nag forever
 *   - revoked                          → dead credential
 *   - older than the offer window      → stale, and the whole point of the clock
 *   - unknown                          → absent, indistinguishable from the rest
 *
 * The window is a RELEVANCE filter, not a security boundary (no clock stops a
 * shared-browser plant — the titles and checkboxes do), but it must still be
 * honest about which side of it a token falls on.
 *
 * The request now carries NO body: what this browser holds lives in its
 * httpOnly agent-session cookie as token IDS, so the server reads the offer
 * set from the credential it already has. The page cannot name a token, which
 * is exactly why it cannot name someone else's.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

import { mintToken, revokeToken } from '@/lib/tokens';
import { claimToken, createUser } from '@/lib/users';
import { createArtifact } from '@/lib/artifacts';

import { POST as claimableRoute } from '@/app/api/tokens/claimable/route';
import { agentCookie, request } from '@/__tests__/harness';
import { useAppHarness } from '@/__tests__/harness';

const harness = useAppHarness();

const BASE = 'http://localhost:3000';
const sessionUser = { id: '' };
vi.mock('@/auth', () => ({ auth: async () => (sessionUser.id ? { user: { id: sessionUser.id } } : null) }));

/** Ask as a browser holding exactly these token ids. */
const claimableResponse = async (tokenIds: string[]) => {
  const cookie = tokenIds.length ? await agentCookie(tokenIds) : '';
  const res = await claimableRoute(request('/api/tokens/claimable', { method: 'POST', cookie }));
  return { status: res.status, body: await res.json() };
};

/** Publish an artifact owned by `tokenId`, unclaimed. */
const publish = (tokenId: string, title: string) =>
  createArtifact(tokenId, null, { format: 'markup', content: '', source: '<div />', meta: {}, title, description: null });

let user: { id: string };

beforeEach(async () => {
  user = await createUser({ email: 'claimer@example.com' });
  sessionUser.id = user.id;
});

describe('what it offers', () => {
  it('offers an anonymous token with its artifact titles', async () => {
    const t = await mintToken('anon');
    await publish(t.id, 'Q3 Revenue');
    await publish(t.id, 'Sales deck');
    const { status, body } = await claimableResponse([t.id]);
    expect(status).toBe(200);
    expect(body.claimable).toHaveLength(1);
    expect(body.claimable[0].tokenId).toBe(t.id);
    // The secret is never echoed — the browser has none to match it against.
    expect(body.claimable[0]).not.toHaveProperty('token');
    expect(body.claimable[0].artifacts).toBe(2);
    expect([...body.claimable[0].titles].sort()).toEqual(['Q3 Revenue', 'Sales deck']);
  });

  it('offers a token that has published nothing yet, with no titles', async () => {
    // Worth claiming anyway: the token is this browser's identity, and what it
    // publishes NEXT should land in the account rather than orphaned.
    const t = await mintToken('empty');
    const { body } = await claimableResponse([t.id]);
    expect(body.claimable).toHaveLength(1);
    expect(body.claimable[0].titles).toEqual([]);
    expect(body.claimable[0].artifacts).toBe(0);
  });

  it('handles a batch, returning only the eligible ones', async () => {
    const mine = await mintToken('mine');
    const theirs = await mintToken('theirs');
    const other = await createUser({ email: 'other@example.com' });
    await claimToken(other.id, theirs.token);
    const { body } = await claimableResponse([mine.id, theirs.id, 'tok_unknown']);
    expect(body.claimable.map((c: { tokenId: string }) => c.tokenId)).toEqual([mine.id]);
  });
});

describe('what it refuses', () => {
  it('never offers a token claimed by someone else', async () => {
    const t = await mintToken('theirs');
    const other = await createUser({ email: 'other@example.com' });
    await claimToken(other.id, t.token);
    await publish(t.id, 'Their private draft');
    const { body } = await claimableResponse([t.id]);
    expect(body.claimable).toEqual([]);
  });

  it('never offers a token this user has already claimed', async () => {
    const t = await mintToken('already');
    await claimToken(user.id, t.token);
    const { body } = await claimableResponse([t.id]);
    expect(body.claimable).toEqual([]);
  });

  it('never offers a revoked token', async () => {
    const t = await mintToken('dead');
    await revokeToken(t.id);
    const { body } = await claimableResponse([t.id]);
    expect(body.claimable).toEqual([]);
  });

  it('never offers a token older than the offer window', async () => {
    const t = await mintToken('stale');
    await publish(t.id, 'Ancient draft');
    const db = await harness.db();
    await db.query("UPDATE tokens SET created_at = now() - interval '25 hours' WHERE id = $1", [t.id]);
    const { body } = await claimableResponse([t.id]);
    expect(body.claimable).toEqual([]);
  });

  it('still offers a token just inside the window', async () => {
    const t = await mintToken('fresh');
    const db = await harness.db();
    await db.query("UPDATE tokens SET created_at = now() - interval '23 hours' WHERE id = $1", [t.id]);
    const { body } = await claimableResponse([t.id]);
    expect(body.claimable).toHaveLength(1);
  });

  it('is silent about unknown tokens rather than saying so', async () => {
    const { status, body } = await claimableResponse(['tok_nope', 'not-even-a-token']);
    expect(status).toBe(200);
    expect(body.claimable).toEqual([]);
  });
});

describe('the shape of the request', () => {
  it('401s without a session — the offer is meaningless logged out', async () => {
    sessionUser.id = '';
    const t = await mintToken('anon');
    expect((await claimableResponse([t.id])).status).toBe(401);
  });

  it('caps how many held tokens it will scan, keeping the most recent', async () => {
    // A browser cannot plausibly hold dozens; the cap bounds the query rather
    // than rejecting, because the cookie is OUR value — a caller cannot inflate
    // it, so there is no oversized "request" to refuse.
    const fresh = await mintToken('newest');
    const { status, body } = await claimableResponse([...Array.from({ length: 25 }, (_, i) => `tok_${i}`), fresh.id]);
    expect(status).toBe(200);
    expect(body.claimable.map((c: { tokenId: string }) => c.tokenId)).toEqual([fresh.id]);
  });

  it('offers nothing to a browser holding no tokens', async () => {
    const { status, body } = await claimableResponse([]);
    expect(status).toBe(200);
    expect(body.claimable).toEqual([]);
  });
});
