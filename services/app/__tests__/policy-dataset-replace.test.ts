/**
 * A dataset that carries a write policy could never be replaced again: the owner's
 * re-push answered a bare `not_found`. The owner may replace it while the policy still
 * fits the new columns; everyone else is told it is locked, by name. And a stored table
 * that declares its columns may start empty.
 */
import { expect, it } from 'vitest';
import { POST as create } from '@/app/api/artifacts/route';
import { PUT as replace } from '@/app/api/artifacts/[id]/route';
import { getArtifactById } from '@/lib/artifacts';
import { artifactState } from '@/lib/artifact-state';
import { setDatasetPolicy } from '@/lib/datasets/policy';
import { publishDataset } from '@/lib/story/data-tiers';
import type { StoredContent } from '@/lib/story/input';
import { mintToken } from '@/lib/tokens';
import { request, useAppHarness } from './harness';
useAppHarness();

const POLICY = {
  version: 1,
  enforcement: 'enabled',
  tables: [{
    table: { schema: 'public', name: 'rows' },
    insert_permissions: [{ role: 'viewer', permission: { columns: ['n'], check: { n: { _gt: 0 } } } }],
  }],
};

async function fixture() {
  const owner = await mintToken('replace-owner');
  const created = await create(request('/api/artifacts', { method: 'POST', token: owner.token, json: { dataset: [{ n: 1 }], access: 'readwrite' } }));
  expect(created.status, await created.clone().text()).toBe(201);
  const ds = (await created.json()).id as string;
  expect(await setDatasetPolicy({ tokenId: owner.id, userId: null }, ds, POLICY, 0)).toMatchObject({ revision: 1 });
  // Every replace names the base it was made from: that is what keeps a stale push from discarding rows.
  const base = { expectedVersion: 1, expectedState: artifactState((await getArtifactById(ds))!) };
  const put = (token: string, dataset: object[], from = base) =>
    replace(request(`/api/artifacts/${ds}`, { method: 'PUT', token, json: { dataset, ...from } }), { params: Promise.resolve({ id: ds }) });
  return { owner, ds, put };
}

it('lets the owner replace the rows and add a column while the policy still fits', async () => {
  const f = await fixture();
  const response = await f.put(f.owner.token, [{ n: 1, note: 'a' }, { n: 2, note: 'b' }]);
  expect(response.status, await response.clone().text()).toBe(200);
  const row = (await getArtifactById(f.ds))!;
  expect(row.version).toBe(2);
  expect(row.dataset_policy).toMatchObject({ enforcement: 'enabled' });
  // The REVISION too: `canUseDataPolicy` and `recheckMutation` both compare it, so moving it on a
  // content write would revoke every viewer's permission mid-session.
  expect(row.policy_revision).toBe(1);
});

it('refuses, by name, a replacement that the policy no longer fits', async () => {
  const f = await fixture();
  const response = await f.put(f.owner.token, [{ m: 1 }]);
  expect(response.status).toBe(400);
  const body = await response.json();
  expect(body.error).toBe('policy_mismatch');
  expect(JSON.stringify(body)).toMatch(/\bn\b|column/i);
  expect((await getArtifactById(f.ds))!.version).toBe(1);
});

it('still refuses a replacement from a stale base, so rows written by viewers are never silently discarded', async () => {
  const f = await fixture();
  expect((await f.put(f.owner.token, [{ n: 1 }, { n: 2 }])).status).toBe(200);
  const stale = await f.put(f.owner.token, [{ n: 9 }]);
  expect(stale.status).toBe(409);
  expect((await getArtifactById(f.ds))!.version).toBe(2);
});

it('never answers not_found for a dataset the caller can see', async () => {
  const f = await fixture();
  const response = await f.put(f.owner.token, [{ m: 1 }]);
  expect(response.status).not.toBe(404);
});

it('accepts a stored table with declared columns and no rows, and still refuses a bare empty array', async () => {
  const declared = await publishDataset({ columns: [{ name: 'name', type: 'string' }, { name: 'joined_on', type: 'date' }] }, []);
  expect(declared).not.toBeInstanceOf(Response);
  expect((declared as StoredContent).meta).toMatchObject({ rowCount: 0, columns: [{ name: 'name', type: 'string' }, { name: 'joined_on', type: 'date' }] });
  const bare = await publishDataset({}, []);
  expect(bare).toBeInstanceOf(Response);
  expect((bare as Response).status).toBe(400);
  // The refusal that remains has to say what is wrong with THIS input: a CSV or
  // JSON tier infers its columns from the rows, and zero rows declare nothing.
  expect(JSON.stringify(await (bare as Response).json())).toMatch(/declared columns/);
});

/**
 * END TO END, through the door an author actually uses: the sign-up sheet a page
 * fills in later publishes EMPTY with its shape declared, instead of being seeded
 * with a fake row to get past the refusal.
 */
it('publishes a stored <Dataset> whose table declares columns and starts with no rows', async () => {
  const author = await mintToken('empty-table-author');
  const definition = `<Dataset kind="stored">
  <Table schema="public" name="rows" columns={[{"name":"name","type":"string"},{"name":"joined_on","type":"date"}]} rows={[]} />
</Dataset>`;
  const created = await create(request('/api/artifacts', { method: 'POST', token: author.token, json: { dataset: definition, access: 'readwrite' } }));
  expect(created.status, await created.clone().text()).toBe(201);
  const row = (await getArtifactById((await created.json()).id as string))!;
  const table = (row.meta.catalog as {tables:Array<{columns:Array<{name:string;type:string}>;objectKey?:string}>}).tables[0];
  expect(table.columns).toEqual([{ name: 'name', type: 'string' }, { name: 'joined_on', type: 'date' }]);
  expect(table.objectKey).toBeTruthy();
});

/** A bare column NAME has nothing to infer from in an empty table, so it is text. */
it('names the columns a stored table declares with bare names when it starts empty', async () => {
  const author = await mintToken('empty-named-author');
  const definition = `<Dataset kind="stored">
  <Table schema="public" name="rows" columns={["name","note"]} rows={[]} />
</Dataset>`;
  const created = await create(request('/api/artifacts', { method: 'POST', token: author.token, json: { dataset: definition } }));
  expect(created.status, await created.clone().text()).toBe(201);
  const row = (await getArtifactById((await created.json()).id as string))!;
  const table = (row.meta.catalog as {tables:Array<{columns:Array<{name:string;type:string}>}>}).tables[0];
  expect(table.columns).toEqual([{ name: 'name', type: 'string' }, { name: 'note', type: 'string' }]);
});
