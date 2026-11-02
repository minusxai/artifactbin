/**
 * THE DATA PLANE'S FOOTING through the interface: a dataset write's guarded commit and a policy's, a stored row
 * compiled under its author's reach (refs, declarations, errors), and what depends on a row.
 */
import { describe, expect, it } from 'vitest';
import { mintAccountToken, request, useAppHarness } from '@/__tests__/harness';
import { POST as create } from '@/app/api/artifacts/route';
import { identityForUser } from '@/lib/accounts';
import { commitDatasetPolicy, commitDatasetWrite, getArtifactById, updateSharingFor } from '@/lib/artifacts';
import { type ArtifactRow } from '@/lib/artifact-access';
import { account, head } from '@/__tests__/artifact-fixtures';

const harness = useAppHarness();

async function storedDataset(access: 'read' | 'readwrite' = 'readwrite') {
  const owner = await mintAccountToken('data_plane_owner');
  const reply = await create(request('/api/artifacts', { method: 'POST', token: owner.token, json: { dataset: [{ n: 1 }], access } }));
  expect(reply.status).toBe(201);
  const { id } = await reply.json() as { id: string };
  return { actor: identityForUser(owner.userId, owner.id) as ReturnType<typeof identityForUser> & { userId: string }, row: (await getArtifactById(id))! };
}
const commit = (row: ArtifactRow, actor: ReturnType<typeof identityForUser>, extra: Partial<Parameters<typeof commitDatasetWrite>[1]> = {}) =>
  harness.db().then(db => commitDatasetWrite(db, { current: row, actor, meta: { ...row.meta, rowCount: 2 }, policyRole: null, policyDeclared: false, granted: false, ...extra }));

describe('dataset commits', () => {
  it('a write swaps the head only from the head it read, for an editor of a writable dataset', async () => {
    const { row, actor } = await storedDataset();
    const stranger = await account('stranger@example.test');
    expect(await commit(row, stranger)).toBeUndefined();
    const written = (await commit(row, actor))!;
    expect(written).toMatchObject({ version: row.version + 1, meta: { rowCount: 2 }, actor_user_id: actor.userId });
    expect(await commit(row, actor)).toBeUndefined();
    // Grants already checked in the caller's transaction stand in for access and the editor scope.
    expect(await commit(written, stranger, { granted: true })).toMatchObject({ version: row.version + 2 });
    const { row: readOnly, actor: owner } = await storedDataset('read');
    expect(await commit(readOnly, owner)).toBeUndefined();
  });

  it('a policy commit needs the exact head and policy revision, and an editor', async () => {
    const { row, actor } = await storedDataset();
    const stranger = await account('stranger@example.test');
    const policy = { version: 2, allow: [{ actions: ['read'], from: { user: '*' } }] };
    const db = await harness.db();
    expect(await commitDatasetPolicy(db, stranger, row, policy, 0)).toBeNull();
    expect(await commitDatasetPolicy(db, actor, row, policy, 3)).toBeNull();
    expect(await commitDatasetPolicy(db, actor, row, policy, 0)).toBe(1);
    expect(await commitDatasetPolicy(db, actor, row, policy, 0)).toBeNull();
    expect(await commitDatasetPolicy(db, actor, row, policy, 1)).toBe(2);
    // A head that moved since the caller read it (version, edit id or sharing) refuses the policy.
    await updateSharingFor(actor, row.id, { shares: [{ email: 'x@example.test', role: 'viewer' }] });
    expect(await commitDatasetPolicy(db, actor, row, policy, 2)).toBeNull();
    expect(await commitDatasetPolicy(db, actor, await head(row.id), policy, 2)).toBe(3);
  });
});
