/**
 * THE PAGE SQL DOOR, admission, lock order and retries (the door itself: page-sql-door.test.ts). What a malformed or
 * refused request reveals, the lock order every guarded writer takes (lib/artifact-access locks.ts), and the whole-
 * transaction retry on deadlock and serialization failure.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { admitGroupMember, request, setSession, useAppHarness } from './harness';
import { getDb, TransactionConflict } from '@/lib/platform';
import { createArtifactFromBody } from '@/lib/publish';
import { createArtifact, replaceArtifactFor, setArtifactGroupShare, updateSharingFor } from '@/lib/artifacts';
import { lockOrder } from '@/lib/artifact-access';
import { resolverDatasets } from '@/lib/graphql-compat';
import { createGroup, deleteGroup } from '@/lib/groups';
import { POST as graphqlPost } from '@/app/api/artifacts/[id]/graphql/route';
import { POST as sqlPost } from '@/app/api/artifacts/[id]/sql/route';
import { type Person, person, params, publish, sql, gql, fixture, stored } from './page-sql-door-fixture';

useAppHarness();
beforeEach(() => setSession(null));

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
 * FIRST lock of a row counts (re-reading a row already held takes nothing new). App facts are shares and group
 * shares; identity rows (accounts, groups, memberships) are read, never locked, by the app, and the identity module's
 * own writes (membership, deletion, subgroups, reparenting) are not in this order at all: they neither wait for nor
 * hold up a decision. A group-owned publish is traced for its artifact order only.
 */
it('every writer locks its artifacts by tier and lockOrder, before its facts', async () => {
  const f = await fixture(), db = await getDb(), transaction = db.transaction.bind(db);
  const group = await createGroup(f.owner.userId!, { handle: 'lock_order_group', name: 'Lock order' });
  await admitGroupMember(f.owner.userId!, group.id, f.other.userId!, 'viewer');
  const formats = new Map((await db.query<{ id: string; format: string }>('SELECT id, format FROM artifacts')).rows.map((r) => [r.id, r.format]));
  const isArtifactLock = (s: string) => / FOR (UPDATE|SHARE)/.test(s) && /FROM artifacts\b/.test(s) && !/JOIN/.test(s);
  const isFact = (s: string) => / FOR (UPDATE|SHARE)/.test(s) && /FROM (artifact_shares|artifact_group_shares)\b/.test(s)
    || /^(DELETE FROM|UPDATE) (artifact_shares|artifact_group_shares)\b/.test(s);
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
    path = 'group-owned publish'; await createArtifact(null, f.owner.userId, { format: 'html', source: '<p>group page</p>', meta: {}, title: 'Group page', destination: { type: 'group', id: group.id } });
  } finally { spy.mockRestore(); }
  const bad = traces.filter((t) => t.problems.length);
  expect(bad, JSON.stringify(bad)).toEqual([]);
  // Each path locked something it is pinned for; the guarded ones locked their page before the dataset.
  // (A test user's erasure, the third competing writer, is pinned in lib/operations' own test: testusers-erase.test.ts.)
  for (const p of ['sql door', 'sql door, cross-link read', 'graphql', 'resolver', 'sharing', 'group share'])
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
  it('the competing writers (the identity module\'s group deletion, group-owned publish, replace) retry whole', async () => {
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
