/**
 * WHOSE A ROW IS through the interface: new-artifact destinations, atomic ownership transfer of an owner closure,
 * and the adoption of a claimed token's or a merged guest's artifacts.
 */
import { describe, expect, it } from 'vitest';
import { useAppHarness } from '@/__tests__/harness';
import { identityForUser, mintToken } from '@/lib/accounts';
import { createGroup } from '@/lib/groups';
import { adoptGuestArtifacts, adoptTokenArtifacts, createArtifact, newArtifactDestination, parseArtifactDestination, transferArtifact } from '@/lib/artifacts';
import { account, dataset, head, mine, page, personOfKind, sql } from '@/__tests__/artifact-fixtures';

const harness = useAppHarness();
const folder = (actor: { userId: string }, title = 'Folder', ancestor_ids: string[] = [], extra: Record<string, unknown> = {}) =>
  createArtifact(null, actor.userId, { format: 'folder', source: null, meta: {}, title, ancestor_ids, ...extra });

describe('destinations and transfer', () => {
  it('parses a destination strictly and picks a new one from the parent, refusing a group the actor does not edit', async () => {
    const owner = await account('owner@example.test');
    const stranger = await account('stranger@example.test');
    expect(parseArtifactDestination(undefined)).toBeUndefined();
    expect(parseArtifactDestination({ type: 'personal' })).toEqual({ type: 'personal' });
    expect(parseArtifactDestination({ type: 'group', id: 'g' })).toEqual({ type: 'group', id: 'g' });
    for (const bad of [null, [], { type: 'group' }, { type: 'personal', id: 'x' }, { type: 'team' }]) expect(() => parseArtifactDestination(bad)).toThrow('Invalid destination');
    const group = await createGroup(owner.userId, { handle: 'dest-team', name: 'Dest' });
    const teamFolder = await folder(owner, 'Team', [], { destination: { type: 'group', id: group.id } });
    expect(await newArtifactDestination(owner, undefined, teamFolder.id)).toEqual({ type: 'group', id: group.id });
    expect(await newArtifactDestination(owner)).toEqual({ type: 'personal' });
    await expect(newArtifactDestination(stranger, { type: 'group', id: group.id })).rejects.toMatchObject({ status: 403 });
    await expect(newArtifactDestination(owner, undefined, 'missing')).rejects.toMatchObject({ status: 400 });
    const personal = await folder(owner, 'Mine');
    await expect(newArtifactDestination(stranger, undefined, personal.id)).rejects.toThrow('Invalid parent');
    await expect(newArtifactDestination(owner, { type: 'personal' }, teamFolder.id)).rejects.toThrow('Destination conflicts with parent owner');
  });

  it('transfers a whole owner closure atomically; refuses mixed owners, outside dependents and non-editors', async () => {
    const owner = await account('owner@example.test');
    const stranger = await account('stranger@example.test');
    const group = await createGroup(owner.userId, { handle: 'xfer-team', name: 'Xfer' });
    const box = await folder(owner);
    const child = await mine(owner, 'Child', { ancestor_ids: [box.id] });
    await expect(transferArtifact(identityForUser(null, 'tok'), box.id, { type: 'personal' })).rejects.toThrow('Sign in');
    expect(await transferArtifact(stranger, box.id, { type: 'group', id: group.id })).toBeNull();
    await expect(transferArtifact(owner, box.id, { type: 'group', id: 'missing' })).rejects.toMatchObject({ status: 403 });
    const moved = (await transferArtifact(owner, box.id, { type: 'group', id: group.id }))!;
    expect(moved).toMatchObject({ group_id: group.id, user_id: null, creator_user_id: owner.userId, sharing_revision: 1 });
    expect(await head(child.id)).toMatchObject({ group_id: group.id, user_id: null });
    expect(await sql('SELECT artifact_id, next_owner FROM ownership_transfers')).toEqual([{ artifact_id: box.id, next_owner: { type: 'group', id: group.id } }]);
    // Unchanged when it is already there.
    expect((await transferArtifact(owner, box.id, { type: 'group', id: group.id }))!.sharing_revision).toBe(1);
    const data = await dataset(owner);
    await mine(owner, 'Reader', { meta: { refs: [{ id: data.id }] } });
    await sql('UPDATE artifacts SET meta=$2 WHERE id=$1', [(await mine(owner, 'Uses')).id, JSON.stringify({ refs: [{ id: data.id }] })]);
    await expect(transferArtifact(owner, data.id, { type: 'group', id: group.id })).rejects.toThrow('dependencies outside');
    const mixed = await folder(owner, 'Mixed');
    const foreign = await mine(stranger, 'Foreign');
    await sql('UPDATE artifacts SET ancestor_ids=$2 WHERE id=$1', [foreign.id, [mixed.id]]);
    await expect(transferArtifact(owner, mixed.id, { type: 'group', id: group.id })).rejects.toThrow('different owner');
  });
});

describe('adoption', () => {
  it('a claimed token takes only its unowned, ungrouped rows; a guest merge takes everything the guest owns', async () => {
    const user = await account('claimer@example.test');
    const guest = await personOfKind('guest');
    const loose = await mintToken('loose', null);
    const loose2 = await createArtifact(loose.id, null, page('Loose'));
    const owned = await createArtifact(loose.id, user.userId, page('Owned'));
    const guestRow = await createArtifact(null, guest.userId, page('Guest'));
    const db = await harness.db();
    expect(await db.transaction(tx => adoptTokenArtifacts(tx, loose.id, user.userId))).toBe(1);
    expect(await db.transaction(tx => adoptTokenArtifacts(tx, loose.id, user.userId))).toBe(0);
    expect((await head(loose2.id)).user_id).toBe(user.userId);
    expect((await head(owned.id)).user_id).toBe(user.userId);
    await db.transaction(tx => adoptGuestArtifacts(tx, guest.userId, user.userId));
    expect((await head(guestRow.id)).user_id).toBe(user.userId);
  });
});
