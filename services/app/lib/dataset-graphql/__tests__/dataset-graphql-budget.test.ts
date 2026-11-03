/**
 * WHAT A DATASET GRAPHQL READ COSTS THE DATABASE: a generated-API list through the dataset's own endpoint
 * (`POST /api/artifacts/<dataset>/graphql`) and through a page linking it (`POST /api/artifacts/<page>/graphql`),
 * for the owner and for a viewer whose select rule filters rows and hides a column.
 *
 * Each case records the statements a request issues after a first, warming request and pins the budget; the
 * answer is pinned beside it, so the savings cannot come from skipping the work. The request is authorized once,
 * and its final fence asks afresh: a share revoked while the read runs withholds the rows.
 */
import { describe, expect, it, vi } from 'vitest';
import { identityForUser, type AccessActor } from '@/lib/accounts';
import { objectStore } from '@/lib/object-store';
import { getDb } from '@/lib/platform';
import { createArtifactFromBody } from '@/lib/publish';
import { POST } from '@/app/api/artifacts/[id]/graphql/route';
import { mintAccountToken, recordStatements, request, useAppHarness } from '@/__tests__/harness';

const harness = useAppHarness();

const STAFF = Array.from({ length: 40 }, (_, i) => ({ name: `n${i}`, team: i % 2 ? 'blue' : 'red', salary: i }));
const POLICY = { version: 3, tables: [{ table: { schema: 'public', name: 'rows' }, select_permissions: [
  { role: 'viewer', permission: { columns: ['name', 'team'], filter: { team: { _eq: 'red' } }, allow_aggregations: true } },
] }] };

async function person(name: string) {
  const token = await mintAccountToken(`budget_${name}`);
  return { ...token, actor: identityForUser(token.userId, token.id, token.email) as AccessActor & { tokenId: string } };
}

/** The owner's dataset under POLICY, a page linking it as `staff`, and a viewer the share `share` names. */
async function seed(share: (viewer: Awaited<ReturnType<typeof person>>) => { userId: string | null; email: string | null }) {
  const owner = await person('owner'), viewer = await person('viewer');
  const created = await createArtifactFromBody({ dataset: STAFF, title: 'Staff', access: 'readwrite', visibility: 'unlisted' }, owner.actor, 'http://localhost:3000');
  const dataset = (await created.json() as { id: string }).id;
  const db = await getDb(), named = share(viewer);
  await db.query("INSERT INTO artifact_shares(artifact_id,user_id,email,role) VALUES($1,$2,$3,'viewer')", [dataset, named.userId, named.email]);
  await db.query('UPDATE artifacts SET dataset_policy=$2::jsonb, policy_revision=policy_revision+1 WHERE id=$1', [dataset, JSON.stringify(POLICY)]);
  const page = (await (await createArtifactFromBody({ html: `<html><head><link rel="af-dataset" data-af-name="staff" href="ref:${dataset}"></head><body>Staff</body></html>`, visibility: 'unlisted' }, owner.actor, 'http://localhost:3000')).json() as { id: string }).id;
  return { owner, viewer, dataset, page };
}
type World = Awaited<ReturnType<typeof seed>>;

type Door = 'direct' | 'page';
type Reply = { data?: Record<string, any>; errors?: Array<{ extensions?: { code?: string } }> };
/** One generated-API request through `door`: the dataset's own endpoint, or the page linking it. */
async function gql(world: World, door: Door, token: string, query: string): Promise<Reply> {
  const id = door === 'direct' ? world.dataset : world.page;
  const response = await POST(request(`/api/artifacts/${id}/graphql`, { method: 'POST', token, json: { query, ...(door === 'page' ? { revision: '1' } : {}) } }), { params: Promise.resolve({ id }) });
  expect(response.status).toBe(200);
  return await response.json() as Reply;
}

const ONE = '{ staff(order_by: {name: asc}, limit: 3) { name team } }';
const TWO = '{ staff(order_by: {name: asc}, limit: 3) { name team } staff_aggregate { aggregate { count } } }';

/**
 * The statements one warm list request may issue, per door and caller. Observed on this fixture before one
 * authorization per request: direct 14 (owner) / 46 (viewer), through the page 20 / 64, each engine statement
 * re-reading the dataset row and the caller's role three times. Now the dataset costs one authorization (its row,
 * and for a viewer the role facts once each) and one fresh final fence. Six of a direct request's statements are not
 * the dataset's (the target's header, the bearer token and its hosted authority); a page request also reads the page.
 */
