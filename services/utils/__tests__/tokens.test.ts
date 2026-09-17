import {describe,expect,it} from 'vitest';
import type { Queryable } from '@artifactbin/contracts';
import {TOKEN_RE,createTokenReader,hashToken} from '@artifactbin/utils';

/**
 * THE PROXY'S ONE READ OF tokens. Only SELECT, only the two statements, shape-checked before the database,
 * schema-qualified, expiry-aware, cached with a positive and a shorter negative TTL.
 */

const LIVE = 'mx_' + 'a'.repeat(43);
const REVOKED = 'mx_' + 'b'.repeat(43);
function fakeDb(): Queryable & { statements: Array<{ sql: string; params: unknown[] }> } {
  const statements: Array<{ sql: string; params: unknown[] }> = [];
  const rows: Record<string, { id: string; user_id: string | null; expires_at: string | null }> = {
    [hashToken(LIVE)]: { id: 'tok_live', user_id: 'usr_1', expires_at: null },
  };
  return {
    statements,
    async query<T>(sql: string, params: unknown[] = []) {
      statements.push({ sql, params });
      const byHash = /token_hash = \$1/.test(sql) ? rows[params[0] as string] : undefined;
      const byId = /\bid = \$1/.test(sql) && params[0] === 'tok_live' ? rows[hashToken(LIVE)] : undefined;
      const hit = byHash ?? byId;
      return { rows: (hit ? [hit] : []) as T[] };
    },
  };
}

describe('createTokenReader', () => {
  it('byToken resolves a live token and answers null for an unknown or revoked one', async () => {
    const r = createTokenReader({ db: fakeDb() });
    expect(await r.byToken(LIVE)).toEqual({ id: 'tok_live', userId: 'usr_1' });
    expect(await r.byToken(REVOKED)).toBeNull();
  });
  it('byId resolves the agent cookie\'s primary id', async () => {
    const r = createTokenReader({ db: fakeDb() });
    expect(await r.byId('tok_live')).toEqual({ id: 'tok_live', userId: 'usr_1' });
    expect(await r.byId('tok_nope')).toBeNull();
  });
  it('refuses a value that is not token-shaped BEFORE touching the database', async () => {
    const db = fakeDb();
    const r = createTokenReader({ db });
    expect(TOKEN_RE.test('not a token')).toBe(false);
    expect(await r.byToken('not a token')).toBeNull();
    expect(await r.byToken('mx_short')).toBeNull();
    expect(db.statements).toHaveLength(0);
  });
  it('reads a schema-qualified table (APP__SCHEMA) and refuses a schema that is not a plain identifier', async () => {
    const db = fakeDb();
    await createTokenReader({ db, schema: 'app' }).byToken(LIVE);
    expect(db.statements[0].sql).toMatch(/FROM app\.tokens/);
    expect(() => createTokenReader({ db, schema: 'app; drop table tokens' })).toThrow(/schema/);
  });
  it('caches within the TTL and re-reads after it; a miss is cached for the shorter negative TTL', async () => {
    const db = fakeDb(); let t = 1_000_000;
    const r = createTokenReader({ db, ttlMs: 5000, negativeTtlMs: 1000, now: () => t });
    await r.byToken(LIVE); await r.byToken(LIVE);
    expect(db.statements).toHaveLength(1);
    t += 5001; await r.byToken(LIVE);
    expect(db.statements).toHaveLength(2);
    await r.byToken(REVOKED); await r.byToken(REVOKED);
    expect(db.statements).toHaveLength(3);
    t += 1001; await r.byToken(REVOKED);
    expect(db.statements).toHaveLength(4);
  });
  it('invalidate(id) drops that entry; invalidate() drops everything', async () => {
    const db = fakeDb();
    const r = createTokenReader({ db });
    await r.byId('tok_live'); r.invalidate('tok_live'); await r.byId('tok_live');
    expect(db.statements).toHaveLength(2);
    await r.byToken(LIVE); r.invalidate(); await r.byToken(LIVE); await r.byId('tok_live');
    expect(db.statements).toHaveLength(5);
  });
  it('issues only SELECT, and only the two statements', async () => {
    const db = fakeDb();
    const r = createTokenReader({ db });
    await r.byToken(LIVE); await r.byId('tok_live'); r.invalidate();
    for (const s of db.statements) {
      expect(s.sql).toMatch(/^\s*SELECT id, user_id, audience, scope, expires_at FROM tokens WHERE (token_hash|id) = \$1 AND deleted_at IS NULL AND \(expires_at IS NULL OR expires_at > now\(\)\)\s*$/);
    }
  });
});

describe('expiry', () => {
  /**
   * THE PROXY'S READER REFUSES EXPIRED TOKENS — AT EXPIRY, NOT AT CACHE EVICTION.
   *
   * Before this guard a token dying INSIDE the reader's 5 s
   * TTL window kept answering from cache until eviction, and after eviction the SQL admitted the expired row
   * anyway. Two refusal points are therefore asserted here:
   *   (i)  the SELECT carries the expiry clause  — `expires_at IS NULL OR expires_at > now()`;
   *   (ii) a cache entry never outlives its token — an entry for a token expiring in 300 ms is gone at 400 ms
   *        (clamp the entry's TTL to the remaining lifetime at remember(), or check per hit; either passes).
   * The reader's SELECT includes expiry and optional OAuth audience metadata. The fake database
   * below applies the clause's SEMANTICS on the reader's clock, so a stale cache hit is the only way to be wrong.
   */

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
});
