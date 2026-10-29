/**
 * lib/social's join and membership states (setRelationState, seedOwnerJoin, dismissPendingRelations, read through
 * JOIN_RELATIONS) and a profile's social header (profileSocial): counts for everyone, the relation and the followers
 * you know only for another signed-in viewer, and only accounts with a handle named among them.
 */
import { describe, expect, it } from 'vitest';
import { useAppHarness } from '@/__tests__/harness';
import { createUser, setUsername } from '@/lib/accounts';
import { getDb } from '@/lib/platform';
import { JOIN_RELATIONS, dismissPendingRelations, link, profileSocial, seedOwnerJoin, setRelationState } from '@/lib/social';

useAppHarness();

const joins = async (artifactId: string) => (await (await getDb()).query<{ user_id: string; status: string; direction: string; initiated_by: string; joined_at: string | null; revision: number; explicit_join: boolean }>(
  `SELECT user_id, status, direction, initiated_by, joined_at, revision, explicit_join FROM ${JOIN_RELATIONS} j WHERE artifact_id = $1 ORDER BY user_id`, [artifactId])).rows;
const deletedAt = async (subjectId: string, objectId: string) => (await (await getDb()).query<{ deleted_at: string | null }>(
  'SELECT deleted_at FROM relations WHERE subject_id = $1 AND object_id = $2', [subjectId, objectId])).rows[0]?.deleted_at ?? null;

describe('join relation states', () => {
  it('seeds the owner as an accepted, explicit member once', async () => {
    const db = await getDb();
    await seedOwnerJoin(db, 'art_1', 'owner');
    await seedOwnerJoin(db, 'art_1', 'owner');
    expect(await joins('art_1')).toEqual([expect.objectContaining({ user_id: 'owner', status: 'accepted', direction: 'request', initiated_by: 'owner', explicit_join: true, revision: 1 })]);
    expect((await joins('art_1'))[0]!.joined_at).not.toBeNull();
  });

  it('moves one edge through pending, accepted and left, keeping the first acceptance time', async () => {
    const db = await getDb();
    const state = (status: 'pending' | 'accepted' | 'left', revision: number) => setRelationState(db, 'member', 'join', 'art_2', { status, direction: 'invitation', initiatedBy: 'owner', revision });
    await state('pending', 1);
    expect(await joins('art_2')).toEqual([expect.objectContaining({ status: 'pending', joined_at: null, explicit_join: false, revision: 1 })]);
    await state('accepted', 2);
    const accepted = (await joins('art_2'))[0]!;
    expect(accepted).toMatchObject({ status: 'accepted', revision: 2 });
    expect(accepted.joined_at).not.toBeNull();
    await state('accepted', 3);
    expect((await joins('art_2'))[0]!.joined_at).toBe(accepted.joined_at);
    await state('left', 4);
    expect(await joins('art_2')).toEqual([expect.objectContaining({ status: 'left', revision: 4 })]);
    expect(await deletedAt('member', 'art_2')).not.toBeNull();
  });

  it('refuses a verb it has no object kind for', async () => {
    await expect(setRelationState(await getDb(), 'a', 'befriend' as never, 'b', { status: 'pending', direction: 'request', initiatedBy: 'a', revision: 1 })).rejects.toThrow('Unknown relation verb');
  });

  it('dismisses pending requests either way between two people, and nobody else\'s', async () => {
    const db = await getDb();
    const pending = (subject: string, initiatedBy: string, artifact: string) => setRelationState(db, subject, 'join', artifact, { status: 'pending', direction: 'request', initiatedBy, revision: 1 });
    await pending('alice', 'mallory', 'art_a');
    await pending('mallory', 'alice', 'art_b');
    await pending('bob', 'mallory', 'art_c');
    await setRelationState(db, 'alice', 'join', 'art_d', { status: 'accepted', direction: 'invitation', initiatedBy: 'mallory', revision: 1 });
    await dismissPendingRelations(db, 'alice', 'mallory');
    expect(await joins('art_a')).toEqual([expect.objectContaining({ status: 'dismissed', revision: 2 })]);
    expect(await joins('art_b')).toEqual([expect.objectContaining({ status: 'dismissed', revision: 2 })]);
    expect(await joins('art_c')).toEqual([expect.objectContaining({ status: 'pending', revision: 1 })]);
    expect(await joins('art_d')).toEqual([expect.objectContaining({ status: 'accepted' })]);
  });
});

describe('profileSocial', () => {
  async function person(name: string, handle = true) {
    const user = await createUser({ email: `${name}@example.test` });
    if (handle) await setUsername(user.id, name);
    return user.id;
  }

  it('shows counts to anyone, and the relation and followers-you-know only to another viewer', async () => {
    const [owner, viewer, a, b, c, d, nameless] = [await person('owner1'), await person('viewer1'), await person('alpha'), await person('bravo'), await person('charlie'), await person('delta'), await person('nameless', false)];
    for (const friend of [a, b, c, d, nameless]) { await link(viewer, 'follow', friend); await link(friend, 'follow', owner); }
    await link(owner, 'follow', viewer);
    expect(await profileSocial(owner, null)).toEqual({ followers: 5, following: 1 });
    expect(await profileSocial(owner, owner)).toEqual({ followers: 5, following: 1 });
    const seen = await profileSocial(owner, viewer);
    expect(seen).toMatchObject({ followers: 5, following: 1, relation: { youFollow: false, followsYou: true, knownTotal: 4 } });
    expect(seen.relation!.known).toHaveLength(3);
    expect(seen.relation!.known.map(k => k.username)).not.toContain('nameless');
    expect(seen.relation!.known[0]).toEqual({ id: expect.any(String), username: expect.any(String), image: null });
    await link(viewer, 'follow', owner);
    expect((await profileSocial(owner, viewer)).relation).toMatchObject({ youFollow: true, followsYou: true });
  });
});
