/**
 * THE DATASET ROLE: one case per derivation row (owner, editor, anonymous, viewer, signed_in, none), over the
 * pure contract and over the access facts the lib function reads. Page readers without sharing of their own
 * get signed_in or anonymous, never more.
 */
import { describe, expect, it } from 'vitest';
import { datasetRoleFrom, type ArtifactRole, type DatasetRoleFacts, type GroupRole, type UserKind } from '@artifactbin/contracts';
import { identityForUser, type AccessActor } from '@/lib/accounts';
import type { AccessFacts } from '@/lib/artifact-access';
import { datasetRole, pageRole, type DatasetRoleRow } from '../role';

const facts = (over: Partial<DatasetRoleFacts>): DatasetRoleFacts => ({ held: 'none', account: true, linkRole: 'viewer', visibility: 'unlisted', throughPage: false, ...over });

describe('datasetRoleFrom (the contract)', () => {
  it.each<[string, Partial<DatasetRoleFacts>, ReturnType<typeof datasetRoleFrom>]>([
    ['the owning account, token or group editor', { held: 'owner' }, 'owner'],
    ['a named editor share', { held: 'editor' }, 'editor'],
    ['the link role editor, for an account', { linkRole: 'editor' }, 'editor'],
    ['the link role editor, without an account', { linkRole: 'editor', account: false }, 'anonymous'],
    ['no account on a linkable dataset', { account: false }, 'anonymous'],
    ['no account on a private dataset', { account: false, visibility: 'private', linkRole: 'none' }, null],
    ['no account through a page linking a private dataset', { account: false, visibility: 'private', linkRole: 'none', throughPage: true }, 'anonymous'],
    ['a named viewer share', { held: 'viewer' }, 'viewer'],
    ['a named commenter share (maps to viewer)', { held: 'commenter' }, 'viewer'],
    ['a group viewer without an account (guest)', { held: 'viewer', account: false }, 'anonymous'],
    ['an account reaching through the link', {}, 'signed_in'],
    ['an account on a private dataset without a share', { visibility: 'private', linkRole: 'none' }, null],
    ['an account through a page linking a private dataset', { visibility: 'private', linkRole: 'none', throughPage: true }, 'signed_in'],
    ['a shared viewer through a page stays viewer (a page never raises or lowers)', { held: 'viewer', throughPage: true }, 'viewer'],
  ])('%s', (_, over, role) => expect(datasetRoleFrom(facts(over))).toBe(role));
});

function fakeFacts(over: { group?: GroupRole | null; kinds?: Record<string, UserKind>; named?: ArtifactRole } = {}): AccessFacts {
  return {
    groupRole: async () => over.group ?? null,
    groupAudience: async () => !!over.group,
    groupShareRole: async () => 'none',
    userKind: async (id) => (id ? over.kinds?.[id] ?? 'account' : null),
    sharedWith: async () => (over.named ?? 'none') !== 'none',
    namedRole: async () => over.named ?? 'none',
    editorGroupIds: async () => [],
  };
}
const row = (over: Partial<DatasetRoleRow> = {}): DatasetRoleRow => ({ id: 'ds1', user_id: 'owner', token_id: null, visibility: 'unlisted', link_role: null, format: 'dataset', ...over });
const user = (id: string): AccessActor => identityForUser(id, null);

