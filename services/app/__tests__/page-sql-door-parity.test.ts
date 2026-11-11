/**
 * THE PAGE SQL DOOR, parity and naming (the door itself: page-sql-door.test.ts; receipts: page-sql-door-receipts.test.ts).
 * The same request through the page GraphQL and compared, a multi-table link's naming and write-only roles, and the
 * review cases on pinned links, cross-link reads, the output budget, SQLite expressions and the mutation quota.
 */
import { beforeEach, expect, it, vi } from 'vitest';
import { setSession, useAppHarness } from './harness';
import { getDb, services } from '@/lib/platform';
import { person, publish, sql, gql, ROWS, fixture, stored, refused } from './page-sql-door-fixture';

useAppHarness();
beforeEach(() => setSession(null));

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
  // The quota counts per minute. This minute's bucket and the next are both full, so a run that crosses a minute
  // boundary between here and the writes is still refused (it was let through on main, run 42975200518).
  const minute = Math.floor(Date.now() / 60000);
  for (const at of [minute, minute + 1])
    await db.query('INSERT INTO dataset_usage(bucket,calls) VALUES($1,30)', [`mutation:${f.staff}:${at}`]);
  for (const key of ['review_quota_00000001', 'review_quota_00000002'])
    await refused(f, sql(f.page, null, "insert into staff (name) values ('quota')", {}, { key }));
});
