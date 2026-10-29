/**
 * WHO IS AROUND AN ARTIFACT through the interface: the sharing surface (tiers, link role, named people, the
 * dataset write ACL), membership (join, invite, accept, approve, leave), mention candidates and saved invitations,
 * and the account profile resource whose likes must be readable.
 */
import { describe, expect, it } from 'vitest';
import { useAppHarness } from '@/__tests__/harness';
import { setUsername } from '@/lib/accounts';
import {
  MembershipError, accountProfile, changeMembership, getSharingFor, invitePeople, membershipState, mentionCandidates, updateAccountProfile,
  updateSharingFor,
} from '@/lib/artifacts';
import { account, dataset, head, mine, personOfKind } from '@/__tests__/artifact-fixtures';

const harness = useAppHarness();
async function person(name: string) {
  const actor = await account(`${name}@example.test`);
  await setUsername(actor.userId, name);
  return actor;
}

describe('the sharing surface', () => {
  it('editors read and change the ACL, a stranger gets the uniform null; shares normalize and resolve', async () => {
    const owner = await person('owner');
    const stranger = await person('stranger');
    const row = await mine(owner);
    expect(await getSharingFor(stranger, row.id)).toBeNull();
    expect(await getSharingFor(owner, row.id)).toMatchObject({ visibility: 'private', linkRole: 'viewer', shares: [], canPrivate: true });
    const after = await updateSharingFor(owner, row.id, { visibility: 'unlisted', linkRole: 'commenter', shares: [{ email: ' B@Example.test', role: 'viewer' }, { email: 'b@example.test', role: 'editor' }, { email: 'a@example.test', role: 'viewer' }] });
    expect(after).toMatchObject({ visibility: 'unlisted', linkRole: 'commenter', shares: [{ email: 'a@example.test', role: 'viewer' }, { email: 'b@example.test', role: 'editor' }] });
    expect((await head(row.id)).sharing_revision).toBe(1);
    await updateSharingFor(owner, row.id, { shares: [{ email: 'a@example.test', role: 'viewer' }, { email: 'b@example.test', role: 'editor' }] });
    expect((await head(row.id)).sharing_revision).toBe(1);
    // A document never acquires a write ACL by way of this surface.
    await updateSharingFor(owner, row.id, { access: 'readwrite' });
    expect((await head(row.id)).access).toBe('read');
    expect(await updateSharingFor(stranger, row.id, { visibility: 'public' })).toBeNull();
  });

  it('a dataset\'s sharing names its write ACL and the documents that write it', async () => {
    const owner = await person('owner');
    const data = await dataset(owner);
    expect(await getSharingFor(owner, data.id)).toMatchObject({ access: 'readwrite', datasetKind: 'stored', policyVersion: 1, writtenBy: [] });
    expect(await updateSharingFor(owner, data.id, { access: 'read' })).toMatchObject({ access: 'read' });
    const governed = await dataset(owner, { version: 2, allow: [{ actions: ['read'], from: { user: '*' } }] });
    expect(await getSharingFor(owner, governed.id)).toMatchObject({ policyVersion: 2 });
  });
});

