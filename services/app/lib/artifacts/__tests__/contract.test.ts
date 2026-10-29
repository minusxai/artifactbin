/**
 * lib/artifacts' CONTRACT, through its index only: the edit protocol's versions and conflicts, ownership by
 * token, user and group, the share roles and general access, the trash gate, and the collection page.
 */
import { describe, expect, it } from 'vitest';
import { useAppHarness } from '@/__tests__/harness';
import { nativeHtml } from '@/__tests__/native-html-fixture';
import { createUser, identityForUser, type AccessActor } from '@/lib/accounts';
import { createGroup } from '@/lib/groups';
import { mintToken } from '@/lib/accounts/tokens';
import {
  artifactState, canReadArtifact, createArtifact, effectiveRole, getArtifactById, getArtifactFor, getArtifactsFor,
  getLinkReadableArtifact, getOwnedArtifactFor, isVersionConflict, listArtifactPageFor, listVersionsFor,
  ownsArtifact, replaceArtifactFor, revertArtifactFor, trashSubtree, updateSharingFor, type ArtifactRow,
} from '@/lib/artifacts';

const harness = useAppHarness();
const page = (title: string, extra: Record<string, unknown> = {}) => ({ format: 'html' as const, source: nativeHtml(`<p>${title}</p>`), meta: {}, title, ...extra });

async function account(email: string): Promise<AccessActor & { userId: string }> {
  const user = await createUser({ email });
  return identityForUser(user.id, null) as AccessActor & { userId: string };
}
const mine = async (actor: AccessActor & { userId: string }, title = 'Doc', extra: Record<string, unknown> = {}) => createArtifact(null, actor.userId, page(title, extra));
const replace = (actor: AccessActor, row: ArtifactRow, title: string, opts: Parameters<typeof replaceArtifactFor>[3] = {}) =>
  replaceArtifactFor(actor, row.id, page(title), { expectedVersion: row.version, ...opts });

describe('the edit protocol', () => {
  it('each accepted replace is the next version under a fresh edit id, stamped with its writer, the old one listed', async () => {
    const owner = await account('owner@example.test');
    const v1 = await mine(owner);
    const v2 = await replace(owner, v1, 'Second') as ArtifactRow;
    expect(v2).toMatchObject({ version: v1.version + 1, title: 'Second', actor_user_id: owner.userId });
    expect(v2.edit_id).not.toBe(v1.edit_id);
    expect(artifactState(v2)).not.toBe(artifactState(v1));
    expect((await listVersionsFor(owner, v1.id))!.map(v => v.version)).toEqual([v1.version]);
  });

  it('a stale expected version or expected state is a conflict naming the head, and changes nothing', async () => {
    const owner = await account('owner@example.test');
    const v1 = await mine(owner);
    const v2 = await replace(owner, v1, 'Second') as ArtifactRow;
    const staleVersion = await replace(owner, v1, 'Lost');
    expect(isVersionConflict(staleVersion as ArtifactRow) && staleVersion).toEqual({ conflict: true, currentVersion: v2.version });
    const staleState = await replace(owner, v2, 'Lost too', { expectedState: artifactState(v1) });
    expect(staleState).toEqual({ conflict: true, reason: 'state_conflict', currentVersion: v2.version, currentState: artifactState(v2) });
    expect(await getArtifactById(v1.id)).toMatchObject({ version: v2.version, edit_id: v2.edit_id, title: 'Second' });
  });

  it('an HTML replace must name the version it replaces; republishing the head unchanged adds no version', async () => {
    const owner = await account('owner@example.test');
    const v1 = await mine(owner);
    const unnamed = await replaceArtifactFor(owner, v1.id, page('Unnamed')) as Response;
    expect(unnamed.status).toBe(400);
    expect(await unnamed.json()).toEqual({ error: 'expected_version_required' });
    const same = await replaceArtifactFor(owner, v1.id, { ...page('Doc'), source: v1.source }, { expectedVersion: v1.version }) as ArtifactRow;
    expect(same).toMatchObject({ version: v1.version, edit_id: v1.edit_id });
  });

  it('a revert is a new version carrying the archived content', async () => {
    const owner = await account('owner@example.test');
    const v1 = await mine(owner, 'First');
    const v2 = await replace(owner, v1, 'Second') as ArtifactRow;
    const reverted = await revertArtifactFor(owner, v1.id, v1.version) as ArtifactRow;
    expect(reverted).toMatchObject({ version: v2.version + 1, title: 'First', source: v1.source });
  });
});

