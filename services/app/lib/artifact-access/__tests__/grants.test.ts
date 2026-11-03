/**
 * DATASET ACCESS AND CAPABILITIES through the interface: the private ceiling on a read rule, the policy
 * revision a commit re-checks, an upload's saved-page context and its host-only proof, and the capability table.
 */
import { describe, expect, it } from 'vitest';
import { useAppHarness } from '@/__tests__/harness';
import { identityForUser } from '@/lib/accounts';
import { attestSavedHtmlUpload, can, capabilityRefusal, readThrough, refusalFor, uploadGrantContext, type ArtifactRow } from '@/lib/artifact-access';
import { canReadArtifact, capabilityGuard } from '@/lib/artifacts';
import { updateSharingFor } from '@/lib/artifacts';
import { account, dataset, head, mine, personOfKind, readAllPolicy, sql } from '@/__tests__/artifact-fixtures';

const harness = useAppHarness();

describe('dataset grants', () => {
  const readable = readAllPolicy();

  it('a read rule honours the private ceiling', async () => {
    const owner = await account('owner@example.test');
    const stranger = await account('stranger@example.test');
    const data = await dataset(owner, readable);
    expect(data.visibility).toBe('unlisted');
    expect(await canReadArtifact(data, stranger)).toBe(true);
    await updateSharingFor(owner, data.id, { visibility: 'private' });
    const closed = await head(data.id);
    expect(await canReadArtifact(closed, stranger)).toBe(false);
    expect(await canReadArtifact(closed, owner)).toBe(true);
    expect(await readThrough(await harness.db(), closed, stranger)).toBe(false);
    expect(await readThrough(await harness.db(), closed, owner)).toBe(true);
  });

  // Write decisions (and their commit-time recheck) are lib/dataset-permissions'; grants supply program trust.
  it('an upload context needs its host proof, the head edit and an accepted join, and never a guest', async () => {
    const owner = await account('owner@example.test');
    const reader = await account('reader@example.test');
    const guest = await personOfKind('guest');
    const data = await dataset(owner, readable);
    const doc = await mine(owner, 'App');
    await updateSharingFor(owner, doc.id, { visibility: 'unlisted' });
    const verified: string[] = [];
    const authority = { id: doc.id, editId: doc.edit_id, version: doc.version, datasetId: data.id };
    const uploading = { ...authority, uploadProof: attestSavedHtmlUpload(authority, async () => { verified.push(doc.id); }) };
    expect(await uploadGrantContext(data, owner, uploading)).toMatchObject({ owner: { userId: owner.userId }, callerEditorGroupIds: [], artifact: { id: doc.id, owner: { userId: owner.userId } } });
    expect(verified).toEqual([doc.id]);
    await expect(uploadGrantContext(data, guest, uploading)).rejects.toThrow('Sign in to change data');
    // The proof is bound to the dataset it names and the edit it was minted at; a copied object proves nothing.
    await expect(uploadGrantContext(data, owner, { ...uploading, datasetId: 'other' })).rejects.toThrow('Document access or action changed');
    await expect(uploadGrantContext(data, owner, { ...uploading, editId: 'stale' })).rejects.toThrow('Document access or action changed');
    await expect(uploadGrantContext(data, owner, { ...uploading, uploadProof: {} })).rejects.toThrow('Document access or action changed');
    await expect(uploadGrantContext(data, reader, uploading)).rejects.toThrow('Join this artifact');
  });
});

describe('the capability table', () => {
  it('kinds decide what an actor may do; refusals name the door', async () => {
    const owner = await account('owner@example.test');
    const friend = await account('friend@example.test');
    const guest = await personOfKind('guest');
    const tester = await personOfKind('testuser');
    const anon = identityForUser(null, null);
    const row = await mine(owner);
    await updateSharingFor(owner, row.id, { visibility: 'unlisted' });
    const open = await head(row.id) as ArtifactRow;
    expect(await can(anon, 'create')).toBe(false);
    expect(await can(identityForUser(null, 'tok'), 'create')).toBe(true);
    expect(await can(owner, 'comment')).toBe(false);
    expect(await can(friend, 'read', open)).toBe(true);
    expect(await can(friend, 'comment', open)).toBe(true);
    expect(await can(friend, 'edit', open)).toBe(false);
    expect(await can(owner, 'edit', open)).toBe(true);
    expect(await can(guest, 'comment', open)).toBe(false);
    expect(await can(tester, 'comment', open)).toBe(false);
    expect(await can(anon, 'fork', open)).toBe(false);
    expect(await can(identityForUser(null, 'tok'), 'fork', open)).toBe(true);
    expect(await can(friend, 'follow', { userId: owner.userId })).toBe(true);
    expect(await can(friend, 'follow', open)).toBe(false);
    expect(await can(guest, 'follow', { userId: owner.userId })).toBe(false);
    await sql('UPDATE users SET test_account=true WHERE id=$1', [friend.userId]);
    expect(await can(friend, 'comment', open)).toBe(false);
    expect(await can(friend, 'fork', open)).toBe(true);
    expect(await can(friend, 'follow', { userId: owner.userId })).toBe(false);
    expect(await refusalFor(friend)).toMatchObject({ status: 403, body: { error: 'test_account_restricted' } });
    expect(await refusalFor(tester, 'abc123')).toMatchObject({ status: 403, body: { error: 'sandbox_only', hint: expect.stringContaining('abc123') } });
    expect(await refusalFor(guest)).toEqual({ status: 401, body: { error: 'sign_in_required' } });
    const refused = await capabilityRefusal(guest, row.id);
    expect([refused.status, await refused.json()]).toEqual([401, { error: 'sign_in_required' }]);
    // The gate speaks only to someone the artifact is visible to.
    expect(await capabilityGuard(guest, 'comment', 'missing')).toBeNull();
    expect((await capabilityGuard(guest, 'comment', row.id))!.status).toBe(401);
    expect(await capabilityGuard(owner, 'comment', row.id)).toBeNull();
  });
});
