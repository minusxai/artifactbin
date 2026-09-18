/**
 * An account looking at a sandbox copy sees the test user BY NAME. Its rows are
 * the point of the exercise; "Unknown person" would hide the very thing the
 * account came to check.
 */
import { beforeEach, expect, it, vi } from 'vitest';
import { agentCookie, request, useAppHarness } from './harness';
import { POST as createArtifactRoute } from '@/app/api/artifacts/route';
import { PATCH as patchArtifact } from '@/app/api/artifacts/[id]/route';
import { POST as forkOpRoute } from '@/app/api/artifacts/[id]/fork/route';
import { POST as newTestUser } from '@/app/api/testusers/route';
import { POST as mutate } from '@/app/a/[id]/mutate/route';
import { POST as query } from '@/app/a/[id]/query/route';
import { observedRequest } from '@/__tests__/conditional-request';
import { mintToken } from '@/lib/tokens';
import { claimToken, createUser } from '@/lib/users';
import { viewersWritePolicy } from '@artifactbin/utils';
import { getArtifactById } from '@/lib/artifacts';
import { readFileSync } from 'node:fs';
import path from 'node:path';

useAppHarness();
const sessionUser = { id: '', email: '' };
vi.mock('@/auth', () => ({ auth: async () => (sessionUser.id ? { user: { id: sessionUser.id, email: sessionUser.email || null } } : null) }));
beforeEach(() => { sessionUser.id = ''; sessionUser.email = ''; });
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const PAGE = readFileSync(path.resolve(process.cwd(), '__tests__/fixtures/splitwise-2RbE7f.jsx'), 'utf8');
const DATASET = `<Dataset kind="stored">
  <Table schema="public" name="people" rows={[]} columns={[{"name":"person","type":"user","constraints":{"self":true}},{"name":"joined_on","type":"date"}]} />
  <Table schema="public" name="expenses" rows={[]} columns={[{"name":"id","type":"string"},{"name":"paid_by","type":"user","constraints":{"self":true}},{"name":"spent_on","type":"date"},{"name":"item","type":"string"},{"name":"amount","type":"number"}]} />
</Dataset>`;

it('labels a test user for the account viewing the sandbox copy', async () => {
  const t = await mintToken('owner'); const me = await createUser({ email: 'mxmx_test_me@example.com' }); await claimToken(me.id, t.token);
  const publish = async (body: object) => { const r = await createArtifactRoute(request('/api/artifacts', { method: 'POST', token: t.token, json: body })); expect(r.status, await r.clone().text()).toBe(201); return (await r.json()).id as string; };
  const ds = await publish({ dataset: DATASET, access: 'readwrite', visibility: 'unlisted' });
  const head = await getArtifactById(ds);
  const granted = await patchArtifact(await observedRequest(`/api/artifacts/${ds}`, { method: 'PATCH', token: t.token, json: { policy: viewersWritePolicy([{ schema: 'public', name: 'people' }, { schema: 'public', name: 'expenses' }]), expectedPolicyRevision: head!.policy_revision ?? 0 } }), ctx(ds));
  expect(granted.status).toBe(200);
  const doc = await publish({ markup: PAGE.replaceAll('ref:hf8fYY', `ref:${ds}`), visibility: 'unlisted' });
  const tu = await newTestUser(request('/api/testusers', { method: 'POST', token: t.token, json: {} }));
  const { id: tuId, label } = (await tu.json()) as { id: string; label: string };
  const forked = await forkOpRoute(request(`/api/artifacts/${doc}/fork`, { method: 'POST', token: t.token, json: { as: { testuser: tuId } } }), ctx(doc));
  const copy = ((await forked.json()) as { id: string }).id;
  // The test user joins its copy (through the app's own door, as a session would).
  const { createTestUser } = await import('@/lib/testusers');
  void createTestUser;
  const { resolveTestUser } = await import('@/lib/testusers');
  const resolved = await resolveTestUser(me.id, tuId);
  if (typeof resolved === 'string') throw new Error(`test user not resolvable: ${resolved}`);
  const tuCookie = await agentCookie([resolved.tokenId]);
  sessionUser.id = tuId; sessionUser.email = '';
  const joined = await mutate(request(`/a/${copy}/mutate`, { method: 'POST', cookie: tuCookie, json: { mutation: 'join' } }), ctx(copy));
  expect(joined.status, await joined.clone().text()).toBe(200);
  // The account reads the copy: the test user's row carries its label.
  sessionUser.id = me.id; sessionUser.email = me.email;
  const cookie = await agentCookie([t.id]);
  const r = await query(request(`/a/${copy}/query`, { method: 'POST', cookie, json: {} }), ctx(copy));
  const body = (await r.json()) as { userLabels: Record<string, string>; tables: { balances: { rows: Array<{ person: string }> } } };
  expect(body.tables.balances.rows.map((x) => x.person)).toEqual([tuId]);
  expect(body.userLabels[tuId]).toBe(label);
});
