import { describe, expect, it } from 'vitest';
import { useAppHarness } from '@/__tests__/harness';
import { createUser, setUsername } from '@/lib/accounts';
import { getDb } from '@/lib/platform';
import { GroupError, createGroup, getGroupById, inviteGroupMember, listGroups, removeGroupInvitation, searchGroupMembers, setGroupMember, getGroupDetail } from '..';

useAppHarness();
const account = async (name: string) => createUser({ email: `mxmx_test_${name}@example.com` });

describe('GroupError', () => {
  it('carries a code and an HTTP status, 400 by default', () => {
    const error = new GroupError('invalid_group');
    expect(error).toBeInstanceOf(Error);
    expect([error.code, error.status, error.message]).toEqual(['invalid_group', 400, 'invalid_group']);
    expect(new GroupError('forbidden', 403).status).toBe(403);
  });
});

describe('getGroupById', () => {
  it('reads a live group and refuses unknown or deleted ones', async () => {
    const owner = await account('byid');
    const group = await createGroup(owner.id, { handle: 'by-id', name: 'By id' });
    expect(await getGroupById(group.id)).toMatchObject({ id: group.id, handle: 'by-id', name: 'By id', created_by: owner.id, deleted_at: null });
    expect(await getGroupById('grp_missing')).toBeNull();
    await (await getDb()).query('UPDATE groups SET deleted_at = now() WHERE id = $1', [group.id]);
    expect(await getGroupById(group.id)).toBeNull();
  });
});

describe('createGroup input', () => {
  it('normalizes handle case and whitespace, and refuses malformed input before writing', async () => {
    const owner = await account('create');
    expect(await createGroup(owner.id, { handle: '  MiXeD-Case ', name: ' Spaced ' })).toMatchObject({ handle: 'mixed-case', name: 'Spaced', description: '' });
    for (const input of [{ handle: 'ab', name: 'Short' }, { handle: '-lead', name: 'x' }, { handle: 'ok-handle', name: '   ' }, { handle: 'ok-handle', name: 'x'.repeat(121) }, { handle: 'ok-handle', name: 'x', description: 'd'.repeat(2001) }, { handle: 'émoji', name: 'x' }, null])
      await expect(createGroup(owner.id, input as never)).rejects.toMatchObject({ code: 'invalid_group' });
    expect(await listGroups(owner.id)).toHaveLength(1);
  });

  it('refuses a non-account creator and a taken handle', async () => {
    const owner = await account('taken');
    await createGroup(owner.id, { handle: 'taken', name: 'Taken' });
    await expect(createGroup(owner.id, { handle: 'taken', name: 'Again' })).rejects.toMatchObject({ code: 'handle_taken', status: 409 });
    await expect(createGroup('usr_missing', { handle: 'fresh', name: 'Fresh' })).rejects.toMatchObject({ code: 'account_required', status: 403 });
  });
});

describe('listGroups', () => {
  it('lists only the groups the user belongs to, by name, with their role, and none once deleted', async () => {
    const owner = await account('lister'), other = await account('lister-other');
    const zeta = await createGroup(owner.id, { handle: 'zeta', name: 'Zeta' });
    const alpha = await createGroup(other.id, { handle: 'alpha', name: 'Alpha' });
    await setGroupMember(other.id, alpha.id, owner.id, 'viewer');
    await createGroup(other.id, { handle: 'hidden', name: 'Hidden' });
    expect((await listGroups(owner.id)).map(group => [group.handle, group.role])).toEqual([['alpha', 'viewer'], ['zeta', 'editor']]);
    await (await getDb()).query('UPDATE groups SET deleted_at = now() WHERE id = $1', [zeta.id]);
    expect((await listGroups(owner.id)).map(group => group.handle)).toEqual(['alpha']);
    expect(await listGroups('usr_nobody')).toEqual([]);
  });
});

describe('searchGroupMembers', () => {
  it('matches username or name case-insensitively, and an empty query lists everyone', async () => {
    const owner = await account('search-owner'), ada = await account('search-ada');
    await setUsername(owner.id, 'owner-person');
    await setUsername(ada.id, 'ada');
    await (await getDb()).query("UPDATE users SET name = 'Ada Lövelace' WHERE id = $1", [ada.id]);
    const group = await createGroup(owner.id, { handle: 'search', name: 'Search' });
    await setGroupMember(owner.id, group.id, ada.id, 'viewer');
    expect((await searchGroupMembers(owner.id, group.id, '')).map(member => member.user_id).sort()).toEqual([ada.id, owner.id].sort());
    expect((await searchGroupMembers(owner.id, group.id, 'LÖV')).map(member => member.user_id)).toEqual([ada.id]);
    expect(await searchGroupMembers(owner.id, group.id, 'nobody-matches')).toEqual([]);
  });

  it('answers not_found to anyone outside the group', async () => {
    const owner = await account('search-private'), stranger = await account('search-stranger');
    const group = await createGroup(owner.id, { handle: 'private-search', name: 'Private' });
    await expect(searchGroupMembers(stranger.id, group.id, '')).rejects.toMatchObject({ code: 'not_found', status: 404 });
  });
});

describe('removeGroupInvitation', () => {
  it('lets an editor withdraw an invitation and refuses viewers', async () => {
    const owner = await account('inv-owner'), viewer = await account('inv-viewer');
    const group = await createGroup(owner.id, { handle: 'invites', name: 'Invites' });
    await setGroupMember(owner.id, group.id, viewer.id, 'viewer');
    const invitation = await inviteGroupMember(owner.id, group.id, '  MXMX_TEST_New@Example.com ', 'viewer');
    expect(invitation.email).toBe('mxmx_test_new@example.com');
    await expect(removeGroupInvitation(viewer.id, group.id, invitation.id)).rejects.toMatchObject({ code: 'forbidden' });
    expect((await getGroupDetail(owner.id, group.id))?.invitations).toHaveLength(1);
    await removeGroupInvitation(owner.id, group.id, invitation.id);
    expect((await getGroupDetail(owner.id, group.id))?.invitations).toEqual([]);
    await expect(removeGroupInvitation(owner.id, group.id, invitation.id)).resolves.toBeUndefined();
    await expect(removeGroupInvitation(owner.id, 'grp_missing', invitation.id)).rejects.toMatchObject({ code: 'not_found' });
  });
});
