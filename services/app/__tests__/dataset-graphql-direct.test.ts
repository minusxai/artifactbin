/**
 * THE DIRECT DATASET GRAPHQL ENDPOINT (`/api/artifacts/:id/graphql` on a dataset): the caller's role comes from
 * the dataset's own sharing (never a page), the schema is generated from the role's view, and every read runs
 * through that view. Operator semantics follow Hasura's documented examples (articles, ratings, dates).
 */
import { beforeEach, expect, it } from 'vitest';
import { mintAccountToken, request, setSession, useAppHarness } from './harness';
import { ANONYMOUS_ACTOR, identityForUser, type AccessActor } from '@/lib/accounts';
import { getDb } from '@/lib/platform';
import { createArtifactFromBody } from '@/lib/publish';
import { executeCatalog } from '@/lib/datasets';
import { overrideCatalogExecutor } from '@/lib/datasets/execute';
import { OPERATIONS, type OpContext } from '@/lib/operations/registry';
import { GET, POST } from '@/app/api/artifacts/[id]/graphql/route';

useAppHarness();
beforeEach(() => setSession(null));

const params = (id: string) => ({ params: Promise.resolve({ id }) });
type Person = Awaited<ReturnType<typeof person>>;
async function person(name: string) {
  const token = await mintAccountToken(`gql_${name}`);
  return { ...token, actor: identityForUser(token.userId, token.id, token.email) as AccessActor };
}
async function dataset(owner: Person, rows: unknown[], title: string, visibility: 'unlisted' | 'private' = 'unlisted') {
  const created = await createArtifactFromBody({ dataset: rows, title, access: 'readwrite', visibility }, owner.actor as AccessActor & { tokenId: string }, 'http://localhost:3000');
  expect(created.status, await created.clone().text()).toBe(201);
  return (await created.json()).id as string;
}
const schema = (id: string, who?: Person) => GET(request(`/api/artifacts/${id}/graphql`, who ? { token: who.token } : {}), params(id));
async function gql(id: string, who: Person | null, query: string, variables?: Record<string, unknown>) {
  const response = await POST(request(`/api/artifacts/${id}/graphql`, { method: 'POST', json: { query, ...(variables ? { variables } : {}) }, ...(who ? { token: who.token } : {}) }), params(id));
  return { status: response.status, body: await response.json() as { data?: Record<string, any>; errors?: Array<{ message: string; extensions: { code: string } }> } };
}

const STAFF = [{ name: 'ada', team: 'red', salary: 10 }, { name: 'bo', team: 'blue', salary: 20 }, { name: 'cy', team: 'red', salary: 30 }];
const POLICY = { version: 3, tables: [{ table: { schema: 'public', name: 'rows' }, select_permissions: [
  { role: 'viewer', permission: { columns: ['name', 'team'], filter: { team: { _eq: 'red' } }, allow_aggregations: false } },
  { role: 'signed_in', permission: { columns: '*', filter: {}, limit: 2, allow_aggregations: true } },
] }] };

async function staff(visibility: 'unlisted' | 'private' = 'unlisted') {
  const owner = await person('owner'), viewer = await person('viewer'), other = await person('other');
  const id = await dataset(owner, STAFF, 'Staff', visibility);
  const db = await getDb();
  await db.query("INSERT INTO artifact_shares(artifact_id,user_id,email,role) VALUES($1,$2,$3,'viewer')", [id, viewer.userId, viewer.email]);
  await db.query('UPDATE artifacts SET dataset_policy=$2::jsonb, policy_revision=policy_revision+1 WHERE id=$1', [id, JSON.stringify(POLICY)]);
  return { owner, viewer, other, id };
}

it('GET answers the caller\'s own schema and role: hidden columns and ungranted aggregates are absent', async () => {
  const { owner, viewer, other, id } = await staff();
  const owned = await (await schema(id, owner)).json();
  expect(owned.role).toBe('owner');
  expect(owned.revision).toBe('1');
  expect(owned.sdl).toContain('type staff { _id: ID! name: String team: String salary: Float }');
  expect(owned.sdl).toContain('staff_aggregate(');
  const viewed = await (await schema(id, viewer)).json();
  expect(viewed.role).toBe('viewer');
  expect(viewed.sdl).toContain('type staff { _id: ID! name: String team: String }');
  expect(viewed.sdl).not.toMatch(/salary|_aggregate/);
  const linked = await (await schema(id, other)).json();
  expect(linked.role).toBe('signed_in');
  expect(linked.sdl).toContain('staff_aggregate(');
  // No rule for anonymous: the uniform 404, byte-identical to an id that does not exist.
  const anonymous = await schema(id);
  const missing = await schema('nosuchid');
  expect(anonymous.status).toBe(404);
  expect(await anonymous.text()).toBe(await missing.text());
});

