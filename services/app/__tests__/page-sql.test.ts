/**
 * THE PAGE'S READ-ONLY SQL DOOR: the reserved page-GraphQL root `_sql(sql, params)` through the real page route
 * (`/api/artifacts/:id/graphql`, what `@afbin/apollo` sends). It reads the page VERSION's dataset links as the
 * reader: a single-table dataset is the table `<link>`, a multi-table one `<link>.<table>`; each shows exactly the
 * rows and columns the reader's select rule shows; a mounted table whose rule lacks `allow_aggregations` refuses
 * the call (owner and editor always may). Params are bound, never spliced. GraphQL has no aggregate roots.
 */
import { beforeEach, expect, it } from 'vitest';
import { mintAccountToken, request, setSession, useAppHarness } from './harness';
import { identityForUser, type AccessActor } from '@/lib/accounts';
import { getDb } from '@/lib/platform';
import { createArtifactFromBody } from '@/lib/publish';
import { GET as artifactGet, PUT as artifactPut } from '@/app/api/artifacts/[id]/route';
import { GET, POST } from '@/app/api/artifacts/[id]/graphql/route';

useAppHarness();
beforeEach(() => setSession(null));

type Person = Awaited<ReturnType<typeof person>>;
type Reply = { data?: Record<string, any> | null; errors?: Array<{ message: string; extensions?: { code: string } }> };
async function person(name: string) {
  const token = await mintAccountToken(`psql_${name}`);
  return { ...token, actor: identityForUser(token.userId, token.id, token.email) as AccessActor & { tokenId: string } };
}
const params = (id: string) => ({ params: Promise.resolve({ id }) });
async function publish(owner: Person, body: Record<string, unknown>) {
  const created = await createArtifactFromBody({ ...('dataset' in body ? { access: 'readwrite' } : {}), visibility: 'unlisted', ...body }, owner.actor, 'http://localhost:3000');
  return { status: created.status, body: await created.json() as { id: string; error?: string; details?: string[] } };
}
async function gql(page: string, who: Person | null, query: string, options: { variables?: Record<string, unknown>; revision?: string } = {}) {
  const response = await POST(request(`/api/artifacts/${page}/graphql`, { method: 'POST', json: { query, revision: options.revision ?? '1', ...(options.variables ? { variables: options.variables } : {}) }, ...(who ? { token: who.token } : {}) }), params(page));
  return { status: response.status, body: await response.json() as Reply };
}
const SQL = 'query Q($sql: String!, $params: JSON) { _sql(sql: $sql, params: $params) { columns { name type } rows } }';
const sql = (page: string, who: Person | null, statement: string, values?: Record<string, unknown>, revision?: string) =>
  gql(page, who, SQL, { variables: { sql: statement, ...(values ? { params: values } : {}) }, ...(revision ? { revision } : {}) });
const rowsOf = (reply: { body: Reply }) => { expect(reply.body.errors, JSON.stringify(reply.body.errors)).toBeUndefined(); return reply.body.data!._sql.rows as Array<Record<string, unknown>>; };
const codeOf = (reply: { body: Reply }) => reply.body.errors?.[0]?.extensions?.code ?? null;
const setPolicy = async (id: string, policy: unknown) => { await (await getDb()).query('UPDATE artifacts SET dataset_policy=$2::jsonb, policy_revision=policy_revision+1 WHERE id=$1', [id, JSON.stringify(policy)]); };
const share = async (id: string, who: Person, role: 'viewer' | 'editor') => { await (await getDb()).query('INSERT INTO artifact_shares(artifact_id,user_id,email,role) VALUES($1,$2,$3,$4)', [id, who.userId, who.email, role]); };

