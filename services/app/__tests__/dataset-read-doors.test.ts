/**
 * EVERY ROW-READING DOOR READS THE ROLE VIEW (lib/dataset-permissions). A v3 policy gives shared viewers one
 * select rule: rows where team = red, columns name and team, no aggregates; signed-in link holders and signed-out
 * readers get no rule (the uniform 404). Through each door, the viewer never sees the filtered row ("bo") or the
 * hidden column ("salary"); the owner sees both. v3 cannot be PUT yet (PR 7), so the policy is written directly.
 */
import { beforeEach, expect, it } from 'vitest';
import { mintAccountToken, request, setSession, useAppHarness } from './harness';
import { ANONYMOUS_ACTOR, identityForUser, type AccessActor } from '@/lib/accounts';
import { getDb } from '@/lib/platform';
import { getArtifactById, canReadArtifact } from '@/lib/artifacts';
import { createArtifactFromBody } from '@/lib/publish';
import { linkedGql, liveLink, errorCode } from './linked-datasets';
import { datasetResolverForActor } from '@/lib/document-data';
import { OPERATIONS, type OpContext } from '@/lib/operations/registry';
import { POST as tables } from '@/app/a/[id]/tables/route';
import { GET as raw } from '@/app/a/[id]/raw/route';
import { GET as frame } from '@/app/a/[id]/events/frame/route';
import { GET as content } from '@/app/api/artifacts/[id]/content/route';
import { POST as queryRead } from '@/app/api/artifacts/[id]/query/route';

useAppHarness();
beforeEach(() => setSession(null));

const ROWS = [{ name: 'ada', team: 'red', salary: 10 }, { name: 'bo', team: 'blue', salary: 20 }, { name: 'cy', team: 'red', salary: 30 }];
const POLICY = { version: 3, tables: [{ table: { schema: 'public', name: 'rows' }, select_permissions: [
  { role: 'viewer', permission: { columns: ['name', 'team'], filter: { team: { _eq: 'red' } }, allow_aggregations: false } },
] }] };
const params = (id: string) => ({ params: Promise.resolve({ id }) });

async function person(name: string) {
  const token = await mintAccountToken(`doors_${name}`);
  return { ...token, actor: identityForUser(token.userId, token.id, token.email) as AccessActor };
}

async function setup() {
  const owner = await person('owner'), viewer = await person('viewer'), other = await person('other');
  const created = await createArtifactFromBody({ dataset: ROWS, access: 'readwrite', visibility: 'unlisted' }, owner.actor as AccessActor & { tokenId: string }, 'http://localhost:3000');
  expect(created.status, await created.clone().text()).toBe(201);
  const id = (await created.json()).id as string;
  const db = await getDb();
  await db.query("INSERT INTO artifact_shares(artifact_id,user_id,email,role) VALUES($1,$2,$3,'viewer')", [id, viewer.userId, viewer.email]);
  await db.query('UPDATE artifacts SET dataset_policy=$2::jsonb, policy_revision=policy_revision+1 WHERE id=$1', [id, JSON.stringify(POLICY)]);
  return { owner, viewer, other, id };
}

/** The viewer's answer shows red rows, never "bo" or "salary"; the owner's shows everything. */
function sees(text: string, whole: boolean) {
  expect(text).toContain('ada');
  expect(text).toContain('cy');
  if (whole) { expect(text).toContain('bo'); expect(text).toContain('salary'); }
  else { expect(text).not.toMatch(/"bo"/); expect(text).not.toContain('salary'); }
}

it('admits only roles with a select rule: shared viewer yes, signed-in link holder and signed-out no', async () => {
  const { owner, viewer, other, id } = await setup();
  const row = (await getArtifactById(id))!;
  expect(await canReadArtifact(row, owner.actor)).toBe(true);
  expect(await canReadArtifact(row, viewer.actor)).toBe(true);
  expect(await canReadArtifact(row, other.actor)).toBe(false);
  expect(await canReadArtifact(row, ANONYMOUS_ACTOR)).toBe(false);
  const sql = { method: 'POST', json: { sql: 'select * from rows' } };
  expect((await tables(request(`/a/${id}/tables`, { ...sql, token: other.token }), params(id))).status).toBe(404);
  expect((await tables(request(`/a/${id}/tables`, sql), params(id))).status).toBe(404);
});

