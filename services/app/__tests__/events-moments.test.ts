/**
 * THE APP SAYS ITS OWN MOMENTS: a sharing change, a token's mint, claim and
 * revoke, and a route that threw — each once, after the change, with the
 * acting account as subject when there is one, and never when nothing
 * changed. The share list (emails) and a raw URL (ids) never travel.
 *
 * Seeded RED by the orchestrator. The annotation moments have their own file
 * (annotations-events.test.ts), written by the implementer against the
 * annotation fixtures.
 */
import { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeEvents, type FakeEvents } from '@artifactbin/utils';
import { createEvents } from '@artifactbin/events/local';
import { useAppHarness } from '@/__tests__/harness';
import { createArtifact, updateSharingFor } from '@/lib/artifacts';
import { EVENTS_SCHEMA } from '@/lib/config';
import { setServices } from '@/lib/services';
import { mintToken, revokeHeldToken, revokeToken } from '@/lib/tokens';
import { claimToken, claimTokenById, createUser, revokeUserToken } from '@/lib/users';
import { mountRoutes } from '@/server/api';

const harness = useAppHarness();
let fake: FakeEvents;
/** A fresh log, so a fixture's own moments never count against the moment under test. */
const listen = () => { fake = fakeEvents(); setServices({ events: fake }); };
beforeEach(listen);
afterEach(() => { vi.restoreAllMocks(); });

const markup = { format: 'markup' as const, content: '', source: '<div>hi</div>', meta: {}, title: 'hi', description: null };
/** createArtifact says `created` on its own (trackEvent, fire-and-forget): let it land, THEN start a fresh log. */
const settled = async () => { await vi.waitFor(() => expect(fake.events.map((e) => e.verb)).toContain('created')); listen(); };

describe('sharing', () => {
  it('updateSharingFor says artifact.sharing_changed once, after the change, with the visibility and link role — never the share list', async () => {
    const owner = await createUser({ email: 'mxmx_test_share_owner@example.com' });
    const tok = await mintToken('web', owner.id, undefined, { expiresInMs: null });
    const row = await createArtifact(tok.id, owner.id, markup);
    await settled();
    const state = await updateSharingFor({ tokenId: tok.id, userId: owner.id }, row.id, { visibility: 'public', shares: [{ email: 'mxmx_test_reader@example.com', role: 'viewer' }] });
    expect(state).not.toBeNull();
    expect(fake.events).toHaveLength(1);
    expect(fake.events[0]).toMatchObject({ source: 'app', verb: 'sharing_changed', subject_kind: 'user', subject_id: owner.id, object_kind: 'artifact', object_id: row.id, payload: { visibility: 'public', link_role: null } });
    expect(JSON.stringify(fake.events[0])).not.toContain('mxmx_test_reader');
    listen();
    await updateSharingFor({ tokenId: tok.id, userId: owner.id }, row.id, { linkRole: 'commenter' });
    expect(fake.events[0]).toMatchObject({ verb: 'sharing_changed', payload: { visibility: null, link_role: 'commenter' } });
  });
  it('a refused change (not the owner) says nothing', async () => {
    const owner = await createUser({ email: 'mxmx_test_share_owner2@example.com' });
    const tok = await mintToken('web', owner.id, undefined, { expiresInMs: null });
    const row = await createArtifact(tok.id, owner.id, markup);
    await settled();
    expect(await updateSharingFor({ tokenId: 'tok_stranger', userId: 'usr_stranger' }, row.id, { visibility: 'public' })).toBeNull();
    expect(fake.events).toHaveLength(0);
  });
});