const STAFF = [
  { name: 'ada', team: 'red', salary: 10 }, { name: 'bo', team: 'blue', salary: 20 },
  { name: 'cy', team: 'red', salary: 30 }, { name: 'di', team: 'red', salary: 40 },
];
const TEAMS = [{ team: 'red', lead: 'ada', budget: 100 }, { team: 'blue', lead: 'bo', budget: 200 }];
const rule = (schema: string, name: string, permissions: unknown[]) => ({ table: { schema, name }, select_permissions: permissions });
/** viewers: red rows only, no salary, at most 2 rows, may run SQL; signed-in: everything, no SQL; anonymous: names, may run SQL. */
const STAFF_POLICY = { version: 3, tables: [rule('public', 'rows', [
  { role: 'viewer', permission: { columns: ['name', 'team'], filter: { team: { _eq: 'red' } }, limit: 2, allow_aggregations: true } },
  { role: 'signed_in', permission: { columns: '*', filter: {}, allow_aggregations: false } },
  { role: 'anonymous', permission: { columns: ['name', 'team'], filter: { team: { _eq: 'blue' } }, allow_aggregations: true } },
])] };
/** Teams: viewers see red only without budget; everyone else reads it all, with SQL. */
const TEAMS_POLICY = { version: 3, tables: [rule('public', 'rows', [
  { role: 'viewer', permission: { columns: ['team', 'lead'], filter: { team: { _eq: 'red' } }, allow_aggregations: true } },
  { role: 'signed_in', permission: { columns: '*', filter: {}, allow_aggregations: true } },
  { role: 'anonymous', permission: { columns: '*', filter: {}, allow_aggregations: true } },
])] };

async function fixture(visibility: 'unlisted' | 'public' = 'unlisted') {
  const owner = await person('owner'), viewer = await person('viewer'), editor = await person('editor'), other = await person('other');
  const staff = await publish(owner, { dataset: STAFF, title: 'Staff', visibility });
  const teams = await publish(owner, { dataset: TEAMS, title: 'Teams', visibility });
  expect([staff.status, teams.status]).toEqual([201, 201]);
  for (const id of [staff.body.id, teams.body.id]) { await share(id, viewer, 'viewer'); await share(id, editor, 'editor'); }
  await setPolicy(staff.body.id, STAFF_POLICY);
  await setPolicy(teams.body.id, TEAMS_POLICY);
  const html = `<html><head><link rel="af-dataset" data-af-name="staff" href="ref:${staff.body.id}"><link rel="af-dataset" data-af-name="teams" href="ref:${teams.body.id}"></head><body>Staff</body></html>`;
  const page = await publish(owner, { html, visibility });
  expect(page.status, JSON.stringify(page.body)).toBe(201);
  return { owner, viewer, editor, other, staff: staff.body.id, teams: teams.body.id, page: page.body.id };
}

it('mounts _sql on a page with dataset links, and no _aggregate root anywhere in the page schema', async () => {
  const f = await fixture();
  const response = await GET(request(`/api/artifacts/${f.page}/graphql`, { token: f.owner.token }), params(f.page));
  const sdl = (await response.json() as { sdl: string }).sdl;
  expect(sdl).toMatch(/_sql\(sql: String!, params: JSON\): SqlResult/);
  expect(sdl).not.toMatch(/_aggregate/);
  expect(sdl).not.toMatch(/aggregate_fields|sum_fields|avg_fields/);
});

it('reads as the reader: the rule\'s rows (filter and limit) and columns, a hidden column refused', async () => {
  const f = await fixture();
  // The owner reads every row and column.
  expect(rowsOf(await sql(f.page, f.owner, 'select name, salary from staff order by name')).map((r) => r.name)).toEqual(['ada', 'bo', 'cy', 'di']);
  // The viewer: red rows only, at most 2 (the rule's limit), never salary; every table carries _id.
  const seen = rowsOf(await sql(f.page, f.viewer, 'select * from staff'));
  expect(seen.map((r) => r.name).sort()).toEqual(['ada', 'cy']);
  expect(Object.keys(seen[0]!).sort()).toEqual(['_id', 'name', 'team']);
  expect(rowsOf(await sql(f.page, f.viewer, 'select count(*) as n from staff'))).toEqual([{ n: 2 }]);
  const hidden = await sql(f.page, f.viewer, 'select sum(salary) as s from staff');
  expect(hidden.body.data?._sql ?? null).toBeNull();
  expect(codeOf(hidden)).toBe('validation_failed');
  expect(hidden.body.errors?.[0]?.message).toMatch(/salary/);
});