describe('ownership', () => {
  it('a token owns its unclaimed rows; a user owns theirs; a group row is its editors\', never its creator\'s alone', async () => {
    const owner = await account('owner@example.test');
    const stranger = await account('stranger@example.test');
    const loose = await mintToken('loose', null);
    const tokenActor = identityForUser(null, loose.id);
    const byToken = await createArtifact(loose.id, null, page('By token'));
    expect(ownsArtifact(byToken, tokenActor)).toBe(true);
    expect(await getOwnedArtifactFor(tokenActor, byToken.id)).toMatchObject({ id: byToken.id });
    expect(await getOwnedArtifactFor(owner, byToken.id)).toBeNull();

    const byUser = await mine(owner);
    expect(ownsArtifact(byUser, owner)).toBe(true);
    // A user's row is not its creating token's: the token alone reaches nothing once an account owns it.
    expect(ownsArtifact({ ...byUser, token_id: loose.id }, tokenActor)).toBe(false);

    const group = await createGroup(owner.userId, { handle: 'contract-team', name: 'Contract team' });
    const byGroup = await createArtifact(null, owner.userId, page('Team doc', { destination: { type: 'group', id: group.id } }));
    expect(byGroup.group_id).toBe(group.id);
    expect(ownsArtifact(byGroup, owner)).toBe(false);
    expect(ownsArtifact(byGroup, { ...owner, groupId: group.id })).toBe(true);
    expect(await effectiveRole(byGroup, owner)).toBe('owner');
    expect(await effectiveRole(byGroup, stranger)).toBe('none');
    expect(await getArtifactFor(stranger, byGroup.id)).toBeNull();
  });
});

describe('visibility and share roles', () => {
  it('named viewers read, named editors reach for writing, strangers get nothing from a private row', async () => {
    const owner = await account('owner@example.test');
    const viewer = await account('viewer@example.test');
    const editor = await account('editor@example.test');
    const stranger = await account('stranger@example.test');
    const row = await mine(owner);
    await updateSharingFor(owner, row.id, { visibility: 'private', shares: [{ email: 'viewer@example.test', role: 'viewer' }, { email: 'EDITOR@example.test ', role: 'editor' }] });
    const head = (await getArtifactById(row.id))!;
    expect(await Promise.all([owner, viewer, editor, stranger].map(a => effectiveRole(head, a)))).toEqual(['owner', 'viewer', 'editor', 'none']);
    expect(await Promise.all([viewer, stranger].map(a => canReadArtifact(head, a)))).toEqual([true, false]);
    expect(await getArtifactFor(editor, row.id)).toMatchObject({ id: row.id });
    expect(await getArtifactFor(viewer, row.id)).toBeNull();
    expect(await getLinkReadableArtifact(row.id)).toBeNull();
    // An editor writes the document but does not own it.
    expect(await getOwnedArtifactFor(editor, row.id)).toBeNull();
    expect(await replace(editor, head, 'Edited by editor')).toMatchObject({ version: head.version + 1, actor_user_id: editor.userId, user_id: owner.userId });
  });

  it('general access grants its role to anyone holding the link, and only while the row is not private', async () => {
    const owner = await account('owner@example.test');
    const stranger = await account('stranger@example.test');
    const row = await mine(owner);
    await updateSharingFor(owner, row.id, { visibility: 'unlisted', linkRole: 'commenter' });
    expect(await effectiveRole((await getArtifactById(row.id))!, stranger)).toBe('commenter');
    expect(await getLinkReadableArtifact(row.id)).toMatchObject({ id: row.id });
    await updateSharingFor(owner, row.id, { visibility: 'private' });
    expect(await effectiveRole((await getArtifactById(row.id))!, stranger)).toBe('none');
    // A stranger cannot change the ACL: the uniform null.
    expect(await updateSharingFor(stranger, row.id, { visibility: 'public' })).toBeNull();
  });
});

