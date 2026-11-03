/**
 * THE AGENT POLICY DOOR for v3 dataset permissions (`GET/PUT /api/artifacts/:id/policy`, `GET …/policy/templates`):
 * owners and editors read the stored v3 policy (the default when none is stored; `unreadable`, with the reason, for
 * anything else stored), its generated GraphQL names and the plain-language read-back; a PUT validates against the dataset's
 * tables and columns, reports every problem by path, and saves only with the current revision; a dry run saves
 * nothing. `configuration` is server-owned. Everyone else gets the uniform 404.
 */
import { expect, it } from 'vitest';
import { mintAccountToken, request, useAppHarness } from './harness';
import { identityForUser, type AccessActor } from '@/lib/accounts';
import { getDb } from '@/lib/platform';
import { createArtifactFromBody } from '@/lib/publish';
import { getArtifactById } from '@/lib/artifacts';
import { GET, PUT } from '@/app/api/artifacts/[id]/policy/route';
import { GET as TEMPLATES } from '@/app/api/artifacts/[id]/policy/templates/route';

useAppHarness();

const params = (id: string) => ({ params: Promise.resolve({ id }) });
type Person = Awaited<ReturnType<typeof person>>;
async function person(name: string) {
  const token = await mintAccountToken(`policy_${name}`);
  return { ...token, actor: identityForUser(token.userId, token.id, token.email) as AccessActor };
}
const ROWS = { schema: 'public', name: 'rows' };
const OWN_ROWS = {
  version: 3,
  tables: [{
    table: ROWS,
    select_permissions: [{ role: 'viewer', permission: { columns: '*', filter: {} } }],
    insert_permissions: [{ role: 'viewer', permission: { columns: ['name'], check: {}, set: { created_by: 'X-Hasura-User-Id' } } }],
    update_permissions: [{ role: 'viewer', permission: { columns: ['name'], filter: { created_by: { _eq: 'X-Hasura-User-Id' } }, check: { created_by: { _eq: 'X-Hasura-User-Id' } } } }],
  }],
};

async function fixture() {
  const owner = await person('owner'), editor = await person('editor'), viewer = await person('viewer'), stranger = await person('stranger');
  const created = await createArtifactFromBody({ dataset: [{ name: 'a', created_by: 'x' }], title: 'Signups', access: 'readwrite', visibility: 'unlisted' }, owner.actor as AccessActor & { tokenId: string }, 'http://localhost:3000');
  expect(created.status, await created.clone().text()).toBe(201);
  const id = (await created.json()).id as string;
  const db = await getDb();
  for (const [who, role] of [[editor, 'editor'], [viewer, 'viewer']] as const)
    await db.query('INSERT INTO artifact_shares(artifact_id,user_id,email,role) VALUES($1,$2,$3,$4)', [id, who.userId, who.email, role]);
  return { owner, editor, viewer, stranger, id, db };
}
const read = async (id: string, who: Person) => { const r = await GET(request(`/api/artifacts/${id}/policy`, { token: who.token }), params(id)); return { status: r.status, body: await r.json() }; };
const put = async (id: string, who: Person, json: unknown) => { const r = await PUT(request(`/api/artifacts/${id}/policy`, { method: 'PUT', token: who.token, json }), params(id)); return { status: r.status, body: await r.json() }; };
const templates = async (id: string, who: Person, query = '') => { const r = await TEMPLATES(request(`/api/artifacts/${id}/policy/templates${query}`, { token: who.token }), params(id)); return { status: r.status, body: await r.json() }; };
const stored = async (id: string) => { const row = (await getArtifactById(id))!; return { policy: row.dataset_policy, revision: row.policy_revision ?? 0 }; };

