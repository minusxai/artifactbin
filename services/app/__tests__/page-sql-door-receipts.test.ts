/**
 * THE PAGE SQL DOOR, receipts (the door itself: page-sql-door.test.ts; GraphQL parity and table naming:
 * page-sql-door-parity.test.ts). The rate limit and output budget a write is charged, and what a receipt or a replay
 * may show as the reader's access changes between the call and its commit.
 */
import { beforeEach, expect, it, vi } from 'vitest';
import { admitGroupMember, setSession, useAppHarness } from './harness';
import { getDb, services } from '@/lib/platform';
import { createGroup, removeGroupMember } from '@/lib/groups';
import { sql, gql, POLICY, fixture, stored, refused } from './page-sql-door-fixture';

useAppHarness();
beforeEach(() => setSession(null));

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
