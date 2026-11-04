/**
 * THE GENERATED MUTATIONS on the direct dataset GraphQL endpoint (`POST /api/artifacts/:id/graphql` on a
 * dataset): the mutation root is generated per role from its insert/update/delete rules, every field compiles
 * into the one write path (`mutateDataset`), so the rule's columns, filter, check and presets hold, and one
 * operation is one atomic dataset write. Semantics follow Hasura's documented mutation examples: `returning`
 * and `affected_rows`, `_one`/`_by_pk` answering the row or null, `_inc` on numbers, `where` required.
 */
import { beforeEach, expect, it, vi } from 'vitest';
import { mintAccountToken, request, setSession, useAppHarness } from './harness';
import { ANONYMOUS_ACTOR, identityForUser, type AccessActor } from '@/lib/accounts';
import { getDb } from '@/lib/platform';
import { createArtifactFromBody } from '@/lib/publish';
import { getArtifactById } from '@/lib/artifacts';
import { loadDatasetRows } from '@/lib/datasets';
import { OPERATIONS, type OpContext } from '@/lib/operations/registry';
import { GET, POST } from '@/app/api/artifacts/[id]/graphql/route';

const harness = useAppHarness();
beforeEach(() => { setSession(null); vi.restoreAllMocks(); });

const params = (id: string) => ({ params: Promise.resolve({ id }) });
type Person = Awaited<ReturnType<typeof person>>;
type Reply = { data?: Record<string, any> | null; errors?: Array<{ message: string; extensions: { code: string } }> };
async function person(name: string) {
  const token = await mintAccountToken(`gqlm_${name}`);
  return { ...token, actor: identityForUser(token.userId, token.id, token.email) as AccessActor };
}
const schema = async (id: string, who?: Person) => (await GET(request(`/api/artifacts/${id}/graphql`, who ? { token: who.token } : {}), params(id)));
async function gql(id: string, who: Person | null, query: string, variables?: Record<string, unknown>, key?: string) {
  const response = await POST(request(`/api/artifacts/${id}/graphql`, { method: 'POST', json: { query, ...(variables ? { variables } : {}) }, ...(who ? { token: who.token } : {}), ...(key ? { headers: { 'Idempotency-Key': key } } : {}) }), params(id));
  return { status: response.status, body: await response.json() as Reply };
}
const code = (reply: { body: Reply }) => reply.body.errors?.[0]?.extensions.code;
const version = async (id: string) => (await getArtifactById(id))!.version;
const stored = async (id: string) => loadDatasetRows((await getArtifactById(id))!);

const STAFF = [
  { name: 'ada', team: 'red', salary: 10, votes: 1, owner: 'nobody' },
  { name: 'bo', team: 'blue', salary: 20, votes: 2, owner: 'nobody' },
];
const ROWS = { schema: 'public', name: 'rows' };
const POLICY = () => ({ version: 3, tables: [{
  table: ROWS,
  select_permissions: [
    { role: 'viewer', permission: { columns: ['name', 'team', 'votes', 'owner'], filter: {} } },
    { role: 'signed_in', permission: { columns: '*', filter: {} } },
    { role: 'anonymous', permission: { columns: ['name'], filter: { team: { _eq: 'red' } } } },
  ],
  insert_permissions: [
    { role: 'viewer', permission: { columns: ['name', 'team'], check: { team: { _neq: 'blue' } }, set: { owner: 'X-Hasura-User-Id' } } },
    { role: 'anonymous', permission: { columns: ['name'], check: {}, set: { team: 'red' } } },
  ],
  update_permissions: [{ role: 'viewer', permission: { columns: ['name', 'votes'], filter: { owner: { _eq: 'X-Hasura-User-Id' } }, check: { votes: { _lte: 10 } } } }],
  delete_permissions: [{ role: 'viewer', permission: { filter: { owner: { _eq: 'X-Hasura-User-Id' } } } }],
}] });

