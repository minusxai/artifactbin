/**
 * THE PAGE SQL DOOR (POST /api/artifacts/<page>/sql): one reader-authored statement over the page's dataset links,
 * reads and writes, as the reader through the page. Adversarial first: every write attack asserts the refusal AND that
 * the stored rows did not move; parity cases run the same request through the page GraphQL and compare.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { admitGroupMember, mintAccountToken, request, setSession, useAppHarness } from './harness';
import { identityForUser, type AccessActor } from '@/lib/accounts';
import { getDb, services, TransactionConflict } from '@/lib/platform';
import { createArtifactFromBody } from '@/lib/publish';
import { createArtifact, getArtifactById, replaceArtifactFor, setArtifactGroupShare, updateSharingFor } from '@/lib/artifacts';
import { lockOrder } from '@/lib/artifact-access';
import { loadDatasetRows } from '@/lib/datasets';
import { resolverDatasets } from '@/lib/page-graphql';
import { createGroup, deleteGroup, removeGroupMember } from '@/lib/groups';
import { POST as graphqlPost } from '@/app/api/artifacts/[id]/graphql/route';
import { POST as sqlPost } from '@/app/api/artifacts/[id]/sql/route';

useAppHarness();
beforeEach(() => setSession(null));

type Person = Awaited<ReturnType<typeof person>>;
type SqlReply = { columns?: Array<{ name: string; type: string }>; rows?: Array<Record<string, unknown>>; affected?: number; returning?: Array<Record<string, unknown>>; error?: string; message?: string };
type GqlReply = { data?: Record<string, any> | null; errors?: Array<{ message: string; extensions?: { code: string } }> };
async function person(name: string) {
  const token = await mintAccountToken(`psd_${name}`);
  return { ...token, actor: identityForUser(token.userId, token.id, token.email) as AccessActor & { tokenId: string } };
}
const params = (id: string) => ({ params: Promise.resolve({ id }) });
async function publish(owner: Person, body: Record<string, unknown>) {
  const created = await createArtifactFromBody({ ...('dataset' in body ? { access: 'readwrite' } : {}), visibility: 'unlisted', ...body }, owner.actor, 'http://localhost:3000');
  return { status: created.status, body: await created.json() as { id: string } };
}
async function sql(page: string, who: Person | null, text: string, values: Record<string, unknown> = {}, options: { key?: string; revision?: string; readOnly?: boolean } = {}) {
  const response = await sqlPost(request(`/api/artifacts/${page}/sql`, { method: 'POST', json: { sql: text, params: values, revision: options.revision ?? '1', ...(options.readOnly ? { readOnly: true } : {}) }, ...(who ? { token: who.token } : {}), ...(options.key ? { headers: { 'Idempotency-Key': options.key } } : {}) }), params(page));
  return { status: response.status, body: await response.json() as SqlReply };
}
async function gql(page: string, who: Person | null, query: string, variables?: Record<string, unknown>, key?: string) {
  const response = await graphqlPost(request(`/api/artifacts/${page}/graphql`, { method: 'POST', json: { query, revision: '1', ...(variables ? { variables } : {}) }, ...(who ? { token: who.token } : {}), ...(key ? { headers: { 'Idempotency-Key': key } } : {}) }), params(page));
  return { status: response.status, body: await response.json() as GqlReply };
}

const STAFF = [{ name: 'ada', team: 'red', salary: 10, page: 'seed', by: 'seed' }, { name: 'bo', team: 'blue', salary: 20, page: 'seed', by: 'seed' }];
const ROWS = { schema: 'public', name: 'rows' };
/**
 * viewer: red rows without salary, may move any row's team (update filter wider than its select filter);
 * signed_in: every row and column, adds rows stamped with page and self, edits and deletes its own, never to black;
 * anonymous: names only, may add a name and a team it cannot read back (a write-only column).
 */
const NOT_BLACK = { _or: [{ team: { _is_null: true } }, { team: { _neq: 'black' } }] };
const POLICY = { version: 3, tables: [{
  table: ROWS,
  select_permissions: [
    { role: 'viewer', permission: { columns: ['name', 'team', 'page', 'by'], filter: { team: { _eq: 'red' } }, allow_aggregations: false } },
    { role: 'signed_in', permission: { columns: '*', filter: {}, allow_aggregations: true } },
    { role: 'anonymous', permission: { columns: ['name'], filter: {} } },
  ],
  insert_permissions: [
    { role: 'signed_in', permission: { columns: ['name', 'team'], check: NOT_BLACK, set: { page: 'X-Hasura-Page-Id', by: 'X-Hasura-User-Id' } } },
    { role: 'anonymous', permission: { columns: ['name', 'team'], check: {}, set: { page: 'X-Hasura-Page-Id', by: 'anon' } } },
  ],
  update_permissions: [
    { role: 'signed_in', permission: { columns: ['team'], filter: { by: { _eq: 'X-Hasura-User-Id' } }, check: NOT_BLACK } },
    { role: 'viewer', permission: { columns: ['team'], filter: {}, check: {} } },
  ],
  delete_permissions: [{ role: 'signed_in', permission: { filter: { by: { _eq: 'X-Hasura-User-Id' } } } }],
}] };
const NOTES_POLICY = { version: 3, tables: [{ table: ROWS, select_permissions: [
  { role: 'signed_in', permission: { columns: '*', filter: {} } },
  { role: 'anonymous', permission: { columns: '*', filter: {} } },
] }] };

async function fixture() {
  const owner = await person('owner'), viewer = await person('viewer'), other = await person('other');
  const staff = await publish(owner, { dataset: STAFF, title: 'Staff' });
  const notes = await publish(owner, { dataset: [{ note: 'hello' }], title: 'Notes' });
  const db = await getDb();
  await db.query("INSERT INTO artifact_shares(artifact_id,user_id,email,role) VALUES($1,$2,$3,'viewer')", [staff.body.id, viewer.userId, viewer.email]);
  for (const [id, policy] of [[staff.body.id, POLICY], [notes.body.id, NOTES_POLICY]] as const)
    await db.query('UPDATE artifacts SET dataset_policy=$2::jsonb, policy_revision=policy_revision+1 WHERE id=$1', [id, JSON.stringify(policy)]);
  const page = await publish(owner, { html: `<html><head><link rel="af-dataset" data-af-name="staff" href="ref:${staff.body.id}"><link rel="af-dataset" data-af-name="notes" href="ref:${notes.body.id}"></head><body>Staff</body></html>` });
  expect(page.status, JSON.stringify(page.body)).toBe(201);
  return { owner, viewer, other, staff: staff.body.id, notes: notes.body.id, page: page.body.id };
}
const stored = async (id: string) => loadDatasetRows((await getArtifactById(id))!);
/** A refusal: an error code, nothing written. */
async function refused(f: { staff: string; notes: string }, reply: Promise<{ status: number; body: SqlReply }>, code?: string | RegExp) {
  const before = [await stored(f.staff), await stored(f.notes)];
  const { status, body } = await reply;
  expect(status, JSON.stringify(body)).toBeGreaterThanOrEqual(400);
  expect(body.error, JSON.stringify(body)).toBeTruthy();
  if (code) expect(body.error).toMatch(code);
  expect([await stored(f.staff), await stored(f.notes)]).toEqual(before);
  return body;
}

/* ------------------------------------------------------------------------------------------------------- reads */

it('reads as the reader: the role view, aggregates without allow_aggregations, values always bound', async () => {
  const f = await fixture();
  const all = await sql(f.page, f.owner, 'select name, salary from staff order by name');
  expect(all.status, JSON.stringify(all.body)).toBe(200);
  expect(all.body).toEqual({ columns: [{ name: 'name', type: 'string' }, { name: 'salary', type: 'number' }], rows: [{ name: 'ada', salary: 10 }, { name: 'bo', salary: 20 }] });
  // The viewer's select rule has allow_aggregations: false; this door aggregates over the rows the reader sees anyway.
  expect((await sql(f.page, f.viewer, 'select count(*) as n from staff')).body.rows).toEqual([{ n: 1 }]);
  expect((await sql(f.page, null, 'select group_concat(name) as names from staff')).body.rows).toEqual([{ names: 'ada,bo' }]);
  // Hidden columns do not exist for the reader.
  expect((await sql(f.page, f.viewer, 'select sum(salary) as s from staff')).body.error).toBe('validation_failed');
  expect((await sql(f.page, null, 'select team from staff')).body.error).toBe('validation_failed');
  // `${…}` values are parameters, never SQL text.
  expect((await sql(f.page, f.other, 'select name from staff where name = $p0', { p0: "ada' or 1=1 --" })).body.rows).toEqual([]);
  expect((await sql(f.page, f.other, 'select name from staff where name = $p0', { p0: 'ada' })).body.rows).toEqual([{ name: 'ada' }]);
  expect((await sql(f.page, f.other, 'select _id from staff where name = $p0', { p0: 'ada' })).body.rows?.[0]?._id).toMatch(/^r_/);
  // Joins across links read each as the reader.
  expect((await sql(f.page, null, 'select n.note, count(s.name) as c from notes n, staff s group by n.note')).body.rows).toEqual([{ note: 'hello', c: 2 }]);
});

