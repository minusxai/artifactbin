/** P3 (seeded RED) — the token's soft state is `deleted_at`; the verb stays revoke. */
import { describe, expect, it } from 'vitest';
import { useAppHarness } from './harness';
import { getDb } from '@/lib/db';
import { LIVE_TOKEN_SQL, mintToken, resolveToken, tokenStatus } from '@/lib/tokens';

useAppHarness();

describe('tokens carry deleted_at', () => {
  it('the live clause and the status read deleted_at, never revoked_at', () => {
    expect(LIVE_TOKEN_SQL).toContain('deleted_at IS NULL');
    expect(LIVE_TOKEN_SQL).not.toContain('revoked_at');
    expect(tokenStatus({ deleted_at: '2026-01-01T00:00:00Z', expires_at: null } as never)).toBe('revoked');
    expect(tokenStatus({ deleted_at: null, expires_at: null } as never)).toBe('active');
  });

  it('a token with deleted_at set no longer resolves, and the column revoked_at is gone', async () => {
    const t = await mintToken('t');
    expect(await resolveToken(t.token)).not.toBeNull();
    const db = await getDb();
    await db.query('UPDATE tokens SET deleted_at = now() WHERE id = $1', [t.id]);
    expect(await resolveToken(t.token)).toBeNull();
    const cols = (await db.query<{ column_name: string }>(`SELECT column_name FROM information_schema.columns WHERE table_name = 'tokens'`)).rows.map((r) => r.column_name);
    expect(cols).toContain('deleted_at');
    expect(cols).not.toContain('revoked_at');
  });
});