async function staff(rows: unknown[] = STAFF, policy: () => unknown = POLICY) {
  const owner = await person('owner'), viewer = await person('viewer'), other = await person('other');
  const created = await createArtifactFromBody({ dataset: rows, title: 'Staff', access: 'readwrite', visibility: 'unlisted' }, owner.actor as AccessActor & { tokenId: string }, 'http://localhost:3000');
  expect(created.status, await created.clone().text()).toBe(201);
  const id = (await created.json()).id as string;
  const db = await getDb();
  await db.query("INSERT INTO artifact_shares(artifact_id,user_id,email,role) VALUES($1,$2,$3,'viewer')", [id, viewer.userId, viewer.email]);
  await db.query('UPDATE artifacts SET dataset_policy=$2::jsonb, policy_revision=policy_revision+1 WHERE id=$1', [id, JSON.stringify(policy())]);
  return { owner, viewer, other, id };
}
const idsByName = async (id: string, owner: Person) => Object.fromEntries((await gql(id, owner, '{ staff { _id name } }')).body.data!.staff.map((r: { _id: string; name: string }) => [r.name, r._id]));

it('generates each role\'s mutation root from its rules: inputs name only the rule\'s columns, less presets', async () => {
  const { owner, viewer, other, id } = await staff();
  const sdl = async (who?: Person) => (await (await schema(id, who)).json()).sdl as string;
  const owned = await sdl(owner);
  for (const root of ['insert_staff(', 'insert_staff_one(', 'update_staff(', 'update_staff_by_pk(', 'delete_staff(', 'delete_staff_by_pk(']) expect(owned).toContain(root);
  expect(owned).toContain('input staff_inc_input { salary: Float votes: Float }');
  const viewed = await sdl(viewer);
  expect(viewed).toContain('input staff_insert_input { name: String team: String }');
  expect(viewed).toContain('input staff_set_input { name: String votes: Float }');
  expect(viewed).toContain('input staff_inc_input { votes: Float }');
  expect(viewed).toContain('type staff_mutation_response { affected_rows: Int! returning: [staff!]! }');
  expect(await sdl(other)).not.toContain('type Mutation');
  const anonymous = await sdl();
  expect(anonymous).toContain('input staff_insert_input { name: String }');
  expect(anonymous).not.toMatch(/update_staff|delete_staff|staff_set_input/);
});

it('insert, update and delete answer as Hasura: returning, affected_rows, _one and _by_pk', async () => {
  const { owner, id } = await staff();
  const one = await gql(id, owner, 'mutation($o: staff_insert_input!) { insert_staff_one(object: $o) { _id name salary } }', { o: { name: 'cy', team: 'red', salary: 30 } });
  expect(one.body.errors).toBeUndefined();
  expect(one.body.data!.insert_staff_one).toMatchObject({ name: 'cy', salary: 30 });
  expect(one.body.data!.insert_staff_one._id).toMatch(/^r_/);
  const many = await gql(id, owner, 'mutation { insert_staff(objects: [{name: "dee", votes: 0}, {name: "eve"}]) { affected_rows returning { name votes } } }');
  expect(many.body.data).toEqual({ insert_staff: { affected_rows: 2, returning: [{ name: 'dee', votes: 0 }, { name: 'eve', votes: null }] } });
  expect(await version(id)).toBe(3);
  const ids = await idsByName(id, owner);
  expect(ids.cy).toBe(one.body.data!.insert_staff_one._id);

  const inc = await gql(id, owner, 'mutation { update_staff(where: {team: {_eq: "red"}}, _inc: {votes: 5}, _set: {owner: "x"}) { affected_rows returning { name votes owner } } }');
  expect(inc.body.data!.update_staff.affected_rows).toBe(2);
  expect(inc.body.data!.update_staff.returning).toEqual([{ name: 'ada', votes: 6, owner: 'x' }, { name: 'cy', votes: null, owner: 'x' }]);
  const pk = 'mutation($id: ID!) { update_staff_by_pk(pk_columns: {_id: $id}, _set: {salary: 99}) { name salary } }';
  expect((await gql(id, owner, pk, { id: ids.bo })).body.data).toEqual({ update_staff_by_pk: { name: 'bo', salary: 99 } });
  const before = await version(id);
  expect((await gql(id, owner, pk, { id: 'r_nosuchrow' })).body.data).toEqual({ update_staff_by_pk: null });

  const del = await gql(id, owner, 'mutation { delete_staff(where: {name: {_in: ["dee", "eve"]}}) { affected_rows returning { _id name } } }');
  expect(del.body.data!.delete_staff).toEqual({ affected_rows: 2, returning: [{ _id: ids.dee, name: 'dee' }, { _id: ids.eve, name: 'eve' }] });
  expect((await gql(id, owner, 'mutation($id: ID!) { delete_staff_by_pk(_id: $id) { name } }', { id: ids.bo })).body.data).toEqual({ delete_staff_by_pk: { name: 'bo' } });
  expect((await gql(id, owner, 'mutation($id: ID!) { delete_staff_by_pk(_id: $id) { name } }', { id: ids.bo })).body.data).toEqual({ delete_staff_by_pk: null });
  expect((await stored(id)).map((r) => r.name)).toEqual(['ada', 'cy']);
  // where is required, as in Hasura; an empty one matches every row.
  expect(code(await gql(id, owner, 'mutation { delete_staff { affected_rows } }'))).toBe('validation_failed');
  expect(before).toBeGreaterThan(3);
});

