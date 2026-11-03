/**
 * gate-data-journey's HTTP facts (scripts/gates/gate-data-journey.mjs keeps what a browser must see): a dataflow
 * that reads a column its dataset lacks is refused at publish, naming the query and the column; and a dataset under
 * an access policy takes no direct SQL its rules do not name from a non-owner, while its owner keeps full access.
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
 it('reads generated columns and rejects unknown ones before executing a query',async()=>{
  const {linkedGql,liveLink,errorCode}=await import('./linked-datasets');
  const o=await owner(),id=await o.created({dataset:[{region:'EU',revenue:837}]});
  const link=liveLink(id,'sales'),actor=identityForUser(o.t.userId,o.t.id);
  expect((await linkedGql(actor,link,'{ sales(limit: 1) { region } }')).data).toEqual({sales:[{region:'EU'}]});
  expect(errorCode(await linkedGql(actor,link,'{ sales(limit: 1) { missing_column } }'))).toBe('validation_failed');
 });
});

describe('a dataset under an access policy', () => {
  // Plan §249: owner and editor are admin-equivalent, so a rule never refuses the owner; rule holders get only their rules.
  it('refuses a reader\'s direct SQL that no rule names and keeps the rows, while its owner keeps full access', async () => {
    const o = await owner();
    const ds = await o.created({ dataset: [{ branch: 'root' }], access: 'readwrite' });
    const actor = identityForUser(o.t.userId, o.t.id);
    const roles = ['viewer', 'signed_in', 'anonymous'];
    await setDatasetPolicy(actor, ds, {
      version: 3,
      tables: [{
        table: { schema: 'public', name: 'rows' },
        select_permissions: roles.map((role) => ({ role, permission: { columns: '*', filter: {}, allow_aggregations: true } })),
        insert_permissions: roles.map((role) => ({ role, permission: { columns: '*', check: { branch: { _neq: 'blocked' } } } })),
      }],
    }, 0);
    const reader = await mintToken('data-journey-reader');
    const raw = await mutateDataset(request(`/api/artifacts/${ds}/mutate`, { method: 'POST', token: reader.token, json: { sql: 'delete from public.rows' } }), params(ds));
    expect(raw.status).toBe(403);
    expect(((await raw.json()) as { error: string }).error).toBe('policy_denied');
    expect(await loadDatasetRows((await getArtifactById(ds))!)).toEqual([{ branch: 'root' }]);
    const owned = await mutateDataset(request(`/api/artifacts/${ds}/mutate`, { method: 'POST', token: o.t.token, json: { sql: 'delete from public.rows' } }), params(ds));
    expect(owned.status, await owned.clone().text()).toBe(200);
    expect(await loadDatasetRows((await getArtifactById(ds))!)).toEqual([]);
  });
});
