/**
 * gate-data-journey's HTTP facts (scripts/gates/gate-data-journey.mjs keeps what a browser must see): a dataflow
 * that reads a column its dataset lacks is refused at publish, naming the query and the column; and a dataset under
 * an access policy takes no direct SQL its grants do not name, not even from its owner.
 */
import { describe, expect, it } from 'vitest';
import { identityForUser } from '@/lib/accounts';
import { POST as createRoute } from '@/app/api/artifacts/route';
import { POST as mutateDataset } from '@/app/api/artifacts/[id]/mutate/route';
import { getArtifactById } from '@/lib/artifacts';
import { setDatasetPolicy } from '@/__tests__/harness';
import { loadDatasetRows } from '@/lib/datasets';
import { mintAccountToken as mintToken, request, useAppHarness } from '@/__tests__/harness';

useAppHarness();

const params = (id: string) => ({ params: Promise.resolve({ id }) });

async function owner() {
  const t = await mintToken('data-journey');
  const publish = (json: Record<string, unknown>) => createRoute(request('/api/artifacts', { method: 'POST', token: t.token, json: { visibility: 'unlisted', ...json } }));
  const created = async (json: Record<string, unknown>) => {
    const res = await publish(json);
    expect(res.status, await res.clone().text()).toBe(201);
    return ((await res.json()) as { id: string }).id;
  };
  return { t, publish, created };
}

describe('native dataset column validation',()=>{
 it('discovers stable columns and rejects unknown IDs before executing a query',async()=>{
  const {createRetainedDatasetGraphql}=await import('@/lib/dataset-graphql');
  const o=await owner(),id=await o.created({dataset:[{region:'EU',revenue:837}]});
  const api=createRetainedDatasetGraphql(),binding={kind:'dataset' as const,name:'sales',datasetId:id,mode:'live' as const},actor=identityForUser(o.t.userId,o.t.id),signal=new AbortController().signal;
  const table=(await api.schema(actor,binding,signal)).tables[0]!;
  expect((await api.read(actor,binding,{tableId:table.id,columnIds:[table.columns[0]!.id],first:1},signal)).rows).toHaveLength(1);
  await expect(api.read(actor,binding,{tableId:table.id,columnIds:['missing-column'],first:1},signal)).rejects.toThrow();
 });
});

describe('a dataset under an access policy', () => {
  it('refuses its owner\'s direct SQL that no grant names, and keeps the rows', async () => {
    const o = await owner();
    const ds = await o.created({ dataset: [{ branch: 'root' }], access: 'readwrite' });
    const actor = identityForUser(o.t.userId, o.t.id);
    await setDatasetPolicy(actor, ds, {
      version: 1,
      enforcement: 'enabled',
      tables: [{ table: { schema: 'public', name: 'rows' }, insert_permissions: [{ role: 'viewer', permission: { columns: '*', check: { branch: { _neq: 'blocked' } } } }] }],
    }, 0);
    const raw = await mutateDataset(request(`/api/artifacts/${ds}/mutate`, { method: 'POST', token: o.t.token, json: { sql: 'delete from public.rows' } }), params(ds));
    expect(raw.status).toBe(403);
    expect(((await raw.json()) as { error: string }).error).toBe('policy_denied');
    expect(await loadDatasetRows((await getArtifactById(ds))!)).toEqual([{ branch: 'root' }]);
  });
});
