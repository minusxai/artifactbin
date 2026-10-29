/**
 * A ROW'S HISTORY AND THE LISTINGS through the interface: version lists and pages, archived content in the editor
 * scope, and the collection page's filters.
 */
import { describe, expect, it } from 'vitest';
import { useAppHarness } from '@/__tests__/harness';
import { mintToken } from '@/lib/accounts';
import { createArtifact, getVersionFor, listArtifactPageFor, listVersionPageFor, listVersionsFor, replaceArtifactFor } from '@/lib/artifacts';
import { type ArtifactRow } from '@/lib/artifact-access';
import { account, dataset, mine, page } from '@/__tests__/artifact-fixtures';

useAppHarness();
const folder = (actor: { userId: string }, title = 'Folder', ancestor_ids: string[] = []) =>
  createArtifact(null, actor.userId, { format: 'folder', source: null, meta: {}, title, ancestor_ids });

describe('history and listings', () => {
  it('versions list newest first; pages filter by author and bound; content reads stay in the editor scope', async () => {
    const owner = await account('owner@example.test');
    const stranger = await account('stranger@example.test');
    const v1 = await mine(owner, 'One');
    let current = v1;
    for (const title of ['Two', 'Three']) current = await replaceArtifactFor(owner, v1.id, page(title), { expectedVersion: current.version }) as ArtifactRow;
    expect((await listVersionsFor(owner, v1.id))!.map(v => v.version)).toEqual([2, 1]);
    expect(await listVersionsFor(stranger, v1.id)).toBeNull();
    const first = (await listVersionPageFor(owner, v1.id, 2))!;
    expect(first).toMatchObject({ rows: [{ version: 3, title: 'Three' }, { version: 2 }], next: 2 });
    expect((await listVersionPageFor(owner, v1.id, 5, first.next))!.rows.map(r => r.version)).toEqual([1]);
    expect((await listVersionPageFor(owner, v1.id, 5, undefined, 2))!.rows.map(r => r.version)).toEqual([2, 1]);
    expect((await listVersionPageFor(owner, v1.id, 5, undefined, undefined, { author: 'nobody' }))!.rows).toEqual([]);
    expect(await listVersionPageFor(stranger, v1.id, 5)).toBeNull();
    expect(await getVersionFor(owner, v1.id, 1)).toMatchObject({ version: 1, title: 'One', source: v1.source });
    expect(await getVersionFor(owner, v1.id, 3)).toBeNull();
    expect(await getVersionFor(stranger, v1.id, 1)).toBeNull();
  });

  it('the collection page filters by type, visibility and parent, and a token lists its own', async () => {
    const owner = await account('owner@example.test');
    const box = await folder(owner);
    const inside = await mine(owner, 'Inside', { ancestor_ids: [box.id] });
    const data = await dataset(owner);
    const ids = async (filters: Parameters<typeof listArtifactPageFor>[3]) => (await listArtifactPageFor(owner, 10, undefined, filters)).rows.map(r => r.id);
    expect(await ids({ type: 'folder' })).toEqual([box.id]);
    expect(await ids({ type: 'dataset' })).toEqual([data.id]);
    expect(await ids({ visibility: 'unlisted' })).toEqual([data.id]);
    expect(await ids({ parent_id: box.id })).toEqual([inside.id]);
    const loose = await mintToken('loose', null);
    const tokenRow = await createArtifact(loose.id, null, page('Token'));
    expect((await listArtifactPageFor({ userId: null, tokenId: loose.id, email: null, documentEditor: false }, 10)).rows.map(r => r.id)).toEqual([tokenRow.id]);
  });
});
