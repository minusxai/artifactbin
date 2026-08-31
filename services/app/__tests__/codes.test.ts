/**
 * lib/codes — the ONE implementation of hash/TTL/single-use every code flow
 * shares. These tests are the module's contract; login and oauth then become
 * thin callers whose own suites (login-codes.test.ts, oauth.test.ts) stay
 * untouched through the port — they are the behavior lock.
 */
import { describe, expect, it } from 'vitest';
import { claimByHash, claimBySubject, issueCode, peekByHash } from '@/lib/codes';
import { useAppHarness } from '@/__tests__/harness';

const harness = useAppHarness();


const TTL = 10 * 60 * 1000;
const T0 = Date.parse('2026-08-13T12:00:00Z');

describe('claimByHash (high-entropy kinds)', () => {
  it('round-trips the payload and is spent by the claim', async () => {
    await issueCode({ kind: 'oauth', secret: 's3cret-high-entropy', payload: { user_id: 'u1', redirect_uri: 'http://x/cb', code_challenge: 'c' }, ttlMs: TTL, now: T0 });
    const payload = await claimByHash({ kind: 'oauth', code: 's3cret-high-entropy', now: T0 + 1000 });
    expect(payload).toEqual({ user_id: 'u1', redirect_uri: 'http://x/cb', code_challenge: 'c' });
    expect(await claimByHash({ kind: 'oauth', code: 's3cret-high-entropy', now: T0 + 2000 })).toBeNull();
  });

  it('answers null for an expired code and the row is gone', async () => {
    await issueCode({ kind: 'oauth', secret: 'will-expire', ttlMs: TTL, now: T0 });
    expect(await claimByHash({ kind: 'oauth', code: 'will-expire', now: T0 + TTL + 1 })).toBeNull();
    const db = await harness.db();
    expect((await db.query("SELECT 1 FROM codes WHERE kind = 'oauth'")).rows.length).toBe(0);
  });

  it('exactly one of two concurrent claims wins', async () => {
    await issueCode({ kind: 'oauth', secret: 'raced', payload: { n: 1 }, ttlMs: TTL, now: T0 });
    const [a, b] = await Promise.all([
      claimByHash({ kind: 'oauth', code: 'raced', now: T0 + 1 }),
      claimByHash({ kind: 'oauth', code: 'raced', now: T0 + 1 }),
    ]);
    expect([a, b].filter(Boolean).length).toBe(1);
  });

  it('kinds are disjoint: the same secret under two kinds spends independently', async () => {
    await issueCode({ kind: 'oauth', secret: 'shared', payload: { from: 'oauth' }, ttlMs: TTL, now: T0 });
    await issueCode({ kind: 'start', secret: 'shared', payload: { from: 'start' }, ttlMs: TTL, now: T0 });
    expect(await claimByHash({ kind: 'oauth', code: 'shared', now: T0 })).toEqual({ from: 'oauth' });
    expect(await claimByHash({ kind: 'start', code: 'shared', now: T0 })).toEqual({ from: 'start' });
  });
});

describe('issueCode with a subject (supersede semantics)', () => {
  it('re-issue for the same subject keeps ONE row, the new code wins, attempts reset', async () => {
    await issueCode({ kind: 'login', secret: '111111', subject: 'a@x.com', ttlMs: TTL, now: T0 });
    // burn attempts on the first code
    await claimBySubject({ kind: 'login', subject: 'a@x.com', code: '000000', maxAttempts: 5, now: T0 });
    await issueCode({ kind: 'login', secret: '222222', subject: 'a@x.com', ttlMs: TTL, now: T0 });

    const db = await harness.db();
    const rows = await db.query<{ attempts: number }>("SELECT attempts FROM codes WHERE kind = 'login' AND subject = 'a@x.com'");
    expect(rows.rows.length).toBe(1);
    expect(rows.rows[0].attempts).toBe(0);

    const old = await claimBySubject({ kind: 'login', subject: 'a@x.com', code: '111111', maxAttempts: 5, now: T0 });
    expect(old).toEqual({ ok: false, reason: 'bad_code' }); // superseded
    const fresh = await claimBySubject({ kind: 'login', subject: 'a@x.com', code: '222222', maxAttempts: 5, now: T0 });
    expect(fresh.ok).toBe(true);
  });

  it('subject uniqueness is per-kind: one email may hold codes of two kinds', async () => {
    await issueCode({ kind: 'login', secret: '111111', subject: 'a@x.com', ttlMs: TTL, now: T0 });
    await issueCode({ kind: 'confirm', secret: '333333', subject: 'a@x.com', ttlMs: TTL, now: T0 });
    expect((await claimBySubject({ kind: 'login', subject: 'a@x.com', code: '111111', maxAttempts: 5, now: T0 })).ok).toBe(true);
    expect((await claimBySubject({ kind: 'confirm', subject: 'a@x.com', code: '333333', maxAttempts: 5, now: T0 })).ok).toBe(true);
  });
});