it('reads compose the caller\'s where with the select rule; _by_pk is not an oracle; hidden columns cannot be named', async () => {
  const { owner, viewer, id } = await staff();
  const all = await gql(id, owner, '{ staff { _id name salary } }');
  // No order_by: rows come in _id order (the deterministic tie-break), not stored order.
  const sorted = (rows: Array<{ name: string }>) => rows.map((r) => r.name).sort();
  expect(sorted(all.body.data!.staff)).toEqual(['ada', 'bo', 'cy']);
  expect(all.body.data!.staff.map((r: { _id: string }) => r._id)).toEqual(all.body.data!.staff.map((r: { _id: string }) => r._id).sort());
  const ids = Object.fromEntries(all.body.data!.staff.map((r: { _id: string; name: string }) => [r.name, r._id]));
  expect((await gql(id, viewer, '{ staff(order_by: {name: asc}) { name team } }')).body).toEqual({ data: { staff: [{ name: 'ada', team: 'red' }, { name: 'cy', team: 'red' }] } });
  expect((await gql(id, viewer, '{ staff(where: {team: {_eq: "blue"}}) { name } }')).body.data!.staff).toEqual([]);
  const pk = 'query($id: ID!) { staff_by_pk(_id: $id) { _id name } }';
  expect((await gql(id, viewer, pk, { id: ids.ada })).body.data!.staff_by_pk).toEqual({ _id: ids.ada, name: 'ada' });
  expect((await gql(id, viewer, pk, { id: ids.bo })).body.data!.staff_by_pk).toBeNull();
  expect((await gql(id, viewer, pk, { id: 'r_nosuchrow' })).body.data!.staff_by_pk).toBeNull();
  for (const query of ['{ staff { salary } }', '{ staff(where: {salary: {_gt: 0}}) { name } }', '{ staff(order_by: {salary: desc}) { name } }', '{ staff_aggregate { aggregate { count } } }']) {
    const refused = await gql(id, viewer, query);
    expect(refused.status, query).toBe(200);
    expect(refused.body.data, query).toBeUndefined();
    expect(refused.body.errors![0]!.extensions.code, query).toBe('validation_failed');
    expect(JSON.stringify(refused.body), query).not.toMatch(/"bo"|\b20\b/);
  }
});

it('aggregates follow allow_aggregations and cover only rows the role sees; the rule\'s limit caps reads', async () => {
  const { owner, other, id } = await staff();
  expect((await gql(id, owner, '{ staff_aggregate { aggregate { count sum { salary } } } }')).body.data).toEqual({ staff_aggregate: { aggregate: { count: 3, sum: { salary: 60 } } } });
  // The rule's limit is a prefix of the stored rows (the role view, as at every door), then the query applies.
  expect((await gql(id, other, '{ staff(limit: 10, order_by: {name: asc}) { name } }')).body.data!.staff).toEqual([{ name: 'ada' }, { name: 'bo' }]);
  expect((await gql(id, other, '{ staff(order_by: {salary: desc}) { name } }')).body.data!.staff).toEqual([{ name: 'bo' }, { name: 'ada' }]);
  expect((await gql(id, other, '{ staff_aggregate { aggregate { count sum { salary } } nodes(order_by: {name: asc}) { name } } }')).body.errors![0]!.extensions.code).toBe('validation_failed');
  expect((await gql(id, other, '{ staff_aggregate(order_by: {name: asc}) { aggregate { count sum { salary } } nodes { name } } }')).body.data).toEqual({ staff_aggregate: { aggregate: { count: 2, sum: { salary: 30 } }, nodes: [{ name: 'ada' }, { name: 'bo' }] } });
});