it('reads a dataset with no stored policy as v3, with its GraphQL names, roles, read-back and report, for owners and editors only', async () => {
  const f = await fixture();
  const owned = await read(f.id, f.owner);
  expect(owned.status).toBe(200);
  expect(owned.body).toMatchObject({
    revision: 0,
    source: 'none',
    report: [],
    roles: { rules: ['viewer', 'signed_in', 'anonymous'], admin: ['owner', 'editor'] },
    templates: ['read-only', 'own-rows', 'editors-only'],
    tables: [{ table: ROWS, root: 'signups', columns: [{ name: 'name', field: 'name', type: 'string', graphqlType: 'String' }, { name: 'created_by', field: 'created_by', type: 'string', graphqlType: 'String' }] }],
    warnings: [],
  });
  expect(owned.body.policy).toMatchObject({ version: 3, tables: [{ table: ROWS, select_permissions: [{ role: 'viewer' }, { role: 'signed_in' }, { role: 'anonymous' }] }] });
  expect(owned.body.readBack).toMatch(/^Table public\.rows\n- Owner, editors: see and change everything\.\n/);
  expect(owned.body.readBack).toContain('Warnings: none.');
  expect((await read(f.id, f.editor)).status).toBe(200);
  // A viewer and a stranger hear the same thing as a dataset that does not exist.
  for (const who of [f.viewer, f.stranger]) expect(await read(f.id, who)).toEqual({ status: 404, body: { error: 'not_found' } });
  expect(await read('nOsUcH1d', f.owner)).toEqual({ status: 404, body: { error: 'not_found' } });
});

it('answers a stored policy that is not version 3 as unreadable, naming it, and lets the owner save a version 3 policy over it', async () => {
  const f = await fixture();
  await f.db.query('UPDATE artifacts SET dataset_policy=$2::jsonb WHERE id=$1', [f.id, JSON.stringify({ version: 1, enforcement: 'enabled', tables: [{ table: ROWS, insert_permissions: [{ role: 'viewer', permission: { columns: '*', check: {} } }] }] })]);
  const { status, body } = await read(f.id, f.owner);
  expect(status).toBe(200);
  expect(body).toMatchObject({ source: 'unreadable', policy: null, revision: 0, readBack: '' });
  expect(body.report).toEqual([{ code: 'unreadable', message: expect.stringMatching(/^The stored dataset policy is version 1: only version 3 is read\./) }]);
  expect(await put(f.id, f.owner, { policy: OWN_ROWS, expectedPolicyRevision: 0 })).toMatchObject({ status: 200, body: { revision: 1, policy: OWN_ROWS } });
  expect((await read(f.id, f.owner)).body).toMatchObject({ source: 'v3', report: [], policy: OWN_ROWS });
});

