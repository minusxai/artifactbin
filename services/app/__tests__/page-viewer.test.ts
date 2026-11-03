/**
 * THE BUILT-IN VIEWER through the page GraphQL handler: every page answers `{ viewer { signedIn id name } }` with no
 * link. A signed-in reader reads the id their dataset writes are stamped with (`X-Hasura-User-Id`, a resolver's
 * `principal.subject`) and their display name, never their email; a signed-out reader reads nulls, never an error.
 * Publishing a link named `viewer` is refused.
 */
import { beforeEach, expect, it } from 'vitest';
import { mintAccountToken, request, setSession, useAppHarness } from './harness';
import { identityForUser, type AccessActor } from '@/lib/accounts';
import { getDb } from '@/lib/platform';
import { createArtifactFromBody } from '@/lib/publish';
import { POST } from '@/app/api/artifacts/[id]/graphql/route';

useAppHarness();
beforeEach(() => setSession(null));

type Person = Awaited<ReturnType<typeof person>>;
async function person(name: string) {
  const token = await mintAccountToken(`viewer_${name}`);
  return { ...token, actor: identityForUser(token.userId, token.id, token.email) as AccessActor & { tokenId: string } };
}
async function publish(owner: Person, body: Record<string, unknown>) {
  const created = await createArtifactFromBody({ ...('dataset' in body ? { access: 'readwrite' } : {}), visibility: 'unlisted', ...body }, owner.actor, 'http://localhost:3000');
  return { status: created.status, body: await created.json() as { id: string; error?: string; details?: string[] } };
}
async function gql(page: string, who: Person | null, query: string) {
  const response = await POST(request(`/api/artifacts/${page}/graphql`, { method: 'POST', json: { query, revision: '1' }, ...(who ? { token: who.token } : {}) }), { params: Promise.resolve({ id: page }) });
  const text = await response.text();
  return { status: response.status, text, body: JSON.parse(text) as { data?: Record<string, any> | null; errors?: unknown[] } };
}
const VIEWER = '{ viewer { signedIn id name } }';
const ROWS = { schema: 'public', name: 'rows' };
const POLICY = { version: 3, tables: [{
  table: ROWS,
  select_permissions: [{ role: 'signed_in', permission: { columns: '*', filter: {} } }],
  insert_permissions: [{ role: 'signed_in', permission: { columns: ['name'], check: {}, set: { by: 'X-Hasura-User-Id' } } }],
}] };

it('answers a page with no links: the signed-in reader\'s id and display name, never their email; nulls signed out', async () => {
  const owner = await person('owner'), reader = await person('reader');
  await (await getDb()).query('UPDATE users SET name=$2 WHERE id=$1', [owner.userId, 'Ada Lovelace']);
  const page = await publish(owner, { html: '<html><head></head><body>No links</body></html>' });
  expect(page.status, JSON.stringify(page.body)).toBe(201);

  const mine = await gql(page.body.id, owner, VIEWER);
  expect(mine.status).toBe(200);
  expect(mine.body).toEqual({ data: { viewer: { signedIn: true, id: owner.userId, name: 'Ada Lovelace' } } });
  expect(mine.text).not.toContain(owner.email!);
  expect(mine.text).not.toContain(owner.token);

  const theirs = await gql(page.body.id, reader, '{ viewer { signedIn id } }');
  expect(theirs.body).toEqual({ data: { viewer: { signedIn: true, id: reader.userId } } });

  const guest = await gql(page.body.id, null, VIEWER);
  expect(guest.status).toBe(200);
  expect(guest.body).toEqual({ data: { viewer: { signedIn: false, id: null, name: null } } });
});

it('gives the id a dataset write is stamped with (X-Hasura-User-Id), so a page can compare row owners', async () => {
  const owner = await person('dsowner'), writer = await person('writer');
  const dataset = await publish(owner, { dataset: [{ name: 'seed', by: 'seed' }], title: 'Notes' });
  expect(dataset.status).toBe(201);
  await (await getDb()).query('UPDATE artifacts SET dataset_policy=$2::jsonb, policy_revision=policy_revision+1 WHERE id=$1', [dataset.body.id, JSON.stringify(POLICY)]);
  const page = await publish(owner, { html: `<html><head><link rel="af-dataset" data-af-name="notes" href="ref:${dataset.body.id}"></head><body>Notes</body></html>` });
  expect(page.status, JSON.stringify(page.body)).toBe(201);
  const written = await gql(page.body.id, writer, 'mutation { insert_notes_one(object: {name: "mine"}) { by } }');
  expect(written.body.errors).toBeUndefined();
  const viewer = await gql(page.body.id, writer, '{ viewer { id } notes(where: {name: {_eq: "mine"}}) { by } }');
  expect(viewer.body.data).toEqual({ viewer: { id: writer.userId }, notes: [{ by: writer.userId }] });
});

it('refuses to publish a link named viewer, resolver or dataset: the built-in cannot be shadowed', async () => {
  const owner = await person('shadow');
  const resolver = await publish(owner, { html: '<html><head><link rel="af-resolver" data-af-name="viewer" href="./viewer.ts"></head><body>x</body></html>', resolverSources: { viewer: 'export const typeDefs="type Query { signedIn: Boolean }"; export default { signedIn: () => true };' } });
  expect(resolver.status).toBe(400);
  expect(resolver.body).toEqual({ error: 'graphql_root_collision', details: ['link "viewer" names viewer, the built-in viewer query; rename the link'] });
  const dataset = await publish(owner, { dataset: [{ name: 'x' }], title: 'Shadow' });
  const linked = await publish(owner, { html: `<html><head><link rel="af-dataset" data-af-name="viewer" href="ref:${dataset.body.id}"></head><body>x</body></html>` });
  expect(linked.status).toBe(400);
  expect(linked.body).toEqual({ error: 'graphql_root_collision', details: ['link "viewer" names viewer, the built-in viewer query; rename the link'] });
});