it('refuses a read the guard refuses, with nothing about hidden data', async () => {
  const f = await fixture();
  for (const text of ['select 1; select 2', 'pragma table_info(staff)', "attach database ':memory:' as x", 'select * from sqlite_master', "select load_extension('x')", "select readfile('/etc/passwd')"]) {
    const reply = await sql(f.page, f.other, text);
    expect(reply.status, text).toBe(400);
    expect(reply.body.error, text).toBe('validation_failed');
  }
  const big = await sql(f.page, f.other, `select ${"'x' || ".repeat(20000)}'x' as a`);
  expect(big.body.error).toBe('input_too_large');
});

/* ------------------------------------------------------------------------------------- statement-shape attacks */

it('runs exactly one statement: trailing statements, comments and quotes cannot smuggle a second', async () => {
  const f = await fixture();
  await refused(f, sql(f.page, f.other, "insert into staff (name) values ('x'); delete from staff"), 'validation_failed');
  await refused(f, sql(f.page, f.other, "insert into staff (name) values ('x');\n/* */ delete from staff"), 'validation_failed');
  await refused(f, sql(f.page, f.other, "select 1 /* ; */; drop table staff"), 'validation_failed');
  // Inside a literal or a comment a semicolon is text: one INSERT, the comment ignored.
  const one = await sql(f.page, f.other, "insert into staff (name) values ('a;b') -- ; delete from staff");
  expect(one.status, JSON.stringify(one.body)).toBe(200);
  expect(one.body.affected).toBe(1);
  expect((await stored(f.staff)).map((r) => r.name)).toEqual(['ada', 'bo', 'a;b']);
});

it('refuses DDL, PRAGMA, ATTACH, transactions, RETURNING and DML inside a CTE', async () => {
  const f = await fixture();
  for (const text of [
    'drop table staff', 'create table x (a)', 'alter table staff add column z', 'create index i on staff(name)', 'create temp trigger t after insert on staff begin delete from staff; end',
    'pragma writable_schema = 1', "attach database ':memory:' as x", 'detach database main', 'begin', 'commit', 'savepoint a', 'release a', 'vacuum', 'reindex', 'analyze',
    "update staff set team = 'red' returning salary", "insert into staff (name) values ('x') returning *",
    'with x as (delete from staff returning *) select * from x', "with x as (insert into notes (note) values ('n') returning *) insert into staff (name) select note from x",
  ]) await refused(f, sql(f.page, f.owner, text), 'validation_failed');
  // REPLACE needs a conflict to delete anything, and the reader's table has no key: it is an INSERT.
  expect((await sql(f.page, f.owner, "replace into staff (name) values ('x')")).body.affected).toBe(1);
});

it('writes exactly one linked table: never another link, an unlinked name or a system table', async () => {
  const f = await fixture();
  // notes has no write rule for anyone below editor; the owner administers it and may.
  await refused(f, sql(f.page, f.other, "insert into notes (note) values ('x')"), /permission_denied/);
  await refused(f, sql(f.page, null, "update notes set note = 'x'"), /permission_denied/);
  await refused(f, sql(f.page, f.other, "insert into rows (name) values ('x')"), 'validation_failed');
  await refused(f, sql(f.page, f.other, "insert into public.rows (name) values ('x')"), 'validation_failed');
  await refused(f, sql(f.page, f.other, "insert into sqlite_master values ('table','x','x',0,'')"), 'validation_failed');
  // Reading another link inside a write reads it as the reader.
  const copied = await sql(f.page, f.other, 'insert into staff (name) select note from notes');
  expect(copied.body.affected).toBe(1);
  expect((await stored(f.staff)).at(-1)).toMatchObject({ name: 'hello', page: f.page, by: f.other.userId });
});

it('allows only side-effect-free, repeatable functions in a write', async () => {
  const f = await fixture();
  for (const fn of ["load_extension('x')", "readfile('/etc/passwd')", 'random()', 'randomblob(4)', 'uuid()', 'current_timestamp', 'changes()', 'last_insert_rowid()', 'sqlite_version()'])
    await refused(f, sql(f.page, f.owner, `insert into staff (name) values (${fn})`), 'validation_failed');
  expect((await sql(f.page, f.owner, "insert into staff (name) values (upper('zed'))")).body.affected).toBe(1);
});

it('refuses a statement over the byte cap and an effect over the row cap', async () => {
  const f = await fixture();
  await refused(f, sql(f.page, f.owner, `insert into staff (name) values ('${'x'.repeat(70_000)}')`), 'input_too_large');
  await refused(f, sql(f.page, f.owner, "with recursive r(i) as (select 1 union all select i + 1 from r where i < 101) insert into staff (name) select 'n' || i from r"), 'too_many_rows');
  // A runaway read inside a write stops at the deadline.
  await refused(f, sql(f.page, f.owner, "with recursive r(i) as (select 1 union all select i + 1 from r) insert into staff (name) select 'n' from r where i = 100000000"), /timeout|validation_failed/);
});

/* ---------------------------------------------------------------------------------------- hidden data attacks */

it('a write never reads a hidden column or a row outside the select filter', async () => {
  const f = await fixture();
  // The viewer sees red rows without salary. A hidden column in WHERE, SET or a subquery does not exist.
  await refused(f, sql(f.page, f.viewer, "update staff set team = 'red' where salary > 15"), 'validation_failed');
  await refused(f, sql(f.page, f.viewer, 'update staff set team = (select salary from staff limit 1)'), 'validation_failed');
  // A blue row is outside the viewer's select filter: a subquery cannot see it, so it is no oracle.
  const probe = await sql(f.page, f.viewer, "update staff set team = 'red' where exists (select 1 from staff where team = 'blue')");
  expect(probe.body.affected).toBe(0);
  // Naming an invisible row and a row that does not exist answer exactly alike.
  const hidden = await sql(f.page, f.viewer, "update staff set team = 'red' where name = 'bo'");
  const absent = await sql(f.page, f.viewer, "update staff set team = 'red' where name = 'nobody'");
  expect(hidden).toEqual(absent);
  expect(hidden.body).toEqual({ affected: 0, returning: [] });
  expect((await stored(f.staff)).map((r) => r.team)).toEqual(['red', 'blue']);
  // Anonymous reads names only: team is write-only for it, NULL in every row it reads, never the stored value.
  expect((await sql(f.page, null, "insert into staff (name) select name from staff where team = 'red'")).body.affected).toBe(0);
  await refused(f, sql(f.page, null, 'insert into staff (name) select salary from staff'), 'validation_failed');
});

it('an UPDATE cannot leave its filter or fail its check, and the select rule shapes what it returns', async () => {
  const f = await fixture();
  const added = await sql(f.page, f.other, "insert into staff (name, team) values ('cy', 'red')");
  expect(added.status, JSON.stringify(added.body)).toBe(200);
  // Seed rows are not the caller's: the update filter skips them; their own row moves.
  const moved = await sql(f.page, f.other, "update staff set team = 'green'");
  expect(moved.body.affected).toBe(1);
  expect(moved.body.returning).toEqual([expect.objectContaining({ name: 'cy', team: 'green', salary: null, by: f.other.userId })]);
  // The check holds on the result.
  await refused(f, sql(f.page, f.other, "update staff set team = 'black' where name = 'cy'"), 'check_violation');
  // A column the update rule does not name, visible or not.
  await refused(f, sql(f.page, f.other, "update staff set name = 'x' where name = 'cy'"), /permission_denied/);
  await refused(f, sql(f.page, f.other, "update staff set by = 'seed' where name = 'cy'"), /permission_denied/);
  expect((await stored(f.staff)).map((r) => [r.name, r.team])).toEqual([['ada', 'red'], ['bo', 'blue'], ['cy', 'green']]);
});

it('an INSERT names only its rule\'s columns, presets win, and _id is the platform\'s', async () => {
  const f = await fixture();
  await refused(f, sql(f.page, f.other, "insert into staff (name, page) values ('x', 'evil')"), /permission_denied/);
  await refused(f, sql(f.page, f.other, "insert into staff (name, salary) values ('x', 99)"), /permission_denied/);
  // An explicit NULL still names the column.
  await refused(f, sql(f.page, f.other, "insert into staff (name, salary) values ('x', null)"), /permission_denied/);
  await refused(f, sql(f.page, f.other, "insert into staff (name, team) values ('x', 'black')"), 'check_violation');
  await refused(f, sql(f.page, f.other, "insert into staff (_id, name) values ('r_forged', 'x')"), 'validation_failed');
  await refused(f, sql(f.page, f.owner, "update staff set _id = 'r_forged'"), 'validation_failed');
  const ok = await sql(f.page, null, "insert into staff (name, team) values ('anon', 'blue')");
  expect(ok.status, JSON.stringify(ok.body)).toBe(200);
  // Anonymous reads names only, so that is what it gets back.
  expect(ok.body).toEqual({ affected: 1, returning: [{ _id: expect.stringMatching(/^r_/), name: 'anon' }] });
  expect((await stored(f.staff)).at(-1)).toEqual({ name: 'anon', team: 'blue', salary: null, page: f.page, by: 'anon' });
});