it('refuses a role whose rule lacks allow_aggregations; owner and editor always run SQL', async () => {
  const f = await fixture();
  const refused = await sql(f.page, f.other, 'select name from staff');
  expect(refused.body.data?._sql ?? null).toBeNull();
  expect(codeOf(refused)).toBe('permission_denied');
  expect(refused.body.errors?.[0]?.message).toMatch(/staff/);
  // The same reader runs SQL over a table its rule lets it: a link the SQL does not name is not mounted.
  expect(rowsOf(await sql(f.page, f.other, 'select sum(budget) as total from teams'))).toEqual([{ total: 300 }]);
  // Rows through GraphQL still work for the flagless role.
  expect((await gql(f.page, f.other, '{ staff { name } }')).body.data!.staff).toHaveLength(4);
  for (const who of [f.owner, f.editor]) expect(rowsOf(await sql(f.page, who, 'select count(*) as n from staff'))).toEqual([{ n: 4 }]);
});

it('a signed-out reader of a public page reads under the anonymous rule', async () => {
  const f = await fixture('public');
  expect(rowsOf(await sql(f.page, null, 'select name from staff order by name'))).toEqual([{ name: 'bo' }]);
  expect(codeOf(await sql(f.page, null, 'select salary from staff'))).toBe('validation_failed');
});

it('joins two linked datasets under both rules', async () => {
  const f = await fixture();
  const join = 'select s.name, t.lead from staff s join teams t on t.team = s.team order by s.name';
  expect(rowsOf(await sql(f.page, f.owner, join))).toEqual([{ name: 'ada', lead: 'ada' }, { name: 'bo', lead: 'bo' }, { name: 'cy', lead: 'ada' }, { name: 'di', lead: 'ada' }]);
  // The viewer: two red staff rows joined to the red team only; the team budget is not theirs to read.
  expect(rowsOf(await sql(f.page, f.viewer, join))).toEqual([{ name: 'ada', lead: 'ada' }, { name: 'cy', lead: 'ada' }]);
  expect(codeOf(await sql(f.page, f.viewer, 'select s.name, t.budget from staff s join teams t on t.team = s.team'))).toBe('validation_failed');
});

it('binds params as values, never SQL', async () => {
  const f = await fixture();
  expect(rowsOf(await sql(f.page, f.owner, 'select name from staff where team = $team order by name', { team: 'red' })).map((r) => r.name)).toEqual(['ada', 'cy', 'di']);
  expect(rowsOf(await sql(f.page, f.owner, 'select name from staff where team = $team', { team: "red' or '1'='1" }))).toEqual([]);
  expect(codeOf(await sql(f.page, f.owner, 'select name from staff where team = $team'))).toBe('validation_failed');
  expect(codeOf(await sql(f.page, f.owner, 'select name from staff where team = $team', { team: { nested: true } }))).toBe('validation_failed');
});

it('is read-only and bounded: one SELECT, a statement size cap, a result row cap', async () => {
  const f = await fixture();
  for (const statement of ['delete from staff', "update staff set name = 'x'", 'select 1; select 2', 'pragma table_info(staff)'])
    expect(codeOf(await sql(f.page, f.owner, statement)), statement).toBe('validation_failed');
  expect(rowsOf(await sql(f.page, f.owner, 'select count(*) as n from staff'))).toEqual([{ n: 4 }]);
  expect(codeOf(await sql(f.page, f.owner, `select 1 as x -- ${'x'.repeat(64_001)}`))).toBe('input_too_large');
  expect(codeOf(await sql(f.page, f.owner, 'with recursive n(i) as (select 1 union all select i + 1 from n where i < 10001) select i from n'))).toBe('result_too_large');
});

