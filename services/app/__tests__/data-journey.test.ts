/**
 * gate-data-journey's HTTP facts (scripts/gates/gate-data-journey.mjs keeps what a browser must see): a dataflow
 * that reads a column its dataset lacks is refused at publish, naming the query and the column; and a dataset under
 * an access policy takes no direct SQL its grants do not name, not even from its owner.
 */
import { describe, expect, it } from 'vitest';
import { POST as createRoute } from '@/app/api/artifacts/route';
import { POST as mutateDataset } from '@/app/api/artifacts/[id]/mutate/route';
import { getArtifactById } from '@/lib/artifacts';
import { setDatasetPolicy } from '@/lib/document-data/dataset-policy';
import { loadDatasetRows } from '@/lib/datasets/dataset-store';
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

const SALES = (ds: string, column: string) => `<Helmet><Value name="region" type="string" />
<Import name="sales_data" src="ref:${ds}" /><Query name="sales">{\`select region, sum(${column}) revenue from sales_data.rows where $region is null or region = $region group by 1 order by 1\`}</Query></Helmet>
<div><select aria-label="Region" value="$region" options="$sales" /><p>Total <Number data="$sales" col="revenue" agg="sum" prefix="$" /></p></div>`;

describe('publishing a dataflow', () => {
  it('refuses a column the dataset lacks as invalid_sql, the compiler naming the query and the column', async () => {
    const o = await owner();
    const ds = await o.created({ dataset: [{ region: 'EU', revenue: 837 }, { region: 'NA', revenue: 1200 }] });
    expect((await o.publish({ markup: SALES(ds, 'revenue') })).status).toBe(201);
    const bad = await o.publish({ markup: SALES(ds, 'revenu') });
    expect(bad.status).toBe(400);
    const body = (await bad.json()) as { error: string; details: unknown };
    expect(body.error).toBe('invalid_sql');
    expect(JSON.stringify(body.details)).toContain('<Query> \\"sales\\" reads revenu — no such column');
  });
});

describe('a dataset under an access policy', () => {
  it('refuses its owner\'s direct SQL that no grant names, and keeps the rows', async () => {
    const o = await owner();
    const ds = await o.created({ dataset: [{ branch: 'root' }], access: 'readwrite' });
    const actor = { tokenId: o.t.id, userId: o.t.userId };
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
