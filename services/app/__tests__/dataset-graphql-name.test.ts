/**
 * A DATASET'S GRAPHQL ROOT NAME is chosen once, at creation (`POST /api/artifacts` with `name`), and stored where
 * the generated names live (the policy's `configuration.custom_name`). It must be a valid GraphQL name that is
 * not reserved and whose generated fields and types meet no shared type; only a new single-table stored dataset
 * takes one. Afterwards no door changes it: a replace naming it is refused, the policy doors keep the stored
 * configuration, and clearing the policy keeps the name.
 */
import { expect, it } from 'vitest';
import { mintAccountToken, request, useAppHarness } from './harness';
import { getArtifactById } from '@/lib/artifacts';
import { POST } from '@/app/api/artifacts/route';
import { PATCH, PUT as REPLACE } from '@/app/api/artifacts/[id]/route';
import { GET as POLICY, PUT as SET_POLICY } from '@/app/api/artifacts/[id]/policy/route';

useAppHarness();

const params = (id: string) => ({ params: Promise.resolve({ id }) });
const ROWS = [{ item: 'tea', amount: 3 }];
type Reply = { status: number; body: Record<string, any> };
const reply = async (r: Response): Promise<Reply> => ({ status: r.status, body: await r.json() });
async function owner() { return (await mintAccountToken('graphql_name_owner')).token; }
const create = async (token: string, json: Record<string, unknown>) => reply(await POST(request('/api/artifacts', { method: 'POST', token, json })));
const root = async (token: string, id: string) => (await reply(await POLICY(request(`/api/artifacts/${id}/policy`, { token }), params(id)))).body.tables[0].root as string;
const customName = async (id: string) => ((await getArtifactById(id))!.dataset_policy as { tables: Array<{ configuration?: { custom_name?: string } }> } | null)?.tables[0]?.configuration?.custom_name;

it('names a new dataset\'s GraphQL root at creation, whatever its title or access', async () => {
  const token = await owner();
  const created = await create(token, { dataset: ROWS, title: 'Q3 sales export', name: 'orders' });
  expect(created.status, JSON.stringify(created.body)).toBe(201);
  expect(await customName(created.body.id)).toBe('orders');
  expect(await root(token, created.body.id)).toBe('orders');
  const readOnly = await create(token, { dataset: ROWS, title: 'Other', name: 'Ledger_2', access: 'read' });
  expect(readOnly.status, JSON.stringify(readOnly.body)).toBe(201);
  expect(await root(token, readOnly.body.id)).toBe('Ledger_2');
  // Without a name the root still comes from the title.
  const plain = await create(token, { dataset: ROWS, title: 'Q3 sales export' });
  expect(await root(token, plain.body.id)).toBe('q3_sales_export');
});

it('refuses a name that is not a GraphQL name, is reserved, or would shadow a shared type', async () => {
  const token = await owner();
  for (const name of [5, '', '2orders', 'has space', 'naïve', '__orders', '_id', '_and', 'true', 'null', 'Query', 'String', 'order_by', 'dataset', 'String_comparison_exp', 'x'.repeat(65)]) {
    const refused = await create(token, { dataset: ROWS, name });
    expect(refused.status, `${JSON.stringify(name)} → ${JSON.stringify(refused.body)}`).toBe(400);
    expect(refused.body.error).toBe('invalid_graphql_name');
    expect(refused.body.details[0]).toEqual(expect.any(String));
  }
});

it('takes a name only for a new stored dataset', async () => {
  const token = await owner();
  const page = await create(token, { html: '<!doctype html><html><head><title>P</title></head><body><p>p</p></body></html>', name: 'orders' });
  expect(page).toMatchObject({ status: 400, body: { error: 'invalid_graphql_name' } });
  const source = await create(token, { dataset: ROWS, title: 'Source' });
  const copy = await create(token, { dataset: ROWS, name: 'orders', forked_from: source.body.id });
  expect(copy).toMatchObject({ status: 400, body: { error: 'invalid_graphql_name' } });
});

it('never changes the name afterwards: replace, metadata, policy writes and a policy clear all keep it', async () => {
  const token = await owner();
  const created = await create(token, { dataset: ROWS, title: 'Orders', name: 'orders' });
  const id = created.body.id as string;
  const replaced = await reply(await REPLACE(request(`/api/artifacts/${id}`, { method: 'PUT', token, json: { dataset: ROWS, name: 'renamed', expectedVersion: created.body.version, expectedState: created.body.state } }), params(id)));
  expect(replaced).toMatchObject({ status: 400, body: { error: 'graphql_name_immutable' } });
  const patched = await reply(await PATCH(request(`/api/artifacts/${id}`, { method: 'PATCH', token, json: { name: 'renamed', expectedState: created.body.state } }), params(id)));
  expect(patched).toMatchObject({ status: 400, body: { error: 'invalid_metadata' } });

  const policy = { version: 3, tables: [{ table: { schema: 'public', name: 'rows' }, select_permissions: [{ role: 'viewer', permission: { columns: '*', filter: {} } }] }] };
  const renamed = { ...policy, tables: [{ ...policy.tables[0], configuration: { custom_name: 'renamed' } }] };
  // The metadata door is a policy door too: a changed configuration is refused, an omitted one is kept.
  const patchRename = await reply(await PATCH(request(`/api/artifacts/${id}`, { method: 'PATCH', token, json: { policy: renamed, expectedPolicyRevision: 0, expectedState: created.body.state } }), params(id)));
  expect(patchRename.status, JSON.stringify(patchRename.body)).toBe(400);
  expect(patchRename.body.error).toBe('invalid_policy');
  expect(patchRename.body.detail).toContain('tables[0].configuration');
  const patchKeep = await reply(await PATCH(request(`/api/artifacts/${id}`, { method: 'PATCH', token, json: { policy, expectedPolicyRevision: 0, expectedState: created.body.state } }), params(id)));
  expect(patchKeep.status, JSON.stringify(patchKeep.body)).toBe(200);
  expect(await customName(id)).toBe('orders');
  // Clearing the policy reads as the read-only template and keeps the server-owned names.
  const cleared = await reply(await SET_POLICY(request(`/api/artifacts/${id}/policy`, { method: 'PUT', token, json: { policy: null, expectedPolicyRevision: 1 } }), params(id)));
  expect(cleared.status, JSON.stringify(cleared.body)).toBe(200);
  expect(await customName(id)).toBe('orders');
  expect(await root(token, id)).toBe('orders');
});
