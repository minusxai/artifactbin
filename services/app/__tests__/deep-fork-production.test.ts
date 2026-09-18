/**
 * THE FORK THAT FAILED IN PRODUCTION (2RbE7f, 2026-09-18): a Splitwise tab whose `people` and
 * `expenses` tables carry `user` columns constrained to the writer's own id, with rows naming the
 * ORIGINAL owner, and a page that writes both. The copy carries those rows verbatim; re-judging
 * them under the forker's id refused the whole fork (and surfaced as a 500). The page body here is
 * the production page as pulled, node ids and all; the dataset is the reference's definition.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { beforeEach, expect, it, vi } from 'vitest';
import { POST as create } from '@/app/api/artifacts/route';
import { PATCH as patchArtifact } from '@/app/api/artifacts/[id]/route';
import { POST as forkRoute } from '@/app/api/my/artifacts/[id]/fork/route';
import { POST as mutate } from '@/app/a/[id]/mutate/route';
import { POST as query } from '@/app/a/[id]/query/route';
import { getArtifactById } from '@/lib/artifacts';
import { mintToken } from '@/lib/tokens';
import { claimToken, createUser } from '@/lib/users';
import { observedRequest } from '@/__tests__/conditional-request';
import { viewersWritePolicy } from '@artifactbin/utils';
import { agentCookie, request, useAppHarness } from './harness';

useAppHarness();
const sessionUser = { id: '', email: '' };
vi.mock('@/auth', () => ({
  auth: async () => (sessionUser.id ? { user: { id: sessionUser.id, email: sessionUser.email || null } } : null),
}));
beforeEach(() => { sessionUser.id = ''; sessionUser.email = ''; });
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const PAGE = readFileSync(path.resolve(process.cwd(), '__tests__/fixtures/splitwise-2RbE7f.jsx'), 'utf8');
const dataset = (ownerId: string) => `<Dataset kind="stored">
  <Table schema="public" name="people" rows={[{"person":"${ownerId}","joined_on":"2026-09-18"}]}
    columns={[{"name":"person","type":"user","constraints":{"self":true}},{"name":"joined_on","type":"date"}]} />
  <Table schema="public" name="expenses" rows={[{"id":"e1","paid_by":"${ownerId}","spent_on":"2026-09-18","item":"Groceries","amount":48.5}]}
    columns={[{"name":"id","type":"string"},{"name":"paid_by","type":"user","constraints":{"self":true}},{"name":"spent_on","type":"date"},{"name":"item","type":"string"},{"name":"amount","type":"number"}]} />
</Dataset>`;

it('forks the production Splitwise tracker: the tab is copied with its rows, and the forker joins the COPY', async () => {
  const owner = await mintToken('owner'); const pavel = await createUser({ email: 'mxmx_test_pavel@example.com' }); await claimToken(pavel.id, owner.token);
  const friend = await mintToken('friend'); const me = await createUser({ email: 'mxmx_test_me@example.com' }); await claimToken(me.id, friend.token);
  const publish = async (body: object) => {
    const r = await create(request('/api/artifacts', { method: 'POST', token: owner.token, json: body }));
    expect(r.status, await r.clone().text()).toBe(201);
    return (await r.json()).id as string;
  };
  const ds = await publish({ dataset: dataset(pavel.id), access: 'readwrite', visibility: 'unlisted', title: 'Splitwise tab' });
  const head = await getArtifactById(ds);
  const policy = viewersWritePolicy([{ schema: 'public', name: 'people' }, { schema: 'public', name: 'expenses' }]);
  const granted = await patchArtifact(await observedRequest(`/api/artifacts/${ds}`, { method: 'PATCH', token: owner.token, json: { policy, expectedPolicyRevision: head!.policy_revision ?? 0 } }), ctx(ds));
  expect(granted.status, await granted.clone().text()).toBe(200);
  const doc = await publish({ markup: PAGE.replaceAll('ref:hf8fYY', `ref:${ds}`), visibility: 'unlisted', title: 'Splitwise tracker' });

  // The forker, signed in through the browser, presses Fork.
  sessionUser.id = me.id; sessionUser.email = me.email;
  const cookie = await agentCookie([friend.id]);
  const preview = await forkRoute(request(`/api/my/artifacts/${doc}/fork`, { method: 'POST', cookie, json: { dry_run: true } }), ctx(doc));
  expect(preview.status, await preview.clone().text()).toBe(200);
  expect(await preview.json()).toEqual({ datasets: [{ id: ds, title: 'Splitwise tab' }] });
  const forked = await forkRoute(request(`/api/my/artifacts/${doc}/fork`, { method: 'POST', cookie }), ctx(doc));
  expect(forked.status, await forked.clone().text()).toBe(201);
  const copy = (await getArtifactById((await forked.json()).id))!;
  const copied = copy.source!.match(/ref:([A-Za-z0-9]+)/)![1]!;
  expect(copied).not.toBe(ds);
  expect((await getArtifactById(copied))!.user_id).toBe(me.id);

  // Joining the copy lands in the copy's tab; the original tab still has one person.
  const joined = await mutate(request(`/a/${copy.id}/mutate`, { method: 'POST', cookie, json: { mutation: 'join' } }), ctx(copy.id));
  expect(joined.status, await joined.clone().text()).toBe(200);
  const read = async (id: string) => { const r = await query(request(`/a/${id}/query`, { method: 'POST', cookie, json: {} }), ctx(id)); expect(r.status, await r.clone().text()).toBe(200); return r.json(); };
  expect((await read(copy.id)).tables.balances.rows.map((r: { person: string }) => r.person).sort()).toEqual([pavel.id, me.id].sort());
  expect((await read(doc)).tables.balances.rows.map((r: { person: string }) => r.person)).toEqual([pavel.id]);
});