describe('the trash gate', () => {
  it('a trashed row is the uniform miss on every read seam, and trashing is the owner\'s alone', async () => {
    const owner = await account('owner@example.test');
    const stranger = await account('stranger@example.test');
    const row = await mine(owner);
    await updateSharingFor(owner, row.id, { visibility: 'public' });
    const db = await harness.db();
    expect(await trashSubtree(db, stranger, row.id)).toEqual([]);
    expect(await getArtifactById(row.id)).not.toBeNull();
    expect((await trashSubtree(db, owner, row.id)).map(r => r.id)).toEqual([row.id]);
    expect(await getArtifactById(row.id)).toBeNull();
    expect(await getArtifactFor(owner, row.id)).toBeNull();
    expect(await getOwnedArtifactFor(owner, row.id)).toBeNull();
    expect(await getArtifactsFor(owner, [row.id])).toEqual([]);
    expect(await getLinkReadableArtifact(row.id)).toBeNull();
    expect((await listArtifactPageFor(owner, 10)).rows).toEqual([]);
    expect(await replace(owner, row, 'Ghost')).toBeNull();
  });
});

describe('the collection page', () => {
  it('lists newest first by creation, pages by a stable cursor, and separates owned from shared', async () => {
    const owner = await account('owner@example.test');
    const friend = await account('friend@example.test');
    const db = await harness.db();
    const ids: string[] = [];
    for (let i = 0; i < 5; i++) {
      const row = await mine(owner, `Doc ${i}`);
      ids.push(row.id);
      await db.query("UPDATE artifacts SET created_at = timestamptz '2026-01-01' + $2 * interval '1 minute' WHERE id = $1", [row.id, i]);
    }
    // Two rows on the same instant: the id breaks the tie, so the cursor never skips or repeats one.
    await db.query('UPDATE artifacts SET created_at = (SELECT created_at FROM artifacts WHERE id = $2) WHERE id = $1', [ids[1], ids[2]]);
    const theirs = await mine(friend, 'Shared with owner');
    await updateSharingFor(friend, theirs.id, { shares: [{ email: 'owner@example.test', role: 'viewer' }] });
    await db.query("UPDATE artifacts SET created_at = timestamptz '2025-01-01' WHERE id = $1", [theirs.id]);

    const seen: string[] = [];
    let cursor: { created: string; id: string } | undefined;
    do {
      const pageOf = await listArtifactPageFor(owner, 2, cursor, { relationship: 'owned' });
      expect(pageOf.rows.length).toBeLessThanOrEqual(2);
      seen.push(...pageOf.rows.map(r => r.id));
      cursor = pageOf.next;
    } while (cursor);
    const tied = [ids[1]!, ids[2]!].sort().reverse();
    expect(seen).toEqual([ids[4], ids[3], ...tied, ids[0]]);
    expect((await listArtifactPageFor(owner, 10, undefined, { relationship: 'shared' })).rows.map(r => r.id)).toEqual([theirs.id]);
    expect((await listArtifactPageFor(owner, 10)).rows.map(r => r.id).at(-1)).toBe(theirs.id);
    expect((await listArtifactPageFor(owner, 10, undefined, { search: 'doc 3' })).rows.map(r => r.id)).toEqual([ids[3]]);
  });
});