it('reads the page version\'s links: an archived revision keeps its dataset, a pinned link its revision', async () => {
  const f = await fixture();
  const other = await publish(f.owner, { dataset: [{ name: 'zed', team: 'green', salary: 1 }], title: 'Others' });
  const context = params(f.page);
  const head = await (await artifactGet(request(`/api/artifacts/${f.page}`, { token: f.owner.token }), context)).json();
  // Revision 2 points `staff` at another dataset and pins `teams` to its revision 1.
  const html = (head.html as string).replace(`href="ref:${f.staff}"`, `href="ref:${other.body.id}"`).replace(`data-af-name="teams" href="ref:${f.teams}"`, `data-af-name="teams" href="ref:${f.teams}" data-af-mode="pinned" data-af-revision="1"`);
  const updated = await artifactPut(request(`/api/artifacts/${f.page}`, { method: 'PUT', token: f.owner.token, json: { html, expectedVersion: head.version, expectedState: head.state } }), context);
  expect(updated.status, await updated.clone().text()).toBe(200);
  expect(rowsOf(await sql(f.page, f.owner, 'select name from staff order by name', undefined, '1')).map((r) => r.name)).toEqual(['ada', 'bo', 'cy', 'di']);
  expect(rowsOf(await sql(f.page, f.owner, 'select name from staff', undefined, '2'))).toEqual([{ name: 'zed' }]);
  // A write to teams moves its head; the pinned link still reads revision 1, the archived page revision 1 reads live.
  const write = await gql(f.page, f.owner, 'mutation { insert_teams_one(object: {team: "green", lead: "zed", budget: 5}) { _id } }', { revision: '1' });
  expect(write.status).toBe(403); // an archived revision is read-only
  const live = await gql(f.page, f.owner, 'mutation { insert_staff_one(object: {name: "yu", team: "green", salary: 2}) { _id } }', { revision: '2' });
  expect(live.body.errors, JSON.stringify(live.body)).toBeUndefined();
  expect(rowsOf(await sql(f.page, f.owner, 'select count(*) as n from staff', undefined, '2'))).toEqual([{ n: 2 }]);
  const teamsWrite = await sqlWriteTeams(f);
  expect(teamsWrite).toBe(true);
  expect(rowsOf(await sql(f.page, f.owner, 'select count(*) as n from teams', undefined, '2'))).toEqual([{ n: 2 }]);
  expect(rowsOf(await sql(f.page, f.owner, 'select count(*) as n from teams', undefined, '1'))).toEqual([{ n: 3 }]);
});

/** A write to the teams dataset through a page that links it live (the fixture's revision-1 page is archived now). */
async function sqlWriteTeams(f: Awaited<ReturnType<typeof fixture>>): Promise<boolean> {
  const page = await publish(f.owner, { html: `<html><head><link rel="af-dataset" data-af-name="teams" href="ref:${f.teams}"></head><body>T</body></html>` });
  const reply = await gql(page.body.id, f.owner, 'mutation { insert_teams_one(object: {team: "green", lead: "zed", budget: 5}) { _id } }');
  return !reply.body.errors && !!reply.body.data?.insert_teams_one;
}

it('refuses a link named _sql, the reserved root', async () => {
  const owner = await person('reserved');
  const dataset = await publish(owner, { dataset: [{ a: 1 }], title: 'Reserved' });
  const page = await publish(owner, { html: `<html><head><link rel="af-dataset" data-af-name="_sql" href="ref:${dataset.body.id}"></head><body>x</body></html>` });
  expect(page.status).toBe(400);
  expect(page.body.error).toBe('graphql_root_collision');
  expect(page.body.details?.[0]).toMatch(/_sql/);
});

it('reads the whole stored source past every display window: 10,005 rows sum and count; an empty filter counts zero', async () => {
  const owner = await person('whole');
  const dataset = await publish(owner, { dataset: Array.from({ length: 10005 }, (_, i) => ({ amount: i + 1, label: 'all' })), title: 'Many' });
  const page = await publish(owner, { html: `<html><head><link rel="af-dataset" data-af-name="many" href="ref:${dataset.body.id}"></head><body>x</body></html>` });
  expect(rowsOf(await sql(page.body.id, owner, 'select count(*) as n, sum(amount) as total, avg(amount) as mean from many where amount > $m', { m: 0 }))).toEqual([{ n: 10005, total: 50055015, mean: 5003 }]);
  expect(rowsOf(await sql(page.body.id, owner, 'select count(*) as n, sum(amount) as total, min(label) as first from many where amount > 100000'))).toEqual([{ n: 0, total: null, first: null }]);
});

it('never answers one role from another role\'s prepared rows: same columns, different filters, same statement', async () => {
  const f = await fixture('public');
  const statement = 'select name from staff order by name';
  for (let round = 0; round < 2; round++) {
    expect(rowsOf(await sql(f.page, f.viewer, statement))).toEqual([{ name: 'ada' }, { name: 'cy' }]);
    expect(rowsOf(await sql(f.page, null, statement))).toEqual([{ name: 'bo' }]);
  }
});
