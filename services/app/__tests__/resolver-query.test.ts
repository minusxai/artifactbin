/**
 * caps.query AS THE CALLER (resolvers plan, PR 5): a resolver reads the datasets its page links through the
 * generated Hasura-style API with the caller's dataset role (the page audience rule over the dataset's own
 * sharing), never the page owner's rights. In process the caller is the admitted request's principal; remotely it is
 * the signed runner pin, which the app reads instead of rebuilding an anonymous caller.
 */
import { beforeEach, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { attachActor } from '@artifactbin/utils';
import type { Actor, RunStart } from '@artifactbin/contracts';
import { mintAccountToken, request, setSession, useAppHarness } from './harness';
import { identityForUser, type AccessActor } from '@/lib/accounts';
import { getDb } from '@/lib/platform';
import { createArtifactFromBody } from '@/lib/publish';
import { readHtmlPage } from '@/lib/html-publication';
import { getHtmlBackendVersion, htmlLiveLinks, htmlSharedRevisions } from '@/lib/html-backends';
import { localPageBackendCapability, pageBackendOperation } from '@/lib/page-operations';
import { resolverDatasets } from '@/lib/page-graphql';
import { getArtifactById } from '@/lib/artifacts';
import { loadDatasetRows } from '@/lib/datasets';

vi.mock('@/lib/page-operations', async (original) => ({
  ...await original<typeof import('@/lib/page-operations')>(),
  compilePageBackend: async (source: string) => ({ typeDefs: 'type Query { targets: Int }', compiled: source, secretBindings: [], secretHosts: {} }),
}));
useAppHarness();
beforeEach(() => setSession(null));

type Person = Awaited<ReturnType<typeof person>>;
async function person(name: string) {
  const token = await mintAccountToken(`rq_${name}`);
  return { ...token, actor: identityForUser(token.userId, token.id, token.email) as AccessActor & { tokenId: string } };
}
async function publish(owner: Person, body: Record<string, unknown>) {
  const created = await createArtifactFromBody({ ...('dataset' in body ? { access: 'readwrite' } : {}), visibility: 'unlisted', ...body }, owner.actor, 'http://localhost:3000');
  expect(created.status, await created.clone().text()).toBe(201);
  return (await created.json()).id as string;
}

const STAFF = [{ name: 'ada', team: 'red', salary: 10 }, { name: 'bo', team: 'blue', salary: 20 }, { name: 'cy', team: 'red', salary: 30 }];
const POLICY = { version: 3, tables: [{ table: { schema: 'public', name: 'rows' }, select_permissions: [
  { role: 'viewer', permission: { columns: ['name', 'team'], filter: { team: { _eq: 'red' } }, allow_aggregations: false } },
  { role: 'signed_in', permission: { columns: '*', filter: {}, limit: 2, allow_aggregations: true } },
] }] };

/** A page linking `staff` (v3 rule: viewers see red rows, other accounts 2 rows, anonymous nothing) and a resolver. */
async function fixture() {
  const owner = await person('owner'), viewer = await person('viewer'), other = await person('other');
  const staff = await publish(owner, { dataset: STAFF, title: 'Staff' });
  const unlinked = await publish(owner, { dataset: [{ secret: 'x' }], title: 'Hidden' });
  const db = await getDb();
  await db.query("INSERT INTO artifact_shares(artifact_id,user_id,email,role) VALUES($1,$2,$3,'viewer')", [staff, viewer.userId, viewer.email]);
  await db.query('UPDATE artifacts SET dataset_policy=$2::jsonb, policy_revision=policy_revision+1 WHERE id=$1', [staff, JSON.stringify(POLICY)]);
  const pageId = await publish(owner, {
    html: `<html><head><link rel="af-dataset" data-af-name="staff" href="ref:${staff}"><link rel="af-resolver" data-af-name="budget" href="./budget.ts"></head><body>Budget</body></html>`,
    resolverSources: { budget: 'export default {}' },
  });
  const page = await readHtmlPage(owner.actor, pageId);
  const link = page.links.find((l) => l.kind === 'backend');
  if (link?.kind !== 'backend') throw Error('missing resolver link');
  const backend = (await getHtmlBackendVersion(link.backendId, link.version))!;
  return { owner, viewer, other, staff, unlinked, pageId, link, backend };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;

const READ = '{ staff(order_by: {name: asc}) { name } }';
const names = (data: unknown) => (data as { staff: Array<{ name: string }> }).staff.map((r) => r.name);
/** The admitted request a run carries in process: the app's principal, with the caller's subject and page role. */
const admitted = (f: Fixture, caller: { subject: string | null; role: string } | null, pageBackendOperation: 'query' | 'mutation' = 'query'): RunStart => ({
  requestId: 'r', userId: f.backend.ownerId, pageBackendOperation, artifactId: f.backend.backendId, artifactVersion: f.backend.version,
  program: { source: f.backend.compiled, language: 'javascript' }, input: { kind: 'invoke', principal: { tenant: f.pageId, subject: caller?.subject ?? null, ...(caller ? { role: caller.role } : {}) } },
});
const inProcess = (f: Fixture, caller: { subject: string | null; role: string } | null, query: string, op: 'query' | 'mutation' = 'query') =>
  localPageBackendCapability(admitted(f, caller, op), 'artifactbin.pageBackend.query', { query }, undefined, resolverDatasets);

it('runs as the caller: owner, a viewer share and a signed-in reader see different rows under the v3 select rule; anonymous none', async () => {
  const f = await fixture();
  expect(names(await inProcess(f, { subject: f.owner.userId, role: 'owner' }, READ))).toEqual(['ada', 'bo', 'cy']);
  expect(names(await inProcess(f, { subject: f.viewer.userId, role: 'viewer' }, READ))).toEqual(['ada', 'cy']);
  // No sharing of their own: through the page they are signed_in (the rule's limit 2), never viewer.
  expect(names(await inProcess(f, { subject: f.other.userId, role: 'viewer' }, READ))).toHaveLength(2);
  // The page role never picks the dataset role: a viewer claiming owner on the page still reads as the dataset decides.
  expect(names(await inProcess(f, { subject: f.viewer.userId, role: 'owner' }, READ))).toEqual(['ada', 'cy']);
  await expect(inProcess(f, { subject: null, role: 'anonymous' }, READ)).rejects.toThrow(/^unavailable/);
  // A hidden column is not in the viewer's schema.
  await expect(inProcess(f, { subject: f.viewer.userId, role: 'viewer' }, '{ staff { salary } }')).rejects.toThrow(/^validation_failed: /);
});

it('sees only the page\'s linked datasets under their page names', async () => {
  const f = await fixture();
  const owner = { subject: f.owner.userId, role: 'owner' };
  await expect(inProcess(f, owner, '{ hidden { secret } }')).rejects.toThrow(/^validation_failed: /);
  await expect(inProcess(f, owner, '{ budget { targets } }')).rejects.toThrow(/^validation_failed: /);
  expect(await inProcess(f, owner, '{ staff_aggregate { aggregate { count } } }')).toEqual({ staff_aggregate: { aggregate: { count: 3 } } });
});

it('refuses mutations in query resolvers; in mutation resolvers they write as the caller under the dataset rules', async () => {
  const f = await fixture();
  // Other accounts (signed_in through the page) may add a row, stamped with the page and themselves.
  const db = await getDb();
  const policy = { ...POLICY, tables: [{ ...POLICY.tables[0]!, insert_permissions: [{ role: 'signed_in', permission: { columns: ['name'], check: {}, set: { team: 'X-Hasura-Page-Id', salary: 0 } } }] }] };
  await db.query('UPDATE artifacts SET dataset_policy=$2::jsonb, policy_revision=policy_revision+1 WHERE id=$1', [f.staff, JSON.stringify(policy)]);
  const owner = { subject: f.owner.userId, role: 'owner' };
  const write = (name: string) => `mutation { insert_staff_one(object: {name: "${name}"}) { _id } }`;
  await expect(inProcess(f, owner, write('zed'), 'query')).rejects.toThrow(/^permission_denied: /);
  expect(await inProcess(f, owner, write('dee'), 'mutation')).toEqual({ insert_staff_one: { _id: expect.any(String) } });
  // Written; the row it returns is outside the signed_in select rule's 2-row window, so the role sees null (as in Hasura).
  expect(await inProcess(f, { subject: f.other.userId, role: 'viewer' }, write('eve'), 'mutation')).toEqual({ insert_staff_one: null });
  // The viewer share has no insert rule: the caller's schema has no insert root.
  await expect(inProcess(f, { subject: f.viewer.userId, role: 'viewer' }, write('fay'), 'mutation')).rejects.toThrow(/^validation_failed: /);
  await expect(inProcess(f, { subject: null, role: 'anonymous' }, write('gus'), 'mutation')).rejects.toThrow(/^unavailable/);
  const rows = await loadDatasetRows((await getArtifactById(f.staff))!);
  expect(rows.map((r) => r.name)).toEqual(['ada', 'bo', 'cy', 'dee', 'eve']);
  expect(rows.find((r) => r.name === 'eve')).toMatchObject({ team: f.pageId, salary: 0 });
});

it('refuses a run that does not attest its caller, and bounds the document', async () => {
  const f = await fixture();
  await expect(inProcess(f, null, READ)).rejects.toThrow(/^caller_unavailable/);
  await expect(inProcess(f, { subject: f.owner.userId, role: 'owner' }, `{ staff { name } } #${'x'.repeat(16 * 1024)}`)).rejects.toThrow(/^validation_failed: a query document is at most 16384 bytes/);
  await expect(localPageBackendCapability(admitted(f, { subject: f.owner.userId, role: 'owner' }), 'artifactbin.pageBackend.query', { query: READ })).rejects.toThrow('backend_capability_forbidden');
});

it('remote callback: the caller comes from the signed pin, never from arguments; a pin without one is refused', async () => {
  const f = await fixture();
  const pin = (caller?: { subject: string | null; role: 'owner' | 'viewer' | 'anonymous' }): Actor => ({ credential: 'session', userId: f.backend.ownerId,
    runner: { pageBackendOperation: 'query', runId: 'run1', callId: 1, artifactId: f.backend.backendId, version: f.backend.version, editId: f.backend.version, sourceHash: createHash('sha256').update(f.backend.compiled).digest('hex'), ...(caller ? { caller } : {}) } });
  const call = async (actor: Actor, input: Record<string, unknown>) => {
    const response = await pageBackendOperation(attachActor(request('/api/runner/operations', { method: 'POST' }), actor), 'pageBackend.query', input as never, f.backend.compiled, resolverDatasets);
    return { status: response.status, body: await response.json() };
  };
  expect(names((await call(pin({ subject: f.viewer.userId, role: 'viewer' }), { query: READ })).body)).toEqual(['ada', 'cy']);
  expect(names((await call(pin({ subject: f.owner.userId, role: 'owner' }), { query: READ })).body)).toEqual(['ada', 'bo', 'cy']);
  // Arguments naming another caller change nothing.
  expect(names((await call(pin({ subject: f.viewer.userId, role: 'viewer' }), { query: READ, principal: { subject: f.owner.userId, role: 'owner' }, subject: f.owner.userId })).body)).toEqual(['ada', 'cy']);
  expect(await call(pin(), { query: READ })).toEqual({ status: 400, body: { error: 'caller_unavailable: the run does not attest who called' } });
});

it('a write to a linked dataset moves the resolver\'s revision, whoever reads', async () => {
  const f = await fixture();
  const revisions = async (mayRead: boolean) => {
    const row = (await getArtifactById(f.pageId))!;
    return htmlSharedRevisions(await getDb(), htmlLiveLinks(row.meta), { mayReadDataset: async () => mayRead });
  };
  const before = await revisions(true);
  const budget = before.find((r) => r.name === 'budget')!.revision;
  expect(budget).toMatch(new RegExp(`^resolver:${f.link.backendId}:[A-Za-z0-9_-]{43}$`));
  expect(budget).not.toContain(f.staff);
  // A reader without access of their own to the dataset still reads it through caps.query: the same revision.
  expect((await revisions(false)).find((r) => r.name === 'budget')!.revision).toBe(budget);
  await (await getDb()).query('UPDATE artifacts SET version=version+1, edit_id=$2 WHERE id=$1', [f.staff, 'edit-2']);
  const after = await revisions(true);
  expect(after.find((r) => r.name === 'budget')!.revision).not.toBe(budget);
  expect(after.find((r) => r.name === 'staff')!.revision).not.toBe(before.find((r) => r.name === 'staff')!.revision);
});