it('a DELETE without a filter deletes only what the delete rule admits; roles without a rule are refused', async () => {
  const f = await fixture();
  await sql(f.page, f.other, "insert into staff (name) values ('mine')");
  const gone = await sql(f.page, f.other, 'delete from staff');
  expect(gone.body.affected).toBe(1);
  expect((await stored(f.staff)).map((r) => r.name)).toEqual(['ada', 'bo']);
  await refused(f, sql(f.page, null, 'delete from staff'), /permission_denied/);
  await refused(f, sql(f.page, f.viewer, 'delete from staff'), /permission_denied/);
  await refused(f, sql(f.page, f.viewer, "insert into staff (name) values ('v')"), /permission_denied/);
  await refused(f, sql(f.page, null, "update staff set name = 'x'"), /permission_denied/);
  // The owner administers the dataset: every row, every column.
  expect((await sql(f.page, f.owner, 'update staff set salary = salary + 1')).body.affected).toBe(2);
  expect((await stored(f.staff)).map((r) => r.salary)).toEqual([11, 21]);
});

/* ------------------------------------------------------------------------- page, receipts and concurrency rules */

it('writes only on the head revision, never from a read-only page, and replays an Idempotency-Key', async () => {
  const f = await fixture();
  await refused(f, sql(f.page, f.other, "insert into staff (name) values ('old')", {}, { revision: '0' }));
  await refused(f, sql(f.page, f.other, "insert into staff (name) values ('ro')", {}, { readOnly: true }), 'permission_denied');
  const key = 'sql_door_key_0123456789';
  const first = await sql(f.page, f.other, 'insert into staff (name) values ($p0)', { p0: 'once' }, { key });
  expect(first.status, JSON.stringify(first.body)).toBe(200);
  expect(await sql(f.page, f.other, 'insert into staff (name) values ($p0)', { p0: 'once' }, { key })).toEqual(first);
  expect((await stored(f.staff)).filter((r) => r.name === 'once')).toHaveLength(1);
  // The same key for a different statement is refused.
  await refused(f, sql(f.page, f.other, 'insert into staff (name) values ($p0)', { p0: 'twice' }, { key }), 'validation_failed');
  expect((await sql(f.page, f.other, "insert into staff (name) values ('x')", {}, { key: 'bad key' })).status).toBe(400);
});

it('concurrent read-modify-write statements never lose an update', async () => {
  const f = await fixture();
  const replies = await Promise.all(Array.from({ length: 6 }, () => sql(f.page, f.owner, "update staff set salary = salary + 1 where name = 'ada'")));
  expect(replies.map((r) => r.body.affected)).toEqual([1, 1, 1, 1, 1, 1]);
  expect((await stored(f.staff))[0]!.salary).toBe(16);
});

/* ------------------------------------------------------------------------------------------- GraphQL parity */

it('parity: the same writes through GraphQL and SQL allow and deny alike and leave the same rows', async () => {
  const viaGraphql = await fixture(), viaSql = await fixture();
  const cases: Array<{ who: 'owner' | 'viewer' | 'other' | null; gql: string; sql: string }> = [
    { who: 'other', gql: 'mutation { insert_staff_one(object: {name: "cy", team: "red"}) { name } }', sql: "insert into staff (name, team) values ('cy', 'red')" },
    { who: 'other', gql: 'mutation { insert_staff_one(object: {name: "dee", team: "black"}) { name } }', sql: "insert into staff (name, team) values ('dee', 'black')" },
    { who: 'other', gql: 'mutation { insert_staff_one(object: {name: "x", salary: 5}) { name } }', sql: "insert into staff (name, salary) values ('x', 5)" },
    { who: 'other', gql: 'mutation { update_staff(where: {name: {_eq: "cy"}}, _set: {team: "green"}) { affected_rows } }', sql: "update staff set team = 'green' where name = 'cy'" },
    { who: 'other', gql: 'mutation { update_staff(where: {name: {_eq: "ada"}}, _set: {team: "green"}) { affected_rows } }', sql: "update staff set team = 'green' where name = 'ada'" },
    { who: 'other', gql: 'mutation { update_staff(where: {name: {_eq: "cy"}}, _set: {team: "black"}) { affected_rows } }', sql: "update staff set team = 'black' where name = 'cy'" },
    { who: null, gql: 'mutation { insert_staff_one(object: {name: "an", team: "t"}) { name } }', sql: "insert into staff (name, team) values ('an', 't')" },
    { who: null, gql: 'mutation { delete_staff(where: {}) { affected_rows } }', sql: 'delete from staff' },
    { who: 'viewer', gql: 'mutation { insert_staff_one(object: {name: "v"}) { name } }', sql: "insert into staff (name) values ('v')" },
    { who: 'owner', gql: 'mutation { update_staff(where: {name: {_eq: "bo"}}, _set: {salary: 21}) { affected_rows } }', sql: "update staff set salary = 21 where name = 'bo'" },
    { who: 'other', gql: 'mutation { delete_staff(where: {name: {_eq: "cy"}}) { affected_rows } }', sql: "delete from staff where name = 'cy'" },
  ];
  for (const c of cases) {
    const g = await gql(viaGraphql.page, c.who ? viaGraphql[c.who] : null, c.gql);
    const s = await sql(viaSql.page, c.who ? viaSql[c.who] : null, c.sql);
    const gAllowed = !g.body.errors?.length, sAllowed = s.status === 200;
    expect([c.sql, sAllowed], JSON.stringify({ g: g.body, s: s.body })).toEqual([c.sql, gAllowed]);
    if (gAllowed) {
      const field = Object.values(g.body.data ?? {})[0] as { affected_rows?: number } | null;
      if (field && 'affected_rows' in field) expect([c.sql, s.body.affected]).toEqual([c.sql, field.affected_rows]);
    } else if (g.body.errors?.[0]?.extensions?.code === 'check_violation') expect(s.body.error).toBe('check_violation');
    const strip = (rows: Array<Record<string, unknown>>, page: string, other: string) => rows.map((r) => ({ ...r, page: r.page === page ? 'PAGE' : r.page, by: r.by === other ? 'OTHER' : r.by }));
    expect(strip(await stored(viaSql.staff), viaSql.page, viaSql.other.userId!), c.sql).toEqual(strip(await stored(viaGraphql.staff), viaGraphql.page, viaGraphql.other.userId!));
  }
});

it('parity, deliberate divergence: SQL reaches only rows the reader can select, GraphQL every row in the update filter', async () => {
  const viaGraphql = await fixture(), viaSql = await fixture();
  // The viewer's update filter is every row, its select filter the red ones.
  expect((await gql(viaGraphql.page, viaGraphql.viewer, 'mutation { update_staff(where: {}, _set: {team: "red"}) { affected_rows } }')).body.data).toEqual({ update_staff: { affected_rows: 2 } });
  expect((await sql(viaSql.page, viaSql.viewer, "update staff set team = 'red'")).body).toEqual({ affected: 1, returning: [expect.objectContaining({ name: 'ada', team: 'red' })] });
  expect((await stored(viaSql.staff)).map((r) => r.team)).toEqual(['red', 'blue']);
});

/* ------------------------------------------------------------------------------- table naming and write-only roles */

it('names a multi-table link <link>.<table>, and a role that only inserts writes a table it cannot read', async () => {
  const owner = await person('owner2'), other = await person('other2');
  const teams = await publish(owner, { dataset: { kind: 'stored', defaultSchema: 'public', tables: [
    { schema: 'public', name: 'leads', rows: [{ team: 'red', lead: 'ada' }] },
    { schema: 'public', name: 'budgets', rows: [{ team: 'red', budget: 100 }] },
  ] }, title: 'Teams' });
  const signups = await publish(owner, { dataset: [{ email: 'first@example.com' }], title: 'Signups' });
  const db = await getDb();
  // Teams: signed_in reads both tables and may add budgets. Signups: anyone may add an email; nobody below editor reads one.
  await db.query('UPDATE artifacts SET dataset_policy=$2::jsonb, policy_revision=policy_revision+1 WHERE id=$1', [teams.body.id, JSON.stringify({ version: 3, tables: [
    { table: { schema: 'public', name: 'leads' }, select_permissions: [{ role: 'signed_in', permission: { columns: '*', filter: {} } }] },
    { table: { schema: 'public', name: 'budgets' }, select_permissions: [{ role: 'signed_in', permission: { columns: '*', filter: {} } }], insert_permissions: [{ role: 'signed_in', permission: { columns: ['team', 'budget'], check: {} } }] },
  ] })]);
  await db.query('UPDATE artifacts SET dataset_policy=$2::jsonb, policy_revision=policy_revision+1 WHERE id=$1', [signups.body.id, JSON.stringify({ version: 3, tables: [
    { table: ROWS, insert_permissions: [{ role: 'anonymous', permission: { columns: ['email'], check: {} } }, { role: 'signed_in', permission: { columns: ['email'], check: {} } }] },
  ] })]);
  const page = (await publish(owner, { html: `<html><head><link rel="af-dataset" data-af-name="teams" href="ref:${teams.body.id}"><link rel="af-dataset" data-af-name="signups" href="ref:${signups.body.id}"></head><body>x</body></html>` })).body.id;
  const f = { staff: teams.body.id, notes: signups.body.id };
  expect((await sql(page, other, 'select l.lead, b.budget from teams.leads l join teams.budgets b using (team)')).body.rows).toEqual([{ lead: 'ada', budget: 100 }]);
  const added = await sql(page, other, 'insert into teams.budgets (team, budget) select team, 5 from teams.leads');
  expect(added.body, JSON.stringify(added.body)).toMatchObject({ affected: 1, returning: [{ team: 'red', budget: 5 }] });
  await refused(f, sql(page, other, "insert into teams.leads (team, lead) values ('x', 'y')"), /permission_denied/);
  // Insert-only: the email column exists to write, holds NULL in every row the reader can see (none), and reads back nothing.
  const signed = await sql(page, null, 'insert into signups (email) values ($p0)', { p0: 'me@example.com' });
  expect(signed.body, JSON.stringify(signed.body)).toEqual({ affected: 1, returning: [] });
  expect((await stored(signups.body.id)).map((r) => r.email)).toEqual(['first@example.com', 'me@example.com']);
  expect((await sql(page, null, 'select count(*) as n from signups')).body.error).toBe('validation_failed');
  expect((await sql(page, null, "insert into signups (email) select email from signups")).body).toEqual({ affected: 0, returning: [] });
  await refused(f, sql(page, null, 'delete from signups'), /permission_denied/);
});


