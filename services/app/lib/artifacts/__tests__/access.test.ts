/**
 * THE ACCESS RULE through the interface: the role lattice (ownership by token, user and group, named shares, the
 * link and its anonymous ceiling, the host's document-editor grant), the facts it reads, its SQL mirror (the
 * scopes), dataset grants and the saved-document proofs, and the capability table.
 */
import { describe, expect, it } from 'vitest';
import { useAppHarness } from '@/__tests__/harness';
import { identityForUser, mintToken, type AccessActor } from '@/lib/accounts';
import { createGroup, setGroupMember } from '@/lib/groups';
import {
  annotationScope, assertGrantCommit, attestRegisteredHtmlMutation, attestSavedHtmlUpload, can, canReadArtifact, capabilityGuard,
  capabilityRefusal, commentMonitorScope, createArtifact, documentEditorReaches, editorScope, effectiveRole, grantContext, grantsOf,
  grantsPermitRead, grantsPermitWrite, holdsCreatingToken, liveAccessFacts, ownsArtifact, preloadAccessFacts, reactionScope, readThrough,
  refusalFor, updateSharingFor, uploadGrantContext, verifyRegisteredHtmlMutation, writerFor, type ArtifactRow, type Scope,
} from '@/lib/artifacts';
import { account, dataset, head, mine, page, personOfKind, sql } from './fixtures';

const harness = useAppHarness();
const reaches = async (scope: Scope, id: string) => (await sql('SELECT id FROM artifacts WHERE id=$1 AND ' + scope.where('$2'), [id, scope.val])).length === 1;
const grants = (allow: unknown[]) => ({ version: 2, allow });

describe('ownership and the creating token', () => {
  it('a null token never matches, a user row is not its token\'s, a group row is its editors\'', async () => {
    const owner = await account('owner@example.test');
    const loose = await mintToken('loose', null);
    const anon: AccessActor = identityForUser(null, null);
    expect(holdsCreatingToken({ token_id: null }, anon)).toBe(false);
    expect(holdsCreatingToken({ token_id: loose.id }, identityForUser(null, loose.id))).toBe(true);
    expect(holdsCreatingToken({ token_id: loose.id }, anon)).toBe(false);
    expect(ownsArtifact({ user_id: null, token_id: null }, anon)).toBe(false);
    expect(ownsArtifact({ user_id: owner.userId, token_id: loose.id }, identityForUser(null, loose.id))).toBe(false);
    expect(ownsArtifact({ user_id: owner.userId, token_id: null }, owner)).toBe(true);
    expect(ownsArtifact({ user_id: owner.userId, token_id: null, group_id: 'g1' }, owner)).toBe(false);
    expect(ownsArtifact({ user_id: null, token_id: null, group_id: 'g1' }, { ...owner, groupId: 'g1' })).toBe(true);
  });
});