describe('datasetRole (the dataset sharing, read through access facts)', () => {
  it('derives owner from the account, the creating token and a group editor', async () => {
    expect(await datasetRole(row(), user('owner'), { facts: fakeFacts() })).toBe('owner');
    expect(await datasetRole(row({ user_id: null, token_id: 'tok' }), { ...identityForUser(null, 'tok') }, { facts: fakeFacts() })).toBe('owner');
    expect(await datasetRole(row({ user_id: null, group_id: 'g1' }), user('member'), { facts: fakeFacts({ group: 'admin' }) })).toBe('owner');
  });
  it('derives viewer from a named viewer or commenter share and from group viewer membership', async () => {
    expect(await datasetRole(row(), user('reader'), { facts: fakeFacts({ named: 'viewer' }) })).toBe('viewer');
    expect(await datasetRole(row(), user('reader'), { facts: fakeFacts({ named: 'commenter' }) })).toBe('viewer');
    expect(await datasetRole(row({ group_id: 'g1' }), user('member'), { facts: fakeFacts({ group: 'member' }) })).toBe('viewer');
    expect(await datasetRole(row(), user('reader'), { facts: fakeFacts({ named: 'editor' }) })).toBe('editor');
  });
  it('treats a guest and a test user outside the sandbox as anonymous, and a test user inside it as an account', async () => {
    expect(await datasetRole(row(), user('guest'), { facts: fakeFacts({ kinds: { guest: 'guest' } }) })).toBe('anonymous');
    expect(await datasetRole(row(), user('tester'), { facts: fakeFacts({ kinds: { tester: 'testuser' } }) })).toBe('anonymous');
    expect(await datasetRole(row(), user('tester'), { facts: fakeFacts({ kinds: { tester: 'testuser', owner: 'testuser' } }) })).toBe('signed_in');
  });
  it('caps the link role editor at anonymous without an account, and never lets the document-editor grant reach a dataset', async () => {
    expect(await datasetRole(row({ link_role: 'editor' }), identityForUser(null, null), { facts: fakeFacts() })).toBe('anonymous');
    expect(await datasetRole(row({ link_role: 'editor' }), user('reader'), { facts: fakeFacts() })).toBe('editor');
    expect(await datasetRole(row(), { ...user('admin'), documentEditor: true }, { facts: fakeFacts() })).toBe('signed_in');
  });
  it('answers none for a private dataset unless the caller arrives through a linking page', async () => {
    const closed = row({ visibility: 'private', link_role: 'editor' });
    expect(await datasetRole(closed, user('reader'), { facts: fakeFacts() })).toBeNull();
    expect(await datasetRole(closed, identityForUser(null, null), { facts: fakeFacts() })).toBeNull();
    expect(await datasetRole(closed, user('reader'), { facts: fakeFacts(), throughPage: true })).toBe('signed_in');
    expect(await datasetRole(closed, identityForUser(null, null), { facts: fakeFacts(), throughPage: true })).toBe('anonymous');
  });
});

describe('pageRole (the page sharing, which resolver @auth reads)', () => {
  const page = (over: Partial<DatasetRoleRow> = {}) => row({ id: 'page1', format: 'html', visibility: 'public', ...over });
  it('derives every role from the page itself, never raised by a linking page', async () => {
    expect(await pageRole(page(), user('owner'), { facts: fakeFacts() })).toBe('owner');
    expect(await pageRole(page(), user('reader'), { facts: fakeFacts({ named: 'editor' }) })).toBe('editor');
    expect(await pageRole(page(), user('reader'), { facts: fakeFacts({ named: 'commenter' }) })).toBe('viewer');
    expect(await pageRole(page(), user('reader'), { facts: fakeFacts() })).toBe('signed_in');
    expect(await pageRole(page(), user('guest'), { facts: fakeFacts({ kinds: { guest: 'guest' } }) })).toBe('anonymous');
    expect(await pageRole(page(), identityForUser(null, null), { facts: fakeFacts() })).toBe('anonymous');
    expect(await pageRole(page({ visibility: 'private' }), user('reader'), { facts: fakeFacts() })).toBeNull();
  });
  it('keeps the document-editor grant as the page editor role, for an account only', async () => {
    expect(await pageRole(page(), { ...user('admin'), documentEditor: true }, { facts: fakeFacts() })).toBe('editor');
    expect(await pageRole(page(), { ...user('admin'), documentEditor: true }, { facts: fakeFacts({ kinds: { admin: 'guest' } }) })).toBe('anonymous');
    expect(await pageRole(page({ visibility: 'private' }), { ...user('admin'), documentEditor: true }, { facts: fakeFacts() })).toBeNull();
  });
});
