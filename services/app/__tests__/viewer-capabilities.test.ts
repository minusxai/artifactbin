/**
 * WHAT THIS VIEWER MAY CHANGE, asked up front through the page GraphQL door (the one `@afbin/apollo` posts to):
 * `viewer { canEdit }` (the live-region editor's page edit check), `<root>_can { insert }` (the role has an insert
 * rule) and a row's `_can { update delete }` (the role's rule exists and its filter holds for this row, decided in
 * the same read as the row). Owner and editor: always true. A signed-in visitor under own-rows: true only on the
 * rows they added. Signed out: false everywhere. `backend_only` and missing rules: false. The answers are advisory:
 * every write is still judged as before.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { datasetPermissionsTemplate } from '@artifactbin/utils/dataset-permissions';
import { mintAccountToken, recordStatements, request, setSession, useAppHarness } from './harness';
import { identityForUser, type AccessActor } from '@/lib/accounts';
import { getDb } from '@/lib/platform';
import { createArtifactFromBody } from '@/lib/publish';
import { POST } from '@/app/api/artifacts/[id]/graphql/route';

const harness = useAppHarness();
beforeEach(() => setSession(null));

type Person = Awaited<ReturnType<typeof person>>;
type Reply = { data?: Record<string, any> | null; errors?: Array<{ message: string; extensions?: { code?: string } }> };
async function person(name: string) {
  const token = await mintAccountToken(`caps_${name}`);
  return { ...token, actor: identityForUser(token.userId, token.id, token.email) as AccessActor & { tokenId: string } };
}
async function publish(owner: Person, body: Record<string, unknown>) {
  const created = await createArtifactFromBody({ ...('dataset' in body ? { access: 'readwrite' } : {}), visibility: 'unlisted', ...body }, owner.actor, 'http://localhost:3000');
  return { status: created.status, body: await created.json() as { id: string; error?: string; details?: string[] } };
}
/** One request through a door: the page linking the dataset (`revision` 1), or the dataset's own endpoint. */
async function gql(id: string, who: Person | null, query: string, variables?: Record<string, unknown>, page = true): Promise<Reply> {
  const response = await POST(request(`/api/artifacts/${id}/graphql`, { method: 'POST', json: { query, ...(variables ? { variables } : {}), ...(page ? { revision: '1' } : {}) }, ...(who ? { token: who.token } : {}) }), { params: Promise.resolve({ id }) });
  expect(response.status).toBe(200);
  return await response.json() as Reply;
}
const ok = (reply: Reply) => { expect(reply.errors, JSON.stringify(reply.errors)).toBeUndefined(); return reply.data!; };

const ROWS = { schema: 'public', name: 'rows' };
const SEED = [{ title: 'seed a', created_by: 'nobody' }, { title: 'seed b', created_by: 'nobody' }];
const share = async (artifact: string, who: Person, role: 'viewer' | 'editor') =>
  (await getDb()).query('INSERT INTO artifact_shares(artifact_id,user_id,email,role) VALUES($1,$2,$3,$4)', [artifact, who.userId, who.email, role]);
const setPolicy = async (dataset: string, policy: unknown) =>
  (await getDb()).query('UPDATE artifacts SET dataset_policy=$2::jsonb, policy_revision=policy_revision+1 WHERE id=$1', [dataset, JSON.stringify(policy)]);

