/**
 * THE PROXY'S ONE READ OF tokens. Only SELECT, only the two statements, shape-checked before the database,
 * schema-qualified, expiry-aware, cached with a positive and a shorter negative TTL.
 */
import { describe, expect, it } from 'vitest';
import type { Queryable } from '@artifactbin/contracts';
import { TOKEN_RE, createTokenReader, hashToken } from '@artifactbin/utils';

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
