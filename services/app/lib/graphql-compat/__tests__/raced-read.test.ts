/** DEPRECATED: GraphQL compatibility for pages published before SQL. Do not use in new code; do not extend. */
/**
 * A page read that a linked dataset's write races (another reader's save) re-runs on the new head instead of
 * answering `page_operation_unavailable`. Pages refresh right after a commit notification, so this race is the
 * normal case on a busy page (the datasets-in-documents gate's stale-reader check met it on a slow runner).
 */
import { expect, it, vi } from 'vitest';
import { identityForUser, type AccessActor } from '@/lib/accounts';
import { getDb } from '@/lib/platform';
import { createArtifactFromBody } from '@/lib/publish';
import { objectStore } from '@/lib/object-store';
import { POST } from '@/app/api/artifacts/[id]/graphql/route';
import { mintAccountToken, request, useAppHarness } from '@/__tests__/harness';

useAppHarness();
const POLICY = { version: 3, tables: [{ table: { schema: 'public', name: 'rows' },
  select_permissions: [{ role: 'signed_in', permission: { columns: '*', filter: {} } }],
  insert_permissions: [{ role: 'signed_in', permission: { columns: ['name'], check: {} } }] }] };
async function person(name: string) {
  const token = await mintAccountToken(`raced_${name}`);
  return { ...token, actor: identityForUser(token.userId, token.id, token.email) as AccessActor & { tokenId: string } };
}
async function gql(page: string, token: string, query: string) {
  const response = await POST(request(`/api/artifacts/${page}/graphql`, { method: 'POST', token, json: { query, revision: '1' } }), { params: Promise.resolve({ id: page }) });
  return { status: response.status, body: await response.json() as { data?: { staff?: Array<{ name: string }> }; errors?: unknown[] } };
}

it('re-runs a page read that a concurrent dataset write raced, instead of refusing it as unavailable', async () => {
  const owner = await person('owner'), other = await person('other');
  const dataset = await (await createArtifactFromBody({ dataset: [{ name: 'ada' }, { name: 'bo' }], title: 'Staff', access: 'readwrite', visibility: 'unlisted' }, owner.actor, 'http://localhost:3000')).json() as { id: string };
  await (await getDb()).query('UPDATE artifacts SET dataset_policy=$2::jsonb, policy_revision=policy_revision+1 WHERE id=$1', [dataset.id, JSON.stringify(POLICY)]);
  const page = await (await createArtifactFromBody({ html: `<html><head><link rel="af-dataset" data-af-name="staff" href="ref:${dataset.id}"></head><body>Staff</body></html>`, visibility: 'unlisted' }, owner.actor, 'http://localhost:3000')).json() as { id: string };
  const store = objectStore(), get = store.get.bind(store);
  let loads = 0;
  // The read's first object load lets another reader's write commit before the read's fence checks the head.
  const spy = vi.spyOn(store, 'get').mockImplementation(async (key: string) => {
    if (loads++ === 0) expect((await gql(page.id, other.token, 'mutation { insert_staff_one(object: {name: "cy"}) { name } }')).body.errors).toBeUndefined();
    return get(key);
  });
  try {
    const read = await gql(page.id, owner.token, '{ staff { name } }');
    expect(read.status, JSON.stringify(read.body)).toBe(200);
    expect(read.body.data?.staff?.map((row) => row.name).sort()).toEqual(['ada', 'bo', 'cy']);
  } finally { spy.mockRestore(); }
  expect(loads).toBeGreaterThan(1);
});
