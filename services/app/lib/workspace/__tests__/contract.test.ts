/**
 * lib/workspace's CONTRACT, through its index only: the trash's acts over a folder subtree, the listings'
 * reach and order, and the shelf's partition.
 */
import { describe, expect, it } from 'vitest';
import { useAppHarness } from '@/__tests__/harness';
import { nativeHtml } from '@/__tests__/native-html-fixture';
import { createUser, identityForUser, revokeToken, type AccessActor } from '@/lib/accounts';
import { mintToken } from '@/lib/accounts/tokens';
import { createArtifact, getArtifactById, updateSharingFor, type ArtifactRow } from '@/lib/artifacts';
import {
  buildShelf, groupShelfByRecency, listArtifactsByUser, listDraftsByTokenIds, listPublicArtifactsByUser, listSharedWithEmail,
  listTrashFor, ownedArtifactState, restoreArtifactFor, trashArtifactFor,
} from '@/lib/workspace';

const harness = useAppHarness();
type Account = AccessActor & { userId: string };
async function account(email: string): Promise<Account> {
  return identityForUser((await createUser({ email })).id, null) as Account;
}
const folder = (owner: Account, title: string, parent?: ArtifactRow) =>
  createArtifact(null, owner.userId, { format: 'folder', source: null, meta: {}, title, ...(parent ? { ancestor_ids: [...parent.ancestor_ids, parent.id] } : {}) });
const doc = (owner: Account, title: string, parent?: ArtifactRow) =>
  createArtifact(null, owner.userId, { format: 'html', source: nativeHtml(`<p>${title}</p>`), meta: {}, title, ...(parent ? { ancestor_ids: [...parent.ancestor_ids, parent.id] } : {}) });
const placed = async (id: string) => (await getArtifactById(id))?.ancestor_ids ?? null;
const stamp = async (id: string) => (await (await harness.db()).query<{ deleted_at: string | null }>('SELECT deleted_at FROM artifacts WHERE id=$1', [id])).rows[0]!.deleted_at;

describe('the trash', () => {
  it('deleting a folder takes its whole subtree in one act; repeating it stamps nothing new', async () => {
    const owner = await account('owner@example.test');
    const top = await folder(owner, 'Top');
    const inner = await folder(owner, 'Inner', top);
    const leaf = await doc(owner, 'Leaf', inner);
    expect((await trashArtifactFor(owner, top.id))!.sort()).toEqual([top.id, inner.id, leaf.id].sort());
    const first = await stamp(leaf.id);
    expect(first).not.toBeNull();
    expect(await stamp(top.id)).toBe(first);
    expect((await trashArtifactFor(owner, top.id))!.sort()).toEqual([top.id, inner.id, leaf.id].sort());
    expect(await stamp(top.id)).toBe(first);
    expect(await ownedArtifactState(owner, top.id)).toEqual({ deleted: true });
    expect(await getArtifactById(leaf.id)).toBeNull();
  });

  it('restore brings back the act, not the containment: a row trashed on its own stays trashed', async () => {
    const owner = await account('owner@example.test');
    const top = await folder(owner, 'Top');
    const earlier = await doc(owner, 'Deleted first', top);
    const later = await doc(owner, 'Deleted with folder', top);
    await trashArtifactFor(owner, earlier.id);
    await (await harness.db()).query("UPDATE artifacts SET deleted_at = deleted_at - interval '1 minute' WHERE id = $1", [earlier.id]);
    await trashArtifactFor(owner, top.id);
    expect(await restoreArtifactFor(owner, top.id)).toEqual({ id: top.id, ancestor_ids: [] });
    expect(await placed(later.id)).toEqual([top.id]);
    expect(await getArtifactById(earlier.id)).toBeNull();
    expect((await listTrashFor(owner)).map(row => row.id)).toEqual([earlier.id]);
  });

  it('a row restored out of a folder still in the trash lands at the root, and its own subtree follows it', async () => {
    const owner = await account('owner@example.test');
    const top = await folder(owner, 'Top');
    const inner = await folder(owner, 'Inner', top);
    const leaf = await doc(owner, 'Leaf', inner);
    await trashArtifactFor(owner, inner.id);
    await (await harness.db()).query("UPDATE artifacts SET deleted_at = deleted_at - interval '1 minute' WHERE id = ANY($1::text[])", [[inner.id, leaf.id]]);
    await trashArtifactFor(owner, top.id);
    expect(await restoreArtifactFor(owner, inner.id)).toEqual({ id: inner.id, ancestor_ids: [] });
    expect(await placed(inner.id)).toEqual([]);
    expect(await placed(leaf.id)).toEqual([inner.id]);
    expect(await getArtifactById(top.id)).toBeNull();
  });

  it('is the owner\'s alone: a stranger can neither see, trash nor restore, and a live row is not restorable', async () => {
    const owner = await account('owner@example.test');
    const stranger = await account('stranger@example.test');
    const row = await doc(owner, 'Mine');
    expect(await restoreArtifactFor(owner, row.id)).toBeNull();
    expect(await trashArtifactFor(stranger, row.id)).toBeNull();
    expect(await ownedArtifactState(stranger, row.id)).toBeNull();
    expect(await ownedArtifactState(owner, row.id)).toEqual({ deleted: false });
    await trashArtifactFor(owner, row.id);
    expect(await restoreArtifactFor(stranger, row.id)).toBeNull();
    expect(await listTrashFor(stranger)).toEqual([]);
    expect(await getArtifactById(row.id)).toBeNull();
  });

  it('lists the owner\'s trash newest deletion first', async () => {
    const owner = await account('owner@example.test');
    const a = await doc(owner, 'A'), b = await doc(owner, 'B');
    await trashArtifactFor(owner, a.id);
    await trashArtifactFor(owner, b.id);
    await (await harness.db()).query("UPDATE artifacts SET deleted_at = deleted_at + interval '1 hour' WHERE id = $1", [a.id]);
    expect((await listTrashFor(owner)).map(row => row.title)).toEqual(['A', 'B']);
  });
});

