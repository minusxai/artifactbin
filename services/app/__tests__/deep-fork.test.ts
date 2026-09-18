/**
 * FORKING AN APP. A page that WRITES a dataset it does not own cannot be published, so a fork
 * that kept `ref:` pointing at the original's dataset was refused: an app could not be forked at
 * all. A fork now copies the datasets the page writes — columns, rows, access and write policy —
 * under the forker's account and rewrites the refs, in one operation. Datasets the page only reads
 * keep their reference: a read is permitted, and copying it would freeze a live source.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { agentCookie, useAppHarness } from './harness';
import { POST as forkRoute } from '@/app/api/my/artifacts/[id]/fork/route';
import { POST as createArtifactRoute } from '@/app/api/artifacts/route';
import { getArtifactById } from '@/lib/artifacts';
import { setDatasetPolicy } from '@/lib/datasets/policy';
import { loadDatasetRows } from '@/lib/story/dataset-store';
import { mintToken } from '@/lib/tokens';
import { claimToken, createUser } from '@/lib/users';
import { viewersWritePolicy } from '@artifactbin/utils';

const BASE = 'http://localhost:3000';
useAppHarness();
const sessionUser = { id: '', email: '' };
vi.mock('@/auth', () => ({
  auth: async () => (sessionUser.id ? { user: { id: sessionUser.id, email: sessionUser.email || null } } : null),
}));
const params = (id: string) => ({ params: Promise.resolve({ id }) });
const jreq = (path: string, method: string, body?: unknown, token?: string, cookie?: string) =>
  new Request(`${BASE}${path}`, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(cookie ? { Cookie: cookie, Origin: BASE } : {}) }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
const create = async (token: string, body: Record<string, unknown>) => {
  const res = await createArtifactRoute(jreq('/api/artifacts', 'POST', body, token));
  expect(res.status, await res.clone().text()).toBe(201);
  return (await res.json()) as { id: string };
};
beforeEach(() => { sessionUser.id = ''; sessionUser.email = ''; });

async function world() {
  const ta = await mintToken('a'); const owner = await createUser({ email: 'owner@x.com' }); await claimToken(owner.id, ta.token);
  const tb = await mintToken('b'); const bob = await createUser({ email: 'bob@x.com' }); await claimToken(bob.id, tb.token);
  const written = await create(ta.token, { dataset: [{ id: 1, who: owner.id, item: 'Groceries', amount: 48.5 }], access: 'readwrite', visibility: 'unlisted', title: 'tab' });
  expect(await setDatasetPolicy({ tokenId: ta.id, userId: owner.id }, written.id, viewersWritePolicy(), 0)).toMatchObject({ revision: 1 });
  const readOnly = await create(ta.token, { dataset: [{ code: 'USD', rate: 1 }], visibility: 'unlisted', title: 'rates' });
  const page = await create(ta.token, {
    visibility: 'unlisted', title: 'Splitwise tracker',
    markup: `<Helmet><Query name="rows" source="ref:${written.id}">{\`select * from public.rows order by id\`}</Query><Query name="rates" source="ref:${readOnly.id}">{\`select * from public.rows\`}</Query><Mutation name="add" source="ref:${written.id}">{\`insert into public.rows (id, who, item, amount) select 2, $_me, 'Taxi', 12\`}</Mutation></Helmet><div>{$_me ? <Button run="$add">Add</Button> : <SignIn>Sign in</SignIn>}<DataTable data="$rows" /></div>`,
  });
  const cookie = await agentCookie([tb.id]);
  sessionUser.id = bob.id; sessionUser.email = bob.email;
  return { ta, tb, owner, bob, written, readOnly, page, cookie };
}

describe('forking a page that writes a dataset', () => {
  it('copies the written dataset with its rows, access and policy, rewrites the ref, and keeps the read-only ref', async () => {
    const w = await world();
    const res = await forkRoute(jreq(`/api/my/artifacts/${w.page.id}/fork`, 'POST', undefined, undefined, w.cookie), params(w.page.id));
    expect(res.status, await res.clone().text()).toBe(201);
    const copy = (await getArtifactById((await res.json()).id))!;
    const refs = [...new Set(copy.source!.match(/ref:[A-Za-z0-9]+/g))];
    expect(refs).toContain(`ref:${w.readOnly.id}`);
    expect(refs).not.toContain(`ref:${w.written.id}`);
    const copied = refs.filter((r) => r !== `ref:${w.readOnly.id}`);
    expect(copied).toHaveLength(1);
    const ds = (await getArtifactById(copied[0]!.slice(4)))!;
    expect(ds.user_id).toBe(w.bob.id);
    expect(ds.format).toBe('dataset');
    expect(ds.access).toBe('readwrite');
    expect(ds.visibility).toBe(copy.visibility);
    expect(ds.dataset_policy).toMatchObject({ enforcement: 'enabled' });
    expect(await loadDatasetRows(ds)).toEqual([{ id: 1, who: w.owner.id, item: 'Groceries', amount: 48.5 }]);
    expect((await getArtifactById(w.written.id))!.version).toBe(1);
  });

  it('copies nothing when the forker already owns the written dataset', async () => {
    const w = await world();
    sessionUser.id = w.owner.id; sessionUser.email = w.owner.email;
    const cookie = await agentCookie([w.ta.id]);
    const res = await forkRoute(jreq(`/api/my/artifacts/${w.page.id}/fork`, 'POST', undefined, undefined, cookie), params(w.page.id));
    expect(res.status, await res.clone().text()).toBe(201);
    const copy = (await getArtifactById((await res.json()).id))!;
    expect(copy.source).toContain(`ref:${w.written.id}`);
  });

  it('says what will be copied before the fork, without copying anything', async () => {
    const w = await world();
    const res = await forkRoute(jreq(`/api/my/artifacts/${w.page.id}/fork`, 'POST', { dry_run: true }, undefined, w.cookie), params(w.page.id));
    expect(res.status, await res.clone().text()).toBe(200);
    const body = await res.json();
    expect(body.datasets).toEqual([{ id: w.written.id, title: 'tab' }]);
  });
});