it('SQL doors (/a/:id/tables, query_resource) run over the role view: hidden columns cannot be named', async () => {
  const { owner, viewer, id } = await setup();
  // The viewer may run SQL here: POLICY's rule with allow_aggregations.
  const sqlRule = { ...POLICY, tables: [{ ...POLICY.tables[0], select_permissions: [{ role: 'viewer', permission: { ...POLICY.tables[0]!.select_permissions[0]!.permission, allow_aggregations: true } }] }] };
  await (await getDb()).query('UPDATE artifacts SET dataset_policy=$2::jsonb, policy_revision=policy_revision+1 WHERE id=$1', [id, JSON.stringify(sqlRule)]);
  const sql = (token: string, statement: string) => tables(request(`/a/${id}/tables`, { method: 'POST', json: { sql: statement }, token }), params(id));
  sees(await (await sql(owner.token, 'select * from rows')).text(), true);
  sees(await (await sql(viewer.token, 'select * from rows')).text(), false);
  // A count covers only visible rows; a hidden column is not in the viewer's catalog.
  expect((await (await sql(viewer.token, 'select count(*) as n from rows')).json()).rows).toEqual([{ n: 2 }]);
  expect((await sql(viewer.token, 'select salary from rows')).status).not.toBe(200);
  const op = OPERATIONS.find((o) => o.name === 'query_resource')!;
  const run = async (actor: AccessActor) => (await op.run({ actor, base: 'http://localhost:3000', request: request(`/api/artifacts/${id}/query`) } as unknown as OpContext, { id })).body;
  sees(JSON.stringify(await run(owner.actor)), true);
  sees(JSON.stringify(await run(viewer.actor)), false);
});

it('query_resource SQL needs allow_aggregations, as caps.sql does: a flagless role reads rows by table name only', async () => {
  const { owner, viewer, other, id } = await setup();
  const db = await getDb();
  const editor = await person('editor');
  await db.query("INSERT INTO artifact_shares(artifact_id,user_id,email,role) VALUES($1,$2,$3,'editor')", [id, editor.userId, editor.email]);
  // signed_in (the link holder) gets a flagless rule too; viewer keeps POLICY's.
  const flagless = { columns: ['name', 'team'], filter: { team: { _eq: 'red' } } };
  await db.query('UPDATE artifacts SET dataset_policy=$2::jsonb, policy_revision=policy_revision+1 WHERE id=$1', [id, JSON.stringify({ ...POLICY, tables: [{ ...POLICY.tables[0], select_permissions: [...POLICY.tables[0]!.select_permissions, { role: 'signed_in', permission: flagless }] }] })]);
  const query = (token: string, body: Record<string, unknown>) => queryRead(request(`/api/artifacts/${id}/query`, { method: 'POST', token, json: body }), params(id));
  for (const who of [viewer, other]) {
    for (const sql of ['select count(*) as n from rows', 'select team, count(*) from rows group by team', 'select sum(length(name)) from rows', 'select * from rows']) {
      const refused = await query(who.token, { sql });
      expect(refused.status, sql).toBe(403);
      expect(await refused.json()).toEqual({ error: 'permission_denied', message: "your role's rule for public.rows does not allow SQL (allow_aggregations); read its rows instead" });
    }
    // The server-built row read still answers the role view.
    for (const body of [{}, { name: 'public.rows' }]) {
      const rows = await query(who.token, body);
      expect(rows.status).toBe(200);
      sees(await rows.text(), false);
    }
  }
  for (const who of [owner, editor]) {
    const counted = await query(who.token, { sql: 'select count(*) as n from rows' });
    expect(counted.status).toBe(200);
    expect((await counted.json()).results[0].rows).toEqual([{ n: 3 }]);
  }
});

it('raw, content, get_artifact and the live frame serve the role view', async () => {
  const { owner, viewer, id } = await setup();
  sees(await (await raw(request(`/a/${id}/raw`, { token: owner.token }), params(id))).text(), true);
  sees(await (await raw(request(`/a/${id}/raw`, { token: viewer.token }), params(id))).text(), false);
  sees(await (await content(request(`/api/artifacts/${id}/content`, { token: owner.token }), params(id))).text(), true);
  sees(await (await content(request(`/api/artifacts/${id}/content`, { token: viewer.token }), params(id))).text(), false);
  const get = OPERATIONS.find((o) => o.name === 'get_artifact')!;
  const read = async (actor: AccessActor) => JSON.stringify((await get.run({ actor, base: 'http://localhost:3000', request: request(`/api/artifacts/${id}`) } as unknown as OpContext, { id })).body);
  sees(await read(owner.actor), true);
  const viewerWire = await read(viewer.actor);
  sees(viewerWire, false);
  expect(JSON.parse(viewerWire).rowCount).toBe(2);
  setSession({ user: { id: owner.userId!, email: owner.email } });
  sees(await (await frame(request(`/a/${id}/events/frame`), params(id))).text(), true);
  setSession({ user: { id: viewer.userId!, email: viewer.email } });
  sees(await (await frame(request(`/a/${id}/events/frame`), params(id))).text(), false);
});