it('a private dataset has no link audience directly; a refused POST answers as a missing id', async () => {
  const { owner, viewer, other, id } = await staff('private');
  expect((await gql(id, owner, '{ staff { name } }')).body.data!.staff).toHaveLength(3);
  expect((await gql(id, viewer, '{ staff { name } }')).body.data!.staff).toHaveLength(2);
  // Refused, the dataset answers as the page door always has for it; with a revision named, exactly as a missing id.
  const post = (target: string, who: Person | null) => POST(request(`/api/artifacts/${target}/graphql`, { method: 'POST', json: { query: '{ staff { name } }', revision: '1' }, ...(who ? { token: who.token } : {}) }), params(target)).then(async (r) => [r.status, await r.text()]);
  expect(await post(id, other)).toEqual(await post('nosuchid', other));
  expect(await post(id, null)).toEqual(await post('nosuchid', null));
  const refused = await gql(id, other, '{ staff { name } }');
  expect(refused.status).not.toBe(200);
  expect(JSON.stringify(refused.body)).not.toMatch(/ada|errors|data/);
});

it('nothing bypasses the role view: every engine statement for a restricted role carries the view', async () => {
  const { owner, viewer, id } = await staff();
  const views: Array<unknown> = [];
  // Records each call's view and runs the real executor (it picks its implementation synchronously at the call).
  const record: typeof executeCatalog = (...args) => { views.push(args[3].view); overrideCatalogExecutor(undefined); try { return executeCatalog(...args); } finally { overrideCatalogExecutor(record); } };
  overrideCatalogExecutor(record);
  await gql(id, viewer, '{ staff { name } a: staff(where: {name: {_eq: "bo"}}) { name } staff_by_pk(_id: "x") { name } }');
  expect(views.length).toBe(3);
  expect(views.every((v) => v !== null && v !== undefined)).toBe(true);
  views.length = 0;
  await gql(id, owner, '{ staff { name } }');
  expect(views).toEqual([null]);
  overrideCatalogExecutor(undefined);
});

it('a role without write rules has no mutation root; there is no subscription root', async () => {
  const { owner, other, id } = await staff();
  // Mutations are generated per role from its write rules (PR 5): `other` (signed_in) has none here.
  for (const [who, query] of [[other, 'mutation { insert_staff_one(object: {name: "x"}) { _id } }'], [owner, 'subscription { staff { name } }']] as const) {
    const refused = await gql(id, who, query);
    expect(refused.body.errors![0]!.extensions.code).toBe('validation_failed');
  }
  expect((await POST(request(`/api/artifacts/${id}/graphql`, { method: 'POST', json: { query: 7 }, token: owner.token }), params(id))).status).toBe(400);
});

it('is the registry operation query_dataset_graphql', async () => {
  const { viewer, id } = await staff();
  const op = OPERATIONS.find((o) => o.name === 'query_dataset_graphql')!;
  expect(op.http).toEqual({ method: 'POST', path: '/api/artifacts/{id}/graphql' });
  const reply = await op.run({ actor: viewer.actor, base: 'http://localhost:3000', request: request(`/api/artifacts/${id}/graphql`) } as unknown as OpContext, { id, query: '{ staff(order_by: {name: asc}) { name } }' });
  expect(reply).toMatchObject({ status: 200, body: { data: { staff: [{ name: 'ada' }, { name: 'cy' }] } } });
  expect((await op.run({ actor: ANONYMOUS_ACTOR, base: 'http://localhost:3000', request: request(`/api/artifacts/${id}/graphql`) } as unknown as OpContext, { id, query: '{ staff { name } }' })).status).toBe(404);
});

const ARTICLES = [
  { title: 'Lorem ipsum amet', rating: 5, published_on: '2018-06-10', is_published: true, author: 'Sidney' },
  { title: 'Dolor sit', rating: 3, published_on: '2017-03-01', is_published: false, author: 'Brandon' },
  { title: 'AMET consectetur', rating: 4, published_on: null, is_published: true, author: 'Ada' },
  { title: 'Elit', rating: null, published_on: '2019-01-01', is_published: false, author: 'Sidney' },
];

