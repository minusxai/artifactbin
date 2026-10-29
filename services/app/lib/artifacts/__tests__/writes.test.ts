/**
 * THE WRITE PATH through the interface: creation (own transaction or the caller's, reserved ids, the post-commit
 * effects), replace and revert under the edit protocol, metadata writes without a content version, the quotas, the
 * observed state and the after-commit hooks.
 */
import { describe, expect, it, vi } from 'vitest';
import { useAppHarness } from '@/__tests__/harness';
import { mintToken } from '@/lib/accounts';
import { ALLOW_PUBLIC_VISIBILITY } from '@/lib/platform';
import { artifactChannel } from '@artifactbin/contracts';
import { afterCreated, artifactQuotaExceeded, artifactState, assetByteQuotaExceeded, assetByteQuotaLimit, byteQuotaFor, createArtifact, emitDatasetCommitted, emitHeadCommitted, getArtifactById, ARTIFACT_HEADER_COLUMNS, assetBytesForToken, getArtifactHeaderById, listArtifactsFor, onDatasetCommitted, onHeadCommitted, repairRegisteredMutationHead, repairRegisteredQueryHead, setArtifactQuotaForTests, setAssetByteQuotaForTests, isVersionConflict, isVersionNotArchived, replaceArtifactFor, reserveArtifactIds, revertArtifactFor, setMetadataFor, updateSharingFor } from '@/lib/artifacts';
import { type ArtifactRow } from '@/lib/artifact-access';
import { account, dataset, head, mine, page, sql } from '@/__tests__/artifact-fixtures';

const harness = useAppHarness();
const folder = (actor: { userId: string }, title = 'Folder', ancestor_ids: string[] = []) =>
  createArtifact(null, actor.userId, { format: 'folder', source: null, meta: {}, title, ancestor_ids });
async function heard(id: string) {
  const payloads: string[] = [];
  const stop = await (await harness.db()).listen(artifactChannel(id), payload => payloads.push(payload));
  return { payloads, stop };
}

describe('creation', () => {
  it('chooses visibility by kind and owner, files the row under its folder and wakes it after commit', async () => {
    const owner = await account('owner@example.test');
    const loose = await mintToken('loose', null);
    const box = await folder(owner);
    const channel = await heard(box.id);
    const doc = await mine(owner, 'Filed', { ancestor_ids: [box.id] });
    expect(doc).toMatchObject({ visibility: 'private', ancestor_ids: [box.id], version: 1, user_id: owner.userId, creator_user_id: owner.userId, actor_user_id: owner.userId });
    expect((await dataset(owner)).visibility).toBe('unlisted');
    expect((await createArtifact(loose.id, null, page('Anon'))).visibility).toBe(ALLOW_PUBLIC_VISIBILITY ? 'public' : 'unlisted');
    await expect(createArtifact(null, null, page('Nobody'))).rejects.toThrow('requires a user or token');
    await expect(mine(owner, 'Misfiled', { ancestor_ids: [doc.id] })).rejects.toThrow('Parent owner or placement changed');
    await (await harness.db()).query('SELECT 1');
    expect(channel.payloads).toEqual(['child']);
    await channel.stop();
  });

  it('inside the caller\'s transaction: a reserved id, no post-commit effects until afterCreated', async () => {
    const owner = await account('owner@example.test');
    const box = await folder(owner);
    const [id] = await reserveArtifactIds(owner, 1);
    const channel = await heard(box.id);
    const row = await (await harness.db()).transaction(tx => createArtifact(null, owner.userId, page('Inner', { ancestor_ids: [box.id] }), { tx, reservedId: id, linkRole: 'commenter', shares: [{ email: 'A@Example.test ', role: 'viewer' }] }));
    expect(row).toMatchObject({ id, link_role: 'commenter', shares: [{ email: 'a@example.test', role: 'viewer' }], sharing_revision: 1 });
    await (await harness.db()).query('SELECT 1');
    expect(channel.payloads).toEqual([]);
    await afterCreated(row, owner.userId);
    await (await harness.db()).query('SELECT 1');
    expect(channel.payloads).toEqual(['child']);
    await channel.stop();
    await expect(createArtifact(null, owner.userId, page('Again'), { reservedId: id })).rejects.toMatchObject({ reply: { status: 409, body: { error: 'identity_consumed' } } });
  });
});

