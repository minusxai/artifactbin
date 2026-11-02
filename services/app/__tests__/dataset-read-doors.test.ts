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
import { createRetainedDatasetGraphql } from '@/lib/dataset-graphql';
import { datasetResolverForActor, registeredQueryImportForRow } from '@/lib/document-data';
import { executeCatalog } from '@/lib/datasets';
import { OPERATIONS, type OpContext } from '@/lib/operations/registry';
import { POST as tables } from '@/app/a/[id]/tables/route';
import { GET as raw } from '@/app/a/[id]/raw/route';
import { GET as frame } from '@/app/a/[id]/events/frame/route';
import { GET as content } from '@/app/api/artifacts/[id]/content/route';

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

it('page GraphQL: schema, counts, rows and people read the view; aggregates need allow_aggregations', async () => {
  const { owner, viewer, id } = await setup();
  const api = createRetainedDatasetGraphql(), signal = new AbortController().signal;
  const binding = { kind: 'dataset' as const, name: 'data', datasetId: id, mode: 'live' as const };
  const schema = async (actor: AccessActor) => api.schema(actor, binding, signal);
  const ownerSchema = await schema(owner.actor), viewerSchema = await schema(viewer.actor);
  expect(ownerSchema.tables[0]!.columns.map((c) => c.label)).toEqual(['name', 'team', 'salary']);
  expect(viewerSchema.tables[0]!.columns.map((c) => c.label)).toEqual(['name', 'team']);
  expect(viewerSchema.tables[0]!.source.totalRows).toBe(2);
  const table = viewerSchema.tables[0]!;
  const read = async (actor: AccessActor, columnIds: string[]) => api.read(actor, binding, { tableId: table.id, columnIds, first: 100 } as never, signal);
  const ownerRows = await read(owner.actor, ownerSchema.tables[0]!.columns.map((c) => c.id));
  expect(ownerRows.rows).toHaveLength(3);
  const viewerRows = await read(viewer.actor, table.columns.map((c) => c.id));
  sees(JSON.stringify(viewerRows.rows.map((r) => r.cells.map((c) => c.value))), false);
  expect(viewerRows.rows).toHaveLength(2);
  // A hidden column cannot be asked for by its ID.
  await expect(read(viewer.actor, ownerSchema.tables[0]!.columns.map((c) => c.id))).rejects.toThrow();
  const count = { tableId: table.id, aggregates: [{ fn: 'count', alias: 'n' }], first: 10 } as never;
  await expect(api.query(viewer.actor, binding, count, signal)).rejects.toThrow('dataset_aggregations_denied');
});

it('markup imports and registered page queries read the reader\'s view through the page', async () => {
  const { owner, viewer, id } = await setup();
  const imported = async (actor: AccessActor) => JSON.stringify((await datasetResolverForActor(actor)(id, 'import'))?.tables ?? null);
  sees(await imported(owner.actor), true);
  sees(await imported(viewer.actor), false);
  const db = await getDb();
  await db.query("INSERT INTO artifacts(id,token_id,user_id,format,visibility,edit_id) VALUES('doorspage',$1,$2,'html','public','doorspage-edit')", [owner.id, owner.userId]);
  const page = (await getArtifactById('doorspage'))!;
  for (const [actor, whole] of [[owner.actor, true], [viewer.actor, false]] as const) {
    const source = await registeredQueryImportForRow(page, id, actor);
    expect(source.view === null).toBe(whole);
    const result = await executeCatalog(source.catalog, 'select * from rows', {}, { view: source.view, datasetId: id, actor });
    sees(JSON.stringify(result), whole);
  }
});