it('review: a pinned link cannot mutate the live dataset', async () => {
  const f = await fixture();
  const page = await publish(f.owner, { html: `<html><head><link rel="af-dataset" data-af-name="staff" href="ref:${f.staff}" data-af-mode="pinned" data-af-revision="1"></head><body>Pinned</body></html>` });
  expect(page.status).toBe(201);
  await refused(f, sql(page.body.id, f.other, "insert into staff (name) values ('pinned-write')"));
});

it('review: revoking a cross-link read after phase one prevents copying its data', async () => {
  const f = await fixture();
  const engine = services().sql;
  const original = engine.mutate.bind(engine);
  let revoked = false;
  const spy = vi.spyOn(engine, 'mutate').mockImplementation(async (input) => {
    const result = await original(input);
    if (!revoked && input.policy?.role === 'reader') {
      revoked = true;
      await (await getDb()).query('UPDATE artifacts SET dataset_policy=$2::jsonb, policy_revision=policy_revision+1 WHERE id=$1', [f.notes, JSON.stringify({ version: 3, tables: [] })]);
    }
    return result;
  });
  try {
    await refused(f, sql(f.page, f.other, 'insert into staff (name) select note from notes'));
  } finally { spy.mockRestore(); }
  expect(revoked).toBe(true);
});

it('review: generated SQL results obey the four MiB output budget', async () => {
  const f = await fixture();
  const reply = await sql(f.page, null, "select printf('%5000000s', 'x') as payload from staff limit 1");
  expect(reply.status).toBe(413);
});

it('review: SQLite expressions cannot expose hidden values or forge identities', async () => {
  const f = await fixture();
  for (const text of [
    "insert into staff (name) select value from json_each((select salary from staff limit 1))",
    "insert into staff (name) values ((select salary from staff limit 1))",
    "insert into staff (name) select first_value(salary) over () from staff",
    "with recursive r(v) as (select salary from staff union all select v from r limit 2) insert into staff (name) select v from r",
    "insert into staff (name) select note from notes where exists (select salary from staff)",
    "insert into staff (_id, name) select 'r_forged', name from staff",
    "update staff set _id = upper(_id)",
    "insert into staff (name) values ('x') on conflict(_id) do update set name = 'x'",
    "alter table staff add column leaked generated always as (salary)",
  ]) await refused(f, sql(f.page, null, text), 'validation_failed');
  const blank = await sql(f.page, null, "insert into staff (name) select name from staff where team is null");
  expect(blank.body.affected).toBe(2);
  const overflow = await sql(f.page, f.owner, 'select sum(n) as n from (select 9223372036854775807 as n union all select 9223372036854775807)');
  expect(overflow.status).toBeGreaterThanOrEqual(400);
  // Collations affect visible comparisons; they must not widen the policy's red-only view.
  const visible = await sql(f.page, f.viewer, "select name from staff where team = 'RED' collate nocase");
  expect(visible.body.rows).toEqual([{ name: 'ada' }]);
});

it('review: changing receipt keys cannot bypass the public mutation quota', async () => {
  const f = await fixture();
  const db = await getDb();
  const bucket = `mutation:${f.staff}:${Math.floor(Date.now() / 60000)}`;
  await db.query('INSERT INTO dataset_usage(bucket,calls) VALUES($1,30)', [bucket]);
  for (const key of ['review_quota_00000001', 'review_quota_00000002'])
    await refused(f, sql(f.page, null, "insert into staff (name) values ('quota')", {}, { key }));
});

it('charges the public-write rate limit once per call, even when the head moved and both phases ran again', async () => {
  const f = await fixture();
  const engine = services().sql;
  const original = engine.mutate.bind(engine);
  let moved = false, phases = 0;
  const spy = vi.spyOn(engine, 'mutate').mockImplementation(async (input) => {
    const result = await original(input);
    // A cold keyed write is asked twice (the miss answers rowsRequired, then the rows travel): count the runs.
    const ran = input.policy?.role === 'reader' && !('rowsRequired' in result && result.rowsRequired);
    if (ran) phases++;
    if (!moved && ran) {
      moved = true;
      // Another writer lands between phase one and the commit: the write re-runs on the new head.
      expect((await sql(f.page, f.owner, "update staff set salary = 99 where name = 'bo'")).body.affected).toBe(1);
    }
    return result;
  });
  try {
    expect((await sql(f.page, null, "insert into staff (name) values ('once')")).body.affected).toBe(1);
  } finally { spy.mockRestore(); }
  expect(phases).toBe(3); // the anonymous write twice, the owner's once
  const bucket = `mutation:${f.staff}:${Math.floor(Date.now() / 60000)}`;
  expect((await (await getDb()).query<{ calls: number }>('SELECT calls FROM dataset_usage WHERE bucket=$1', [bucket])).rows[0]?.calls).toBe(1);
});

it('bounds a write\'s reply and its receipt by the output budget; the write stands', async () => {
  const f = await fixture();
  const key = 'sql_door_big_reply_0001';
  const big = await sql(f.page, f.owner, "insert into staff (name) values (printf('%5000000s', 'x'))", {}, { key });
  expect(big.status, JSON.stringify(big.body).slice(0, 300)).toBe(200);
  expect(big.body).toEqual({ affected: 1, returning: [], returningOmitted: 'result_too_large' });
  expect(String((await stored(f.staff)).at(-1)!.name).length).toBe(5000000);
  const receipt = (await (await getDb()).query<{ size: number }>('SELECT octet_length(response::text) AS size FROM mutation_receipts ORDER BY created_at DESC LIMIT 1')).rows[0]!;
  expect(receipt.size).toBeLessThan(1000);
  expect(await sql(f.page, f.owner, "insert into staff (name) values (printf('%5000000s', 'x'))", {}, { key })).toEqual(big);
});


it('adversarial: receipt replay must not return columns hidden by the current role', async () => {
  const f = await fixture(), db = await getDb();
  await db.query("UPDATE artifact_shares SET role='editor' WHERE artifact_id=$1 AND user_id=$2", [f.staff, f.viewer.userId]);
  const text = "update staff set team = 'red' where name = 'ada'", key = 'review_stale_receipt_001';
  const first = await sql(f.page, f.viewer, text, {}, { key });
  expect(first.status).toBe(200);
  expect(first.body.returning?.[0]?.salary).toBe(10);
  await db.query("UPDATE artifact_shares SET role='viewer' WHERE artifact_id=$1 AND user_id=$2", [f.staff, f.viewer.userId]);
  expect((await sql(f.page, f.viewer, 'select salary from staff')).status).toBeGreaterThanOrEqual(400);
  const replay = await sql(f.page, f.viewer, text, {}, { key });
  expect(JSON.stringify(replay.body)).not.toContain('salary');
});


it('adversarial: removing a page link after phase one prevents the write commit', async () => {
  const f = await fixture(), engine = services().sql, original = engine.mutate.bind(engine);
  let moved = false;
  const spy = vi.spyOn(engine, 'mutate').mockImplementation(async (input) => {
    const result = await original(input);
    if (!moved && input.policy?.role === 'reader' && !('rowsRequired' in result && result.rowsRequired)) {
      moved = true;
      await (await getDb()).query("UPDATE artifacts SET meta=jsonb_set(meta, '{htmlLinks}', '[]'::jsonb), version=version+1 WHERE id=$1", [f.page]);
    }
    return result;
  });
  try { await refused(f, sql(f.page, f.other, "insert into staff (name) values ('removed-link')")); }
  finally { spy.mockRestore(); }
  expect(moved).toBe(true);
});