describe('replace and revert', () => {
  it('a replace may refile and reshare in one write; markup and a stranger are refused', async () => {
    const owner = await account('owner@example.test');
    const stranger = await account('stranger@example.test');
    const box = await folder(owner);
    const row = await mine(owner);
    const next = await replaceArtifactFor(owner, row.id, { ...page('Moved'), ancestor_ids: [box.id] }, { expectedVersion: 1, shares: [{ email: 'x@example.test', role: 'editor' }] }) as ArtifactRow;
    expect(next).toMatchObject({ version: 2, ancestor_ids: [box.id], shares: [{ email: 'x@example.test', role: 'editor' }] });
    const kept = await replaceArtifactFor(owner, row.id, page('Kept'), { expectedVersion: 2 }) as ArtifactRow;
    expect(kept.shares).toEqual([{ email: 'x@example.test', role: 'editor' }]);
    expect(await replaceArtifactFor(stranger, row.id, page('No'), { expectedVersion: 3 })).toBeNull();
    const markup = await replaceArtifactFor(owner, row.id, { format: 'markup', source: '<Doc/>', meta: {} }) as Response;
    expect([markup.status, await markup.json()]).toEqual([400, { error: 'jsonb_operations_required' }]);
    const invalid = await replaceArtifactFor(owner, row.id, { format: 'html', source: '<script>', meta: {} }, { expectedVersion: 3 });
    expect(isVersionConflict(invalid as ArtifactRow)).toBe(false);
  });

  it('a governed dataset is its owner\'s to replace and nobody\'s to revert', async () => {
    const owner = await account('owner@example.test');
    const editor = await account('editor@example.test');
    const data = await dataset(owner, { version: 2, allow: [{ actions: ['read'], from: { user: '*' } }] });
    await updateSharingFor(owner, data.id, { shares: [{ email: 'editor@example.test', role: 'editor' }] });
    const locked = await replaceArtifactFor(editor, data.id, { format: 'dataset', source: null, meta: {} }) as Response;
    expect([locked.status, (await locked.json()).error]).toEqual([409, 'policy_locked']);
    const replaced = await replaceArtifactFor(owner, data.id, { format: 'dataset', source: null, meta: { note: 1 } }) as ArtifactRow;
    expect(replaced).toMatchObject({ version: 2, meta: { note: 1 } });
    const reverted = await revertArtifactFor(owner, data.id, 1);
    expect(isVersionNotArchived(reverted) && reverted.refusal!.status).toBe(409);
    expect(isVersionNotArchived(null)).toBe(false);
  });

  it('revert names what it cannot do: an unarchived version, a stale head, a stranger', async () => {
    const owner = await account('owner@example.test');
    const stranger = await account('stranger@example.test');
    const v1 = await mine(owner, 'First');
    const v2 = await replaceArtifactFor(owner, v1.id, page('Second'), { expectedVersion: 1 }) as ArtifactRow;
    expect(await revertArtifactFor(stranger, v1.id, 1)).toBeNull();
    expect(await revertArtifactFor(owner, v1.id, 9)).toEqual({ notArchived: true });
    const stale = await revertArtifactFor(owner, v1.id, 1, { expectedVersion: 1 });
    expect(isVersionNotArchived(stale) && [stale.refusal!.status, (await stale.refusal!.json()).error]).toEqual([409, 'version_conflict']);
    const staleState = await revertArtifactFor(owner, v1.id, 1, { expectedState: artifactState(v1) });
    expect(isVersionNotArchived(staleState) && (await staleState.refusal!.json()).error).toBe('state_conflict');
    const done = await revertArtifactFor(owner, v1.id, 1, { expectedVersion: 2, expectedState: artifactState(v2) }) as ArtifactRow;
    expect(done).toMatchObject({ version: 3, title: 'First' });
  });
});

