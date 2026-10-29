/** Accounts: creation, email changes, usernames, and the tokens an account may claim (the claim itself: lib/authentication). */
import { describe, expect, it } from 'vitest';
import { createGuestOwner, useAppHarness } from '@/__tests__/harness';
import { USERNAME_RE, setUserEmail, usernameFromEmail } from '@/lib/accounts/users';
import { authorHandle, claimableTokensById, createUser, ensureUsername, getUserByEmail, getUserById, getUserByUsername, hasCreatedDocument, isAccountRow, mintToken, ownerUsername, revokeToken, revokeUserToken, setUsername } from '@/lib/accounts';
import { getDb } from '@/lib/platform';

const harness = useAppHarness();

const artifact = async (id: string, columns: { token_id?: string; user_id?: string | null; group_id?: string | null; title?: string; creator_user_id?: string; format?: string }) =>
  (await getDb()).query(
    'INSERT INTO artifacts (id, token_id, user_id, group_id, title, creator_user_id, format) VALUES ($1, $2, $3, $4, $5, $6, $7)',
    [id, columns.token_id ?? null, columns.user_id ?? null, columns.group_id ?? null, columns.title ?? null, columns.creator_user_id ?? null, columns.format ?? 'markup'],
  );

describe('username rules', () => {
  // Pure: no rows, so the describe skips the per-test wipe.
  harness.shared(async () => undefined);
  it('USERNAME_RE: 3–32 lowercase letters, digits and underscores', () => {
    for (const ok of ['abc', 'a_1', '___', 'a'.repeat(32)]) expect(USERNAME_RE.test(ok), ok).toBe(true);
    for (const bad of ['', 'ab', 'a'.repeat(33), 'Abc', 'a-b', 'a.b', 'a b', 'é_ab']) expect(USERNAME_RE.test(bad), bad).toBe(false);
  });

  it('usernameFromEmail: sanitized local part, +tags dropped, at most 20 characters, never empty', () => {
    expect(usernameFromEmail('Jane.Doe+news@example.test')).toBe('jane_doe');
    expect(usernameFromEmail('a--b..c@example.test')).toBe('a_b_c');
    expect(usernameFromEmail('__x__@example.test')).toBe('x');
    expect(usernameFromEmail('...@example.test')).toBe('user');
    expect(usernameFromEmail('+tag@example.test')).toBe('user');
    expect(usernameFromEmail('no-at-sign')).toBe('no_at_sign');
    const long = usernameFromEmail(`${'abcdefghi_'.repeat(4)}@example.test`);
    expect(long).toBe('abcdefghi_abcdefghi');
    expect(long.length).toBeLessThanOrEqual(20);
  });
});

describe('usernames', () => {

  it('ensureUsername assigns <base>_<4 chars> once, and leaves a guest without a handle', async () => {
    const user = await createUser({ email: 'Jane.Doe@example.test' });
    expect(user.username).toBeNull();
    const named = await ensureUsername(user);
    expect(named.username).toMatch(/^jane_doe_[a-z0-9]{4}$/);
    expect(USERNAME_RE.test(named.username!)).toBe(true);
    expect((await ensureUsername({ ...user })).username).toBe(named.username);
    expect(await ensureUsername(named)).toBe(named);
    const twin = await ensureUsername(await createUser({ email: 'jane.doe@other.test' }));
    expect(twin.username).not.toBe(named.username);
    const guest = await getUserById((await createGuestOwner()).userId);
    expect(await ensureUsername(guest!)).toBe(guest);
    expect((await getUserById(guest!.id))!.username).toBeNull();
  });

  it('setUsername normalizes, releases the old handle, and answers invalid or taken', async () => {
    const a = await createUser({ email: 'a@example.test' }), b = await createUser({ email: 'b@example.test' });
    expect(await setUsername(a.id, '  First_Name ')).toEqual({ ok: true, username: 'first_name' });
    expect((await getUserByUsername('FIRST_NAME'))!.id).toBe(a.id);
    expect(await setUsername(a.id, 'second')).toEqual({ ok: true, username: 'second' });
    expect(await getUserByUsername('first_name')).toBeNull();
    expect(await setUsername(b.id, 'first_name')).toEqual({ ok: true, username: 'first_name' });
    expect(await setUsername(b.id, 'second')).toEqual({ error: 'taken' });
    for (const bad of ['ab', 'a-b', 'admin', 'tokens', 'x'.repeat(33)]) expect(await setUsername(a.id, bad), bad).toEqual({ error: 'invalid' });
    expect(await setUsername('usr_missing', 'free_name')).toEqual({ error: 'invalid' });
    expect(await ownerUsername(a.id)).toBe('second');
    expect(await ownerUsername(null)).toBeNull();
    expect(await authorHandle({ actor_user_id: b.id })).toBe('first_name');
    expect(await authorHandle({ actor_user_id: null })).toBeNull();
  });

  it('inside a caller\'s transaction a taken handle throws, so the caller\'s transaction aborts', async () => {
    const a = await createUser({ email: 'a@example.test' }), b = await createUser({ email: 'b@example.test' });
    await setUsername(a.id, 'held');
    const db = await getDb();
    await expect(db.transaction((tx) => setUsername(b.id, 'held', tx))).rejects.toMatchObject({ code: '23505' });
    expect((await getUserById(b.id))!.username).toBeNull();
  });
});

