/**
 * THE PAGE SQL DOOR, parity and receipts (the door itself: page-sql-door.test.ts). The same request through the page
 * GraphQL and compared, a multi-table link's naming and write-only roles, and what a receipt or a replay may show as
 * the reader's access changes between the call and its commit.
 */
import { beforeEach, expect, it, vi } from 'vitest';
import { admitGroupMember, setSession, useAppHarness } from './harness';
import { getDb, services } from '@/lib/platform';
import { resolverDatasets } from '@/lib/graphql-compat';
import { createGroup, removeGroupMember } from '@/lib/groups';
import { person, publish, sql, gql, ROWS, POLICY, fixture, stored, refused } from './page-sql-door-fixture';

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
  // Charged once in all, whichever minute's bucket the write fell in (the minute can turn between the write and here).
  expect((await (await getDb()).query<{ calls: number }>("SELECT coalesce(sum(calls),0)::int AS calls FROM dataset_usage WHERE bucket LIKE $1", [`mutation:${f.staff}:%`])).rows[0]?.calls).toBe(1);
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