it('GraphQL too: a receipt replayed under a narrower role does not show the rows again', async () => {
  const f = await fixture(), db = await getDb();
  await db.query("UPDATE artifact_shares SET role='editor' WHERE artifact_id=$1 AND user_id=$2", [f.staff, f.viewer.userId]);
  const text = 'mutation { update_staff(where: {name: {_eq: "bo"}}, _set: {team: "blue"}) { affected_rows returning { name team } } }', key = 'gql_stale_receipt_0001';
  const first = await gql(f.page, f.viewer, text, undefined, key);
  expect(first.body.data?.update_staff).toEqual({ affected_rows: 1, returning: [{ name: 'bo', team: 'blue' }] });
  // As a viewer again, bo (blue) is outside the select filter; the update root still exists (filter {}).
  await db.query("UPDATE artifact_shares SET role='viewer' WHERE artifact_id=$1 AND user_id=$2", [f.staff, f.viewer.userId]);
  const replay = await gql(f.page, f.viewer, text, undefined, key);
  // Authority changed: the count is the recorded rows the reader sees now (bo is outside the red filter).
  expect(replay.body.data?.update_staff).toEqual({ affected_rows: 0, returning: [] });
  // Never executed again.
  expect((await stored(f.staff)).map((r) => r.team)).toEqual(['red', 'blue']);
});

it('GraphQL too: removing a page link while a mutation runs refuses its commit', async () => {
  const f = await fixture(), engine = services().sql, original = engine.mutate.bind(engine);
  let moved = false;
  const spy = vi.spyOn(engine, 'mutate').mockImplementation(async (input) => {
    const result = await original(input);
    if (!moved) {
      moved = true;
      await (await getDb()).query("UPDATE artifacts SET meta=jsonb_set(meta, '{htmlLinks}', '[]'::jsonb), version=version+1 WHERE id=$1", [f.page]);
    }
    return result;
  });
  const before = await stored(f.staff);
  let reply;
  try { reply = await gql(f.page, f.other, 'mutation { insert_staff_one(object: {name: "removed-link"}) { name } }'); }
  finally { spy.mockRestore(); }
  expect(moved).toBe(true);
  // The guard refused the commit; the page no longer holds, so even that refusal leaves as the uniform 404.
  expect(reply.status).toBe(404);
  expect(reply.body.data ?? null).toBeNull();
  expect(await stored(f.staff)).toEqual(before);
});


it('review2: legacy SQL receipts fail closed after role narrowing', async () => {
  const f = await fixture(), db = await getDb();
  await db.query("UPDATE artifact_shares SET role='editor' WHERE artifact_id=$1 AND user_id=$2", [f.staff, f.viewer.userId]);
  const text = "update staff set team = 'red' where name = 'ada'", key = 'review2_legacy_sql_0001';
  expect((await sql(f.page, f.viewer, text, {}, { key })).body.returning?.[0]?.salary).toBe(10);
  await db.query("UPDATE mutation_receipts SET response=jsonb_set(response, '{body}', (response->'body') - '__afReadShape')");
  await db.query("UPDATE artifact_shares SET role='viewer' WHERE artifact_id=$1 AND user_id=$2", [f.staff, f.viewer.userId]);
  const replay = await sql(f.page, f.viewer, text, {}, { key });
  // Superseded contract (review 3): no omission marker; a legacy receipt counts only what is visible now (ada is red).
  expect(replay.body).toEqual({ affected: 1, returning: [] });
});

it('review2: GraphQL aliases cannot bypass receipt redaction', async () => {
  const f = await fixture(), db = await getDb();
  await db.query("UPDATE artifact_shares SET role='editor' WHERE artifact_id=$1 AND user_id=$2", [f.staff, f.viewer.userId]);
  const text = 'mutation { update_staff(where: {name: {_eq: "bo"}}, _set: {team: "blue"}) { affected_rows leaked: returning { name team } } }', key = 'review2_gql_alias_0001';
  expect((await gql(f.page, f.viewer, text, undefined, key)).body.data?.update_staff.leaked).toEqual([{ name: 'bo', team: 'blue' }]);
  await db.query("UPDATE artifact_shares SET role='viewer' WHERE artifact_id=$1 AND user_id=$2", [f.staff, f.viewer.userId]);
  expect((await gql(f.page, f.viewer, text, undefined, key)).body.data?.update_staff).toEqual({ affected_rows: 0, leaked: [] });
});

it('review2: resolver caps.query loses page authority before commit', async () => {
  const f = await fixture(), engine = services().sql, original = engine.mutate.bind(engine);
  const before = await stored(f.staff);
  let moved = false;
  const spy = vi.spyOn(engine, 'mutate').mockImplementation(async input => {
    const result = await original(input);
    if (!moved) {
      moved = true;
      await (await getDb()).query("UPDATE artifacts SET visibility='private', sharing_revision=sharing_revision+1 WHERE id=$1", [f.page]);
    }
    return result;
  });
  try {
    await resolverDatasets.query!({pageId: f.page, caller: {subject: f.other.userId!, role: 'viewer'}, operation: 'mutation', args: {query: 'mutation { insert_staff_one(object: {name: "revoked-resolver"}) { name } }'}}).catch(() => null);
  } finally { spy.mockRestore(); }
  expect(moved).toBe(true);
  expect(await stored(f.staff)).toEqual(before);
});

it('review2: same role with changed filter withholds SQL receipt rows', async () => {
  const f = await fixture(), db = await getDb();
  const text = "update staff set team = 'red' where name = 'ada'", key = 'review2_same_role_0001';
  expect((await sql(f.page, f.viewer, text, {}, {key})).body.returning).toHaveLength(1);
  const policy = structuredClone(POLICY);
  policy.tables[0]!.select_permissions[0]!.permission.filter = { team: { _eq: 'blue' } };
  await db.query('UPDATE artifacts SET dataset_policy=$2::jsonb, policy_revision=policy_revision+1 WHERE id=$1', [f.staff, JSON.stringify(policy)]);
  expect((await sql(f.page, f.viewer, text, {}, {key})).body).toEqual({affected: 0, returning: []});
});


it.each(['sql', 'graphql'] as const)('review2: %s replay checks page access again before disclosing rows', async door => {
  const f = await fixture(), db = await getDb();
  const text = door === 'sql' ? "insert into staff (name) values ('replay-secret')" : 'mutation { insert_staff_one(object: {name: "replay-secret"}) { name } }';
  const key = 'review2_revoke_replay_001';
  const call = () => door === 'sql' ? sql(f.page, f.other, text, {}, {key}) : gql(f.page, f.other, text, undefined, key);
  expect((await call()).status).toBe(200);
  const query = db.query.bind(db);
  let revoked = false;
  const spy = vi.spyOn(db, 'query').mockImplementation(async (statement, values) => {
    const result = await query(statement, values);
    if (!revoked && statement.startsWith('SELECT request_hash,response,created_at FROM mutation_receipts')) {
      revoked = true;
      await query("UPDATE artifacts SET visibility='private', sharing_revision=sharing_revision+1 WHERE id=$1", [f.page]);
    }
    return result;
  });
  try {
    const replay = await call();
    expect(revoked).toBe(true);
    expect(replay.status, JSON.stringify(replay.body)).toBe(404);
  } finally { spy.mockRestore(); }
});

it('review2: legacy GraphQL receipts fail closed', async () => {
  const f = await fixture(), db = await getDb();
  await db.query("UPDATE artifact_shares SET role='editor' WHERE artifact_id=$1 AND user_id=$2", [f.staff, f.viewer.userId]);
  const bulk = 'mutation { update_staff(where: {name: {_eq: "bo"}}, _set: {team: "blue"}) { affected_rows returning { name } } }';
  const key = 'review2_legacy_gql_0001';
  expect((await gql(f.page, f.viewer, bulk, undefined, key)).body.data?.update_staff.returning).toEqual([{name: 'bo'}]);
  await db.query("UPDATE mutation_receipts SET response=jsonb_set(response, '{body}', (response->'body') - '__afReadShape')");
  await db.query("UPDATE artifact_shares SET role='viewer' WHERE artifact_id=$1 AND user_id=$2", [f.staff, f.viewer.userId]);
  expect((await gql(f.page, f.viewer, bulk, undefined, key)).body.data?.update_staff).toEqual({affected_rows: 0, returning: []});
});


it('review2: a fresh GraphQL reply uses authority valid at commit', async () => {
  const f = await fixture(), db = await getDb();
  await db.query("UPDATE artifact_shares SET role='editor' WHERE artifact_id=$1 AND user_id=$2", [f.staff, f.viewer.userId]);
  const query = db.query.bind(db);
  let revoked = false;
  const spy = vi.spyOn(db, 'query').mockImplementation(async (statement, values) => {
    const result = await query(statement, values);
    if (!revoked && statement.startsWith('INSERT INTO mutation_receipts')) {
      revoked = true;
      await query("UPDATE artifact_shares SET role='viewer' WHERE artifact_id=$1 AND user_id=$2", [f.staff, f.viewer.userId]);
    }
    return result;
  });
  try {
    const reply = await gql(f.page, f.viewer, 'mutation { update_staff(where: {name: {_eq: "bo"}}, _set: {team: "blue"}) { affected_rows returning { name team } } }');
    expect(revoked).toBe(true);
    expect(JSON.stringify(reply.body)).not.toContain('bo');
  } finally { spy.mockRestore(); }
});