describe('membership', () => {
  it('a reader requests to join, an editor approves; the member leaves; strangers and guests are refused', async () => {
    const owner = await person('owner');
    const reader = await person('reader');
    const guest = await personOfKind('guest');
    const row = await mine(owner);
    await expect(membershipState(reader, row.id)).rejects.toMatchObject({ status: 404 });
    await updateSharingFor(owner, row.id, { visibility: 'unlisted', linkRole: 'commenter' });
    const requested = await changeMembership(reader, row.id, { action: 'join' });
    expect(requested.self).toMatchObject({ user_id: reader.userId, status: 'pending' });
    expect((await membershipState(owner, row.id)).pending.map(m => m.user_id)).toEqual([reader.userId]);
    expect((await membershipState(await person('other'), row.id)).pending).toEqual([]);
    await expect(changeMembership(reader, row.id, { action: 'approve', userId: reader.userId })).rejects.toThrow('Only owners and editors can approve');
    const approved = await changeMembership(owner, row.id, { action: 'approve', userId: reader.userId });
    expect(approved.members.map(m => m.user_id).sort()).toEqual([owner.userId, reader.userId].sort());
    expect(approved).toMatchObject({ canManage: true, canInvite: true });
    expect((await changeMembership(reader, row.id, { action: 'leave' })).self).toMatchObject({ status: 'left' });
    await expect(changeMembership(guest, row.id, { action: 'join' })).rejects.toBeInstanceOf(MembershipError);
    await expect(changeMembership(reader, row.id, { action: 'nonsense' as never })).rejects.toMatchObject({ status: 400 });
  });

  it('an invitation with access shares the private row; the invitee accepts; candidates are followers and members', async () => {
    const owner = await person('owner');
    const friend = await person('friend');
    const row = await mine(owner);
    await expect(changeMembership(owner, row.id, { action: 'invite', usernames: ['@friend'] })).rejects.toThrow('Give this person access');
    const invited = await changeMembership(owner, row.id, { action: 'invite', usernames: ['@friend'], includeAccess: true });
    expect(invited.pending.map(m => m.user_id)).toEqual([friend.userId]);
    expect((await head(row.id)).sharing_revision).toBe(1);
    expect((await getSharingFor(owner, row.id))!.shares).toEqual([{ email: 'friend@example.test', role: 'viewer' }]);
    await expect(changeMembership(owner, row.id, { action: 'accept', userId: friend.userId })).rejects.toThrow('only for yourself');
    expect((await changeMembership(friend, row.id, { action: 'accept' })).self).toMatchObject({ status: 'accepted' });
    expect((await mentionCandidates(owner, row.id, '@fri', 'invite')).map(c => c.username)).toEqual(['friend']);
    expect(await mentionCandidates(owner, row.id, 'zzz')).toEqual([]);
    await expect(mentionCandidates(await person('nobody'), row.id, 'f')).rejects.toMatchObject({ status: 404 });
  });

  it('a saved invitation needs the target to read the row and to follow the sender, unless explicit', async () => {
    const owner = await person('owner');
    const friend = await person('friend');
    const row = await mine(owner);
    const db = await harness.db();
    await expect(db.transaction(tx => invitePeople(tx, row, owner, [friend.userId]))).rejects.toThrow('not eligible');
    await expect(db.transaction(tx => invitePeople(tx, row, owner, [friend.userId], undefined, true))).rejects.toThrow('Give this person access');
    await updateSharingFor(owner, row.id, { visibility: 'unlisted' });
    await db.transaction(tx => invitePeople(tx, { ...row, visibility: 'unlisted' }, owner, [friend.userId], 'node:1', true));
    expect((await membershipState(friend, row.id)).self).toMatchObject({ status: 'pending', direction: 'invitation' });
    await expect(db.transaction(tx => invitePeople(tx, row, { ...owner, userId: null } as never, [friend.userId]))).rejects.toThrow('Sign in to mention people');
  });
});

describe('the account profile', () => {
  it('reads with a state digest; a proposal must observe it, like only readable rows, and follow real people', async () => {
    const owner = await person('owner');
    const friend = await person('friend');
    const row = await mine(owner);
    const hidden = await mine(friend);
    expect(await accountProfile('missing')).toBeNull();
    const profile = (await accountProfile(owner.userId))!;
    expect(profile).toMatchObject({ type: 'profile', id: owner.userId, username: 'owner', liked: [], following: [], state: expect.stringMatching(/^[a-f0-9]{64}$/) });
    const propose = (input: Record<string, unknown>) => updateAccountProfile(owner, { type: 'profile', id: owner.userId, state: profile.state, ...input });
    expect(await updateAccountProfile({ ...owner, userId: null } as never, {})).toEqual({ status: 403, body: { error: 'account_required' } });
    expect((await updateAccountProfile(owner, { type: 'nope' })).status).toBe(400);
    expect(await updateAccountProfile(owner, { type: 'profile', id: owner.userId })).toEqual({ status: 400, body: { error: 'state_required' } });
    expect(await propose({ liked: [hidden.id] })).toEqual({ status: 404, body: { error: 'not_found' } });
    expect(await propose({ following: [owner.userId] })).toEqual({ status: 400, body: { error: 'invalid_follow', id: owner.userId } });
    expect(await propose({ email: 'other@example.test' })).toMatchObject({ status: 400, body: { error: 'readonly_field' } });
    const changed = await propose({ liked: [row.id], following: [friend.userId], username: 'owner2' });
    expect(changed).toMatchObject({ status: 200, body: { liked: [row.id], following: [friend.userId], username: 'owner2' } });
    expect(await propose({ liked: [] })).toMatchObject({ status: 409, body: { error: 'state_conflict' } });
  });
});
