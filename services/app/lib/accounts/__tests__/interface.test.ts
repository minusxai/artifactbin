/**
 * lib/accounts' interface beyond tokens and sessions: actors, handles, the welcome flag and duplicate profiles,
 * per-request credential answers, hosted request authority, guest merging, token claiming, the admin secret,
 * test users and their browser sessions, and the forwarded client address.
 */
import { TESTUSER_ERRORS } from '@artifactbin/contracts';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createGuestOwner, mintAccountToken, useAppHarness } from '@/__tests__/harness';
import {
  ANONYMOUS_ACTOR, DuplicateProfileEmail, NO_IDENTITY, RESERVED_HANDLES, accountOf, answeredOnce, attachClaimedToken, closeTestUserSessions,
  confirmWelcome, createTestUser, createUser, forgetTestUserSession, forwardedFor, getTestUserRow, hasAdminCredential, hostedCredentialDescriptor,
  identityForUser, lockMembershipUsers, lockMergeableGuests, matchesWorkspaceAccount, mintToken, noteTestUserSession, rememberTokenClient,
  replaceUserImageKey, reserveHandle, resolveTestUser, retireGuest, revokeToken, setAutoAcceptMentions, syncProfile, testUserSessionCount, welcomePending,
} from '@/lib/accounts';
import { forgetRequestCredentials, markRequestAuthority } from '@/lib/accounts/tokens';
import { getDb, runWithRequest, services, setServices } from '@/lib/platform';

useAppHarness();
const userRow = async (id: string) => (await (await getDb()).query<Record<string, unknown>>('SELECT * FROM users WHERE id = $1', [id])).rows[0];
const tokenRow = async (id: string) => (await (await getDb()).query<Record<string, unknown>>('SELECT * FROM tokens WHERE id = $1', [id])).rows[0];

describe('actors', () => {
  it('names the account an actor owns through, and refuses one with neither', () => {
    expect(accountOf({ userId: 'u', tokenId: 't' })).toBe('u');
    expect(accountOf({ userId: null, tokenId: 't' })).toBe('t');
    expect(() => accountOf(ANONYMOUS_ACTOR)).toThrow('owns nothing');
    expect(Object.isFrozen(ANONYMOUS_ACTOR) && Object.isFrozen(NO_IDENTITY)).toBe(true);
    expect(NO_IDENTITY).toEqual({ ...ANONYMOUS_ACTOR, credential: 'none', emailVerified: null });
  });

  it('reads the client address the trusted hop saw, then the real-ip header', () => {
    const headers = (h: Record<string, string>) => new Headers(h);
    expect(forwardedFor(headers({ 'x-forwarded-for': 'spoof, 10.0.0.1, 10.0.0.2' }), 1)).toBe('10.0.0.2');
    expect(forwardedFor(headers({ 'x-forwarded-for': 'spoof, 10.0.0.1, 10.0.0.2' }), 2)).toBe('10.0.0.1');
    expect(forwardedFor(headers({ 'x-forwarded-for': '10.0.0.1' }), 5)).toBe('10.0.0.1');
    expect(forwardedFor(headers({ 'x-forwarded-for': ' , ', 'x-real-ip': ' 10.0.0.9 ' }), 1)).toBe('10.0.0.9');
    expect(forwardedFor(headers({}), 1)).toBe('');
  });
});

describe('handles', () => {
  it('reserves a handle for one subject, keeps it idempotent, frees a renamed one, and refuses another subject', async () => {
    const db = await getDb();
    expect(RESERVED_HANDLES.has('admin') && RESERVED_HANDLES.has('login')).toBe(true);
    await reserveHandle(db, 'alice', 'user', 'u1');
    await reserveHandle(db, 'alice', 'user', 'u1');
    await expect(reserveHandle(db, 'alice', 'group', 'g1')).rejects.toMatchObject({ code: '23505', message: 'Handle is taken' });
    await expect(reserveHandle(db, 'alice', 'user', 'u2')).rejects.toMatchObject({ code: '23505' });
    await reserveHandle(db, 'alicia', 'user', 'u1');
    await reserveHandle(db, 'alice', 'group', 'g1');
    expect((await db.query('SELECT handle, kind, subject_id FROM handle_reservations ORDER BY handle')).rows).toEqual([
      { handle: 'alice', kind: 'group', subject_id: 'g1' }, { handle: 'alicia', kind: 'user', subject_id: 'u1' },
    ]);
  });
});