it('review2: different users cannot share a receipt by choosing the same key', async () => {
  const f = await fixture();
  const text = "update staff set team = 'blue' where name = 'bo'", key = 'review2_other_actor_0001';
  const first = await sql(f.page, f.owner, text, {}, {key});
  const second = await sql(f.page, f.viewer, text, {}, {key});
  expect(first.body.affected).toBe(1);
  expect(second.body, JSON.stringify(second.body)).toMatchObject({affected: 0, returning: []});
});

it.each(['private', 'deleted'] as const)('review2: page %s before replay is refused at admission', async mode => {
  const f = await fixture(), db = await getDb();
  const text = "insert into staff (name) values ('old-receipt')", key = 'review2_gone_page_0001';
  expect((await sql(f.page, f.other, text, {}, {key})).status).toBe(200);
  await db.query(mode === 'private' ? "UPDATE artifacts SET visibility='private' WHERE id=$1" : 'UPDATE artifacts SET deleted_at=now() WHERE id=$1', [f.page]);
  expect((await sql(f.page, f.other, text, {}, {key})).status).toBe(404);
});

it('review2: page group membership revoked before the transaction prevents commit', async () => {
  const f = await fixture(), db = await getDb();
  const group = await createGroup(f.owner.userId!, {handle: 'review2_group', name: 'Review group'});
  await admitGroupMember(f.owner.userId!, group.id, f.other.userId!, 'viewer');
  await db.query("UPDATE artifacts SET visibility='private' WHERE id=$1", [f.page]);
  await db.query("INSERT INTO artifact_group_shares(artifact_id,group_id,role,created_by) VALUES($1,$2,'viewer',$3)", [f.page, group.id, f.owner.userId]);
  const engine = services().sql, original = engine.mutate.bind(engine);
  let revoked = false;
  const spy = vi.spyOn(engine, 'mutate').mockImplementation(async input => {
    const result = await original(input);
    if (!revoked && input.policy?.role === 'reader' && !('rowsRequired' in result && result.rowsRequired)) {
      revoked = true;
      await removeGroupMember(f.owner.userId!, group.id, f.other.userId!);
    }
    return result;
  });
  try { await refused(f, sql(f.page, f.other, "insert into staff (name) values ('revoked-group')")); }
  finally { spy.mockRestore(); }
  expect(revoked).toBe(true);
});

it('receipts keep the outcome identity, never rows; a replay answers the rows as they are now', async () => {
  const f = await fixture(), db = await getDb();
  const key = 'receipt_no_rows_00001';
  const first = await sql(f.page, f.owner, "update staff set salary = 77 where name = 'bo'", {}, { key });
  expect(first.body).toMatchObject({ affected: 1, returning: [{ name: 'bo', salary: 77 }] });
  const saved = (await db.query<{ response: unknown }>('SELECT response FROM mutation_receipts')).rows.map((r) => JSON.stringify(r.response)).join('\n');
  expect(saved).not.toMatch(/"bo"|"salary"|"returning"/);
  expect(saved).toContain('__afOutcome');
  // Another write changes the row; the replay is not run again and shows the row's current visible state.
  await sql(f.page, f.owner, "update staff set salary = 78 where name = 'bo'");
  const replay = await sql(f.page, f.owner, "update staff set salary = 77 where name = 'bo'", {}, { key });
  expect(replay.body).toMatchObject({ affected: 1, returning: [{ name: 'bo', salary: 78 }] });
  expect((await stored(f.staff))[1]!.salary).toBe(78);
  // GraphQL receipts too.
  const gkey = 'receipt_no_rows_gql_01';
  await gql(f.page, f.owner, 'mutation { update_staff(where: {name: {_eq: "ada"}}, _set: {salary: 55}) { affected_rows a: returning { name salary } } }', undefined, gkey);
  const all = (await db.query<{ response: unknown }>('SELECT response FROM mutation_receipts')).rows.map((r) => JSON.stringify(r.response)).join('\n');
  expect(all).not.toMatch(/"ada"|"salary"|"returning"|"a":/);
});

it('a fresh SQL reply shows its rows under the read access that holds at commit', async () => {
  const f = await fixture(), db = await getDb();
  await db.query("UPDATE artifact_shares SET role='editor' WHERE artifact_id=$1 AND user_id=$2", [f.staff, f.viewer.userId]);
  const query = db.query.bind(db);
  let revoked = false;
  const spy = vi.spyOn(db, 'query').mockImplementation(async (statement, values) => {
    const result = await query(statement, values);
    if (!revoked && statement.startsWith('INSERT INTO mutation_receipts')) {
      revoked = true;
      await query("UPDATE artifact_shares SET role='viewer' WHERE artifact_id=$1 AND user_id=$2", [f.staff, f.viewer.userId]);
    }
    return result;
  });
  try {
    // ada is red (still visible as a viewer), but salary is not: the reply never shows it.
    const reply = await sql(f.page, f.viewer, "update staff set team = 'red' where name = 'ada'");
    expect(revoked).toBe(true);
    expect(JSON.stringify(reply.body)).not.toContain('salary');
  } finally { spy.mockRestore(); }
});

it('review3: hidden rows do not contribute to a narrowed replay count', async () => {
  const f = await fixture(), db = await getDb();
  await db.query("UPDATE artifact_shares SET role='editor' WHERE artifact_id=$1 AND user_id=$2", [f.staff, f.viewer.userId]);
  const text = "update staff set team='blue' where name='bo'", key = 'review3_hidden_count_001';
  await sql(f.page, f.viewer, text, {}, {key}); // model a committed write whose reply was lost
  await db.query("UPDATE artifact_shares SET role='viewer' WHERE artifact_id=$1 AND user_id=$2", [f.staff, f.viewer.userId]);
  const reply = await sql(f.page, f.viewer, text, {}, {key});
  expect(reply.body.returning).toEqual([]);
  expect(reply.body.affected).toBe(0);
});

it('review3: malformed requests do not distinguish an unreadable page from a missing page', async () => {
  const f = await fixture(), db = await getDb();
  await db.query("UPDATE artifacts SET visibility='private' WHERE id=$1", [f.page]);
  const call = async (id: string) => {
    const response = await sqlPost(request(`/api/artifacts/${id}/sql`, {method:'POST', json:{}, token:f.other.token}), params(id));
    return {status:response.status, body:await response.json()};
  };
  expect(await call(f.page)).toEqual(await call('missing_review3_page'));
});

it.each(['graphql', 'resolver'] as const)('review3: a group revoke between dataset authorization and page locks prevents %s commit', async door => {
  const f = await fixture(), db = await getDb();
  const group = await createGroup(f.owner.userId!, {handle:'review3_group', name:'Review group'});
  await admitGroupMember(f.owner.userId!, group.id, f.other.userId!, 'viewer');
  await db.query("INSERT INTO artifact_group_shares(artifact_id,group_id,role,created_by) VALUES($1,$2,'editor',$3)", [f.staff, group.id, f.owner.userId]);
  const before = await stored(f.staff), transaction = db.transaction.bind(db);
  let revoked = false;
  // Simulate the READ COMMITTED interleaving: membership disappears after assertWriteCommit's
  // decision, immediately before the newly added page locks. No snapshot/lock was held over it yet.
  const spy = vi.spyOn(db, 'transaction').mockImplementation(callback => transaction(async tx => {
    const query = tx.query.bind(tx);
    return callback({...tx, query: async (statement, values) => {
      if (!revoked && statement.includes('FROM artifact_group_shares s JOIN group_members m') /* review 4: the decision's own group fact, locked as it is read */) {
        revoked = true;
        await query('DELETE FROM group_members WHERE group_id=$1 AND user_id=$2', [group.id, f.other.userId]);
      }
      return query(statement, values);
    }});
  }));
  try {
    const query = 'mutation { update_staff(where: {}, _set: {team: "black"}) { affected_rows } }';
    if (door === 'graphql') await gql(f.page, f.other, query);
    else await resolverDatasets.query!({pageId:f.page, caller:{subject:f.other.userId!, role:'viewer'}, operation:'mutation', args:{query}});
  } finally { spy.mockRestore(); }
  expect(revoked).toBe(true);
  expect(await stored(f.staff)).toEqual(before);
});


