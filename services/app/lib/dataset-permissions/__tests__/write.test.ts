/**
 * THE WRITE DECISION: owner and editor are admin-equivalent; other roles get only their v3 entries;
 * backend_only entries need program trust (proof, membership, a page owner who administers the dataset);
 * the commit transaction decides again under the row lock and refuses any change.
 */
import { describe, expect, it } from 'vitest';
import { useAppHarness } from '@/__tests__/harness';
import { account, dataset, head, mine, sql, type Account } from '@/__tests__/artifact-fixtures';
import { attestRegisteredHtmlMutation, type ArtifactRow } from '@/lib/artifact-access';
import { changeMembership, updateSharingFor } from '@/lib/artifacts';
import { getDb } from '@/lib/platform';
import { assertWriteCommit, canInsert, datasetWriteAccess, tableMutationPolicy } from '../write';

const harness = useAppHarness();
const ROWS = { schema: 'public', name: 'rows' };
const DEFAULT = { version: 2, allow: [{ actions: ['read'], from: { user: '*' } }, { actions: ['insert', 'update', 'delete'], from: { artifactOwner: '$owner' } }] };

async function fixture(policy: unknown = DEFAULT) {
  const owner = await account('owner@example.test'), member = await account('member@example.test'), stranger = await account('stranger@example.test');
  const data = await dataset(owner, policy, { visibility: 'unlisted' });
  const doc = await mine(owner, 'App');
  await updateSharingFor(owner, doc.id, { visibility: 'unlisted' });
  await changeMembership(member, doc.id, { action: 'join' });
  await changeMembership(owner, doc.id, { action: 'approve', userId: member.userId });
  const page = await head(doc.id);
  const program = { id: page.id, editId: page.edit_id, registeredHtml: attestRegisteredHtmlMutation(page.id, page.edit_id, async () => {}) };
  return { owner, member, stranger, data: await head(data.id), page, program };
}

