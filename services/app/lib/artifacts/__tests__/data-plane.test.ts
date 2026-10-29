/**
 * THE DATA PLANE'S FOOTING through the interface: a dataset write's guarded commit and a policy's, a stored row
 * compiled under its author's reach (refs, declarations, errors), and what depends on a row.
 */
import { describe, expect, it } from 'vitest';
import { mintAccountToken, request, useAppHarness } from '@/__tests__/harness';
import { POST as create } from '@/app/api/artifacts/route';
import { identityForUser } from '@/lib/accounts';
import { DATA_SYNTAX_META } from '@/lib/dataflow/server';
import {
  commitDatasetPolicy, commitDatasetWrite, compileErrorText, compileResultForRow, compiledForRow, createArtifact, declarationsForRow, findDependentsFor,
  getArtifactById, getSharingFor, refLoaderForActor, rowToResolvedRef, updateSharingFor, type ArtifactRow,
} from '@/lib/artifacts';
import { account, head, mine } from './fixtures';

const harness = useAppHarness();

async function storedDataset(access: 'read' | 'readwrite' = 'readwrite') {
  const owner = await mintAccountToken('data_plane_owner');
  const reply = await create(request('/api/artifacts', { method: 'POST', token: owner.token, json: { dataset: [{ n: 1 }], access } }));
  expect(reply.status).toBe(201);
  const { id } = await reply.json() as { id: string };
  return { actor: identityForUser(owner.userId, owner.id) as ReturnType<typeof identityForUser> & { userId: string }, row: (await getArtifactById(id))! };
}
const markup = (actor: { userId: string }, source: string, refs: string[] = []) =>
  createArtifact(null, actor.userId, { format: 'markup', source, meta: { ...DATA_SYNTAX_META, refs: refs.map(id => ({ id })) }, title: 'Doc' });
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

describe('a row compiled', () => {
  it('resolves refs by reach then by link, compiles under the author, and names what writes a dataset', async () => {
    const { row: data, actor } = await storedDataset();
    const stranger = await account('stranger@example.test');
    expect(rowToResolvedRef(data, true)).toMatchObject({ id: data.id, format: 'dataset', owned: true, access: 'readwrite', validationState: { id: data.id, version: data.version } });
    expect(rowToResolvedRef({ ...data, format: 'folder' }).columns!.map(c => c.name)).toContain('thumbnail');
    expect(await refLoaderForActor(actor)(data.id)).toMatchObject({ owned: true });
    expect(await refLoaderForActor(stranger)(data.id)).toMatchObject({ owned: false });
    expect(await refLoaderForActor(identityForUser(null, 'nobody'))('missing')).toBeNull();
    const source = `<Helmet><Import name="d" src="ref:${data.id}" /><Query name="q">{\`select * from d.rows\`}</Query><Mutation name="add">{\`insert into d.rows (n) values (2)\`}</Mutation></Helmet><p>Live</p>`;
    const doc = await markup(actor, source, [data.id]);
    expect((await compiledForRow(doc))!.queries.map(q => q.name)).toEqual(['q']);
    expect((await declarationsForRow(doc))!.flow.mutations.map(m => m.name)).toEqual(['add']);
    expect(await compileResultForRow({ ...doc, source: null })).toBeNull();
    expect(await declarationsForRow({ ...doc, source: '<p>No data</p>' })).toBeNull();
    expect((await findDependentsFor(actor, data.id)).map(r => r.id)).toEqual([doc.id]);
    expect(await findDependentsFor(stranger, data.id)).toEqual([]);
    expect((await getSharingFor(actor, data.id))!.writtenBy).toEqual([{ id: doc.id, title: 'Doc', mutations: ['add'] }]);
  });

  it('a document whose data no longer compiles runs as answered errors, never silently', async () => {
    const owner = await account('owner@example.test');
    const broken = `<Helmet><Import name="d" src="ref:Missing1" /><Query name="q">{\`select * from d.rows\`}</Query></Helmet><p>x</p>`;
    const doc = await mine(owner);
    const row = { ...doc, format: 'markup' as const, source: broken, meta: { ...DATA_SYNTAX_META } };
    const result = (await compileResultForRow(row))!;
    expect(result.ok).toBe(false);
    expect(await compiledForRow(row)).toBeNull();
    const errors = result.ok ? [] : result.errors;
    expect(compileErrorText(errors)).toBe(errors.map(e => e.message).join('\n'));
    const ran = (await declarationsForRow(row)) as { state?: { errors: Record<string, string> } };
    expect(Object.keys(ran.state!.errors)).toEqual(['q']);
    expect(ran.state!.errors.q).toContain('ref:Missing1');
  });
});
