/**
 * ONE TOKEN-LIVENESS RULE, TWO CLOCKS. `now()` is the transaction's start; `clock_timestamp()` is the moment the
 * statement runs. A request's own lookup is one statement, so either reads the same; a fence that must still hold
 * when its transaction commits reads the wall clock, so a token that expired while the transaction waited is refused.
 */
import { describe, expect, it } from 'vitest';
import { mintAccountToken, useAppHarness } from '@/__tests__/harness';
import { LIVE_TOKEN_SQL } from '@/lib/accounts/tokens';
import { liveTokenSql } from '@/lib/accounts';
import { getDb } from '@/lib/platform';
import type { Queryable } from '@artifactbin/contracts';

useAppHarness();

/** Inside `tx`: let the clock move past the transaction's start, then expire the token between the two. */
async function expireSinceStart(tx: Queryable, tokenId: string): Promise<void> {
  await tx.query('SELECT pg_sleep(0.02)');
  await tx.query('UPDATE tokens SET expires_at = now() + (clock_timestamp() - now()) / 2 WHERE id = $1', [tokenId]);
}
const live = (tx: Queryable, sql: string, id: string) => tx.query(`SELECT id FROM tokens WHERE id = $1 AND ${sql}`, [id]).then(r => r.rows.length === 1);

describe('token liveness', () => {
  it('the request rule reads the transaction start; the commit rule reads the wall clock', async () => {
    const token = await mintAccountToken('liveness_clocks');
    expect(LIVE_TOKEN_SQL).toBe(liveTokenSql());
    const seen = await (await getDb()).transaction(async tx => {
      await expireSinceStart(tx, token.id);
      return { start: await live(tx, LIVE_TOKEN_SQL, token.id), wall: await live(tx, liveTokenSql('clock_timestamp()'), token.id) };
    });
    expect(seen).toEqual({ start: true, wall: false });
  });
});