describe('metadata', () => {
  it('owner-only unless editors are allowed; no content version; conflicts, dry runs and refusals', async () => {
    const owner = await account('owner@example.test');
    const editor = await account('editor@example.test');
    const row = await mine(owner);
    await updateSharingFor(owner, row.id, { shares: [{ email: 'editor@example.test', role: 'editor' }] });
    expect(await setMetadataFor(editor, row.id, { title: 'By editor' })).toBeNull();
    const channel = await heard(row.id);
    const titled = await setMetadataFor(editor, row.id, { title: '  Renamed  ', theme: 'paper', visibility: 'unlisted' }, { allowEditor: true }) as ArtifactRow;
    expect(titled).toMatchObject({ title: 'Renamed', version: row.version, edit_id: row.edit_id, visibility: 'unlisted', meta: { theme: 'paper' }, actor_user_id: editor.userId, open_annotations: 0 });
    await (await harness.db()).query('SELECT 1');
    expect(channel.payloads).toEqual([row.edit_id]);
    await channel.stop();
    const dry = await setMetadataFor(owner, row.id, { title: 'Dry' }, { dryRun: true }) as ArtifactRow;
    expect(dry.title).toBe('Dry');
    expect((await head(row.id)).title).toBe('Renamed');
    expect(await setMetadataFor(owner, row.id, { title: 'x' }, { expectedVersion: 7 })).toEqual({ conflict: true, currentVersion: row.version });
    expect(await setMetadataFor(owner, row.id, { title: 'x' }, { expectedState: 'stale' })).toMatchObject({ conflict: true, reason: 'state_conflict' });
    expect(await setMetadataFor(owner, row.id, { access: 'readwrite' })).toBeNull();
    expect(await setMetadataFor(owner, 'missing', { title: 'x' })).toBeNull();
  });

  it('a policy write needs the policy revision it observed; a move swaps the whole subtree\'s trail', async () => {
    const owner = await account('owner@example.test');
    const data = await dataset(owner, { version: 2, allow: [{ actions: ['read'], from: { user: '*' } }] });
    const policy = { version: 2 as const, allow: [{ actions: ['read' as const], from: { user: '$owner' } }] };
    expect(await setMetadataFor(owner, data.id, { policy }, { expectedPolicyRevision: 5 })).toMatchObject({ conflict: true, reason: 'state_conflict' });
    expect(await setMetadataFor(owner, data.id, { policy }, { expectedPolicyRevision: 0 })).toMatchObject({ policy_revision: 1, dataset_policy: policy });
    expect(await sql('SELECT revision FROM dataset_policy_audit WHERE dataset_id=$1 ORDER BY revision', [data.id])).toEqual([{ revision: 0 }, { revision: 1 }]);
    const a = await folder(owner, 'A');
    const b = await folder(owner, 'B');
    const inner = await folder(owner, 'Inner', [a.id]);
    const leaf = await mine(owner, 'Leaf', { ancestor_ids: [a.id, inner.id] });
    await setMetadataFor(owner, inner.id, { ancestor_ids: [b.id] });
    expect((await head(leaf.id)).ancestor_ids).toEqual([b.id, inner.id]);
  });
});