describe('accounts', () => {
  it('createUser stores a lowercased, trimmed address and a fresh account row; duplicates are refused', async () => {
    const user = await createUser({ email: '  Person@Example.TEST ', name: 'Person' });
    expect(user).toMatchObject({ email: 'person@example.test', kind: 'account', name: 'Person', username: null, image_key: null, welcome_pending: false, parent_user_id: null });
    expect(user.id).toMatch(/^usr_/);
    expect(isAccountRow(user)).toBe(true);
    expect((await getUserByEmail('PERSON@example.test '))!.id).toBe(user.id);
    expect((await getUserById(user.id))!.email).toBe('person@example.test');
    await expect(createUser({ email: 'person@EXAMPLE.test' })).rejects.toThrow();
    expect(await getUserById('usr_missing')).toBeNull();
    expect(await getUserByEmail('nobody@example.test')).toBeNull();
  });

  it('isAccountRow is false for a guest and for nothing', async () => {
    const guest = await getUserById((await createGuestOwner()).userId);
    expect(guest!.kind).toBe('guest');
    expect(isAccountRow(guest)).toBe(false);
    expect(isAccountRow(null)).toBe(false);
  });

  it('setUserEmail records a normalized address; the old one finds nobody', async () => {
    const user = await createUser({ email: 'old@example.test' });
    await setUserEmail(user.id, ' New@Example.TEST');
    expect(await getUserByEmail('old@example.test')).toBeNull();
    expect((await getUserByEmail('new@example.test'))!.id).toBe(user.id);
  });

  it('hasCreatedDocument is true only for an html artifact the user created', async () => {
    const user = await createUser({ email: 'maker@example.test' });
    await artifact('art_markup', { creator_user_id: user.id, format: 'markup' });
    expect(await hasCreatedDocument(user.id)).toBe(false);
    await artifact('art_html', { creator_user_id: user.id, format: 'html' });
    expect(await hasCreatedDocument(user.id)).toBe(true);
  });
});

describe('claimable tokens', () => {
  it('offers recent unclaimed tokens by id with their titles, and nothing else', async () => {
    const user = await createUser({ email: 'claimer@example.test' });
    const fresh = await mintToken('fresh', null), empty = await mintToken('empty', null), old = await mintToken('old', null);
    const claimed = await mintToken('claimed', user.id);
    const revoked = await mintToken('revoked', null);
    await revokeToken(revoked.id);
    for (let i = 0; i < 7; i++) await artifact(`art_${i}`, { token_id: fresh.id, title: `Title ${i}` });
    await artifact('art_untitled', { token_id: fresh.id });
    const db = await getDb();
    await db.query("UPDATE tokens SET created_at = now() - interval '25 hours' WHERE id = $1", [old.id]);
    expect(await claimableTokensById([])).toEqual([]);
    const offered = await claimableTokensById([fresh.id, empty.id, old.id, claimed.id, revoked.id, 'tok_unknown']);
    const byId = Object.fromEntries(offered.map((o) => [o.tokenId, o]));
    expect(Object.keys(byId).sort()).toEqual([empty.id, fresh.id].sort());
    expect(byId[fresh.id]!.artifacts).toBe(8);
    expect(byId[fresh.id]!.titles).toHaveLength(5);
    expect(byId[empty.id]).toEqual({ tokenId: empty.id, titles: [], artifacts: 0 });
    expect(offered.every((o) => !('token' in o))).toBe(true);
  });

  it('revokeUserToken revokes only the caller\'s own live token', async () => {
    const owner = await createUser({ email: 'owner@example.test' }), other = await createUser({ email: 'other@example.test' });
    const minted = await mintToken('cli', owner.id);
    expect(await revokeUserToken(other.id, minted.id)).toBe(false);
    expect(await revokeUserToken(owner.id, minted.id)).toBe(true);
    expect(await revokeUserToken(owner.id, minted.id)).toBe(false);
  });
});