it('rules hold: insert columns, presets from the session, check, the update and delete filter, masked returning', async () => {
  const { owner, viewer, id } = await staff();
  const added = await gql(id, viewer, 'mutation { insert_staff_one(object: {name: "vic", team: "red"}) { _id name owner } }');
  expect(added.body.data!.insert_staff_one).toMatchObject({ name: 'vic', owner: viewer.userId });
  // Not insertable (and not selectable) for viewers: refused by the schema, nothing written.
  expect(code(await gql(id, viewer, 'mutation { insert_staff_one(object: {name: "x", salary: 1}) { _id } }'))).toBe('validation_failed');
  expect(code(await gql(id, viewer, 'mutation { insert_staff_one(object: {name: "x"}) { salary } }'))).toBe('validation_failed');
  const head = await version(id);
  const blue = await gql(id, viewer, 'mutation { insert_staff_one(object: {name: "x", team: "blue"}) { _id } }');
  expect(code(blue)).toBe('check_violation');
  expect(blue.body.data ?? null).toBeNull();
  expect(await version(id)).toBe(head);

  // Only the viewer's own rows pass the filter: every row matches where, one is updated.
  const bumped = await gql(id, viewer, 'mutation { update_staff(where: {}, _set: {votes: 3}) { affected_rows returning { name votes } } }');
  expect(bumped.body.data!.update_staff).toEqual({ affected_rows: 1, returning: [{ name: 'vic', votes: 3 }] });
  const ids = await idsByName(id, owner);
  expect((await gql(id, viewer, 'mutation($id: ID!) { update_staff_by_pk(pk_columns: {_id: $id}, _set: {name: "hacked"}) { name } }', { id: ids.ada })).body.data).toEqual({ update_staff_by_pk: null });
  expect(code(await gql(id, viewer, 'mutation($id: ID!) { update_staff_by_pk(pk_columns: {_id: $id}, _set: {votes: 11}) { name } }', { id: ids.vic }))).toBe('check_violation');
  expect((await gql(id, viewer, 'mutation { delete_staff(where: {}) { affected_rows } }')).body.data).toEqual({ delete_staff: { affected_rows: 1 } });
  expect((await stored(id)).map((r) => r.name)).toEqual(['ada', 'bo']);
});

