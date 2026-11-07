/**
 * THE SKILL'S PERMISSION AND DATASET GRAPHQL COMMANDS against the real app (createAppServer, real tokens):
 * policy.mjs get/explain/template/set (dry run, revision from the file, conflict exit 4, invalid exit 2 with
 * every error by path, access exit 3) and graphql.mjs on a dataset ID (the server says it is a dataset; the
 * role's schema; queries; a mutation's idempotency key printed and replayed at most once; --revision refused).
 */
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, it } from 'vitest';
import { mintAccountToken, useAppHarness } from './harness';
import { identityForUser, type AccessActor } from '@/lib/accounts';
import { getDb } from '@/lib/platform';
import { createArtifactFromBody } from '@/lib/publish';
import { getArtifactById } from '@/lib/artifacts';
import { loadDatasetRows } from '@/lib/datasets';
import { createAppServer } from '@/server/app';

useAppHarness();

const SERVER = 'http://localhost:3000';
const app = createAppServer({ webDir: 'dist/web' });
const fetcher = (async (input: string | URL | Request, init?: RequestInit) => app.fetch(new Request(String(input), init))) as typeof fetch;
const options = (token: string) => ({ env: { ARTIFACTBIN_URL: SERVER, ARTIFACTBIN_TOKEN: token }, fetcher, retryDelays: [] });
const { policyCommand } = await import('../skills/artifactbin/scripts/policy.mjs');
const { graphqlCommand } = await import('../skills/artifactbin/scripts/graphql.mjs');
type Values = Record<string, unknown>;
const policy = (token: string, sub: string, positionals: string[], values: Values = {}) => policyCommand({ sub, positionals, values }, options(token));
const graphql = (token: string, sub: string, positionals: string[], values: Values = {}) => graphqlCommand({ sub, positionals, values }, options(token));
const failure = async (run: Promise<unknown>) => { try { await run; } catch (error) { return error as { code: string; exit: number; details?: any }; } throw new Error('expected a refusal'); };

async function fixture() {
  const owner = await mintAccountToken('cli_owner'), viewer = await mintAccountToken('cli_viewer');
  const created = await createArtifactFromBody({ dataset: [{ name: 'seed', created_by: 'nobody' }], title: 'Signups', access: 'readwrite', visibility: 'unlisted' }, identityForUser(owner.userId, owner.id) as AccessActor & { tokenId: string }, SERVER);
  expect(created.status, await created.clone().text()).toBe(201);
  const id = (await created.json()).id as string;
  await (await getDb()).query("INSERT INTO artifact_shares(artifact_id,user_id,email,role) VALUES($1,$2,$3,'viewer')", [id, viewer.userId, viewer.email]);
  const dir = await mkdtemp(path.join(tmpdir(), 'policy-cli-'));
  const file = async (name: string, value: unknown) => { const at = path.join(dir, name); await writeFile(at, typeof value === 'string' ? value : JSON.stringify(value)); return at; };
  return { owner, viewer, id, file };
}

it('gets, explains, builds a template, dry-runs and saves it with the revision the file carries, and refuses a stale one', async () => {
  const f = await fixture();
  const got = await policy(f.owner.token, 'get', [f.id]);
  expect(got).toMatchObject({ revision: 0, source: 'none', tables: [{ root: 'signups', columns: [{ name: 'name', field: 'name' }, { name: 'created_by', field: 'created_by' }] }] });
  const explained = await policy(f.owner.token, 'explain', [f.id]);
  expect(explained.readBack).toEqual(['Table public.rows', '- Owner, editors: see and change everything.', '- Shared viewers, signed-in link holders, signed-out link holders: see all rows and columns, and run SQL over them; cannot change anything.', 'Warnings: none.']);

  expect(await failure(policy(f.owner.token, 'template', ['own-rows', f.id]))).toMatchObject({ code: 'invalid_template', exit: 2, details: { errors: [{ path: 'ownerColumn' }] } });
  const template = await policy(f.owner.token, 'template', ['own-rows', f.id], { 'owner-column': 'created_by' });
  expect(template).toMatchObject({ template: 'own-rows', revision: 0, policy: { version: 3 } });
  // The file a template (or get) writes is what set reads: its policy, and its revision for the compare-and-swap.
  const saved = await f.file('own-rows.json', { ok: true, code: 'completed', ...template });
  const dry = await policy(f.owner.token, 'set', [f.id], { file: saved, 'dry-run': true });
  expect(dry).toMatchObject({ dryRun: true, saved: false, revision: 0 });
  expect(dry.readBack).toContain('- Signed-out link holders: see all rows and columns, and run SQL over them; cannot change anything.');
  expect((await getArtifactById(f.id))!.policy_revision ?? 0).toBe(0);
  expect(await policy(f.owner.token, 'set', [f.id], { file: saved })).toMatchObject({ saved: true, revision: 1 });
  expect((await policy(f.owner.token, 'get', [f.id])).source).toBe('v3');
  // The same file again: its revision is stale now.
  expect(await failure(policy(f.owner.token, 'set', [f.id], { file: saved }))).toMatchObject({ code: 'policy_changed', exit: 4, details: { revision: 1 } });
  // A bare policy needs the revision on the command line.
  const bare = await f.file('bare.json', template.policy);
  expect(await failure(policy(f.owner.token, 'set', [f.id], { file: bare }))).toMatchObject({ code: 'missing_expected_revision', exit: 2 });
  expect(await policy(f.owner.token, 'set', [f.id], { file: bare, 'expected-revision': '1' })).toMatchObject({ saved: true, revision: 2 });
});