it('review3: sharing edits and the write guard agree on page/share lock order', async () => {
  const f = await fixture(), db = await getDb(), transaction = db.transaction.bind(db);
  await db.query("INSERT INTO artifact_shares(artifact_id,user_id,email,role) VALUES($1,$2,$3,'viewer')", [f.page, f.other.userId, f.other.email]);
  // Review 4 (lock only what the decision reads): the page is private, so the reader's access IS its page share.
  await db.query("UPDATE artifacts SET visibility='private' WHERE id=$1", [f.page]);
  const traces: string[][] = [];
  const spy = vi.spyOn(db, 'transaction').mockImplementation(callback => transaction(async tx => {
    const trace: string[] = []; traces.push(trace);
    const query = tx.query.bind(tx);
    return callback({...tx, query: async (statement, values) => {
      if (values?.[0] === f.page) {
        if (statement.includes('FROM artifacts') && /FOR (UPDATE|SHARE)/.test(statement)) trace.push('page');
        if ((statement.includes('FROM artifact_shares') && statement.includes('FOR SHARE')) || statement.startsWith('DELETE FROM artifact_shares')) trace.push('shares');
      }
      return query(statement, values);
    }});
  }));
  try {
    expect((await sql(f.page, f.other, "insert into staff (name) values ('through-share')")).status).toBe(200);
    await updateSharingFor(f.owner.actor, f.page, {shares:[]});
  } finally { spy.mockRestore(); }
  const orders = traces.filter(t => t.includes('page') && t.includes('shares')).map(t => [...new Set(t)]);
  expect(orders).toHaveLength(2);
  expect(orders[0]).toEqual(orders[1]);
});

it('review3 (SQL door too): a group revoke between dataset authorization and page locks prevents the commit', async () => {
  const f = await fixture(), db = await getDb();
  const group = await createGroup(f.owner.userId!, {handle:'review3_sql_group', name:'Review group'});
  await admitGroupMember(f.owner.userId!, group.id, f.other.userId!, 'viewer');
  await db.query("INSERT INTO artifact_group_shares(artifact_id,group_id,role,created_by) VALUES($1,$2,'editor',$3)", [f.staff, group.id, f.owner.userId]);
  const before = await stored(f.staff), transaction = db.transaction.bind(db);
  let revoked = false;
  const spy = vi.spyOn(db, 'transaction').mockImplementation(callback => transaction(async tx => {
    const query = tx.query.bind(tx);
    return callback({...tx, query: async (statement, values) => {
      if (!revoked && statement.includes('FROM artifact_group_shares s JOIN group_members m') /* review 4: the decision's own group fact, locked as it is read */) {
        revoked = true;
        await query('DELETE FROM group_members WHERE group_id=$1 AND user_id=$2', [group.id, f.other.userId]);
      }
      return query(statement, values);
    }});
  }));
  try { await sql(f.page, f.other, "update staff set team = 'black'"); }
  finally { spy.mockRestore(); }
  expect(revoked).toBe(true);
  expect(await stored(f.staff)).toEqual(before);
});

it.each(['sql', 'graphql'] as const)('a private page answers malformed requests and bad Idempotency-Keys exactly as a missing one (%s)', async (door) => {
  const f = await fixture(), db = await getDb();
  await db.query("UPDATE artifacts SET visibility='private' WHERE id=$1", [f.page]);
  const route = door === 'sql' ? sqlPost : graphqlPost;
  const call = async (id: string, json: unknown, headers: Record<string, string> = {}) => {
    const response = await route(request(`/api/artifacts/${id}/${door}`, { method: 'POST', json, token: f.other.token, headers }), params(id));
    return { status: response.status, body: await response.json() };
  };
  const valid = door === 'sql' ? { sql: 'select 1', revision: '1' } : { query: '{ __typename }', revision: '1' };
  for (const [json, headers] of [[{}, {}], [{ revision: 7 }, {}], [valid, { 'Idempotency-Key': 'bad key' }]] as const) {
    expect(await call(f.page, json, headers)).toEqual(await call('missing_page_000', json, headers));
  }
});

/**
 * THE LOCK ORDER, traced (lib/artifact-access locks.ts). Every guarded path locks its artifacts first, by tier
 * (documents: the page, then datasets) and within a tier by the shared `lockOrder`, before any fact; facts then lock
 * themselves as the decision reads them, in no fixed order between them (the retry is the net for that). Only the
 * FIRST lock of a row counts (re-reading a row already held takes nothing new). The competing writers that cannot
 * follow it (a group deletion, a test user's erasure, a group-owned publish) take a fact first: for them only the
 * artifact order is checked, and each is proven to retry its whole transaction (below).
 */
it('every writer locks its artifacts by tier and lockOrder, before its facts', async () => {
  const f = await fixture(), db = await getDb(), transaction = db.transaction.bind(db);
  const group = await createGroup(f.owner.userId!, { handle: 'lock_order_group', name: 'Lock order' });
  await admitGroupMember(f.owner.userId!, group.id, f.other.userId!, 'viewer');
  const doomed = await createGroup(f.owner.userId!, { handle: 'lock_order_doomed', name: 'Doomed' });
  const formats = new Map((await db.query<{ id: string; format: string }>('SELECT id, format FROM artifacts')).rows.map((r) => [r.id, r.format]));
  const isArtifactLock = (s: string) => / FOR (UPDATE|SHARE)/.test(s) && /FROM artifacts\b/.test(s) && !/JOIN/.test(s);
  const isFact = (s: string) => / FOR (UPDATE|SHARE)/.test(s) && /FROM (artifact_shares|artifact_group_shares|groups|group_members|users)\b/.test(s)
    || /^(DELETE FROM|UPDATE) (artifact_shares|artifact_group_shares|group_members)\b/.test(s);
  const traces: Array<{ path: string; problems: string[]; artifacts: string[]; facts: number }> = [];
  let path = '';
  const spy = vi.spyOn(db, 'transaction').mockImplementation((callback) => transaction(async (tx) => {
    const trace = { path, problems: [] as string[], artifacts: [] as string[], facts: 0 }, seen = new Set<string>(), query = tx.query.bind(tx);
    traces.push(trace);
    let last: [number, string] | null = null;
    return callback({ ...tx, query: async (statement: string, values?: unknown[]) => {
      const s = statement.replace(/\s+/g, ' ').trim();
      if (isArtifactLock(s) && typeof values?.[0] === 'string' && !seen.has(values[0])) {
        const id = values[0];
        seen.add(id); trace.artifacts.push(id);
        const key: [number, string] = [formats.get(id) === 'dataset' ? 1 : 0, id];
        if (trace.facts && !/^(group|test user|group-owned)/.test(path)) trace.problems.push(`artifact ${id} after a fact`);
        if (last && (key[0] < last[0] || (key[0] === last[0] && lockOrder(key[1], last[1]) < 0))) trace.problems.push(`artifact ${id} out of tier/lockOrder after ${last[1]}`);
        last = key;
      } else if (isFact(s)) trace.facts++;
      return query(statement, values as never);
    } } as never);
  }));
  try {
    path = 'sql door'; await sql(f.page, f.other, "insert into staff (name) values ('o1')");
    path = 'sql door, cross-link read'; await sql(f.page, f.other, 'insert into staff (name) select note from notes');
    path = 'graphql'; await gql(f.page, f.other, 'mutation { insert_staff_one(object: {name: "o2"}) { name } }');
    path = 'resolver'; await resolverDatasets.query!({ pageId: f.page, caller: { subject: f.other.userId!, role: 'viewer' }, operation: 'mutation', args: { query: 'mutation { insert_staff_one(object: {name: "o3"}) { name } }' } });
    path = 'sharing'; await updateSharingFor(f.owner.actor, f.page, { shares: [] });
    path = 'group share'; await setArtifactGroupShare(f.owner.actor, f.page, group.id, 'viewer');
    path = 'group member'; await removeGroupMember(f.owner.userId!, group.id, f.other.userId!);
    path = 'group-owned publish'; await createArtifact(null, f.owner.userId, { format: 'html', source: '<p>group page</p>', meta: {}, title: 'Group page', destination: { type: 'group', id: group.id } });
    path = 'group deletion'; await deleteGroup(f.owner.userId!, doomed.id, 'lock_order_doomed');
  } finally { spy.mockRestore(); }
  const bad = traces.filter((t) => t.problems.length);
  expect(bad, JSON.stringify(bad)).toEqual([]);
  // Each path locked something it is pinned for; the guarded ones locked their page before the dataset.
  // (A test user's erasure, the third competing writer, is pinned in lib/operations' own test: testusers-erase.test.ts.)
  for (const p of ['sql door', 'sql door, cross-link read', 'graphql', 'resolver', 'sharing', 'group share', 'group member', 'group-owned publish', 'group deletion'])
    expect(traces.some((t) => t.path === p && (t.artifacts.length || t.facts)), p).toBe(true);
  for (const p of ['sql door', 'graphql', 'resolver']) expect(traces.find((t) => t.path === p && t.artifacts.length)?.artifacts.slice(0, 2), p).toEqual([f.page, f.staff]);
  expect(traces.find((t) => t.path === 'sql door, cross-link read' && t.artifacts.length)?.artifacts.slice(0, 3)).toEqual([f.page, ...[f.staff, f.notes].sort(lockOrder)]);
});

/**
 * THE SAFETY NET, per writer: a transaction Postgres aborts with 40P01 (deadlock) or 40001 (serialization) is retried
 * WHOLE, and the write lands exactly once; past the bound it is refused as a retryable conflict and nothing lands.
 * PGLite never deadlocks, so the abort is injected into the first attempt(s) of the writer's transaction.
 */