/** A `tasks` dataset under `policy` (own-rows on created_by by default), a page linking it, and the cast. */
async function world(policy?: unknown) {
  const owner = await person('owner'), editor = await person('editor'), visitor = await person('visitor');
  const dataset = await publish(owner, { dataset: SEED, title: 'Tasks' });
  expect(dataset.status, JSON.stringify(dataset.body)).toBe(201);
  const ownRows = datasetPermissionsTemplate('own-rows', { tables: [{ table: ROWS, columns: ['title', 'created_by'] }] }, { ownerColumn: 'created_by' });
  if (!ownRows.ok) throw new Error(JSON.stringify(ownRows.errors));
  await setPolicy(dataset.body.id, policy ?? ownRows.policy);
  const page = await publish(owner, { html: `<html><head><link rel="af-dataset" data-af-name="tasks" href="ref:${dataset.body.id}"></head><body>Tasks</body></html>` });
  expect(page.status, JSON.stringify(page.body)).toBe(201);
  // The editor edits the page and the dataset (shared editor on both).
  await share(page.body.id, editor, 'editor');
  await share(dataset.body.id, editor, 'editor');
  return { owner, editor, visitor, dataset: dataset.body.id, page: page.body.id };
}

const ASK = '{ viewer { canEdit } tasks_can { insert } tasks(order_by: {title: asc}) { _id title _can { update delete } } }';
const all = (value: boolean) => ({ update: value, delete: value });

describe('the roles × answers matrix under own-rows, through the page door', () => {
  const w = harness.shared(async () => {
    const cast = await world();
    // The visitor adds a row through the page: own-rows stamps it with their id, and `returning` answers `_can`.
    const added = ok(await gql(cast.page, cast.visitor, 'mutation { insert_tasks_one(object: {title: "mine"}) { title created_by _can { update delete } } }'));
    expect(added.insert_tasks_one).toEqual({ title: 'mine', created_by: cast.visitor.userId, _can: all(true) });
    return cast;
  });

  it('owner: may edit the page, add rows and change or delete every row', async () => {
    const data = ok(await gql(w().page, w().owner, ASK));
    expect(data.viewer).toEqual({ canEdit: true });
    expect(data.tasks_can).toEqual({ insert: true });
    expect(data.tasks.map((r: any) => [r.title, r._can])).toEqual([['mine', all(true)], ['seed a', all(true)], ['seed b', all(true)]]);
  });

  it('shared editor: may edit the page, add rows and change or delete every row', async () => {
    const data = ok(await gql(w().page, w().editor, ASK));
    expect(data.viewer).toEqual({ canEdit: true });
    expect(data.tasks_can).toEqual({ insert: true });
    expect(data.tasks.map((r: any) => r._can)).toEqual([all(true), all(true), all(true)]);
  });

  it('signed-in visitor: may not edit the page; may add rows; may change or delete only the rows they added', async () => {
    const data = ok(await gql(w().page, w().visitor, ASK));
    expect(data.viewer).toEqual({ canEdit: false });
    expect(data.tasks_can).toEqual({ insert: true });
    expect(data.tasks.map((r: any) => [r.title, r._can])).toEqual([['mine', all(true)], ['seed a', all(false)], ['seed b', all(false)]]);
  });

  it('signed out: may not edit the page, add rows or change any row', async () => {
    const data = ok(await gql(w().page, null, ASK));
    expect(data.viewer).toEqual({ canEdit: false });
    expect(data.tasks_can).toEqual({ insert: false });
    expect(data.tasks.map((r: any) => r._can)).toEqual([all(false), all(false), all(false)]);
  });

  it('_by_pk, an aggregate\'s nodes and a fragment answer the same per row, each field only as asked', async () => {
    const { tasks } = ok(await gql(w().page, w().owner, '{ tasks(order_by: {title: asc}) { _id title } }'));
    const [mine, seed] = [tasks[0]._id, tasks[1]._id];
    const query = `query Two($mine: ID!, $seed: ID!) {
      mine: tasks_by_pk(_id: $mine) { title _can { update } }
      seed: tasks_by_pk(_id: $seed) { ...Can }
      tasks_aggregate(order_by: {title: asc}) { nodes { title _can { delete } } }
    }
    fragment Can on tasks { title _can { ... on tasks_row_can { delete } update } }`;
    expect(ok(await gql(w().page, w().visitor, query, { mine, seed }))).toEqual({
      mine: { title: 'mine', _can: { update: true } },
      seed: { title: 'seed a', _can: { delete: false, update: false } },
      tasks_aggregate: { nodes: [{ title: 'mine', _can: { delete: true } }, { title: 'seed a', _can: { delete: false } }, { title: 'seed b', _can: { delete: false } }] },
    });
  });

  it('the dataset\'s own endpoint answers the same rows: the visitor (a link holder) only on their own row', async () => {
    const data = ok(await gql(w().dataset, w().visitor, '{ tasks_can { insert } tasks(order_by: {title: asc}) { title _can { update delete } } }', undefined, false));
    expect(data.tasks_can).toEqual({ insert: true });
    expect(data.tasks.map((r: any) => r._can)).toEqual([all(true), all(false), all(false)]);
  });

  it('asking costs no database statement: the same count with and without _can for a rule role', async () => {
    const plain = '{ tasks(order_by: {title: asc}) { title } }', asked = '{ tasks(order_by: {title: asc}) { title _can { update delete } } }';
    await gql(w().page, w().visitor, plain);
    const before = await recordStatements(() => gql(w().page, w().visitor, plain));
    const after = await recordStatements(() => gql(w().page, w().visitor, asked));
    expect(after.count, after.sql.join('\n')).toBe(before.count);
    expect(ok(after.value).tasks.map((r: any) => r._can.update)).toEqual([true, false, false]);
  });

  it('advisory only: a false answer is still refused by the write itself', async () => {
    const { tasks } = ok(await gql(w().page, w().owner, '{ tasks(where: {title: {_eq: "seed a"}}) { _id } }'));
    const refused = await gql(w().page, w().visitor, 'mutation($id: ID!) { delete_tasks_by_pk(_id: $id) { _id } }', { id: tasks[0]._id });
    expect(refused.data?.delete_tasks_by_pk ?? null).toBeNull();
  });
});

