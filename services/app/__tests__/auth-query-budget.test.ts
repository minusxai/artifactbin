/**
 * WHAT AUTHENTICATING A REQUEST COSTS. Production is Postgres behind a pool of ten: every transaction a
 * request opens holds a connection and every `FOR UPDATE` serializes callers on a row, so an auth path
 * that writes nothing must not open one, and a request must ask the database each thing once.
 *
 * Each case records the statements (and transactions) a request issues after its first, profile-creating
 * visit, and pins the budget; the account's behaviour (an invitation accepted, a revoked token refused on
 * the very next request) is pinned beside it so the savings cannot come from skipping the work.
 */
import { describe, expect, it } from 'vitest';
import type { Actor } from '@artifactbin/contracts';
import { GET as sessionRoute } from '@/app/api/page/session/route';
import { GET as sessionsRoute } from '@/app/api/sessions/route';
import { mintAccountToken, request, useAppHarness } from '@/__tests__/harness';
import { revokeToken, sessionActor } from '@/lib/accounts';
import { getDb, measureQueries, runWithRequest } from '@/lib/platform';
import type { Queryable } from '@/lib/platform/db';

useAppHarness();

/** Every statement the database sees while `work` runs, and how many transactions it opened. */
async function recorded<T>(work: () => Promise<T>) {
  const db = await getDb();
  const query = db.query.bind(db), transaction = db.transaction.bind(db);
  const sql: string[] = [];
  let transactions = 0;
  db.query = (async <R,>(text: string, params?: unknown[]) => { sql.push(text); return query<R>(text, params); }) as typeof db.query;
  db.transaction = (async <R,>(fn: (tx: Queryable) => Promise<R>) => {
    transactions++;
    return transaction((tx) => fn({ query: async <U,>(text: string, params?: unknown[]) => { sql.push(text); return tx.query<U>(text, params); } }));
  }) as typeof db.transaction;
  try {
    const { value, stats } = await measureQueries(work);
    return { value, sql, transactions, count: stats.count };
  } finally { db.query = query; db.transaction = transaction; }
}
const touching = (sql: string[], table: string) => sql.filter((text) => new RegExp(`\\b(FROM|JOIN|UPDATE|INTO)\\s+${table}\\b`, 'i').test(text));

const verified = (userId: string, email: string): Actor => ({ credential: 'session', userId, email, emailVerified: true });

describe('a verified-email browser request', () => {
  it('with no pending invitation opens no transaction and takes no lock', async () => {
    const actor = verified('usr_budget', 'budget@example.com');
    await sessionActor(request('/api/my/artifacts', { actor }));
    const { value, sql, transactions, count } = await recorded(() => sessionActor(request('/api/my/artifacts', { actor })));
    console.info('[budget] verified-email cookie request, no invitation: statements=%d transactions=%d', count, transactions);
    expect(value.viewer).toMatchObject({ userId: 'usr_budget' });
    expect(transactions).toBe(0);
    expect(sql.filter((text) => /FOR UPDATE/i.test(text))).toEqual([]);
    expect(touching(sql, 'group_invitations')).toHaveLength(1);
  });

  it('still accepts an invitation the moment one exists, in the same locked transaction as before', async () => {
    const actor = verified('usr_invited', 'invited@example.com');
    await sessionActor(request('/api/my/artifacts', { actor }));
    const db = await getDb();
    await db.query("INSERT INTO groups(id,handle,name,created_by) VALUES ('g1','crew','Crew','usr_invited')");
    await db.query("INSERT INTO group_invitations(id,group_id,email,role,invited_by) VALUES ('gin_1','g1','invited@example.com','editor','usr_invited')");
    const { transactions, sql } = await recorded(() => sessionActor(request('/api/my/artifacts', { actor })));
    expect(transactions).toBe(1);
    expect(sql.some((text) => /FOR UPDATE OF g,i/.test(text))).toBe(true);
    expect((await db.query("SELECT role FROM group_members WHERE group_id='g1' AND user_id='usr_invited'")).rows).toEqual([{ role: 'editor' }]);
    expect((await db.query("SELECT id FROM group_invitations WHERE id='gin_1'")).rows).toEqual([]);
  });
});

describe('GET /api/page/session', () => {
  /** As the server calls it: the request is the current one, so a second `sessionActor()` would authenticate it again. */
  const get = (actor?: Actor) => { const req = request('/api/page/session', { actor }); return runWithRequest(req, () => sessionRoute(req)); };
  it('authenticates once and reads the account row once', async () => {
    const actor = verified('usr_chrome', 'chrome@example.com');
    await get(actor);
    const { value, sql, transactions, count } = await recorded(() => get(actor));
    console.info('[budget] GET /api/page/session: statements=%d transactions=%d invitations=%d users=%d', count, transactions, touching(sql, 'group_invitations').length, touching(sql, 'users').length);
    expect(transactions).toBe(0);
    expect(touching(sql, 'group_invitations')).toHaveLength(1);
    expect(touching(sql, 'users')).toHaveLength(1);
    expect(await value.json()).toMatchObject({ user: { id: 'usr_chrome' }, kind: 'account', onboarded: expect.any(Boolean) });
  });

  it('reports a new account as owed the welcome page, and a guest as onboarded', async () => {
    const actor = verified('usr_new', 'new@example.com');
    expect(await (await get(actor)).json()).toMatchObject({ onboarded: false });
    const db = await getDb();
    await db.query("UPDATE users SET welcome_pending=false WHERE id='usr_new'");
    expect(await (await get(actor)).json()).toMatchObject({ onboarded: true });
    expect(await (await get()).json()).toEqual({ user: null, kind: 'none', onboarded: true });
  });
});

describe('a bearer-token operation request', () => {
  const call = (token: string) => { const req = request('/api/sessions', { token }); return runWithRequest(req, () => sessionsRoute(req)); };

  it('resolves the token and its hosted authority once each', async () => {
    const { token } = await mintAccountToken('budget');
    expect((await call(token)).status).toBe(200);
    const { sql, count } = await recorded(() => call(token));
    console.info('[budget] bearer GET /api/sessions: statements=%d resolve=%d authority=%d', count, sql.filter((text) => /FROM tokens WHERE token_hash/.test(text)).length, sql.filter((text) => /request_authority/.test(text)).length);
    expect(sql.filter((text) => /FROM tokens WHERE token_hash/.test(text))).toHaveLength(1);
    expect(sql.filter((text) => /request_authority/.test(text))).toHaveLength(1);
  });

  it('asks again on the next request: a revoked token is refused at once', async () => {
    const { token, id } = await mintAccountToken('revoked');
    expect((await call(token)).status).toBe(200);
    expect(await revokeToken(id)).toBe(true);
    expect((await call(token)).status).toBe(401);
  });

  it('forgets within a request when that request revokes the token', async () => {
    const { token, id } = await mintAccountToken('inflight');
    const req = request('/api/sessions', { token });
    const { resolveToken } = await import('@/lib/accounts');
    await runWithRequest(req, async () => {
      expect(await resolveToken(token)).toMatchObject({ id });
      await revokeToken(id);
      expect(await resolveToken(token)).toBeNull();
    });
  });
});