describe('retry on deadlock and serialization failure', () => {
  const failing = (db: Awaited<ReturnType<typeof getDb>>, failures: number, code = '40P01') => {
    const transaction = db.transaction.bind(db);
    let left = failures;
    return vi.spyOn(db, 'transaction').mockImplementation((callback) => {
      if (left-- > 0) return transaction(async (tx) => { await callback(tx); throw Object.assign(new Error('deadlock detected'), { code }); });
      return transaction(callback);
    });
  };
  it.each(['40P01', '40001'])('guarded writes (SQL door, page GraphQL, caps.query) retry whole and apply once (%s)', async (code) => {
    const f = await fixture(), db = await getDb();
    for (const [door, write] of [
      ['sql', () => sql(f.page, f.other, "insert into staff (name) values ('retried-sql')")],
      ['graphql', () => gql(f.page, f.other, 'mutation { insert_staff_one(object: {name: "retried-gql"}) { name } }')],
      ['resolver', () => resolverDatasets.query!({ pageId: f.page, caller: { subject: f.other.userId!, role: 'viewer' }, operation: 'mutation', args: { query: 'mutation { insert_staff_one(object: {name: "retried-resolver"}) { name } }' } })],
    ] as const) {
      const spy = failing(db, 1, code);
      try { await write(); } finally { spy.mockRestore(); }
      expect([door, (await stored(f.staff)).filter((r) => String(r.name).startsWith(`retried-${door === 'sql' ? 'sql' : door === 'graphql' ? 'gql' : 'resolver'}`)).length]).toEqual([door, 1]);
    }
  });
  it('an exhausted retry is a clean retryable conflict, nothing is written, and its key replays the refusal', async () => {
    const f = await fixture(), db = await getDb();
    const before = await stored(f.staff), key = 'conflict_exhausted_0001';
    const spy = failing(db, 50);
    let reply, graphql;
    try {
      reply = await sql(f.page, f.other, "insert into staff (name) values ('never')", {}, { key });
      graphql = await gql(f.page, f.other, 'mutation { insert_staff_one(object: {name: "never"}) { name } }');
    } finally { spy.mockRestore(); }
    expect(reply).toMatchObject({ status: 409, body: { error: 'dataset_changed' } });
    expect(graphql.body.errors?.[0]?.extensions?.code).toBe('dataset_changed');
    expect(graphql.body.data?.insert_staff_one ?? null).toBeNull();
    expect(await stored(f.staff)).toEqual(before);
    // The receipt recorded the refusal: replaying the key never writes it later.
    expect(await sql(f.page, f.other, "insert into staff (name) values ('never')", {}, { key })).toEqual(reply);
    expect(await stored(f.staff)).toEqual(before);
  });
  // A test user's erasure, the third competing writer, is pinned in lib/operations' own test (testusers-erase.test.ts).
  it('the competing writers (group deletion, group-owned publish, replace) retry whole', async () => {
    const f = await fixture(), db = await getDb();
    const doomed = await createGroup(f.owner.userId!, { handle: 'retry_doomed', name: 'Doomed' });
    const team = await createGroup(f.owner.userId!, { handle: 'retry_team', name: 'Team' });
    let spy = failing(db, 1);
    try { await deleteGroup(f.owner.userId!, doomed.id, 'retry_doomed'); } finally { spy.mockRestore(); }
    expect((await db.query('SELECT 1 FROM groups WHERE id=$1 AND deleted_at IS NOT NULL', [doomed.id])).rows).toHaveLength(1);
    spy = failing(db, 1);
    let created;
    try { created = await createArtifact(null, f.owner.userId, { format: 'html', source: '<p>team</p>', meta: {}, title: 'Team page', destination: { type: 'group', id: team.id } }); } finally { spy.mockRestore(); }
    expect((await db.query('SELECT 1 FROM artifacts WHERE group_id=$1', [team.id])).rows).toHaveLength(1);
    expect(created.group_id).toBe(team.id);
    // A replace (republishing the page) too.
    spy = failing(db, 1);
    let replaced;
    try { replaced = await replaceArtifactFor(f.owner.actor, created.id, { format: 'html', source: '<p>team v2</p>', meta: {}, title: 'Team page' }, { expectedVersion: 1 }); } finally { spy.mockRestore(); }
    expect(replaced && 'version' in replaced ? replaced.version : replaced instanceof Response ? await replaced.text() : replaced).toBe(2);
    // Exhausted: a retryable TransactionConflict, nothing created.
    spy = failing(db, 50);
    try { await expect(createArtifact(null, f.owner.userId, { format: 'html', source: '<p>x</p>', meta: {}, title: 'Never', destination: { type: 'group', id: team.id } })).rejects.toBeInstanceOf(TransactionConflict); } finally { spy.mockRestore(); }
    expect((await db.query('SELECT 1 FROM artifacts WHERE group_id=$1', [team.id])).rows).toHaveLength(1);
  });
});

it('under unchanged authority a replay keeps its original counts, even for rows since gone', async () => {
  const f = await fixture();
  const key = 'replay_same_authority_01';
  await sql(f.page, f.other, "insert into staff (name) values ('gone')");
  expect((await sql(f.page, f.other, "delete from staff where name = 'gone'", {}, { key })).body.affected).toBe(1);
  expect(await sql(f.page, f.other, "delete from staff where name = 'gone'", {}, { key })).toMatchObject({ status: 200, body: { affected: 1, returning: [] } });
  const gkey = 'replay_same_authority_g1';
  await gql(f.page, f.other, 'mutation { insert_staff_one(object: {name: "gone2"}) { name } }');
  const del = 'mutation { delete_staff(where: {name: {_eq: "gone2"}}) { affected_rows } }';
  expect((await gql(f.page, f.other, del, undefined, gkey)).body.data?.delete_staff).toEqual({ affected_rows: 1 });
  expect((await gql(f.page, f.other, del, undefined, gkey)).body.data?.delete_staff).toEqual({ affected_rows: 1 });
});

it('a dataset GraphQL endpoint answers a non-reader\'s malformed request exactly as a missing id, a reader 400', async () => {
  const f = await fixture(), db = await getDb();
  await db.query("UPDATE artifacts SET visibility='private' WHERE id=$1", [f.notes]);
  const call = async (id: string, who: Person) => {
    const response = await graphqlPost(request(`/api/artifacts/${id}/graphql`, { method: 'POST', json: { query: 7 }, token: who.token }), params(id));
    return { status: response.status, body: await response.json() };
  };
  expect(await call(f.notes, f.other)).toEqual(await call('missing_dataset_00', f.other));
  expect((await call(f.notes, f.owner)).status).toBe(400);
});

 it('review4: unreadable dataset with string query and invalid variables is uniformly 404', async () => {
   const f = await fixture(), db = await getDb();
   await db.query("UPDATE artifacts SET visibility='private' WHERE id=$1", [f.notes]);
   const call = async (id: string) => {
     const response = await graphqlPost(request(`/api/artifacts/${id}/graphql`, { method: 'POST', json: {query: '{ rows { _id } }', variables: []}, token: f.other.token }), params(id));
     return { status: response.status, body: await response.json() };
   };
   expect(await call(f.notes)).toEqual(await call('missing_dataset_00'));
 });

it('a write whose user column names a document in memberOf locks that document in the page tier, before the dataset', async () => {
  const owner = await person('member_owner');
  const report = await publish(owner, { html: '<html><body>Report</body></html>' });
  const team = await createArtifactFromBody({ dataset: [{ id: 1, assignee: null }], columns: [{ name: 'id', type: 'number' }, { name: 'assignee', type: 'user', constraints: { memberOf: [`ref:${report.body.id}`] } }], access: 'readwrite', visibility: 'unlisted', title: 'Team' }, owner.actor, 'http://localhost:3000');
  const teamId = (await team.json() as { id: string }).id;
  const page = (await publish(owner, { html: `<html><head><link rel="af-dataset" data-af-name="team" href="ref:${teamId}"></head><body>x</body></html>` })).body.id;
  const db = await getDb(), transaction = db.transaction.bind(db), locked: string[][] = [];
  const spy = vi.spyOn(db, 'transaction').mockImplementation((callback) => transaction(async (tx) => {
    const order: string[] = []; locked.push(order); const query = tx.query.bind(tx);
    return callback({ ...tx, query: async (statement: string, values?: unknown[]) => {
      if (/FROM artifacts\b/.test(statement) && / FOR (UPDATE|SHARE)/.test(statement) && !/JOIN/.test(statement) && typeof values?.[0] === 'string' && !order.includes(values[0])) order.push(values[0]);
      return query(statement, values as never);
    } } as never);
  }));
  let reply;
  try { reply = await sql(page, owner, 'update team set assignee = $p0 where id = 1', { p0: owner.userId }); } finally { spy.mockRestore(); }
  expect(reply.status, JSON.stringify(reply.body)).toBe(200);
  const commit = locked.find((o) => o.includes(teamId))!;
  expect(commit.slice(0, 3)).toEqual([...[page, report.body.id].sort(lockOrder), teamId]);
});
