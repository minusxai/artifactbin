/**
 * PAGE COMPOSITION: every dataset link mounts that dataset's generated roots flat at the top of the page schema,
 * for the page reader's role through the page (no sharing of their own: signed_in or anonymous), reads and
 * mutations, with the page as X-Hasura-Page-Id. There is no other dataset API: a stored link's retired `api` field
 * is ignored and dropped on the next save.
 */
import { beforeEach, expect, it } from 'vitest';
import { mintAccountToken, request, setSession, useAppHarness } from './harness';
import { identityForUser, type AccessActor } from '@/lib/accounts';
import { getDb } from '@/lib/platform';
import { createArtifactFromBody } from '@/lib/publish';
import { getArtifactById } from '@/lib/artifacts';
import { loadDatasetRows } from '@/lib/datasets';
import { readHtmlPage } from '@/lib/html-publication';
import { GET as artifactGet, PUT as artifactPut } from '@/app/api/artifacts/[id]/route';
import { GET, POST } from '@/app/api/artifacts/[id]/graphql/route';

useAppHarness();
beforeEach(() => setSession(null));

type Person = Awaited<ReturnType<typeof person>>;
type Reply = { data?: Record<string, any> | null; errors?: Array<{ message: string; extensions?: { code: string } }>; extensions?: { outcomes: Record<string, string> } };
async function person(name: string) {
  const token = await mintAccountToken(`pda_${name}`);
  return { ...token, actor: identityForUser(token.userId, token.id, token.email) as AccessActor & { tokenId: string } };
}
const params = (id: string) => ({ params: Promise.resolve({ id }) });
async function publish(owner: Person, body: Record<string, unknown>) {
  const created = await createArtifactFromBody({ ...('dataset' in body ? { access: 'readwrite' } : {}), visibility: 'unlisted', ...body }, owner.actor, 'http://localhost:3000');
  return { status: created.status, body: await created.json() as { id: string; error?: string; details?: string[] } };
}
const sdl = async (page: string, who: Person | null) => {
  const response = await GET(request(`/api/artifacts/${page}/graphql`, who ? { token: who.token } : {}), params(page));
  expect(response.status).toBe(200);
  return (await response.json() as { sdl: string }).sdl;
};
async function gql(page: string, who: Person | null, query: string, options: { variables?: Record<string, unknown>; key?: string; revision?: string } = {}) {
  const response = await POST(request(`/api/artifacts/${page}/graphql`, { method: 'POST', json: { query, revision: options.revision ?? '1', ...(options.variables ? { variables: options.variables } : {}) }, ...(who ? { token: who.token } : {}), ...(options.key ? { headers: { 'Idempotency-Key': options.key } } : {}) }), params(page));
  return { status: response.status, body: await response.json() as Reply };
}

const STAFF = [{ name: 'ada', team: 'red', salary: 10, page: 'seed', by: 'seed' }, { name: 'bo', team: 'blue', salary: 20, page: 'seed', by: 'seed' }];
const ROWS = { schema: 'public', name: 'rows' };
/** viewers see red rows without salary; other accounts see every row and add rows stamped with the page and themselves; anonymous sees names. */
const POLICY = { version: 3, tables: [{
  table: ROWS,
  select_permissions: [
    { role: 'viewer', permission: { columns: ['name', 'team', 'page', 'by'], filter: { team: { _eq: 'red' } }, allow_aggregations: false } },
    { role: 'signed_in', permission: { columns: '*', filter: {}, allow_aggregations: true } },
    { role: 'anonymous', permission: { columns: ['name'], filter: {} } },
  ],
  insert_permissions: [{ role: 'signed_in', permission: { columns: ['name', 'team'], check: {}, set: { page: 'X-Hasura-Page-Id', by: 'X-Hasura-User-Id' } } }],
  update_permissions: [{ role: 'signed_in', permission: { columns: ['team'], filter: { by: { _eq: 'X-Hasura-User-Id' } }, check: {} } }],
}] };