describe('the listings', () => {
  it("an account's list is its own live rows, most recently updated first", async () => {
    const owner = await account('owner@example.test');
    const other = await account('other@example.test');
    const old = await doc(owner, 'Old'), recent = await doc(owner, 'Recent'), gone = await doc(owner, 'Gone');
    await doc(other, 'Theirs');
    await (await harness.db()).query("UPDATE artifacts SET updated_at = now() - interval '1 day' WHERE id = $1", [old.id]);
    await trashArtifactFor(owner, gone.id);
    expect((await listArtifactsByUser(owner.userId)).map(row => row.id)).toEqual([recent.id, old.id]);
  });

  it('the public profile lists public root pages and folders only', async () => {
    const owner = await account('owner@example.test');
    const shelf = await folder(owner, 'Shelf');
    const nested = await doc(owner, 'Nested', shelf);
    const hidden = await doc(owner, 'Unlisted');
    for (const row of [shelf, nested]) await updateSharingFor(owner, row.id, { visibility: 'public' });
    await updateSharingFor(owner, hidden.id, { visibility: 'unlisted' });
    expect((await listPublicArtifactsByUser(owner.userId)).map(row => row.id)).toEqual([shelf.id]);
  });

  it('shared-with-me names the role and the owner, and leaves out the viewer\'s own rows and trashed ones', async () => {
    const owner = await account('owner@example.test');
    const viewer = await account('viewer@example.test');
    const shared = await doc(owner, 'Shared'), trashed = await doc(owner, 'Trashed'), own = await doc(viewer, 'Own');
    for (const row of [shared, trashed]) await updateSharingFor(owner, row.id, { shares: [{ email: 'viewer@example.test', role: 'commenter' }] });
    await updateSharingFor(viewer, own.id, { shares: [{ email: 'viewer@example.test', role: 'editor' }] });
    await trashArtifactFor(owner, trashed.id);
    expect((await listSharedWithEmail(' Viewer@Example.test', viewer.userId)).map(row => [row.id, row.role])).toEqual([[shared.id, 'commenter']]);
  });

  it("a browser's drafts are its live tokens' unclaimed rows", async () => {
    const live = await mintToken('live', null), revoked = await mintToken('revoked', null);
    const draft = await createArtifact(live.id, null, { format: 'html', source: nativeHtml('<p>Draft</p>'), meta: {}, title: 'Draft' });
    await createArtifact(revoked.id, null, { format: 'html', source: nativeHtml('<p>Old</p>'), meta: {}, title: 'Old' });
    await revokeToken(revoked.id);
    expect((await listDraftsByTokenIds([live.id, revoked.id])).map(row => row.id)).toEqual([draft.id]);
    expect(await listDraftsByTokenIds([])).toEqual([]);
  });
});

describe('the shelf', () => {
  const row = (format: string, updated_at: string) => ({ format, updated_at });
  it('partitions pages, folders and material, each newest first, counting pages only', () => {
    const shelf = buildShelf([row('dataset', '2026-01-02'), row('html', '2026-01-01'), row('folder', '2026-01-03'), row('html', '2026-01-05')]);
    expect(shelf.documents.map(r => r.updated_at)).toEqual(['2026-01-05', '2026-01-01']);
    expect(shelf.folders).toHaveLength(1);
    expect(shelf.assets.map(r => r.format)).toEqual(['dataset']);
    expect(shelf.total).toBe(2);
  });

  it('bands rows by recency, dropping empty bands and keeping row order', () => {
    // Local calendar days, as the bands are.
    const at = (month: number, day: number, hour: number, year = 2026) => new Date(year, month, day, hour).toISOString();
    const now = new Date(2026, 2, 31, 12);
    const bands = groupShelfByRecency([row('html', at(2, 31, 9)), row('html', at(2, 27, 9)), row('html', at(0, 1, 0, 2025))], now);
    expect(bands.map(band => [band.key, band.rows.length])).toEqual([['today', 1], ['this-week', 1], ['older', 1]]);
  });
});
