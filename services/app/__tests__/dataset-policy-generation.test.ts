import { afterEach, beforeEach, it, expect, vi } from 'vitest';
import { POST as create } from '@/app/api/artifacts/route';
import { POST as mutate } from '@/app/a/[id]/mutate/route';
import { getArtifactById, setAccessFor } from '@/lib/artifacts';
import { GENERATION_PUBLIC_POOLS } from '@/lib/config';
import { setDatasetPolicy } from '@/lib/datasets/policy';
import { services, setServices } from '@/lib/services';
import { mintToken } from '@/lib/tokens';
import { request, useAppHarness } from './harness';
useAppHarness();
const original = services();
const generate = vi.fn(async () => ({
  json: '{"ok":true}',
  usage: { input: 1, output: 1 },
}));
beforeEach(() => {
  generate.mockReset();
  generate.mockResolvedValue({
    json: '{"ok":true}',
    usage: { input: 1, output: 1 },
  });
  setServices({ generation: { generate } });
});
afterEach(() => {
  setServices(original);
  for (const key of Object.keys(GENERATION_PUBLIC_POOLS))
    delete GENERATION_PUBLIC_POOLS[key];
});
async function fixture() {
  const owner = await mintToken('policy-generation');
  const actor = { tokenId: owner.id, userId: null };
  const publish = async (body: object) => {
    const r = await create(
      request('/api/artifacts', {
        method: 'POST',
        token: owner.token,
        json: body,
      }),
    );
    expect(r.status, await r.clone().text()).toBe(201);
    return (await r.json()).id as string;
  };
  const ds = await publish({
    dataset: [{ result: 'seed' }],
    access: 'readwrite',
  });
  const config = JSON.stringify({
    model: 'default',
    schema: {
      type: 'object',
      properties: { ok: { type: 'boolean' } },
      required: ['ok'],
      additionalProperties: false,
    },
    maxTokens: 100,
  });
  const doc = await publish({
    markup: `<Helmet><Mutation name="add" source="ref:${ds}">{\`insert into public.rows select llm('hello','answer','${config}')\`}</Mutation></Helmet><Button run="$add">Add</Button>`,
  });
  const policy = {
    version: 1,
    enforcement: 'enabled',
    tables: [
      {
        table: { schema: 'public', name: 'rows' },
        insert_permissions: [
          { role: 'viewer', permission: { columns: '*', check: {} } },
        ],
      },
    ],
    execution: {
      generation: { models: ['default'], max_calls: 1, max_tokens: 100 },
    },
  };
  const write = () =>
    mutate(
      request(`/a/${doc}/mutate`, {
        method: 'POST',
        json: { mutation: 'add' },
      }),
      { params: Promise.resolve({ id: doc }) },
    );
  return { actor, ds, doc, policy, write };
}
it('requires operator authorization and reserves a bounded generation allowance', async () => {
  const f = await fixture();
  await setDatasetPolicy(f.actor, f.ds, f.policy, 0);
  expect((await f.write()).status).toBeGreaterThanOrEqual(400);
  expect(generate).not.toHaveBeenCalled();
  GENERATION_PUBLIC_POOLS[f.ds] = {
    models: ['default'],
    callsPerDay: 10,
    maxTokens: 100,
  };
  const response = await f.write();
  expect(response.status, await response.clone().text()).toBe(200);
  expect(generate).toHaveBeenCalledTimes(1);
  expect((await f.write()).status).toBeGreaterThanOrEqual(400);
  expect(generate).toHaveBeenCalledTimes(1);
});
it('revocation during a provider call prevents persistence', async () => {
  const f = await fixture();
  await setDatasetPolicy(f.actor, f.ds, f.policy, 0);
  GENERATION_PUBLIC_POOLS[f.ds] = {
    models: ['default'],
    callsPerDay: 10,
    maxTokens: 100,
  };
  generate.mockImplementationOnce(async () => {
    await setAccessFor(f.actor, f.ds, 'read');
    return { json: '{"ok":true}', usage: { input: 1, output: 1 } };
  });
  expect((await f.write()).status).toBeGreaterThanOrEqual(400);
  expect((await getArtifactById(f.ds))?.version).toBe(1);
});
it('function denial cannot dispatch even when generation has a grant', async () => {
  const f = await fixture();
  await setDatasetPolicy(
    f.actor,
    f.ds,
    {
      ...f.policy,
      execution: { ...f.policy.execution, functions: { deny: ['llm'] } },
    },
    0,
  );
  GENERATION_PUBLIC_POOLS[f.ds] = {
    models: ['default'],
    callsPerDay: 10,
    maxTokens: 100,
  };
  expect((await f.write()).status).toBeGreaterThanOrEqual(400);
  expect(generate).not.toHaveBeenCalled();
});