it('pattern operators hold in an update rule: _like in the filter, _nlike and _ilike in the check', async () => {
  const patterned = () => {
    const p = POLICY();
    p.tables[0]!.update_permissions = [{ role: 'viewer', permission: { columns: ['name', 'votes'], filter: { team: { _like: 're%' } } as never, check: { _and: [{ name: { _nlike: '%!%' } }, { name: { _ilike: '%A%' } }] } as never } }];
    return p;
  };
  const { owner, viewer, id } = await staff(STAFF, patterned);
  const ids = await idsByName(id, owner);
  const rename = (rowId: string, name: string) => gql(id, viewer, 'mutation($id: ID!, $name: String!) { update_staff_by_pk(pk_columns: {_id: $id}, _set: {name: $name}) { name } }', { id: rowId, name });
  // The red row passes the filter; a name with an `a` in any case and no `!` passes the check.
  const renamed = await rename(ids.ada!, 'nina');
  expect(renamed.body.errors).toBeUndefined();
  expect(renamed.body.data).toEqual({ update_staff_by_pk: { name: 'nina' } });
  const head = await version(id);
  expect(code(await rename(ids.ada!, 'anna!'))).toBe('check_violation');
  expect(code(await rename(ids.ada!, 'bob'))).toBe('check_violation');
  expect(await version(id)).toBe(head);
  // The blue row is outside the filter: nothing is updated.
  expect((await rename(ids.bo!, 'Abe')).body.data).toEqual({ update_staff_by_pk: null });
  expect((await stored(id)).map((r) => r.name)).toEqual(['nina', 'bo']);
});

it('anonymous writes only what its rule allows, with its preset, and sees only selectable returning', async () => {
  const { owner, id } = await staff();
  const added = await gql(id, null, 'mutation { insert_staff(objects: [{name: "guest"}]) { affected_rows returning { _id name } } }');
  expect(added.body.errors).toBeUndefined();
  expect(added.body.data!.insert_staff).toMatchObject({ affected_rows: 1, returning: [{ name: 'guest' }] });
  expect((await stored(id)).at(-1)).toMatchObject({ name: 'guest', team: 'red' });
  expect(code(await gql(id, null, 'mutation { update_staff(where: {}, _set: {name: "x"}) { affected_rows } }'))).toBe('validation_failed');
  // The owner is admin-equivalent: no rule applies.
  expect((await gql(id, owner, 'mutation { insert_staff_one(object: {name: "z", team: "blue", salary: 5}) { team } }')).body.data).toEqual({ insert_staff_one: { team: 'blue' } });
});

it('returning leaves out rows the select filter hides; affected_rows still counts them', async () => {
  const { id } = await staff(STAFF, () => {
    const p = POLICY();
    p.tables[0]!.insert_permissions[1] = { role: 'anonymous', permission: { columns: ['name', 'team'], check: {} } } as never;
    return p;
  });
  const reply = await gql(id, null, 'mutation { insert_staff(objects: [{name: "r", team: "red"}, {name: "b", team: "blue"}]) { affected_rows returning { name } } }');
  expect(reply.body.data!.insert_staff).toEqual({ affected_rows: 2, returning: [{ name: 'r' }] });
  expect((await gql(id, null, 'mutation { insert_staff_one(object: {name: "b2", team: "blue"}) { name } }')).body.data).toEqual({ insert_staff_one: null });
});

it('a role that can write but select nothing gets affected_rows only and Hasura\'s no_queries_available', async () => {
  const { id } = await staff(STAFF, () => ({ version: 3, tables: [{ table: ROWS, insert_permissions: [{ role: 'anonymous', permission: { columns: ['name'], check: {} } }] }] }));
  const sdl = (await (await schema(id)).json()).sdl as string;
  expect(sdl).toContain('no_queries_available: String!');
  expect(sdl).toContain('type staff_mutation_response { affected_rows: Int! }');
  expect((await gql(id, null, 'mutation { insert_staff(objects: [{name: "signup"}]) { affected_rows } }')).body.data).toEqual({ insert_staff: { affected_rows: 1 } });
  expect((await stored(id)).at(-1)).toEqual({ name: 'signup', team: null, salary: null, votes: null, owner: null });
});

