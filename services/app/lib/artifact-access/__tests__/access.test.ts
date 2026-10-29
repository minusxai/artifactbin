/**
 * THE ACCESS RULE through the interface: the role lattice (ownership by token, user and group, named shares, the
 * link and its anonymous ceiling, the host's document-editor grant), the facts it reads and its SQL mirror (the
 * scopes). Grants and capabilities: ./grants.test.ts.
 */
import { describe, expect, it } from 'vitest';
import { useAppHarness } from '@/__tests__/harness';
import { identityForUser, mintToken, type AccessActor } from '@/lib/accounts';
import { createGroup, setGroupMember } from '@/lib/groups';
import { LIVE_ARTIFACT_SQL, SHARE_PREDICATE, groupMemberPredicate, linkRoleOf, ownerPredicate, ownerScope, policyReaderSql, roleWithoutLink, annotationScope, commentMonitorScope, documentEditorReaches, editorScope, effectiveRole, holdsCreatingToken, liveAccessFacts, ownsArtifact, preloadAccessFacts, reactionScope, writerFor, type Scope } from '@/lib/artifact-access';
import { canReadArtifact } from '@/lib/artifacts';
import { createArtifact, updateSharingFor } from '@/lib/artifacts';
import { account, head, mine, page, personOfKind, sql } from '@/__tests__/artifact-fixtures';

const harness = useAppHarness();
const reaches = async (scope: Scope, id: string) => (await sql('SELECT id FROM artifacts WHERE id=$1 AND ' + scope.where('$2'), [id, scope.val])).length === 1;

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

describe('the rule\'s parts', () => {
  it('the link alone, the role without it, and the SQL predicates a statement composes', async () => {
    const owner = await account('owner@example.test');
    const viewer = await account('viewer@example.test');
    const stranger = await account('stranger@example.test');
    expect([linkRoleOf({ visibility: 'private', link_role: 'editor' }), linkRoleOf({ visibility: 'unlisted', link_role: null }), linkRoleOf({ visibility: 'public', link_role: 'commenter' })]).toEqual(['none', 'viewer', 'commenter']);
    const row = await mine(owner);
    await updateSharingFor(owner, row.id, { visibility: 'unlisted', linkRole: 'editor', shares: [{ email: 'viewer@example.test', role: 'viewer' }] });
    const open = await head(row.id);
    // A listing honours relationships, never the link.
    expect([await roleWithoutLink(open, owner), await roleWithoutLink(open, viewer), await roleWithoutLink(open, stranger)]).toEqual(['owner', 'viewer', 'none']);
    expect(await reaches(ownerScope(owner), row.id)).toBe(true);
    expect(await reaches(ownerScope(viewer), row.id)).toBe(false);
    const where = async (predicate: string, params: unknown[]) => (await sql('SELECT id FROM artifacts WHERE id=$1 AND ' + predicate, [row.id, ...params])).length === 1;
    expect(await where(SHARE_PREDICATE(['viewer'], '$2'), [viewer.userId])).toBe(true);
    expect(await where(SHARE_PREDICATE(['editor'], '$2'), [viewer.userId])).toBe(false);
    const owned = ownerPredicate(owner);
    expect(await where(owned.where('$2'), [owned.val])).toBe(true);
    await sql('UPDATE artifacts SET deleted_at=now() WHERE id=$1', [row.id]);
    // The bare owner predicate reads past the trash gate (the trash's own reads); the scope does not.
    expect(await where(owned.where('$2'), [owned.val])).toBe(true);
    expect(await where(LIVE_ARTIFACT_SQL, [])).toBe(false);
    expect(await reaches(ownerScope(owner), row.id)).toBe(false);
    await sql('UPDATE artifacts SET deleted_at=NULL, visibility=$2 WHERE id=$1', [row.id, 'private']);
    expect(await where(policyReaderSql('$2', '$3'), [viewer.userId, null])).toBe(true);
    expect(await where(policyReaderSql('$2', '$3'), [stranger.userId, null])).toBe(false);
    const group = await createGroup(owner.userId, { handle: 'parts-team', name: 'Parts' });
    const team = await mine(owner, 'Team', { destination: { type: 'group', id: group.id } });
    const member = async (user: string, role?: 'editor') => (await sql('SELECT id FROM artifacts WHERE id=$1 AND ' + groupMemberPredicate('$2', role), [team.id, user])).length === 1;
    expect([await member(owner.userId, 'editor'), await member(stranger.userId)]).toEqual([true, false]);
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

