/**
 * GET /api/my/tokens — what the Account page's tokens panel is fed (tok-p3), through the REAL handler.
 *
 * Every row carries `status` (computed server-side — web code may not import lib/tokens), `expires_at` and
 * `last_used_at`; an expired-but-unrevoked token is listed as `expired`; the order is most-recently-used first,
 * then newest minted (P1's order, unchanged).
 *
 * Seeded RED by the orchestrator; make it green without changing an expectation.
 */
import { describe, expect, it } from 'vitest';
import { GET as listMine } from '@/app/api/my/tokens/route';


import { mintToken } from '@/lib/tokens';
import { createUser } from '@/lib/users';
import { request, useAppHarness } from '@/__tests__/harness';

const harness = useAppHarness();

type Row = { id: string; status: string; expires_at: string | null; last_used_at: string | null };

describe('GET /api/my/tokens', () => {
  it('rows carry status, expires_at and last_used_at, last-used first', async () => {
    const user = await createUser({ email: 'mxmx_test_tokens@example.com' });
    const actor = { credential: 'session' as const, userId: user.id, email: user.email ?? '', emailVerified: true };
    const used = await mintToken('used', user.id);
    const expired = await mintToken('expired', user.id);
    const fresh = await mintToken('fresh', user.id);
    const db = await harness.db();
    await db.query('UPDATE tokens SET last_used_at = now() WHERE id = $1', [used.id]);
    await db.query("UPDATE tokens SET expires_at = now() - interval '1 minute' WHERE id = $1", [expired.id]);

    const res = await listMine(request('/api/my/tokens', { actor }));
    expect(res.status).toBe(200);
    const rows = ((await res.json()) as { tokens: Row[] }).tokens;
    expect(rows.map((r) => r.id)).toEqual([used.id, fresh.id, expired.id]);
    for (const r of rows) expect(Object.keys(r)).toEqual(expect.arrayContaining(['status', 'expires_at', 'last_used_at']));
    expect(rows.find((r) => r.id === used.id)?.status).toBe('active');
    expect(rows.find((r) => r.id === expired.id)?.status).toBe('expired');
    expect(rows.find((r) => r.id === fresh.id)).toMatchObject({ status: 'active', last_used_at: null, expires_at: expect.any(String) });
  });

  it('the account\'s non-expiring web token shows a null expiry and is still active', async () => {
    const user = await createUser({ email: 'mxmx_test_web@example.com' });
    const actor = { credential: 'session' as const, userId: user.id, email: user.email ?? '', emailVerified: true };
    await mintToken('web', user.id, undefined, { expiresInMs: null });
    const rows = ((await (await listMine(request('/api/my/tokens', { actor }))).json()) as { tokens: Row[] }).tokens;
    expect(rows[0]).toMatchObject({ status: 'active', expires_at: null });
  });
});