describe('the role lattice', () => {
  it('owner, named roles, the link with its anonymous ceiling, and link-only kinds', async () => {
    const owner = await account('owner@example.test');
    const commenter = await account('commenter@example.test');
    const stranger = await account('stranger@example.test');
    const guest = await personOfKind('guest');
    const row = await mine(owner);
    await updateSharingFor(owner, row.id, { visibility: 'unlisted', linkRole: 'editor', shares: [{ email: 'commenter@example.test', role: 'commenter' }] });
    const now = await head(row.id);
    expect(await effectiveRole(now, owner)).toBe('owner');
    // The link grants its full role to an account; a named commenter still gets the link's better role.
    expect(await effectiveRole(now, stranger)).toBe('editor');
    expect(await effectiveRole(now, commenter)).toBe('editor');
    // The anonymous ceiling applies to the link only: no account, or a guest, reads at most.
    expect(await effectiveRole(now, identityForUser(null, null))).toBe('viewer');
    expect(await effectiveRole(now, guest)).toBe('viewer');
    await updateSharingFor(owner, row.id, { visibility: 'private' });
    const closed = await head(row.id);
    expect(await effectiveRole(closed, commenter)).toBe('commenter');
    expect(await effectiveRole(closed, stranger)).toBe('none');
    expect(await canReadArtifact(closed, commenter)).toBe(true);
    expect(await canReadArtifact(closed, stranger)).toBe(false);
  });

  it('a test user reaches as an account only toward another test user\'s row', async () => {
    const tester = await personOfKind('testuser');
    const other = await personOfKind('testuser');
    const owner = await account('owner@example.test');
    const sandbox = await createArtifact(null, other.userId, page('Sandbox'), {});
    await updateSharingFor(other, sandbox.id, { visibility: 'unlisted', linkRole: 'commenter' });
    const real = await mine(owner);
    await updateSharingFor(owner, real.id, { visibility: 'unlisted', linkRole: 'commenter' });
    expect(await effectiveRole(await head(sandbox.id), tester)).toBe('commenter');
    expect(await effectiveRole(await head(real.id), tester)).toBe('viewer');
  });

  it('group editors own a group row, group viewers read it, and nobody else', async () => {
    const owner = await account('owner@example.test');
    const viewer = await account('viewer@example.test');
    const stranger = await account('stranger@example.test');
    const group = await createGroup(owner.userId, { handle: 'access-team', name: 'Access team' });
    await setGroupMember(owner.userId, group.id, viewer.userId, 'viewer');
    const row = await mine(owner, 'Team', { destination: { type: 'group', id: group.id } });
    expect(await effectiveRole(row, owner)).toBe('owner');
    expect(await effectiveRole(row, viewer)).toBe('viewer');
    expect(await effectiveRole(row, stranger)).toBe('none');
    expect(await reaches(editorScope(owner), row.id)).toBe(true);
    expect(await reaches(editorScope(viewer), row.id)).toBe(false);
    expect(await reaches(annotationScope(viewer), row.id)).toBe(false);
    // Group viewers watch comment feeds without gaining annotation writes.
    expect(await reaches(commentMonitorScope(viewer), row.id)).toBe(true);
    expect(await reaches(commentMonitorScope(stranger), row.id)).toBe(false);
    expect(writerFor(row)).toEqual({ ...identityForUser(row.user_id, row.token_id), groupId: group.id });
  });

  it('the document-editor grant reaches a non-private page only, as its editor', async () => {
    const owner = await account('owner@example.test');
    const admin = { ...(await account('admin@example.test')), documentEditor: true };
    const row = await mine(owner);
    expect(documentEditorReaches(row, admin)).toBe(false);
    expect(await effectiveRole(row, admin)).toBe('none');
    await updateSharingFor(owner, row.id, { visibility: 'unlisted' });
    const open = await head(row.id);
    expect(documentEditorReaches(open, admin)).toBe(true);
    expect(documentEditorReaches(open, { documentEditor: false })).toBe(false);
    expect(documentEditorReaches({ ...open, format: 'dataset' }, admin)).toBe(false);
    expect(await effectiveRole(open, admin)).toBe('editor');
    expect(await reaches(editorScope(admin), row.id)).toBe(true);
    expect(await reaches(editorScope({ ...admin, documentEditor: false }), row.id)).toBe(false);
  });

  it('scopes mirror the lattice in SQL: commenters annotate, viewers react, a bare token reaches only its own', async () => {
    const owner = await account('owner@example.test');
    const viewer = await account('viewer@example.test');
    const commenter = await account('commenter@example.test');
    const loose = await mintToken('loose', null);
    const row = await mine(owner);
    await updateSharingFor(owner, row.id, { shares: [{ email: 'viewer@example.test', role: 'viewer' }, { email: 'commenter@example.test', role: 'commenter' }] });
    expect([await reaches(reactionScope(viewer), row.id), await reaches(annotationScope(viewer), row.id)]).toEqual([true, false]);
    expect([await reaches(annotationScope(commenter), row.id), await reaches(editorScope(commenter), row.id)]).toEqual([true, false]);
    const tokenRow = await createArtifact(loose.id, null, page('Token'));
    expect(await reaches(editorScope(identityForUser(null, loose.id)), tokenRow.id)).toBe(true);
    expect(await reaches(editorScope(identityForUser(null, null)), tokenRow.id)).toBe(false);
    // The trash gate is composed into every scope.
    await sql('UPDATE artifacts SET deleted_at=now() WHERE id=$1', [row.id]);
    expect(await reaches(reactionScope(owner), row.id)).toBe(false);
  });
});

describe('access facts', () => {
  it('live facts stamp an unresolved invitation on first read; preloaded facts defer it to settle', async () => {
    const owner = await account('owner@example.test');
    const friend = await account('friend@example.test');
    const a = await mine(owner, 'A');
    const b = await mine(owner, 'B');
    for (const row of [a, b]) await updateSharingFor(owner, row.id, { shares: [{ email: 'friend@example.test', role: 'editor' }] });
    const unresolved = async () => (await sql<{ artifact_id: string }>('SELECT artifact_id FROM artifact_shares WHERE user_id IS NULL ORDER BY artifact_id')).map(r => r.artifact_id);
    const live = liveAccessFacts(friend);
    expect(await live.sharedWith(a.id)).toBe(true);
    expect(await live.namedRole(a.id)).toBe('editor');
    expect(await unresolved()).toEqual([b.id]);
    const facts = await preloadAccessFacts(await harness.db(), friend, [b]);
    expect(await facts.namedRole(b.id)).toBe('editor');
    expect(await facts.sharedWith(b.id)).toBe(true);
    expect(await unresolved()).toEqual([b.id]);
    await facts.settle();
    expect(await unresolved()).toEqual([]);
    // A fact outside the preload falls back to the database rather than answering from a partial preload.
    expect(await facts.namedRole(a.id)).toBe('editor');
    expect(await facts.userKind(friend.userId)).toBe('account');
    expect(await facts.userKind(null)).toBeNull();
    expect(await liveAccessFacts(identityForUser(null, null)).editorGroupIds()).toEqual([]);
    const group = await createGroup(friend.userId, { handle: 'facts-team', name: 'Facts' });
    expect(await live.editorGroupIds()).toEqual([group.id]);
    expect(await live.groupRole(group.id)).toBe('editor');
    expect(await facts.groupRole(group.id)).toBeNull();
  });
});

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