it('backend_only rules are for trusted page programs, never the direct endpoint; a session preset denies anonymous', async () => {
  const { viewer, id } = await staff(STAFF, () => ({ version: 3, tables: [{ table: ROWS,
    select_permissions: [{ role: 'viewer', permission: { columns: '*', filter: {} } }, { role: 'anonymous', permission: { columns: ['name'], filter: {} } }],
    insert_permissions: [
      { role: 'viewer', permission: { columns: ['name'], check: {}, backend_only: true } },
      { role: 'anonymous', permission: { columns: ['name'], check: {}, set: { owner: 'X-Hasura-User-Id' } } },
    ],
  }] }));
  expect((await (await schema(id, viewer)).json()).sdl).not.toContain('type Mutation');
  expect(code(await gql(id, viewer, 'mutation { insert_staff_one(object: {name: "x"}) { name } }'))).toBe('validation_failed');
  const anonymous = await gql(id, null, 'mutation { insert_staff(objects: [{name: "x"}]) { affected_rows } }');
  expect(code(anonymous)).toBe('permission_denied');
  expect(await version(id)).toBe(1);
});

it('one operation is one atomic write: a failing field writes nothing, and every field lands in one version', async () => {
  const { owner, viewer, id } = await staff();
  const head = await version(id);
  const failing = await gql(id, viewer, 'mutation { a: insert_staff_one(object: {name: "new", team: "red"}) { _id } b: update_staff(where: {}, _inc: {votes: 100}) { affected_rows } }');
  expect(code(failing)).toBe('check_violation');
  expect(await version(id)).toBe(head);
  expect(await stored(id)).toHaveLength(2);
  const both = await gql(id, owner, 'mutation { a: insert_staff_one(object: {name: "new"}) { name } b: update_staff(where: {name: {_eq: "new"}}, _set: {team: "green"}) { affected_rows returning { team } } c: delete_staff(where: {name: {_eq: "bo"}}) { affected_rows } }');
  expect(both.body.data).toEqual({ a: { name: 'new' }, b: { affected_rows: 1, returning: [{ team: 'green' }] }, c: { affected_rows: 1 } });
  expect(await version(id)).toBe(head + 1);
});

it('an Idempotency-Key replays the first reply and writes once; reused for another request it is refused', async () => {
  const { owner, id } = await staff();
  const insert = 'mutation { insert_staff_one(object: {name: "once"}) { _id name } }';
  const first = await gql(id, owner, insert, undefined, 'key-0123456789abcdef');
  const again = await gql(id, owner, insert, undefined, 'key-0123456789abcdef');
  expect(first.body.errors).toBeUndefined();
  expect(again.body).toEqual(first.body);
  expect(await version(id)).toBe(2);
  expect((await stored(id)).filter((r) => r.name === 'once')).toHaveLength(1);
  const other = await gql(id, owner, 'mutation { insert_staff_one(object: {name: "twice"}) { _id } }', undefined, 'key-0123456789abcdef');
  expect(code(other)).toBe('validation_failed');
  expect(other.body.errors![0]!.message).toMatch(/Idempotency-Key/);
  // Without a key every request is its own write.
  await gql(id, owner, insert);
  await gql(id, owner, insert);
  expect((await stored(id)).filter((r) => r.name === 'once')).toHaveLength(3);
  expect(code(await gql(id, owner, insert, undefined, 'bad key!'))).toBe('validation_failed');
});

/** Lose the version CAS `times` times: the head's edit_id moves between the read and the guarded swap (in the commit transaction). */
async function loseCas(times: number) {
  const db = await harness.db();
  let lost = 0;
  type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
  const contended = (tx: Tx) => async (sql: string, values?: unknown[]) => {
    if (lost < times && sql.includes('UPDATE artifacts') && sql.includes('edit_id = $2')) {
      lost++;
      await tx.query('UPDATE artifacts SET edit_id = md5(random()::text) WHERE id = $1', [values![0]]);
    }
    return tx.query(sql, values as never);
  };
  const transaction = db.transaction.bind(db);
  vi.spyOn(db, 'transaction').mockImplementation((async (fn: (tx: Tx) => Promise<unknown>) => transaction(async (tx) => fn(new Proxy(tx, {
    get: (target, prop) => { if (prop === 'query') return contended(target); const value = Reflect.get(target, prop); return typeof value === 'function' ? value.bind(target) : value; },
  })))) as typeof db.transaction);
  return () => lost;
}