it('dry-runs: every problem by path naming the role, table or column, and the read-back of a valid policy, saving nothing', async () => {
  const f = await fixture();
  const bad = { version: 3, tables: [{ table: ROWS, select_permissions: [{ role: 'owner', permission: { columns: '*', filter: {} } }], insert_permissions: [{ role: 'viewer', permission: { columns: ['nmae'], check: {} } }] }, { table: { schema: 'public', name: 'orders' } }] };
  const refused = await put(f.id, f.owner, { policy: bad, dryRun: true });
  expect(refused.status).toBe(400);
  expect(refused.body.error).toBe('invalid_policy');
  const paths = refused.body.errors.map((e: { path: string }) => e.path);
  expect(paths).toEqual(expect.arrayContaining(['tables[0].select_permissions[0].role', 'tables[0].insert_permissions[0].permission.columns[0]', 'tables[1].table']));
  expect(JSON.stringify(refused.body.errors)).toMatch(/owner/);
  expect(JSON.stringify(refused.body.errors)).toMatch(/nmae/);
  expect(JSON.stringify(refused.body.errors)).toMatch(/public\.orders/);
  expect(refused.body.detail).toContain('tables[0].select_permissions[0].role');

  const dry = await put(f.id, f.owner, { policy: OWN_ROWS, dryRun: true });
  expect(dry.status).toBe(200);
  expect(dry.body).toMatchObject({ dryRun: true, saved: false, revision: 0, policy: OWN_ROWS });
  expect(dry.body.readBack).toContain('Shared viewers: see all rows and columns; add rows (filling name; created_by is set to them); change name only on rows they created.');
  expect(dry.body.readBack).toContain('Signed-in link holders, signed-out link holders: no access.');
  expect(dry.body.warnings).toEqual([]);
  expect(await stored(f.id)).toEqual({ policy: null, revision: 0 });
  // Version 1 and 2 bodies, dry run or save, get the stored-migration refusal pointing at version 3; nothing is saved.
  for (const policy of [{ version: 1, enforcement: 'enabled', tables: [] }, { version: 2, allow: [{ actions: ['read'], from: { user: '*' } }] }, { tables: [] }])
    for (const extra of [{ dryRun: true }, { expectedPolicyRevision: 0 }]) {
      const legacy = await put(f.id, f.owner, { policy, ...extra });
      expect(legacy).toMatchObject({ status: 400, body: { error: 'invalid_policy', errors: [{ path: 'version' }] } });
      expect(legacy.body.errors[0].message).toMatch(/^Version 1 and 2 dataset policies can no longer be set: send a version 3 policy/);
    }
  expect(await stored(f.id)).toEqual({ policy: null, revision: 0 });
  // Below editor, a legacy body hears the uniform 404, not the refusal.
  expect(await put(f.id, f.viewer, { policy: { version: 1, tables: [] }, dryRun: true })).toEqual({ status: 404, body: { error: 'not_found' } });
});

it('saves only at the current revision, answers the read-back, and refuses a stale revision with the current one', async () => {
  const f = await fixture();
  expect(await put(f.id, f.owner, { policy: OWN_ROWS })).toMatchObject({ status: 400, body: { error: 'invalid_policy', errors: [{ path: 'expectedPolicyRevision' }] } });
  const saved = await put(f.id, f.editor, { policy: OWN_ROWS, expectedPolicyRevision: 0 });
  expect(saved.status, JSON.stringify(saved.body)).toBe(200);
  expect(saved.body).toMatchObject({ saved: true, revision: 1, policy: OWN_ROWS });
  expect(saved.body.readBack).toContain('change name only on rows they created');
  expect(await stored(f.id)).toEqual({ policy: OWN_ROWS, revision: 1 });
  expect((await read(f.id, f.owner)).body).toMatchObject({ source: 'v3', revision: 1, policy: OWN_ROWS });
  expect(await put(f.id, f.owner, { policy: OWN_ROWS, expectedPolicyRevision: 0 })).toMatchObject({ status: 409, body: { error: 'policy_changed', revision: 1 } });
  // Nobody below editor learns the dataset exists, valid body or not.
  for (const who of [f.viewer, f.stranger]) {
    expect(await put(f.id, who, { policy: OWN_ROWS, expectedPolicyRevision: 1 })).toEqual({ status: 404, body: { error: 'not_found' } });
    expect(await put(f.id, who, { policy: OWN_ROWS, dryRun: true })).toEqual({ status: 404, body: { error: 'not_found' } });
  }
  expect((await stored(f.id)).revision).toBe(1);
});

it('keeps the server-owned configuration: omitted carries the stored one forward, a changed one is refused', async () => {
  const f = await fixture();
  const configured = { ...OWN_ROWS, tables: [{ ...OWN_ROWS.tables[0], configuration: { custom_name: 'people', custom_column_names: { name: 'full_name' } } }] };
  await f.db.query('UPDATE artifacts SET dataset_policy=$2::jsonb WHERE id=$1', [f.id, JSON.stringify(configured)]);
  expect((await read(f.id, f.owner)).body.tables[0]).toMatchObject({ root: 'people', columns: [{ name: 'name', field: 'full_name' }, { name: 'created_by', field: 'created_by' }] });
  const renamed = { ...OWN_ROWS, tables: [{ ...OWN_ROWS.tables[0], configuration: { custom_name: 'renamed' } }] };
  const refused = await put(f.id, f.owner, { policy: renamed, expectedPolicyRevision: 0 });
  expect(refused).toMatchObject({ status: 400, body: { error: 'invalid_policy', errors: [{ path: 'tables[0].configuration' }] } });
  expect((await put(f.id, f.owner, { policy: configured, expectedPolicyRevision: 0 })).status).toBe(200);
  const saved = await put(f.id, f.owner, { policy: OWN_ROWS, expectedPolicyRevision: 1 });
  expect(saved.status, JSON.stringify(saved.body)).toBe(200);
  expect((await stored(f.id)).policy).toEqual(configured);
});