describe('profiles', () => {
  it('owes a new account the welcome page until it is confirmed, and never a guest', async () => {
    await syncProfile({ userId: 'usr_new', email: 'new@example.test' });
    expect(await welcomePending('usr_new')).toBe(true);
    expect(await welcomePending({ kind: 'account', welcome_pending: true })).toBe(true);
    expect(await welcomePending({ kind: 'guest', welcome_pending: true })).toBe(false);
    expect(await welcomePending(null)).toBe(false);
    await confirmWelcome('usr_new');
    await confirmWelcome('usr_new');
    expect(await welcomePending('usr_new')).toBe(false);
    expect(await welcomePending('usr_missing')).toBe(false);
    const guest = await createGuestOwner();
    expect(await welcomePending(guest.userId)).toBe(false);
  });

  it('refuses a second identity for an address another id holds', async () => {
    await createUser({ email: 'held@example.test' });
    const error = await syncProfile({ userId: 'usr_second', email: 'held@example.test' }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(DuplicateProfileEmail);
    expect((error as Error).message).toContain('already belongs to another id');
  });

  it('replaces the avatar key reporting the previous one, and records the mention preference', async () => {
    const user = await createUser({ email: 'pic@example.test' });
    expect(await replaceUserImageKey(user.id, 'img/1')).toBeNull();
    expect(await replaceUserImageKey(user.id, 'img/2')).toBe('img/1');
    expect(await replaceUserImageKey(user.id, null)).toBe('img/2');
    expect(await userRow(user.id)).toMatchObject({ image_key: null });
    await setAutoAcceptMentions(await getDb(), user.id, true);
    expect(await userRow(user.id)).toMatchObject({ auto_accept_mentions: true });
    await setAutoAcceptMentions(await getDb(), user.id, false);
    expect(await userRow(user.id)).toMatchObject({ auto_accept_mentions: false });
  });
});

describe('per-request credential answers', () => {
  it('asks once per request and key, again after the request\'s answers are forgotten, and every time off-request', async () => {
    let asked = 0;
    const ask = async () => ++asked;
    await runWithRequest(new Request('http://x/'), async () => {
      expect([await answeredOnce('k', ask), await answeredOnce('k', ask), await answeredOnce('other', ask)]).toEqual([1, 1, 2]);
      forgetRequestCredentials();
      expect(await answeredOnce('k', ask)).toBe(3);
    });
    await runWithRequest(new Request('http://x/'), async () => expect(await answeredOnce('k', ask)).toBe(4));
    expect([await answeredOnce('k', ask), await answeredOnce('k', ask)]).toEqual([5, 6]);
    forgetRequestCredentials();
  });

  it('remembers the client that declared itself on a token', async () => {
    const t = await mintAccountToken('cli');
    await rememberTokenClient(t.id, 'claude-code' as never);
    expect(await tokenRow(t.id)).toMatchObject({ client_harness: 'claude-code' });
  });
});

describe('hosted request authority', () => {
  it('describes only the owner\'s live token, and scopes tokens by name prefix', async () => {
    const scoped = await mintAccountToken('hosted:agent-1'), plain = await mintAccountToken('cli'), revoked = await mintAccountToken('hosted:old');
    await revokeToken(revoked.id);
    expect(await hostedCredentialDescriptor(scoped.userId!, scoped.id)).toMatchObject({ name: 'hosted:agent-1', scoped: false });
    await expect(markRequestAuthority('', await getDb())).rejects.toThrow('request_authority_prefix_invalid');
    await expect(markRequestAuthority('x'.repeat(257), await getDb())).rejects.toThrow('request_authority_prefix_invalid');
    await markRequestAuthority('hosted:', await getDb());
    expect(await hostedCredentialDescriptor(scoped.userId!, scoped.id)).toMatchObject({ scoped: true });
    expect(await hostedCredentialDescriptor(plain.userId!, plain.id)).toMatchObject({ scoped: false });
    expect(await hostedCredentialDescriptor(revoked.userId!, revoked.id)).toBeNull();
    expect(await hostedCredentialDescriptor(plain.userId!, scoped.id)).toBeNull();
  });
});

describe('guests and claims', () => {
  it('finds the guests a verified account\'s browser holds live tokens for, retires them into it, and accepts the old id as the account', async () => {
    const account = await createUser({ email: 'merger@example.test' });
    const held = await createGuestOwner(), stale = await createGuestOwner(), other = await createGuestOwner();
    await revokeToken(stale.tokenId);
    const db = await getDb();
    const guests = await db.transaction(tx => lockMergeableGuests(tx, account.id, [held.tokenId, stale.tokenId]));
    expect(guests).toEqual([held.userId]);
    expect(await db.transaction(tx => lockMergeableGuests(tx, held.userId, [other.tokenId]))).toEqual([]);
    expect(await matchesWorkspaceAccount(held.userId, account.id)).toBe(false);
    await db.transaction(tx => retireGuest(tx, held.userId, account.id));
    expect(await tokenRow(held.tokenId)).toMatchObject({ user_id: account.id });
    expect(await userRow(held.userId)).toMatchObject({ merged_into_user_id: account.id });
    expect(await matchesWorkspaceAccount(held.userId, account.id)).toBe(true);
    expect(await matchesWorkspaceAccount(account.id, account.id)).toBe(true);
    expect(await matchesWorkspaceAccount(other.userId, account.id)).toBe(false);
    await db.transaction(tx => lockMembershipUsers(tx, [account.id, account.id, other.userId, 'usr_missing']));
  });

  it('attaches an unowned token by secret or id, and never someone else\'s or a revoked one', async () => {
    const claimer = await createUser({ email: 'claimer@example.test' }), owner = await createUser({ email: 'owner@example.test' });
    const loose = await mintToken('loose', null), byId = await mintToken('by-id', null), owned = await mintToken('owned', owner.id), revoked = await mintToken('revoked', null);
    await revokeToken(revoked.id);
    const db = await getDb();
    expect(await db.transaction(tx => attachClaimedToken(tx, claimer.id, { secret: loose.token }))).toEqual({ id: loose.id, name: 'loose' });
    expect(await tokenRow(loose.id)).toMatchObject({ user_id: claimer.id });
    expect(await db.transaction(tx => attachClaimedToken(tx, claimer.id, { secret: loose.token }))).toEqual({ id: loose.id, name: 'loose' });
    expect(await db.transaction(tx => attachClaimedToken(tx, claimer.id, { id: byId.id }))).toEqual({ id: byId.id, name: 'by-id' });
    expect(await db.transaction(tx => attachClaimedToken(tx, claimer.id, { id: owned.id }))).toBeNull();
    expect(await db.transaction(tx => attachClaimedToken(tx, claimer.id, { secret: revoked.token }))).toBeNull();
    expect(await db.transaction(tx => attachClaimedToken(tx, claimer.id, { secret: 'mx_not_a_token' }))).toBeNull();
    expect(await tokenRow(owned.id)).toMatchObject({ user_id: owner.id });
  });
});

describe('the admin secret', () => {
  it('matches only the configured secret, as a shared-secret header or a bearer', () => {
    const req = (headers: Record<string, string>) => new Request('http://x/', { headers });
    expect(hasAdminCredential(req({ 'x-shared-secret': 'test-secret' }))).toBe(true);
    expect(hasAdminCredential(req({ authorization: 'Bearer test-secret' }))).toBe(true);
    expect(hasAdminCredential(req({ authorization: 'Bearer wrong' }))).toBe(false);
    expect(hasAdminCredential(req({ 'x-shared-secret': 'test-secret-longer' }))).toBe(false);
    expect(hasAdminCredential(req({}))).toBe(false);
  });
});

describe('test users', () => {
  const original = services().browser;
  afterEach(() => setServices({ browser: original }));

  it('resolves only the parent\'s own live test user, and reads its row', async () => {
    const parent = await createUser({ email: 'parent@example.test' }), stranger = await createUser({ email: 'stranger@example.test' });
    const minted = await createTestUser(identityForUser(parent.id));
    if (!minted.ok) throw new Error(minted.error);
    expect(await getTestUserRow(minted.id)).toMatchObject({ id: minted.id, parent_user_id: parent.id });
    expect(await getTestUserRow(parent.id)).toBeNull();
    expect(await resolveTestUser(parent.id, minted.id)).toEqual({ id: minted.id, tokenId: minted.tokenId });
    expect(await resolveTestUser(null, minted.id)).toBe(TESTUSER_ERRORS.notYours);
    expect(await resolveTestUser(stranger.id, minted.id)).toBe(TESTUSER_ERRORS.notYours);
    await (await getDb()).query('UPDATE tokens SET deleted_at = now() WHERE user_id = $1', [minted.id]);
    expect(await resolveTestUser(parent.id, minted.id)).toBe(TESTUSER_ERRORS.expired);
    await (await getDb()).query("UPDATE users SET expires_at = now() - interval '1 second' WHERE id = $1", [minted.id]);
    expect(await resolveTestUser(parent.id, minted.id)).toBe(TESTUSER_ERRORS.expired);
    expect(await createTestUser(identityForUser(null))).toMatchObject({ ok: false, status: 403, error: TESTUSER_ERRORS.requiresAccount });
  });

  it('tracks a test user\'s browser sessions and closes every one, a failing close included', async () => {
    const request = vi.fn(async (body: { session_id: string }) => { if (body.session_id === 's1') throw new Error('gone'); return {}; });
    setServices({ browser: { ...original, sessions: { request } } as never });
    const owner = { credential: 'bearer', userId: 'p', tokenId: 't' } as never;
    noteTestUserSession('tu', 's1', owner);
    noteTestUserSession('tu', 's2', owner);
    noteTestUserSession('tu', 's2', owner);
    expect(testUserSessionCount('tu')).toBe(2);
    forgetTestUserSession('tu', 's2');
    forgetTestUserSession('nobody', 's2');
    noteTestUserSession('tu', 's3', owner);
    await closeTestUserSessions('tu');
    expect(request.mock.calls.map(([body]) => body.session_id)).toEqual(['s1', 's3']);
    expect(request).toHaveBeenCalledWith({ op: 'close', session_id: 's3', actor: owner });
    expect(testUserSessionCount('tu')).toBe(0);
    await closeTestUserSessions('tu');
    expect(request).toHaveBeenCalledTimes(2);
  });
});