async function fixture(html = (id: string) => `<html><head><link rel="af-dataset" data-af-name="staff" href="ref:${id}"></head><body>Staff</body></html>`) {
  const owner = await person('owner'), viewer = await person('viewer'), other = await person('other');
  const dataset = await publish(owner, { dataset: STAFF, title: 'Staff' });
  expect(dataset.status).toBe(201);
  const db = await getDb();
  await db.query("INSERT INTO artifact_shares(artifact_id,user_id,email,role) VALUES($1,$2,$3,'viewer')", [dataset.body.id, viewer.userId, viewer.email]);
  await db.query('UPDATE artifacts SET dataset_policy=$2::jsonb, policy_revision=policy_revision+1 WHERE id=$1', [dataset.body.id, JSON.stringify(POLICY)]);
  const page = await publish(owner, { html: html(dataset.body.id) });
  expect(page.status, JSON.stringify(page.body)).toBe(201);
  return { owner, viewer, other, staff: dataset.body.id, page: page.body.id };
}
const names = (reply: { body: Reply }) => (reply.body.data?.staff as Array<{ name: string }>).map((r) => r.name).sort();

it('stores a new link as name, dataset and mode and mounts its roots flat, per role through the page', async () => {
  const f = await fixture();
  expect((await readHtmlPage(f.owner.actor, f.page)).links).toEqual([{ kind: 'dataset', name: 'staff', datasetId: f.staff, mode: 'live' }]);
  const owner = await sdl(f.page, f.owner), viewer = await sdl(f.page, f.viewer), other = await sdl(f.page, f.other), anonymous = await sdl(f.page, null);
  expect(owner).toMatch(/staff\(where: staff_bool_exp.*\): \[staff!\] @dataset\(link: "staff", file: "[^"]+", version: "live", table: "staff", field: "select"\)/);
  expect(owner).toContain('insert_staff_one(object: staff_insert_input!): staff @dataset');
  expect(owner).not.toContain('staff: staff__Query');
  // The viewer share: no salary anywhere, no aggregate, no writes (no rule).
  expect(viewer).toMatch(/type staff \{\s+_id: ID!\s+name: String\s+team: String\s+page: String\s+by: String\s+"[^"]+"\s+_can: staff_row_can!\s+\}/);
  expect(viewer).not.toContain('staff_aggregate');
  expect(viewer).not.toContain('type Mutation');
  // Another account through the page is signed_in: its insert input names only the rule's columns, less presets.
  expect(other).toMatch(/input staff_insert_input \{\s+name: String\s+team: String\s+\}/);
  expect(other).toContain('staff_aggregate');
  expect(anonymous).toMatch(/type staff \{\s+_id: ID!\s+name: String\s+"[^"]+"\s+_can: staff_row_can!\s+\}/);
  expect(anonymous).not.toContain('type Mutation');
});

it('reads through the page as owner, viewer, signed_in and anonymous under the rules', async () => {
  const f = await fixture();
  const query = '{ staff(order_by: {name: asc}) { name } }';
  expect(names(await gql(f.page, f.owner, query))).toEqual(['ada', 'bo']);
  expect(names(await gql(f.page, f.viewer, query))).toEqual(['ada']);
  expect(names(await gql(f.page, f.other, query))).toEqual(['ada', 'bo']);
  expect(names(await gql(f.page, null, query))).toEqual(['ada', 'bo']);
  expect((await gql(f.page, f.other, '{ staff_aggregate { aggregate { count sum { salary } } } }')).body.data).toEqual({ staff_aggregate: { aggregate: { count: 2, sum: { salary: 30 } } } });
  const hidden = await gql(f.page, f.viewer, '{ staff { salary } }');
  expect(hidden.body.errors?.[0]?.message).toMatch(/Cannot query field "salary"/);
});

it('writes through the page as the caller: presets name the page and the caller, the key replays, others are refused', async () => {
  const f = await fixture();
  const add = 'mutation Add($o: staff_insert_input!) { insert_staff_one(object: $o) { _id name } }';
  const key = 'page_key_0123456789';
  const first = await gql(f.page, f.other, add, { variables: { o: { name: 'cy', team: 'red' } }, key });
  expect(first.body).toMatchObject({ data: { insert_staff_one: { name: 'cy' } }, extensions: { outcomes: { insert_staff_one: 'committed' } } });
  // The same Idempotency-Key replays the first reply and writes nothing.
  expect((await gql(f.page, f.other, add, { variables: { o: { name: 'cy', team: 'red' } }, key })).body).toEqual(first.body);
  const rows = await loadDatasetRows((await getArtifactById(f.staff))!);
  expect(rows.filter((r) => r.name === 'cy')).toEqual([expect.objectContaining({ name: 'cy', team: 'red', page: f.page, by: f.other.userId })]);
  // The owner (admin-equivalent) writes any column; the viewer share and anonymous have no rule, so no root.
  expect((await gql(f.page, f.owner, 'mutation { update_staff(where: {name: {_eq: "bo"}}, _set: {salary: 21}) { affected_rows } }')).body.data).toEqual({ update_staff: { affected_rows: 1 } });
  for (const who of [f.viewer, null]) {
    const refused = await gql(f.page, who, add, { variables: { o: { name: 'zed' } } });
    expect(refused.body.data ?? null).toBeNull();
    expect(refused.body.errors?.[0]?.message).toBeTruthy();
  }
  // The update rule's filter is the caller's own rows: bo was not added by them.
  expect((await gql(f.page, f.other, 'mutation { update_staff(where: {}, _set: {team: "green"}) { affected_rows } }')).body.data).toEqual({ update_staff: { affected_rows: 1 } });
  expect((await loadDatasetRows((await getArtifactById(f.staff))!)).map((r) => [r.name, r.team])).toEqual([['ada', 'red'], ['bo', 'blue'], ['cy', 'green']]);
  // A malformed key is refused before anything runs.
  expect((await gql(f.page, f.other, add, { variables: { o: { name: 'dee' } }, key: 'bad key' })).status).toBe(400);
});

it('mounts a stored link that still carries the retired api field on the generated API, and the next save drops it', async () => {
  const f = await fixture();
  // A page saved while links named their API: its stored link says legacy.
  const db = await getDb();
  for (const table of ['artifacts', 'artifact_versions']) {
    await db.query(`UPDATE ${table} SET meta=jsonb_set(meta,'{htmlLinks}',(SELECT jsonb_agg(link || '{"api":"legacy"}'::jsonb) FROM jsonb_array_elements(meta->'htmlLinks') link)) WHERE ${table === 'artifacts' ? 'id' : 'artifact_id'}=$1`, [f.page]);
  }
  const schema = await sdl(f.page, f.other);
  expect(schema).toContain('staff(where: staff_bool_exp');
  expect(schema).not.toContain('staff__Query');
  expect(names(await gql(f.page, f.other, '{ staff(order_by: {name: asc}) { name } }'))).toEqual(['ada', 'bo']);
  expect((await gql(f.page, f.other, '{ staff { schema { tables { id } } } }')).body.errors?.[0]?.message).toMatch(/Cannot query field "schema"/);
  // Republishing (read → edit → publish) stores every link without the field.
  const context = params(f.page);
  const head = await (await artifactGet(request(`/api/artifacts/${f.page}`, { token: f.owner.token }), context)).json();
  const other = await publish(f.owner, { dataset: [{ note: 'x' }], title: 'Notes' });
  const html = head.html.replace('</head>', `<link rel="af-dataset" data-af-name="notes" href="ref:${other.body.id}"></head>`);
  const updated = await artifactPut(request(`/api/artifacts/${f.page}`, { method: 'PUT', token: f.owner.token, json: { html, expectedVersion: head.version, expectedState: head.state } }), context);
  expect(updated.status, await updated.clone().text()).toBe(200);
  expect((await readHtmlPage(f.owner.actor, f.page)).links).toEqual([
    { kind: 'dataset', name: 'staff', datasetId: f.staff, mode: 'live' },
    { kind: 'dataset', name: 'notes', datasetId: other.body.id, mode: 'live' },
  ]);
  const both = await sdl(f.page, f.owner);
  expect(both).toContain('staff(where: staff_bool_exp');
  expect(both).toContain('notes(where: notes_bool_exp');
});

it('refuses a page whose generated roots collide (graphql_root_collision), whatever data-af-api a link carries', async () => {
  const f = await fixture();
  for (const api of ['', ' data-af-api="legacy"']) {
    const collide = await publish(f.owner, { html: `<html><head><link rel="af-dataset" data-af-name="staff"${api} href="ref:${f.staff}"><link rel="af-dataset" data-af-name="staff_meta" href="ref:${f.staff}"></head><body>x</body></html>` });
    expect(collide.status).toBe(400);
    expect(collide.body).toEqual({ error: 'graphql_root_collision', details: ['link "staff" generates staff_meta, which link "staff_meta" also names; rename one link'] });
  }
});