it('export and fork refuse a reader whose view hides rows; the owner forks the whole dataset', async () => {
  const { owner, viewer, id } = await setup();
  const ctx = (actor: AccessActor, path: string) => ({ actor, base: 'http://localhost:3000', request: request(path) } as unknown as OpContext);
  const exported = OPERATIONS.find((o) => o.name === 'export_artifact')!;
  expect((await exported.run(ctx(viewer.actor, `/api/artifacts/${id}/export`), { id })).status).toBe(404);
  const fork = OPERATIONS.find((o) => o.name === 'fork_artifact')!;
  const refused = await fork.run(ctx(viewer.actor, `/api/artifacts/${id}/fork`), { id });
  expect(refused.status).toBe(403);
  expect(JSON.stringify(refused.body)).toContain('not_forkable');
  expect((await fork.run(ctx(owner.actor, `/api/artifacts/${id}/fork`), { id })).status).toBe(201);
});

it('the dataset explorer door (/a/:id/tables) runs SQL only for a role allowed it; any reader browses a table by name', async () => {
  const { owner, viewer, id } = await setup();
  const post = (token: string, json: Record<string, unknown>) => tables(request(`/a/${id}/tables`, { method: 'POST', json, token }), params(id));
  // POLICY's viewer rule has no allow_aggregations: caller SQL is refused, whatever it computes.
  for (const statement of ['select count(*) as n from rows', 'select * from rows']) {
    const refused = await post(viewer.token, { sql: statement });
    expect(refused.status, statement).toBe(403);
    expect(await refused.json()).toEqual({ error: 'permission_denied', message: "your role's rule for public.rows does not allow SQL (allow_aggregations); read its rows instead" });
  }
  // A table read by name is server-built: the role view's rows, paged.
  const browsed = await post(viewer.token, { table: { schema: 'public', name: 'rows' }, limit: 1, offset: 1 });
  expect(browsed.status).toBe(200);
  const page = await browsed.json();
  expect(page.rows).toEqual([{ name: 'cy', team: 'red' }]);
  sees(JSON.stringify((await (await post(viewer.token, { table: { schema: 'public', name: 'rows' } })).json()).rows), false);
  expect((await post(viewer.token, { table: { schema: 'public', name: 'nope' } })).status).toBe(400);
  expect((await post(viewer.token, { table: { schema: 'public', name: 'rows' }, sql: 'select 1' })).status).toBe(400);
  // The owner still runs SQL.
  expect((await (await post(owner.token, { sql: 'select count(*) as n from rows' })).json()).rows).toEqual([{ n: 3 }]);
});

it('a document\'s dataset queries run for a reader only when their role may run SQL', async () => {
  const { owner, viewer, id } = await setup();
  expect(await datasetResolverForActor(viewer.actor)(id, 'catalog')).toBeNull();
  expect(await datasetResolverForActor(viewer.actor)(id, 'import')).toBeNull();
  expect(await datasetResolverForActor(owner.actor)(id, 'catalog')).not.toBeNull();
});

it('page GraphQL: generated columns and rows read the view; no role has an aggregate root', async () => {
  const { owner, viewer, id } = await setup();
  const link = liveLink(id);
  const ownerRows = await linkedGql(owner.actor, link, '{ data { name team salary } }');
  expect(ownerRows.errors).toBeUndefined();
  expect(ownerRows.data!.data).toHaveLength(3);
  sees(JSON.stringify(ownerRows.data), true);
  const viewerRows = await linkedGql(viewer.actor, link, '{ data { name team } }');
  expect(viewerRows.errors).toBeUndefined();
  expect(viewerRows.data!.data).toHaveLength(2);
  sees(JSON.stringify(viewerRows.data), false);
  // A hidden column is not in the viewer's schema; the aggregate root is in nobody's (totals are the page's _sql).
  expect(errorCode(await linkedGql(viewer.actor, link, '{ data { name salary } }'))).toBe('validation_failed');
  expect(errorCode(await linkedGql(viewer.actor, link, '{ data_aggregate { aggregate { count } } }'))).toBe('validation_failed');
  expect(errorCode(await linkedGql(owner.actor, link, '{ data_aggregate { aggregate { count } } }'))).toBe('validation_failed');
});

it('markup imports read the reader\'s view', async () => {
  const { owner, viewer, id } = await setup();
  const sqlRule = { ...POLICY, tables: [{ ...POLICY.tables[0], select_permissions: [{ role: 'viewer', permission: { ...POLICY.tables[0]!.select_permissions[0]!.permission, allow_aggregations: true } }] }] };
  await (await getDb()).query('UPDATE artifacts SET dataset_policy=$2::jsonb, policy_revision=policy_revision+1 WHERE id=$1', [id, JSON.stringify(sqlRule)]);
  const imported = async (actor: AccessActor) => JSON.stringify((await datasetResolverForActor(actor)(id, 'import'))?.tables ?? null);
  sees(await imported(owner.actor), true);
  sees(await imported(viewer.actor), false);
});
