/** ONE store for every one-time secret: hashed, single-use, attempts capped, bound to whichever table the owner names. */
import { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Queryable } from '@artifactbin/contracts';
import { createCodeStore } from '@artifactbin/utils';

const DDL = (t: string) => `CREATE TABLE ${t} (kind TEXT NOT NULL, code_hash TEXT NOT NULL, subject TEXT, payload JSONB NOT NULL DEFAULT '{}', attempts INTEGER NOT NULL DEFAULT 0, expires_at TIMESTAMPTZ NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), PRIMARY KEY (kind, code_hash))`;
let pg: PGlite; let db: Queryable;
beforeAll(async () => {
  pg = new PGlite();
  await pg.exec('CREATE SCHEMA app; CREATE SCHEMA other;');
  await pg.exec(DDL('app.codes')); await pg.exec(DDL('other.codes'));
  db = { query: async (sql, params) => ({ rows: (await pg.query(sql, params as unknown[])).rows as never }) };
});
afterAll(() => pg.close());

describe('createCodeStore', () => {
  it('claimByHash returns the payload once and null the second time', async () => {
    const s = createCodeStore(db, { schema: 'app' });
    await s.issue({ kind: 'start', secret: 'sekret-1', payload: { artifact: 'abc' }, ttlMs: 60_000 });
    expect(await s.claimByHash({ kind: 'start', code: 'sekret-1' })).toEqual({ artifact: 'abc' });
    expect(await s.claimByHash({ kind: 'start', code: 'sekret-1' })).toBeNull();
  });
  it('an expired code claims as null', async () => {
    const s = createCodeStore(db, { schema: 'app' });
    await s.issue({ kind: 'start', secret: 'sekret-2', ttlMs: 1000, now: 1_000_000 });
    expect(await s.claimByHash({ kind: 'start', code: 'sekret-2', now: 1_002_000 })).toBeNull();
  });
  it('claimBySubject counts attempts and exhausts at the cap; the right code before the cap wins', async () => {
    const s = createCodeStore(db, { schema: 'other' });
    await s.issue({ kind: 'login', secret: '123456', subject: 'a@example.com', payload: { email: 'a@example.com' }, ttlMs: 60_000 });
    expect(await s.claimBySubject({ kind: 'login', subject: 'a@example.com', code: '000000', maxAttempts: 3 })).toEqual({ ok: false, reason: 'mismatch' });
    expect(await s.claimBySubject({ kind: 'login', subject: 'a@example.com', code: '000000', maxAttempts: 3 })).toEqual({ ok: false, reason: 'mismatch' });
    expect(await s.claimBySubject({ kind: 'login', subject: 'a@example.com', code: '123456', maxAttempts: 3 })).toEqual({ ok: true, payload: { email: 'a@example.com' } });
    await s.issue({ kind: 'login', secret: '999999', subject: 'b@example.com', ttlMs: 60_000 });
    for (let i = 0; i < 3; i++) await s.claimBySubject({ kind: 'login', subject: 'b@example.com', code: 'wrong', maxAttempts: 3 });
    expect(await s.claimBySubject({ kind: 'login', subject: 'b@example.com', code: '999999', maxAttempts: 3 })).toEqual({ ok: false, reason: 'exhausted' });
  });
  it('peekByHash reads without consuming', async () => {
    const s = createCodeStore(db, { schema: 'app' });
    await s.issue({ kind: 'chunk', secret: 'sekret-3', payload: { n: 1 }, ttlMs: 60_000 });
    expect(await s.peekByHash({ kind: 'chunk', code: 'sekret-3' })).toEqual({ n: 1 });
    expect(await s.claimByHash({ kind: 'chunk', code: 'sekret-3' })).toEqual({ n: 1 });
  });
  it('two stores on two tables never see each other\'s codes', async () => {
    const app = createCodeStore(db, { schema: 'app' }); const other = createCodeStore(db, { schema: 'other' });
    await app.issue({ kind: 'start', secret: 'only-app', ttlMs: 60_000 });
    expect(await other.peekByHash({ kind: 'start', code: 'only-app' })).toBeNull();
    expect(await app.peekByHash({ kind: 'start', code: 'only-app' })).toEqual({});
  });
  it('stores a hash, never the secret', async () => {
    const s = createCodeStore(db, { schema: 'app' });
    await s.issue({ kind: 'start', secret: 'plain-secret-xyz', ttlMs: 60_000 });
    const { rows } = await db.query<{ code_hash: string }>('SELECT code_hash FROM app.codes');
    expect(rows.some((r) => r.code_hash.includes('plain-secret'))).toBe(false);
  });
});
