/**
 * Users tier: accounts, anonymous tokens, claiming, and user-scoped listing.
 * Same harness as api.test.ts — real handlers / libs against in-memory PGLite.
 */
import { describe, expect, it } from 'vitest';
import { POST as createArtifactRoute } from '@/app/api/artifacts/route';
import { POST as anonymousMintRoute } from '@/app/api/tokens/anonymous/route';


import { claimToken, createUser, getUserByEmail, listArtifactsByUser } from '@/lib/users';
import { useAppHarness, request } from '@/__tests__/harness';

const harness = useAppHarness();

const BASE = 'http://localhost:3000';

async function anonMint(ip = '10.0.0.1'): Promise<{ id: string; token: string }> {
  const res = await anonymousMintRoute(request('/api/tokens/anonymous', { method: 'POST', headers: { ...(ip ? { 'x-forwarded-for': ip } : {}) } }));
  expect(res.status).toBe(201);
  return res.json();
}

async function publish(token: string, title: string) {
  const res = await createArtifactRoute(
    request('/api/artifacts', { method: 'POST', token: token, json: { title, markup: `<h1>${title}</h1>` } }),
  );
  expect(res.status).toBe(201);
  return res.json() as Promise<{ id: string }>;
}

describe('accounts', () => {
  it('creates a user and finds it by email — an account is an address, nothing else', async () => {
    const user = await createUser({ email: 'v@minusx.ai', name: 'Vivek' });
    expect(user.id).toMatch(/^usr_/);
    expect(await getUserByEmail('v@minusx.ai')).toMatchObject({ id: user.id });
    // Lookup normalizes, because the address a user types is rarely the one they registered.
    expect(await getUserByEmail('  V@MinusX.AI ')).toMatchObject({ id: user.id });
    expect(await getUserByEmail('nobody@x.com')).toBeNull();
  });

  it('rejects duplicate emails', async () => {
    await createUser({ email: 'v@minusx.ai' });
    await expect(createUser({ email: 'v@minusx.ai' })).rejects.toThrow();
  });
});

describe('anonymous tokens + claiming', () => {
  it('mints an anonymous token that can publish; artifacts are unowned', async () => {
    const { id, token } = await anonMint();
    expect(token).toMatch(/^mx_/);
    const art = await publish(token, 'anon-page');
    const db = await harness.db();
    const row = (await db.query<{ user_id: string | null }>('SELECT user_id FROM artifacts WHERE id = $1', [art.id]))
      .rows[0];
    expect(row.user_id).toBeNull();
    // The name marks the mint source (distinct from OAuth's oauth-<rand>).
    const named = (await db.query<{ name: string }>('SELECT name FROM tokens WHERE id = $1', [id])).rows[0];
    expect(named.name).toMatch(/^api-[0-9a-z]{6}$/);
  });

  it('carries no in-process mint valve — the proxy\'s ANON_MINT door is the only count', async () => {
    // P2 §H: a door is enforced in exactly one place. The app route serves the
    // mint; the proxy in front counts it, so a caller reaching this handler
    // directly (in-process, no proxy) is never refused here.
    for (let i = 0; i < 12; i++) {
      const res = await anonymousMintRoute(request('/api/tokens/anonymous', { method: 'POST', headers: { 'x-forwarded-for': '10.9.9.9' } }));
      expect(res.status, `mint ${i + 1} of 12`).toBe(201);
    }
  });

  it('claiming attaches the token and backfills its artifacts; later publishes are owned', async () => {
    const user = await createUser({ email: 'v@minusx.ai' });
    const { token } = await anonMint();
    await publish(token, 'before-claim');

    const claimed = await claimToken(user.id, token);
    expect(claimed).toMatchObject({ claimedArtifacts: 1 });

    await publish(token, 'after-claim');
    const mine = await listArtifactsByUser(user.id);
    expect(mine.map((a) => a.title).sort()).toEqual(['after-claim', 'before-claim']);
  });

  it('lists across multiple claimed tokens', async () => {
    const user = await createUser({ email: 'v@minusx.ai' });
    const t1 = await anonMint('10.0.0.1');
    const t2 = await anonMint('10.0.0.2');
    await publish(t1.token, 'from-laptop');
    await publish(t2.token, 'from-desktop');
    await claimToken(user.id, t1.token);
    await claimToken(user.id, t2.token);
    const mine = await listArtifactsByUser(user.id);
    expect(mine.map((a) => a.title).sort()).toEqual(['from-desktop', 'from-laptop']);
  });

  it('rejects unknown tokens and tokens already claimed by someone else', async () => {
    const alice = await createUser({ email: 'a@x.com' });
    const bob = await createUser({ email: 'b@x.com' });
    expect(await claimToken(alice.id, 'mx_' + 'a'.repeat(43))).toBeNull();

    const { token } = await anonMint();
    expect(await claimToken(alice.id, token)).not.toBeNull();
    expect(await claimToken(bob.id, token)).toBeNull();
    // Re-claiming your own token is a harmless no-op, not an error.
    expect(await claimToken(alice.id, token)).toMatchObject({ claimedArtifacts: 0 });
  });
});