describe('claimBySubject (guessable kinds)', () => {
  const issue = (now = T0) => issueCode({ kind: 'login', secret: '424242', subject: 'b@x.com', payload: { hello: true }, ttlMs: TTL, now });
  const claim = (code: string, now = T0) => claimBySubject({ kind: 'login', subject: 'b@x.com', code, maxAttempts: 3, now });

  it('unknown subject → no_code', async () => {
    expect(await claim('424242')).toEqual({ ok: false, reason: 'no_code' });
  });

  it('correct code → ok with the payload, and it is spent', async () => {
    await issue();
    expect(await claim('424242')).toEqual({ ok: true, payload: { hello: true } });
    expect(await claim('424242')).toEqual({ ok: false, reason: 'no_code' });
  });

  it('wrong code → bad_code and burns an attempt; the cap blocks even the RIGHT code', async () => {
    await issue();
    expect(await claim('000000')).toEqual({ ok: false, reason: 'bad_code' });
    expect(await claim('000001')).toEqual({ ok: false, reason: 'bad_code' });
    expect(await claim('000002')).toEqual({ ok: false, reason: 'bad_code' });
    expect(await claim('424242')).toEqual({ ok: false, reason: 'too_many_attempts' });
  });

  it('expired → expired, and the row is deleted', async () => {
    await issue();
    expect(await claim('424242', T0 + TTL + 1)).toEqual({ ok: false, reason: 'expired' });
    expect(await claim('424242', T0)).toEqual({ ok: false, reason: 'no_code' });
  });
});

describe('peekByHash', () => {
  it('returns the payload of a live code, without consuming it', async () => {
    await issueCode({ kind: 'start', secret: 'handle-1', payload: { token: 'mx_x' }, ttlMs: TTL, now: T0 });
    expect(await peekByHash({ kind: 'start', code: 'handle-1', now: T0 + 1 })).toEqual({ token: 'mx_x' });
    expect(await peekByHash({ kind: 'start', code: 'handle-1', now: T0 + 2 })).toEqual({ token: 'mx_x' }); // still there
    expect(await claimByHash({ kind: 'start', code: 'handle-1', now: T0 + 3 })).toEqual({ token: 'mx_x' });
  });

  it('null for expired, claimed, or unknown', async () => {
    await issueCode({ kind: 'start', secret: 'handle-2', ttlMs: TTL, now: T0 });
    expect(await peekByHash({ kind: 'start', code: 'handle-2', now: T0 + TTL + 1 })).toBeNull();
    await issueCode({ kind: 'start', secret: 'handle-3', ttlMs: TTL, now: T0 });
    await claimByHash({ kind: 'start', code: 'handle-3', now: T0 });
    expect(await peekByHash({ kind: 'start', code: 'handle-3', now: T0 })).toBeNull();
    expect(await peekByHash({ kind: 'start', code: 'never-issued', now: T0 })).toBeNull();
  });
});

describe('hygiene', () => {
  it('issueCode sweeps expired rows of its kind', async () => {
    await issueCode({ kind: 'oauth', secret: 'old-1', ttlMs: TTL, now: T0 });
    await issueCode({ kind: 'oauth', secret: 'old-2', ttlMs: TTL, now: T0 });
    await issueCode({ kind: 'login', secret: '999999', subject: 'c@x.com', ttlMs: TTL, now: T0 }); // other kind, also stale later
    // Much later, a new oauth issue sweeps oauth's corpses…
    await issueCode({ kind: 'oauth', secret: 'fresh', ttlMs: TTL, now: T0 + TTL * 2 });
    const db = await harness.db();
    const oauthRows = await db.query("SELECT 1 FROM codes WHERE kind = 'oauth'");
    expect(oauthRows.rows.length).toBe(1); // only the fresh one
    // …and does not touch other kinds (their own issuers sweep them).
    const loginRows = await db.query("SELECT 1 FROM codes WHERE kind = 'login'");
    expect(loginRows.rows.length).toBe(1);
  });
});