const BUDGET = {
  direct: { owner: 8, viewer: 14 },
  page: { owner: 14, viewer: 32 },
};

describe('the statement budget', () => {
  const world = harness.shared(() => seed((viewer) => viewer));

  /** The statements one warm request issues, and its answer. */
  async function cost(door: Door, who: 'owner' | 'viewer', query: string) {
    const { token } = world()[who];
    await gql(world(), door, token, query);
    const { value, count, sql } = await recordStatements(() => gql(world(), door, token, query));
    expect(value.errors).toBeUndefined();
    return { reply: value, count, sql };
  }

  describe.each(['direct', 'page'] as const)('of a dataset GraphQL read through the %s door', (door) => {
    it('answers the owner every row and the viewer only what the rule shows', async () => {
      expect((await cost(door, 'owner', TWO)).reply.data).toEqual({ staff: [{ name: 'n0', team: 'red' }, { name: 'n1', team: 'blue' }, { name: 'n10', team: 'red' }], staff_aggregate: { aggregate: { count: 40 } } });
      expect((await cost(door, 'viewer', TWO)).reply.data).toEqual({ staff: [{ name: 'n0', team: 'red' }, { name: 'n10', team: 'red' }, { name: 'n12', team: 'red' }], staff_aggregate: { aggregate: { count: 20 } } });
    });

    it.each(['owner', 'viewer'] as const)('keeps the %s list within its statement budget', async (who) => {
      const { count, sql } = await cost(door, who, ONE);
      console.info('[budget] dataset graphql %s door, %s list: statements=%d', door, who, count);
      expect(count, sql.join('\n')).toBeLessThanOrEqual(BUDGET[door][who]);
    });

    it.each(['owner', 'viewer'] as const)('costs the %s the same statements for 2 roots as for 1', async (who) => {
      const one = await cost(door, who, ONE), two = await cost(door, who, TWO);
      console.info('[budget] dataset graphql %s door, %s: 1 root=%d statements, 2 roots=%d', door, who, one.count, two.count);
      expect(two.count, two.sql.join('\n')).toBe(one.count);
    });
  });
});

describe.each(['direct', 'page'] as const)('one authorization per request, through the %s door', (door) => {
  it('fences afresh: a share revoked while the read runs withholds its rows', async () => {
    const world = await seed((viewer) => viewer);
    expect((await gql(world, door, world.viewer.token, ONE)).data?.staff).toHaveLength(3);
    const store = objectStore(), get = store.get.bind(store);
    let revoked = false;
    // The read's first object load: the owner revokes the viewer's share after the request was authorized.
    const spy = vi.spyOn(store, 'get').mockImplementation(async (key: string) => {
      if (!revoked) { revoked = true; await (await getDb()).query('DELETE FROM artifact_shares WHERE artifact_id=$1', [world.dataset]); }
      return get(key);
    });
    try {
      // Directly the fence refuses the request (the uniform answer); a page re-runs a raced read on the new head,
      // where the viewer no longer reads the dataset. Either way no row leaves.
      const id = door === 'direct' ? world.dataset : world.page;
      const response = await POST(request(`/api/artifacts/${id}/graphql`, { method: 'POST', token: world.viewer.token, json: { query: ONE, ...(door === 'page' ? { revision: '1' } : {}) } }), { params: Promise.resolve({ id }) });
      const body = await response.text();
      expect(body).not.toMatch(/"n\d+"/);
      expect((JSON.parse(body) as Reply).data?.staff ?? null).toBeNull();
    } finally { spy.mockRestore(); }
    expect(revoked).toBe(true);
  });

  it('stamps an invitation addressed to the reader\'s email once: the namedRole write runs once', async () => {
    const world = await seed((viewer) => ({ userId: null, email: viewer.email }));
    const { value, sql } = await recordStatements(() => gql(world, door, world.viewer.token, ONE));
    expect(value.data?.staff).toHaveLength(3);
    expect(sql.filter((text) => /UPDATE artifact_shares SET user_id/.test(text))).toHaveLength(1);
    const db = await getDb();
    expect((await db.query('SELECT user_id FROM artifact_shares WHERE artifact_id=$1', [world.dataset])).rows).toEqual([{ user_id: world.viewer.userId }]);
  });
});