it('operators, ordering and paging behave as in Hasura\'s documented examples', async () => {
  const owner = await person('articles');
  const id = await dataset(owner, ARTICLES, 'Articles');
  const titles = async (args: string) => {
    const { body } = await gql(id, owner, `{ articles${args} { title } }`);
    expect(body.errors, args).toBeUndefined();
    const out = body.data!.articles.map((a: { title: string }) => a.title);
    // Without order_by the order is _id's: compare filters as sets, in stored order.
    return args.includes('order_by') ? out : ARTICLES.map((a) => a.title).filter((t) => out.includes(t));
  };
  expect(await titles('(where: {rating: {_gte: 4}})')).toEqual(['Lorem ipsum amet', 'AMET consectetur']);
  expect(await titles('(where: {published_on: {_gt: "2018-06-01"}})')).toEqual(['Lorem ipsum amet', 'Elit']);
  expect(await titles('(where: {author: {_in: ["Sidney", "Brandon"]}})')).toEqual(['Lorem ipsum amet', 'Dolor sit', 'Elit']);
  expect(await titles('(where: {author: {_nin: ["Sidney"]}})')).toEqual(['Dolor sit', 'AMET consectetur']);
  expect(await titles('(where: {title: {_like: "%amet%"}})')).toEqual(['Lorem ipsum amet']);
  expect(await titles('(where: {title: {_ilike: "%amet%"}})')).toEqual(['Lorem ipsum amet', 'AMET consectetur']);
  expect(await titles('(where: {title: {_nlike: "%amet%"}})')).toEqual(['Dolor sit', 'AMET consectetur', 'Elit']);
  expect(await titles('(where: {title: {_nilike: "%AMET%"}})')).toEqual(['Dolor sit', 'Elit']);
  expect(await titles('(where: {published_on: {_is_null: true}})')).toEqual(['AMET consectetur']);
  expect(await titles('(where: {_not: {is_published: {_eq: true}}})')).toEqual(['Dolor sit', 'Elit']);
  expect(await titles('(where: {_and: [{published_on: {_gte: "2018-01-01"}}, {published_on: {_lte: "2018-12-31"}}]})')).toEqual(['Lorem ipsum amet']);
  expect(await titles('(where: {_or: [{rating: {_gte: 4}}, {published_on: {_gte: "2019-01-01"}}]})')).toEqual(['Lorem ipsum amet', 'AMET consectetur', 'Elit']);
  expect(await titles('(where: {rating: {_neq: 5}})')).toEqual(['Dolor sit', 'AMET consectetur']);
  expect(await titles('(order_by: {rating: desc})')).toEqual(['Elit', 'Lorem ipsum amet', 'AMET consectetur', 'Dolor sit']);
  expect(await titles('(order_by: {rating: asc})')).toEqual(['Dolor sit', 'AMET consectetur', 'Lorem ipsum amet', 'Elit']);
  expect(await titles('(order_by: {rating: asc_nulls_first})')).toEqual(['Elit', 'Dolor sit', 'AMET consectetur', 'Lorem ipsum amet']);
  expect(await titles('(order_by: [{author: asc}, {rating: desc_nulls_last}])')).toEqual(['AMET consectetur', 'Dolor sit', 'Lorem ipsum amet', 'Elit']);
  expect(await titles('(order_by: {rating: asc}, limit: 2, offset: 1)')).toEqual(['AMET consectetur', 'Lorem ipsum amet']);
  const nulls = await gql(id, owner, '{ articles(where: {rating: {_eq: null}}) { title } }');
  expect(nulls.body.errors![0]!.extensions.code).toBe('validation_failed');
  expect((await gql(id, owner, `{ articles_aggregate { aggregate { count c: count(columns: [rating]) d: count(columns: [author], distinct: true) sum { rating } avg { rating } max { rating } min { title } } } }`)).body.data)
    .toEqual({ articles_aggregate: { aggregate: { count: 4, c: 3, d: 3, sum: { rating: 12 }, avg: { rating: 4 }, max: { rating: 5 }, min: { title: 'AMET consectetur' } } } });
});

it('pages: 100 rows by default, never more than 1000, offset past the end is empty, negative limits are refused', async () => {
  const owner = await person('many');
  const id = await dataset(owner, Array.from({ length: 1200 }, (_, i) => ({ n: i })), 'Many');
  const count = async (args: string) => (await gql(id, owner, `{ many${args} { n } }`)).body.data!.many.length;
  expect(await count('')).toBe(100);
  expect(await count('(limit: 5000)')).toBe(1000);
  expect(await count('(limit: 1000, offset: 1150)')).toBe(50);
  expect(await count('(offset: 5000)')).toBe(0);
  expect(await count('(limit: 0)')).toBe(0);
  expect((await gql(id, owner, '{ many(limit: -1) { n } }')).body.errors![0]!.extensions.code).toBe('validation_failed');
  expect((await gql(id, owner, '{ many_aggregate { aggregate { count } } }')).body.data).toEqual({ many_aggregate: { aggregate: { count: 1200 } } });
  const page = (await gql(id, owner, '{ many(order_by: {n: desc}, limit: 2, offset: 3) { n } }')).body.data!.many;
  expect(page).toEqual([{ n: 1196 }, { n: 1195 }]);
});