describe('quotas, state and after-commit', () => {
  it('the row cap counts trashed rows; the byte cap charges the account; the observed state ignores derived caches', async () => {
    const owner = await account('owner@example.test');
    const loose = await mintToken('loose', null);
    expect(await artifactQuotaExceeded(loose.id, 1000)).toBe(false);
    const row = await createArtifact(loose.id, null, page('One'));
    expect(await artifactQuotaExceeded(loose.id, 1000)).toBe(true);
    await sql('UPDATE artifacts SET deleted_at=now() WHERE id=$1', [row.id]);
    expect(await artifactQuotaExceeded(loose.id, 1000)).toBe(true);
    const limit = assetByteQuotaLimit()!;
    expect(limit).toBeGreaterThan(0);
    expect(await assetByteQuotaExceeded(null, owner.userId)).toBe(false);
    await createArtifact(null, owner.userId, { format: 'image', source: null, meta: { bytes: limit }, title: 'Big' });
    expect(await assetByteQuotaExceeded(null, owner.userId)).toBe(true);
    expect(await byteQuotaFor(null, owner.userId)()).toBe(true);
    expect(await byteQuotaFor(loose.id)()).toBe(false);
    await expect(assetByteQuotaExceeded(null, null)).rejects.toThrow('requires a user or token');
    const doc = (await getArtifactById((await mine(owner)).id))!;
    expect(artifactState({ ...doc, meta: { ...doc.meta, compiledCss: 'x', parsedArtifact: {} } })).toBe(artifactState(doc));
    expect(artifactState({ ...doc, title: 'Other' })).not.toBe(artifactState(doc));
    expect(artifactState({ ...doc, sharing_revision: 9 })).not.toBe(artifactState(doc));
  });

  it('test caps replace the configured ones; bytes count images, web assets and comment images of the account', async () => {
    const owner = await account('owner@example.test');
    const loose = await mintToken('loose', null);
    try {
      setArtifactQuotaForTests(1);
      expect(await artifactQuotaExceeded(loose.id)).toBe(false);
      await createArtifact(loose.id, null, page('One'));
      expect(await artifactQuotaExceeded(loose.id)).toBe(true);
      setArtifactQuotaForTests(0);
      expect(await artifactQuotaExceeded(loose.id, 50)).toBe(false);
      await createArtifact(null, owner.userId, { format: 'image', source: null, meta: { bytes: 40 }, title: 'Pic' });
      await createArtifact(loose.id, null, { format: 'image', source: null, meta: { bytes: 2 }, title: 'Anon pic' });
      expect([await assetBytesForToken(null, owner.userId), await assetBytesForToken(loose.id)]).toEqual([40, 2]);
      setAssetByteQuotaForTests(40);
      expect([assetByteQuotaLimit(), await assetByteQuotaExceeded(null, owner.userId), await assetByteQuotaExceeded(loose.id)]).toEqual([40, true, false]);
      setAssetByteQuotaForTests(null);
      expect(await assetByteQuotaExceeded(null, owner.userId)).toBe(false);
    } finally { setArtifactQuotaForTests(null); setAssetByteQuotaForTests(undefined as never); }
  });

  it('after-commit: listeners run in order, a throwing one never reaches the write, a disposed one hears nothing', async () => {
    const heard: string[] = [];
    const stopBad = onHeadCommitted(() => { throw new Error('listener'); });
    const stopHead = onHeadCommitted((id, row, change) => heard.push(`head:${id}:${row?.id ?? '-'}:${change?.renderingChanged ?? false}`));
    const stopData = onDatasetCommitted(id => heard.push(`data:${id}`));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(() => emitHeadCommitted('a', undefined, { renderingChanged: true })).not.toThrow();
    emitDatasetCommitted('d');
    stopBad(); stopHead(); stopData();
    emitHeadCommitted('b');
    emitDatasetCommitted('e');
    expect(heard).toEqual(['head:a:-:true', 'data:d']);
    expect(warn).toHaveBeenCalledTimes(1);
    // A markup creation emits its head after commit.
    const stop = onHeadCommitted(id => heard.push(`created:${id}`));
    const owner = await account('owner@example.test');
    const doc = await createArtifact(null, owner.userId, { format: 'markup', source: '<p>x</p>', meta: {}, title: 'M' });
    stop();
    expect(heard.at(-1)).toBe(`created:${doc.id}`);
    warn.mockRestore();
  });

  it('the owner\'s listing and the header columns; a registered-program repair leaves an unregistered page alone', async () => {
    const owner = await account('owner@example.test');
    const editor = await account('editor@example.test');
    const a = await mine(owner, 'A');
    await updateSharingFor(owner, a.id, { shares: [{ email: 'editor@example.test', role: 'editor' }] });
    expect((await listArtifactsFor(owner)).map(r => r.id)).toEqual([a.id]);
    expect(await listArtifactsFor(editor)).toEqual([]);
    const header = (await getArtifactHeaderById(a.id))!;
    expect(Object.keys(header).sort()).toEqual([...ARTIFACT_HEADER_COLUMNS].sort());
    const db = await harness.db();
    expect(await db.transaction(tx => repairRegisteredQueryHead(tx, a.id))).toEqual([]);
    expect(await db.transaction(tx => repairRegisteredMutationHead(tx, a.id))).toEqual([]);
    await expect(db.transaction(tx => repairRegisteredQueryHead(tx, 'missing'))).rejects.toThrow('page_unavailable');
    const data = await dataset(owner);
    await expect(db.transaction(tx => repairRegisteredMutationHead(tx, data.id))).rejects.toThrow('page_unavailable');
  });
});