it('exits 2 with every error by path for an invalid policy, 2 for a legacy file, and 3 for a viewer', async () => {
  const f = await fixture();
  const bad = await f.file('bad.json', { version: 3, tables: [{ table: { schema: 'public', name: 'rows' }, insert_permissions: [{ role: 'owner', permission: { columns: ['nmae'], check: {} } }] }] });
  const refused = await failure(policy(f.owner.token, 'set', [f.id], { file: bad, 'dry-run': true }));
  expect(refused).toMatchObject({ code: 'invalid_policy', exit: 2 });
  expect(refused.details.errors.map((e: { path: string }) => e.path)).toEqual(expect.arrayContaining(['tables[0].insert_permissions[0].role', 'tables[0].insert_permissions[0].permission.columns[0]']));
  const legacy = await f.file('legacy.json', { version: 1, enforcement: 'enabled', tables: [] });
  expect(await failure(policy(f.owner.token, 'set', [f.id], { file: legacy, 'expected-revision': '0' }))).toMatchObject({ code: 'policy_version_unsupported', exit: 2 });
  expect(await failure(policy(f.viewer.token, 'get', [f.id]))).toMatchObject({ code: 'not_found', exit: 3 });
  expect(await failure(policy(f.viewer.token, 'set', [f.id], { file: bad, 'dry-run': true }))).toMatchObject({ code: 'not_found', exit: 3 });
});

it('targets a dataset ID through graphql.mjs: the role\'s schema, a query, and a keyed mutation that applies at most once', async () => {
  const f = await fixture();
  const schema = await graphql(f.owner.token, 'schema', [f.id]);
  expect(schema).toMatchObject({ target: 'dataset', role: 'owner' });
  expect(schema.sdl).toContain('insert_signups_one(');
  expect(await graphql(f.viewer.token, 'schema', [f.id])).toMatchObject({ target: 'dataset', role: 'viewer' });
  expect(await failure(graphql(f.owner.token, 'schema', [f.id], { revision: '1' }))).toMatchObject({ code: 'revision_unsupported', exit: 2 });

  const query = await f.file('q.graphql', '{ signups { name } }');
  expect(await graphql(f.viewer.token, 'query', [f.id], { document: query })).toEqual({ data: { signups: [{ name: 'seed' }] } });
  const mutation = await f.file('m.graphql', 'mutation Add($name: String) { insert_signups_one(object: {name: $name}) { name } }');
  const variables = await f.file('v.json', { name: 'ada' });
  const added = await graphql(f.owner.token, 'mutate', [f.id], { document: mutation, variables });
  expect(added).toMatchObject({ data: { insert_signups_one: { name: 'ada' } }, idempotencyKey: expect.any(String) });
  const replayed = await graphql(f.owner.token, 'mutate', [f.id], { document: mutation, variables, 'idempotency-key': added.idempotencyKey });
  expect(replayed).toEqual(added);
  expect((await loadDatasetRows((await getArtifactById(f.id))!)).map((r) => r.name)).toEqual(['seed', 'ada']);
  // The viewer has no write rule (read-only reading): the SDL has no mutation root, so the document is refused locally.
  expect(await failure(graphql(f.viewer.token, 'mutate', [f.id], { document: mutation, variables }))).toMatchObject({ code: 'graphql_validation', exit: 2, details: { errors: ['This schema has no mutations: your role may not write here.'] } });
  expect(await failure(graphql(f.owner.token, 'query', ['nOsUcH1d'], { document: query }))).toMatchObject({ exit: 3 });
});