describe('rules that answer false', () => {
  it('a backend_only rule is false for pages, while the same role\'s ordinary rule answers true', async () => {
    const policy = { version: 3, tables: [{
      table: ROWS,
      select_permissions: [{ role: 'signed_in', permission: { columns: '*', filter: {} } }],
      insert_permissions: [{ role: 'signed_in', permission: { columns: ['title'], check: {}, backend_only: true } }],
      update_permissions: [{ role: 'signed_in', permission: { columns: ['title'], filter: {}, check: {}, backend_only: true } }],
      delete_permissions: [{ role: 'signed_in', permission: { filter: {} } }],
    }] };
    const w = await world(policy);
    const data = ok(await gql(w.page, w.visitor, '{ tasks_can { insert } tasks { _can { update delete } } }'));
    expect(data.tasks_can).toEqual({ insert: false });
    expect(data.tasks).toEqual([{ _can: { update: false, delete: true } }, { _can: { update: false, delete: true } }]);
  });

  it('a role with no write rule answers false everywhere', async () => {
    const w = await world({ version: 3, tables: [{ table: ROWS, select_permissions: [{ role: 'signed_in', permission: { columns: '*', filter: {} } }] }] });
    const data = ok(await gql(w.page, w.visitor, '{ tasks_can { insert } tasks { _can { update delete } } }'));
    expect(data).toEqual({ tasks_can: { insert: false }, tasks: [{ _can: all(false) }, { _can: all(false) }] });
  });
});

it('refuses a page whose links would generate the same `<root>_can`', async () => {
  const owner = await person('collide');
  const one = await publish(owner, { dataset: SEED, title: 'One' }), two = await publish(owner, { dataset: SEED, title: 'Two' });
  const page = await publish(owner, { html: `<html><head><link rel="af-dataset" data-af-name="tasks" href="ref:${one.body.id}"><link rel="af-dataset" data-af-name="tasks_can" href="ref:${two.body.id}"></head><body>x</body></html>` });
  expect(page.status).toBe(400);
  expect(page.body.error).toBe('graphql_root_collision');
  expect(JSON.stringify(page.body.details)).toContain('tasks_can');
});
