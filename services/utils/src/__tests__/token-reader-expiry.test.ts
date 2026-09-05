/**
 * THE PROXY'S READER REFUSES EXPIRED TOKENS — AT EXPIRY, NOT AT CACHE EVICTION (tok-p1).
 *
 * Measured before this change (briefs/tokderisk-evidence, item 1): a token dying INSIDE the reader's 5 s
 * TTL window kept answering from cache until eviction, and after eviction the SQL admitted the expired row
 * anyway. Two refusal points are therefore asserted here:
 *   (i)  the SELECT carries the expiry clause  — `expires_at IS NULL OR expires_at > now()`;
 *   (ii) a cache entry never outlives its token — an entry for a token expiring in 300 ms is gone at 400 ms
 *        (clamp the entry's TTL to the remaining lifetime at remember(), or check per hit; either passes).
 * The reader's SELECT includes expiry and optional OAuth audience metadata. The fake database
 * below applies the clause's SEMANTICS on the reader's clock, so a stale cache hit is the only way to be wrong.
 */
import { describe, expect, it } from 'vitest';
import { createTokenReader, hashToken } from '../tokens';

type Row = { id: string; user_id: string | null; token_hash: string; deleted_at: number | null; expires_at: number | null };

function fakeDb(rows: Row[], clock: () => number) {
  const calls: string[] = [];
  const db = {
    async query<T>(sql: string, params?: unknown[]) {
      calls.push(sql);
      const [param] = (params ?? []) as [string];
      const live = rows.filter((r) => r.deleted_at === null && (r.expires_at === null || r.expires_at > clock()));
      const hit = live.find((r) => (/token_hash/.test(sql) ? r.token_hash === param : r.id === param));
      return { rows: (hit ? [{ id: hit.id, user_id: hit.user_id, expires_at: hit.expires_at }] : []) as T[], rowCount: hit ? 1 : 0 };
    },
  };
  return { db, calls };
}

const SECRET = 'mx_' + 'a'.repeat(43);
const token = (expires_at: number | null): Row => ({ id: 'tok_1', user_id: null, token_hash: hashToken(SECRET), deleted_at: null, expires_at });

describe('createTokenReader and expiry', () => {
  it('(i) the SELECTs carry the expiry clause, by hash and by id', async () => {
    let t = 0;
    const { db, calls } = fakeDb([token(null)], () => t);
    const reader = createTokenReader({ db, now: () => t });
    await reader.byToken(SECRET);
    await reader.byId('tok_1');
    expect(calls).toHaveLength(2);
    for (const sql of calls) expect(sql).toMatch(/expires_at IS NULL OR expires_at > /i);
    t += 1;
  });

  it('(ii) a token expiring INSIDE the TTL window stops working at expiry — the cache does not outlive it', async () => {
    let t = 0;
    const { db, calls } = fakeDb([token(300)], () => t);
    const reader = createTokenReader({ db, now: () => t, ttlMs: 5_000 });
    expect(await reader.byToken(SECRET)).toEqual({ id: 'tok_1', userId: null });
    expect(calls).toHaveLength(1);
    t = 400;
    expect(await reader.byToken(SECRET)).toBeNull();
    expect(calls, 'the read at t+400 must reach the database, not the cache').toHaveLength(2);
  });

  it('(ii) the same by id', async () => {
    let t = 0;
    const { db, calls } = fakeDb([token(300)], () => t);
    const reader = createTokenReader({ db, now: () => t, ttlMs: 5_000 });
    expect(await reader.byId('tok_1')).not.toBeNull();
    t = 400;
    expect(await reader.byId('tok_1')).toBeNull();
    expect(calls).toHaveLength(2);
  });

  it('a non-expiring token is cached for the full TTL, as before', async () => {
    let t = 0;
    const { db, calls } = fakeDb([token(null)], () => t);
    const reader = createTokenReader({ db, now: () => t, ttlMs: 5_000 });
    await reader.byToken(SECRET);
    t = 4_000;
    expect(await reader.byToken(SECRET)).not.toBeNull();
    expect(calls).toHaveLength(1);
    t = 5_001;
    await reader.byToken(SECRET);
    expect(calls).toHaveLength(2);
  });

  it('an expiry beyond the TTL does not shorten the cache', async () => {
    let t = 0;
    const { db, calls } = fakeDb([token(60_000)], () => t);
    const reader = createTokenReader({ db, now: () => t, ttlMs: 5_000 });
    await reader.byToken(SECRET);
    t = 4_999;
    await reader.byToken(SECRET);
    expect(calls).toHaveLength(1);
  });

  it('a token that expires exactly at the read is refused', async () => {
    let t = 0;
    const { db } = fakeDb([token(1_000)], () => t);
    const reader = createTokenReader({ db, now: () => t, ttlMs: 5_000 });
    await reader.byToken(SECRET);
    t = 1_000;
    expect(await reader.byToken(SECRET)).toBeNull();
  });
});