it('a lost CAS re-runs the statements on the new head (up to 3 times) with the same generated _ids', async () => {
  const { owner, id } = await staff();
  const lost = await loseCas(3);
  const reply = await gql(id, owner, 'mutation { insert_staff_one(object: {name: "raced"}) { _id } update_staff(where: {name: {_eq: "ada"}}, _inc: {votes: 1}) { affected_rows } }', undefined, 'race-0123456789abcdef');
  vi.restoreAllMocks();
  expect(lost()).toBe(3);
  expect(reply.body.errors).toBeUndefined();
  expect(reply.body.data!.update_staff).toEqual({ affected_rows: 1 });
  expect((await idsByName(id, owner)).raced).toBe(reply.body.data!.insert_staff_one._id);
  expect((await stored(id)).find((r) => r.name === 'ada')!.votes).toBe(2);

  const { owner: o2, id: busy } = await staff();
  await loseCas(4);
  const refused = await gql(busy, o2, 'mutation { insert_staff_one(object: {name: "never"}) { _id } }');
  vi.restoreAllMocks();
  expect(code(refused)).toBe('dataset_changed');
  expect(await version(busy)).toBe(1);
});

it('at most 100 rows change per operation: above it nothing is written', async () => {
  const { owner, id } = await staff(Array.from({ length: 120 }, (_, i) => ({ name: `n${i}`, team: 'red', salary: i, votes: 0, owner: 'x' })));
  const objects = Array.from({ length: 101 }, (_, i) => ({ name: `new${i}` }));
  expect(code(await gql(id, owner, 'mutation($o: [staff_insert_input!]!) { insert_staff(objects: $o) { affected_rows } }', { o: objects }))).toBe('too_many_rows');
  expect(code(await gql(id, owner, 'mutation { update_staff(where: {}, _inc: {votes: 1}) { affected_rows } }'))).toBe('too_many_rows');
  expect(code(await gql(id, owner, 'mutation { a: delete_staff(where: {salary: {_lt: 60}}) { affected_rows } b: delete_staff(where: {salary: {_gte: 60}}) { affected_rows } }'))).toBe('too_many_rows');
  expect(await version(id)).toBe(1);
  expect((await gql(id, owner, 'mutation { update_staff(where: {salary: {_lt: 100}}, _inc: {votes: 1}) { affected_rows } }')).body.data).toEqual({ update_staff: { affected_rows: 100 } });
});

it('is the registry operation query_dataset_graphql, which now writes; the uniform 404 still covers no access', async () => {
  const { viewer, id } = await staff();
  const op = OPERATIONS.find((o) => o.name === 'query_dataset_graphql')!;
  expect(op.annotations?.readOnly).not.toBe(true);
  const ctx = (actor: AccessActor, headers: Record<string, string> = {}) => ({ actor, base: 'http://localhost:3000', request: request(`/api/artifacts/${id}/graphql`, { method: 'POST', headers }) }) as unknown as OpContext;
  const reply = await op.run(ctx(viewer.actor), { id, query: 'mutation { insert_staff_one(object: {name: "op", team: "red"}) { name } }', idempotencyKey: 'op-key-0123456789abcd' });
  expect(reply).toMatchObject({ status: 200, body: { data: { insert_staff_one: { name: 'op' } } } });
  const replay = await op.run(ctx(viewer.actor, { 'Idempotency-Key': 'op-key-0123456789abcd' }), { id, query: 'mutation { insert_staff_one(object: {name: "op", team: "red"}) { name } }' });
  expect(replay.body).toEqual(reply.body);
  expect((await stored(id)).filter((r) => r.name === 'op')).toHaveLength(1);
  const db = await getDb();
  await db.query("UPDATE artifacts SET visibility='private' WHERE id=$1", [id]);
  expect((await op.run(ctx(ANONYMOUS_ACTOR), { id, query: 'mutation { insert_staff_one(object: {name: "x"}) { name } }' })).status).toBe(404);
});