describe('tokens', () => {
  it('mintToken says token.minted from its one insert: the owner as subject when there is one, else null', async () => {
    const anon = await mintToken('anon-abc123');
    expect(fake.events).toHaveLength(1);
    expect(fake.events[0]).toMatchObject({ verb: 'minted', subject_kind: null, subject_id: null, object_kind: 'token', object_id: anon.id, payload: { name: 'anon-abc123' } });
    const owner = await createUser({ email: 'mxmx_test_mint@example.com' });
    const owned = await mintToken('web', owner.id, undefined, { expiresInMs: null });
    expect(fake.events).toHaveLength(2);
    expect(fake.events[1]).toMatchObject({ verb: 'minted', subject_kind: 'user', subject_id: owner.id, object_id: owned.id, payload: { name: 'web' } });
    expect(JSON.stringify(fake.events), 'the secret never travels').not.toContain(owned.token);
  });
  it('a claim says token.claimed with the claimer as subject and the token name; a refused or repeated no-op claim still says it only when it attached', async () => {
    const user = await createUser({ email: 'mxmx_test_claim@example.com' });
    const other = await createUser({ email: 'mxmx_test_claim_other@example.com' });
    const t = await mintToken('cli-one');
    listen();
    expect(await claimToken(user.id, t.token)).toMatchObject({ tokenId: t.id });
    expect(fake.events).toHaveLength(1);
    expect(fake.events[0]).toMatchObject({ verb: 'claimed', subject_kind: 'user', subject_id: user.id, object_kind: 'token', object_id: t.id, payload: { name: 'cli-one' } });
    expect(await claimToken(other.id, t.token), 'someone else\'s').toBeNull();
    expect(await claimToken(user.id, 'mx_not_a_token')).toBeNull();
    expect(fake.events).toHaveLength(1);
    const t2 = await mintToken('cli-two');
    listen();
    expect(await claimTokenById(user.id, t2.id)).toMatchObject({ tokenId: t2.id });
    expect(fake.events).toHaveLength(1);
    expect(fake.events[0]).toMatchObject({ verb: 'claimed', subject_id: user.id, object_id: t2.id, payload: { name: 'cli-two' } });
  });
  it('each of the three revokes says token.revoked once when a live token died, and nothing when nothing changed', async () => {
    const user = await createUser({ email: 'mxmx_test_revoke@example.com' });
    const a = await mintToken('a');
    const b = await mintToken('b', user.id);
    const c = await mintToken('c', user.id);
    listen();
    expect(await revokeToken(a.id)).toBe(true);
    expect(fake.events).toHaveLength(1);
    expect(fake.events[0]).toMatchObject({ verb: 'revoked', subject_kind: null, subject_id: null, object_kind: 'token', object_id: a.id });
    expect(await revokeToken(a.id), 'already dead').toBe(false);
    expect(fake.events).toHaveLength(1);
    expect(await revokeHeldToken(b.id, user.id)).toBe(true);
    expect(fake.events).toHaveLength(2);
    expect(fake.events[1]).toMatchObject({ verb: 'revoked', subject_kind: 'user', subject_id: user.id, object_id: b.id });
    expect(await revokeUserToken(user.id, c.id)).toBe(true);
    expect(fake.events).toHaveLength(3);
    expect(fake.events[2]).toMatchObject({ verb: 'revoked', subject_kind: 'user', subject_id: user.id, object_id: c.id });
    expect(await revokeUserToken(user.id, 'tok_nope')).toBe(false);
    expect(await revokeHeldToken(c.id, user.id), 'already dead').toBe(false);
    expect(fake.events).toHaveLength(3);
  });
});

describe('a route that throws', () => {
  it('says route.failed with the route PATTERN as the object — never the raw URL, which carries ids', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const boom = { GET: () => { throw new Error('the engine is on fire'); } };
    const routes = [{ path: '/api/boom/:id', dir: '/api/boom/[id]', methods: ['GET'] as const, module: boom }];
    const app = new Hono();
    mountRoutes(app, routes as unknown as Parameters<typeof mountRoutes>[1]);
    const res = await app.request('/api/boom/secret4711');
    expect(res.status).toBe(500);
    await vi.waitFor(() => expect(fake.events).toHaveLength(1));
    expect(fake.events[0]).toMatchObject({ source: 'app', verb: 'failed', subject_kind: null, object_kind: 'route', object_id: 'GET /api/boom/:id', payload: { status: 500, method: 'GET' } });
    expect(JSON.stringify(fake.events[0])).not.toContain('secret4711');
    expect(JSON.stringify(fake.events[0]), 'the error text is the operator\'s log line, not a row').not.toContain('on fire');
  });
});

/**
 * THE ONE PLACE THE MINT MAY NOT AWAIT ITS OWN SENTENCE.
 *
 * `mintToken`'s third parameter exists so a caller ALREADY INSIDE a
 * `db.transaction` can mint on that transaction's handle without re-entering
 * the adapter. PGLite serialises its op queue behind an open transaction, so a
 * log write that the callback AWAITS can never run: the transaction is waiting
 * on the writer and the writer is waiting on the transaction. Fire-and-forget
 * is not a style choice here — it is the difference between a mint that
 * commits and a process that stops.
 *
 * This is the only test in the file that runs the REAL writer (the fake's
 * push never touches the database, so it cannot deadlock and cannot prove
 * anything). The cap is wall-clock: a deadlock does not fail, it hangs.
 */
describe('minting on a caller\'s transaction handle', () => {
  /** Rejects rather than hanging the runner — a deadlock has no other symptom. */
  const within = <T,>(ms: number, work: Promise<T>): Promise<T> => Promise.race([
    work,
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error(`deadlocked: nothing resolved in ${ms}ms`)), ms).unref?.()),
  ]);

  it('does not deadlock: the transaction commits, and the sentence lands after it', async () => {
    const db = await harness.db();
    // The REAL in-process writer, on this file's own database — exactly the
    // registration `test/setup/vitest.setup.ts` makes for the whole suite.
    setServices({
      events: createEvents({
        db: { query: async <T = Record<string, unknown>>(sql: string, params: unknown[] = []) => (await harness.db()).query<T>(sql, params) },
        schema: EVENTS_SCHEMA,
      }),
    });

    const minted = await within(5_000, db.transaction(async (tx) => mintToken('inside', null, tx)));
    expect(minted.name).toBe('inside');
    // The INSERT the emit enqueued was behind the transaction; it lands once
    // the commit lets the queue move.
    await vi.waitFor(async () => {
      const r = await db.query<{ n: string | number }>(
        `SELECT COUNT(*) AS n FROM ${EVENTS_SCHEMA}.events WHERE verb = 'minted' AND object_id = $1`,
        [minted.id],
      );
      expect(Number(r.rows[0]?.n ?? 0)).toBe(1);
    });
  });
});