it('lists the three templates built for the dataset, with the read-back of each and a named error for a missing owner column', async () => {
  const f = await fixture();
  const plain = await templates(f.id, f.owner);
  expect(plain.status).toBe(200);
  expect(plain.body.revision).toBe(0);
  expect(plain.body.templates.map((t: { name: string; ok: boolean }) => [t.name, t.ok])).toEqual([['read-only', true], ['own-rows', false], ['editors-only', true]]);
  expect(plain.body.templates[1].errors).toEqual([{ path: 'ownerColumn', message: 'own-rows needs an owner column' }]);
  expect(plain.body.templates[2].readBack).toContain('Shared viewers, signed-in link holders, signed-out link holders: no access.');
  const owned = await templates(f.id, f.owner, '?ownerColumn=created_by');
  expect(owned.body.templates[1]).toMatchObject({ name: 'own-rows', ok: true, policy: { version: 3 } });
  expect(owned.body.templates[1].readBack).toContain('delete rows they created');
  expect((await templates(f.id, f.owner, '?ownerColumn=nope')).body.templates[1].errors[0].message).toContain('unknown column "nope"');
  expect(await templates(f.id, f.viewer)).toEqual({ status: 404, body: { error: 'not_found' } });
});

it('serves the app editor through the browser session: owners and editors read, dry-run, save and list templates; cross-site writes and strangers are refused', async () => {
  const f = await fixture();
  const session = (who: Person) => ({ credential: 'session' as const, userId: who.userId!, email: who.email!, emailVerified: true });
  const browser = async (who: Person, method: 'GET' | 'PUT', json?: unknown, origin = 'same') => {
    const r = await (method === 'GET' ? GET : PUT)(request(`/api/artifacts/${f.id}/policy`, { method, actor: session(who), origin, ...(json ? { json } : {}) }), params(f.id));
    return { status: r.status, body: await r.json() };
  };
  expect(await browser(f.owner, 'GET')).toMatchObject({ status: 200, body: { source: 'none', revision: 0 } });
  expect(await browser(f.editor, 'PUT', { policy: OWN_ROWS, dryRun: true })).toMatchObject({ status: 200, body: { dryRun: true, saved: false } });
  expect(await browser(f.owner, 'PUT', { policy: OWN_ROWS, expectedPolicyRevision: 0 })).toMatchObject({ status: 200, body: { saved: true, revision: 1 } });
  const listed = await TEMPLATES(request(`/api/artifacts/${f.id}/policy/templates?ownerColumn=created_by`, { actor: session(f.owner), origin: 'same' }), params(f.id));
  expect(listed.status).toBe(200);
  expect((await listed.json()).templates[1]).toMatchObject({ name: 'own-rows', ok: true });
  expect((await browser(f.owner, 'PUT', { policy: OWN_ROWS, expectedPolicyRevision: 1 }, 'https://evil.example')).status).toBe(403);
  for (const who of [f.viewer, f.stranger]) expect(await browser(who, 'GET')).toEqual({ status: 404, body: { error: 'not_found' } });
  expect((await GET(request(`/api/artifacts/${f.id}/policy`), params(f.id))).status).toBe(401);
  expect((await stored(f.id)).revision).toBe(1);
});
