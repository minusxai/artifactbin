/**
 * DATASET GRANTS AND CAPABILITIES through the interface: read and write grants (the private ceiling, the policy
 * revision a commit re-checks), a saved document's context and its host-only proofs, and the capability table.
 */
import { describe, expect, it } from 'vitest';
import { useAppHarness } from '@/__tests__/harness';
import { identityForUser } from '@/lib/accounts';
import { assertGrantCommit, attestRegisteredHtmlMutation, attestSavedHtmlUpload, can, capabilityRefusal, grantContext, grantsOf, grantsPermitRead, grantsPermitWrite, readThrough, refusalFor, uploadGrantContext, verifyRegisteredHtmlMutation, type ArtifactRow } from '@/lib/artifact-access';
import { canReadArtifact, capabilityGuard } from '@/lib/artifacts';
import { updateSharingFor } from '@/lib/artifacts';
import { account, dataset, head, mine, personOfKind, sql } from '@/__tests__/artifact-fixtures';

const harness = useAppHarness();
const grants = (allow: unknown[]) => ({ version: 2, allow });

describe('dataset grants', () => {
  const ownerWrites = grants([{ actions: ['read'], from: { user: '*' } }, { actions: ['insert'], from: { user: '$owner' } }]);

  it('grantsOf reads only a version-2 policy; read grants honour a private ceiling', async () => {
    const owner = await account('owner@example.test');
    const stranger = await account('stranger@example.test');
    const data = await dataset(owner, ownerWrites);
    expect(grantsOf(data)).toMatchObject({ version: 2 });
    expect(grantsOf({ dataset_policy: null })).toBeNull();
    expect(grantsOf({ dataset_policy: { version: 1 } })).toBeNull();
    expect(data.visibility).toBe('unlisted');
    expect(await grantsPermitRead(data, stranger)).toBe(true);
    expect(await canReadArtifact(data, stranger)).toBe(true);
    await updateSharingFor(owner, data.id, { visibility: 'private' });
    const closed = await head(data.id);
    expect(await grantsPermitRead(closed, stranger)).toBe(false);
    expect(await canReadArtifact(closed, stranger)).toBe(false);
    expect(await grantsPermitRead(closed, owner)).toBe(true);
    expect(await readThrough(await harness.db(), closed, stranger)).toBe(false);
    expect(await readThrough(await harness.db(), closed, owner)).toBe(true);
    expect(await grantsPermitRead({ ...closed, dataset_policy: null }, owner)).toBe(false);
  });

  it('write grants: the owner, never a stranger or a guest; a stale policy revision refuses the commit', async () => {
    const owner = await account('owner@example.test');
    const stranger = await account('stranger@example.test');
    const guest = await personOfKind('guest');
    const data = await dataset(owner, ownerWrites);
    expect(await grantsPermitWrite(data, owner)).toBe(true);
    expect(await grantsPermitWrite(data, stranger)).toBe(false);
    expect(await grantsPermitWrite({ ...data, dataset_policy: null }, owner)).toBe(false);
    await expect(grantContext(data, guest)).rejects.toThrow('Sign in to change data');
    expect(await grantContext(data, owner)).toMatchObject({ owner: { userId: owner.userId }, callerEditorGroupIds: [] });
    const db = await harness.db();
    await db.transaction(tx => assertGrantCommit(tx, data, owner));
    await expect(db.transaction(tx => assertGrantCommit(tx, data, stranger))).rejects.toThrow('Mutation permission changed');
    await sql('UPDATE artifacts SET policy_revision=policy_revision+1 WHERE id=$1', [data.id]);
    await expect(db.transaction(tx => assertGrantCommit(tx, data, owner))).rejects.toThrow('Mutation permission changed');
  });

  it('a document context needs a host proof for HTML, the head edit, and an accepted join', async () => {
    const owner = await account('owner@example.test');
    const reader = await account('reader@example.test');
    const data = await dataset(owner, grants([{ actions: ['insert'], from: { artifact: '*' } }]));
    const doc = await mine(owner, 'App');
    await updateSharingFor(owner, doc.id, { visibility: 'unlisted' });
    const verified: string[] = [];
    const proof = attestRegisteredHtmlMutation(doc.id, doc.edit_id, async () => { verified.push(doc.id); });
    const document = { id: doc.id, editId: doc.edit_id, registeredHtml: proof };
    expect(await grantContext(data, owner, document)).toMatchObject({ artifact: { id: doc.id, owner: { userId: owner.userId } } });
    expect(verified).toEqual([doc.id]);
    await expect(grantContext(data, owner, { id: doc.id, editId: doc.edit_id })).rejects.toThrow('Document access or action changed');
    await expect(grantContext(data, owner, { ...document, editId: 'stale' })).rejects.toThrow('Document access or action changed');
    await expect(grantContext(data, reader, document)).rejects.toThrow('Join this artifact');
    expect(await grantsPermitWrite(data, owner, document)).toBe(true);
    expect(await grantsPermitWrite(data, reader, document)).toBe(false);
    expect(await verifyRegisteredHtmlMutation({ ...document, editId: 'other' }, await harness.db())).toBe(false);
    expect(await verifyRegisteredHtmlMutation({ id: doc.id, editId: doc.edit_id, registeredHtml: {} }, await harness.db())).toBe(false);
    // An upload proof is its own authority, bound to the dataset it names.
    const upload = attestSavedHtmlUpload({ id: doc.id, editId: doc.edit_id, version: doc.version, datasetId: data.id }, async () => {});
    const uploading = { id: doc.id, editId: doc.edit_id, version: doc.version, datasetId: data.id, uploadProof: upload };
    expect(await uploadGrantContext(data, owner, uploading)).toMatchObject({ artifact: { id: doc.id } });
    await expect(uploadGrantContext(data, owner, { ...uploading, datasetId: 'other' })).rejects.toThrow('Document access or action changed');
    await expect(grantContext(data, owner, { id: doc.id, editId: doc.edit_id, registeredHtml: upload })).rejects.toThrow('Document access or action changed');
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