describe('datasetWriteAccess', () => {
  it('admits owner and editor with no rules, even when the v2 grants name neither', async () => {
    const f = await fixture({ version: 2, allow: [] });
    await updateSharingFor(f.owner, f.data.id, { shares: [{ email: f.stranger.email!, role: 'editor' }] });
    for (const actor of [f.owner, f.stranger]) {
      const decision = await datasetWriteAccess(await head(f.data.id), actor);
      expect(decision).toMatchObject({ allowed: true, admin: true });
      expect(tableMutationPolicy(decision, ROWS)).toBeUndefined();
    }
  });

  it('keeps a stored v2 write grant naming one person working until migration shares the dataset with them', async () => {
    const f = await fixture({ version: 2, allow: [{ actions: ['read'], from: { user: '*' } }] });
    const named = { version: 2, allow: [{ actions: ['read'], from: { user: '*' } }, { actions: ['insert', 'update'], from: { user: f.stranger.userId } }] };
    await sql('UPDATE artifacts SET dataset_policy=$2 WHERE id=$1', [f.data.id, JSON.stringify(named)]);
    const decision = await datasetWriteAccess(await head(f.data.id), f.stranger);
    expect(decision).toMatchObject({ allowed: true, admin: false, session: { 'x-hasura-user-id': f.stranger.userId } });
    const policy = tableMutationPolicy(decision, ROWS)!;
    expect(policy.operations).toEqual(['insert', 'update']);
    expect(policy.table.delete_permissions).toBeUndefined();
    // Anyone else still has no rule.
    expect(await datasetWriteAccess(await head(f.data.id), f.member)).toMatchObject({ allowed: false, reason: 'no_rule' });
  });

  it('gives a page member backend_only entries only through a trusted program, with the page in the session', async () => {
    const f = await fixture();
    expect(await datasetWriteAccess(f.data, f.member, { throughPage: true })).toMatchObject({ allowed: false, role: 'signed_in', reason: 'no_rule' });
    const decision = await datasetWriteAccess(f.data, f.member, { document: f.program });
    expect(decision).toMatchObject({ allowed: true, admin: false, role: 'signed_in', trusted: true, session: { 'x-hasura-role': 'signed_in', 'x-hasura-user-id': f.member.userId, 'x-hasura-page-id': f.page.id } });
    const policy = tableMutationPolicy(decision, ROWS)!;
    expect(policy).toMatchObject({ role: 'signed_in', trusted: true, operations: ['insert', 'update', 'delete'] });
    expect(policy.table.insert_permissions).toEqual([{ role: 'signed_in', permission: { columns: '*', check: {}, backend_only: true } }]);
    expect(canInsert(decision)).toBe(true);
    // Not a member: the same document proves nothing.
    expect(await datasetWriteAccess(f.data, f.stranger, { document: f.program })).toMatchObject({ allowed: false, reason: 'no_rule' });
  });

  it('refuses a program whose page owner does not administer the dataset, and a stale document edit', async () => {
    const f = await fixture();
    const theirs = await head((await mine(f.stranger, 'Theirs')).id);
    await updateSharingFor(f.stranger, theirs.id, { visibility: 'unlisted' });
    const foreign = { id: theirs.id, editId: theirs.edit_id, registeredHtml: attestRegisteredHtmlMutation(theirs.id, theirs.edit_id, async () => {}) };
    expect(await datasetWriteAccess(f.data, f.owner, { document: foreign })).toMatchObject({ allowed: false, reason: 'document_changed' });
    expect(await datasetWriteAccess(f.data, f.member, { document: { ...f.program, editId: 'stale' } })).toMatchObject({ allowed: false, reason: 'document_changed' });
  });

  it('keeps the access ceiling for datasets without v2 grants, owner included', async () => {
    const owner = await account('owner@example.test');
    const data = await dataset(owner);
    expect(await datasetWriteAccess(await head(data.id), owner)).toMatchObject({ allowed: true, admin: true });
    await sql("UPDATE artifacts SET access='read' WHERE id=$1", [data.id]);
    expect(await datasetWriteAccess(await head(data.id), owner)).toMatchObject({ allowed: false, reason: 'dataset_read_only' });
  });

  it('throws for a table the role has no entry for', async () => {
    const f = await fixture();
    const decision = await datasetWriteAccess(f.data, f.member, { document: f.program });
    expect(() => tableMutationPolicy(decision, { schema: 'public', name: 'other' })).toThrow('No policy permits writes to this table');
  });
});

describe('assertWriteCommit', () => {
  const commit = async (data: ArtifactRow, actor: Account, before: Awaited<ReturnType<typeof datasetWriteAccess>>, options = {}) =>
    (await getDb()).transaction((tx) => assertWriteCommit(tx, data, actor, before, options));

  it('commits the same decision and refuses revoked membership, a revoked share and a new policy revision', async () => {
    const f = await fixture();
    const before = await datasetWriteAccess(f.data, f.member, { document: f.program });
    await commit(f.data, f.member, before, { document: f.program });
    await changeMembership(f.member, f.page.id, { action: 'leave' });
    await expect(commit(f.data, f.member, before, { document: f.program })).rejects.toThrow('Mutation permission changed');

    await updateSharingFor(f.owner, f.data.id, { shares: [{ email: f.stranger.email!, role: 'editor' }] });
    const editor = await datasetWriteAccess(await head(f.data.id), f.stranger);
    await commit(f.data, f.stranger, editor);
    await updateSharingFor(f.owner, f.data.id, { shares: [] });
    await expect(commit(f.data, f.stranger, editor)).rejects.toThrow('Mutation permission changed');

    const owner = await datasetWriteAccess(await head(f.data.id), f.owner);
    await harness.db().then((db) => db.query('UPDATE artifacts SET policy_revision=policy_revision+1 WHERE id=$1', [f.data.id]));
    await expect(commit(f.data, f.owner, owner)).rejects.toThrow('Mutation permission changed');
  });
});
