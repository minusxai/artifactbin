/**
 * WHERE A ROW LIVES AND WHOSE IT IS through the interface: folder placement (resolution, refusals, children per
 * viewer, wakeups), the trash's writes, new-artifact destinations, ownership transfer and the adoption of a
 * token's or a guest's artifacts.
 */
import { describe, expect, it } from 'vitest';
import { useAppHarness } from '@/__tests__/harness';
import { artifactChannel } from '@artifactbin/contracts';
import { ANONYMOUS_ACTOR, identityForUser, mintToken } from '@/lib/accounts';
import { createGroup } from '@/lib/groups';
import {
  adoptGuestArtifacts, adoptTokenArtifacts, childrenTableFor, createArtifact, isParentRefusal, newArtifactDestination, notifyParent, parentOf,
  parseArtifactDestination, rerootArtifact, resolveParent, restoreTrashedSubtree, selectChildren, transferArtifact, trashSubtree, updateSharingFor,
} from '@/lib/artifacts';
import { account, dataset, head, mine, page, personOfKind, sql } from './fixtures';

const harness = useAppHarness();
const folder = (actor: { userId: string }, title = 'Folder', ancestor_ids: string[] = [], extra: Record<string, unknown> = {}) =>
  createArtifact(null, actor.userId, { format: 'folder', source: null, meta: {}, title, ancestor_ids, ...extra });

describe('placement', () => {
  it('a parent is one of the owner\'s folders, never inside the moved row, never too deep — one refusal for all', async () => {
    const owner = await account('owner@example.test');
    const stranger = await account('stranger@example.test');
    const root = await folder(owner, 'Root');
    const doc = await mine(owner);
    expect(await resolveParent(owner, null, null)).toEqual({ ancestor_ids: [] });
    expect(await resolveParent(owner, root.id, null)).toEqual({ ancestor_ids: [root.id] });
    const refusals = [await resolveParent(stranger, root.id, null), await resolveParent(owner, doc.id, null), await resolveParent(owner, root.id, { id: root.id, format: 'folder' })];
    expect(refusals.every(isParentRefusal)).toBe(true);
    expect(new Set(refusals.map(r => JSON.stringify(r))).size).toBe(1);
    let trail: string[] = [];
    for (let level = 0; level < 6; level++) trail = [...trail, (await folder(owner, `L${level}`, trail)).id];
    expect(isParentRefusal(await resolveParent(owner, trail.at(-1)!, null))).toBe(true);
    expect(isParentRefusal(await resolveParent(owner, trail.at(-2)!, null))).toBe(false);
    // A moved folder's own height counts toward the cap.
    expect(isParentRefusal(await resolveParent(owner, trail.at(-2)!, { id: trail[0]!, format: 'folder' }))).toBe(true);
    expect(isParentRefusal({ ancestor_ids: [] })).toBe(false);
    expect([parentOf({ ancestor_ids: [] }), parentOf({ ancestor_ids: ['a', 'b'] })]).toEqual([null, 'b']);
  });

  it('a folder lists its children per viewer: insiders all, strangers the public ones and what names them, numbers to editors', async () => {
    const owner = await account('owner@example.test');
    const named = await account('named@example.test');
    const box = await folder(owner, 'Shelf', [], { visibility: 'public' });
    const pub = await mine(owner, 'Public', { ancestor_ids: [box.id], visibility: 'public' });
    const unlisted = await mine(owner, 'Unlisted', { ancestor_ids: [box.id], visibility: 'unlisted' });
    const priv = await mine(owner, 'Private', { ancestor_ids: [box.id] });
    await updateSharingFor(owner, priv.id, { shares: [{ email: 'named@example.test', role: 'viewer' }] });
    const ids = async (viewer: Parameters<typeof selectChildren>[1]) => (await selectChildren(box, viewer)).children.map(c => c.id).sort();
    expect(await ids(owner)).toEqual([pub.id, unlisted.id, priv.id].sort());
    expect(await ids(null)).toEqual([pub.id]);
    expect(await ids(named)).toEqual([pub.id, priv.id].sort());
    expect((await selectChildren(box, owner)).numbers).toBe(true);
    expect((await selectChildren(box, named)).numbers).toBe(false);
    const table = await childrenTableFor(box, owner);
    expect(table.columns.map(c => c.name)).toContain('sparkline');
    expect(table.rows.find(r => r.id === pub.id)).toMatchObject({ url: `/a/${pub.id}`, thumbnail: `/a/${pub.id}/export?mode=card&v=1`, views: 0, sparkline: expect.stringContaining('<svg') });
    expect(table.rows.find(r => r.id === priv.id)).toMatchObject({ thumbnail: null });
    expect((await childrenTableFor(box, ANONYMOUS_ACTOR)).rows).toEqual([expect.objectContaining({ id: pub.id, views: null, sparkline: null })]);
  });

  it('notifyParent wakes the folder\'s own channel and never fails a write', async () => {
    const payloads: string[] = [];
    const stop = await (await harness.db()).listen(artifactChannel('Folder1'), p => payloads.push(p));
    await notifyParent(null);
    await notifyParent('Folder1');
    await (await harness.db()).query('SELECT 1');
    expect(payloads).toEqual(['child']);
    await stop();
  });
});

describe('the trash', () => {
  it('trashes a subtree once, answers it again, restores what that act stamped, and reroots', async () => {
    const owner = await account('owner@example.test');
    const stranger = await account('stranger@example.test');
    const box = await folder(owner);
    const child = await mine(owner, 'Child', { ancestor_ids: [box.id] });
    const earlier = await mine(owner, 'Earlier', { ancestor_ids: [box.id] });
    const db = await harness.db();
    await trashSubtree(db, owner, earlier.id);
    expect(await trashSubtree(db, stranger, box.id)).toEqual([]);
    const first = await trashSubtree(db, owner, box.id);
    expect(first.map(r => [r.id, r.newly_deleted]).sort()).toEqual([[box.id, true], [child.id, true]].sort());
    const again = await trashSubtree(db, owner, box.id);
    expect(again.map(r => [r.id, r.newly_deleted]).sort()).toEqual([[box.id, false], [child.id, false]].sort());
    const stamp = (await head(box.id)).deleted_at!;
    await db.transaction(tx => restoreTrashedSubtree(tx, stranger, box.id, stamp));
    expect((await head(box.id)).deleted_at).not.toBeNull();
    await db.transaction(tx => restoreTrashedSubtree(tx, owner, box.id, stamp));
    expect([(await head(box.id)).deleted_at, (await head(child.id)).deleted_at]).toEqual([null, null]);
    expect((await head(earlier.id)).deleted_at).not.toBeNull();
    await db.transaction(tx => rerootArtifact(tx, { id: box.id, ancestor_ids: [] }));
    const inner = await folder(owner, 'Inner', [box.id]);
    const leaf = await mine(owner, 'Leaf', { ancestor_ids: [box.id, inner.id] });
    await db.transaction(tx => rerootArtifact(tx, inner));
    expect([(await head(inner.id)).ancestor_ids, (await head(leaf.id)).ancestor_ids]).toEqual([[], [inner.id]]);
  });
});

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
