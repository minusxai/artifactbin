/**
 * Users tier: accounts, anonymous connections, claiming, and user-scoped
 * listing. Same harness as api.test.ts — real handlers / libs against
 * in-memory PGLite.
 *
 * The mint is INTERNAL now (the proxy spends it after a human approves the
 * CLI's device pairing), so these tests call that route the way the proxy
 * does — there is no public door left to call.
 */
import { describe, expect, it } from 'vitest';
import { POST as createArtifactRoute } from '@/app/api/artifacts/route';
import { POST as internalMintRoute } from '@/app/api/internal/tokens/route';
import { POST as startRoute } from '@/app/api/start/route';


import { mintToken, claimToken, createUser, getUserByEmail, listArtifactsByUser } from '@/lib/accounts';
import { createArtifact } from '@/lib/artifacts';
import { useAppHarness, request } from '@/__tests__/harness';

const harness = useAppHarness();


async function anonMint(_ip?: string): Promise<{ id: string; token: string }> {
  return mintToken('legacy', null);
}

async function legacyPublish(tokenId: string, title: string) {
  return createArtifact(tokenId, null, { format: 'markup', source: `<h1>${title}</h1>`, meta: { visibility: 'public' }, title, description: null });
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

describe('anonymous connections + claiming', () => {
  it('legacy anonymous credentials cannot publish', async () => {
    const { token } = await anonMint();
    const response = await createArtifactRoute(request('/api/artifacts', { method: 'POST', token, json: { title: 'refused', markup: '<h1>Refused</h1>' } }));
    expect(response.status).toBe(401);
    expect((await (await harness.db()).query('SELECT 1 FROM artifacts')).rows).toHaveLength(0);
  });

  // A door is enforced in exactly one place. The app routes serve the mint and
  // the create; the proxy counts the approval doors in front of them, so a caller
  // reaching these handlers directly is never refused here (the start case was
  // start-flow.test.ts's).
  it.each([
    { door: 'mint', calls: 12, send: () => internalMintRoute(request('/api/internal/tokens', { method: 'POST', headers: { 'x-forwarded-for': '10.9.9.9' } })) },
    { door: 'start', calls: 15, send: () => startRoute(request('/api/start', { method: 'POST' })) },
  ])('$door carries no in-process valve — the proxy\'s doors are the only count', async ({ door, calls, send }) => {
    for (let i = 0; i < calls; i++) {
      const res = await send();
      expect(res.status, `${door} ${i + 1} of ${calls}`).toBe(401);
    }
  });

  it('claiming attaches the token and backfills its artifacts; later publishes are owned', async () => {
    const user = await createUser({ email: 'v@minusx.ai' });
    const { id, token } = await anonMint();
    await legacyPublish(id, 'before-claim');

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
    await legacyPublish(t1.id, 'from-laptop');
    await legacyPublish(t2.id, 'from-desktop');
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
