/**
 * FORKING AN APP. A page that WRITES a dataset it does not own cannot be published, so a fork
 * that kept `ref:` pointing at the original's dataset was refused: an app could not be forked at
 * all. A fork now copies the datasets the page writes — columns, rows, access and write policy —
 * under the forker's account and rewrites the refs, in one operation. Datasets the page only reads
 * keep their reference: a read is permitted, and copying it would freeze a live source.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { agentCookie, useAppHarness } from './harness';
import { POST as forkRoute } from '@/app/api/my/artifacts/[id]/fork/route';
import { POST as createArtifactRoute } from '@/app/api/artifacts/route';
import { getArtifactById, setArtifactQuotaForTests } from '@/lib/artifacts';
import { setDatasetPolicy } from '@/lib/datasets/policy';
import { loadDatasetRows } from '@/lib/story/dataset-store';
import { mintToken } from '@/lib/tokens';
import { claimToken, createUser } from '@/lib/users';
import { viewersWritePolicy } from '@artifactbin/utils';

const BASE = 'http://localhost:3000';
const harness = useAppHarness();
const sessionUser = { id: '', email: '' };
vi.mock('@/auth', () => ({
  auth: async () => (sessionUser.id ? { user: { id: sessionUser.id, email: sessionUser.email || null } } : null),
}));
/**
 * THE FAULT INJECTOR for the atomicity case. The copies and the page are one
 * transaction, and the only honest way to show that is to break it in the
 * middle: `onClaim` fails the Nth id claim of the run, which is the second
 * dataset copy's. Inert (0) for every other test in this file.
 */
const fault = vi.hoisted(() => ({ onClaim: 0, claims: 0 }));
vi.mock('@/lib/artifact-identities', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/lib/artifact-identities')>();
  return {
    ...real,
    claimArtifactId: async (...args: Parameters<typeof real.claimArtifactId>) => {
      fault.claims += 1;
      if (fault.onClaim && fault.claims === fault.onClaim) throw new Error('injected failure mid-transaction');
      return real.claimArtifactId(...args);
    },
  };
});
const ownedBy = async (userId: string): Promise<number> =>
  Number((await (await harness.db()).query<{ n: string }>('SELECT count(*) n FROM artifacts WHERE user_id = $1', [userId])).rows[0]!.n);
const params = (id: string) => ({ params: Promise.resolve({ id }) });
const jreq = (path: string, method: string, body?: unknown, token?: string, cookie?: string) =>
  new Request(`${BASE}${path}`, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(cookie ? { Cookie: cookie, Origin: BASE } : {}) }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
const create = async (token: string, body: Record<string, unknown>) => {
  const res = await createArtifactRoute(jreq('/api/artifacts', 'POST', body, token));
  expect(res.status, await res.clone().text()).toBe(201);
  return (await res.json()) as { id: string };
};
beforeEach(() => { sessionUser.id = ''; sessionUser.email = ''; fault.onClaim = 0; fault.claims = 0; });
afterEach(() => { setArtifactQuotaForTests(null); });

async function world() {
  const ta = await mintToken('a'); const owner = await createUser({ email: 'owner@x.com' }); await claimToken(owner.id, ta.token);
  const tb = await mintToken('b'); const bob = await createUser({ email: 'bob@x.com' }); await claimToken(bob.id, tb.token);
  const written = await create(ta.token, { dataset: [{ id: 1, who: owner.id, item: 'Groceries', amount: 48.5 }], access: 'readwrite', visibility: 'unlisted', title: 'tab' });
  expect(await setDatasetPolicy({ tokenId: ta.id, userId: owner.id }, written.id, viewersWritePolicy(), 0)).toMatchObject({ revision: 1 });
  const readOnly = await create(ta.token, { dataset: [{ code: 'USD', rate: 1 }], visibility: 'unlisted', title: 'rates' });
  const page = await create(ta.token, {
    visibility: 'unlisted', title: 'Splitwise tracker',
    markup: `<Helmet><Import name="rows_data" src="ref:${written.id}" /><Query name="rows">{\`select * from rows_data.rows order by id\`}</Query><Import name="rates_data" src="ref:${readOnly.id}" /><Query name="rates">{\`select * from rates_data.rows\`}</Query><Import name="add_data" src="ref:${written.id}" /><Mutation name="add">{\`insert into add_data.rows (id, who, item, amount) select 2, $_me.id, 'Taxi', 12\`}</Mutation></Helmet><div>{$_me.id ? <Button run="$add">Add</Button> : <SignIn>Sign in</SignIn>}<DataTable data="$rows" /></div>`,
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

  it('copies rows that name other people in a self-constrained user column — the copy is a snapshot, not a write by the forker', async () => {
    // The production shape that failed: a `person` column every writer may only set to
    // themselves, whose rows name the ORIGINAL owner. The forker did not write them; they
    // are carried, and re-judging them under the forker's id would make every such app unforkable.
    const w = await world();
    const tab = await create(w.ta.token, {
      dataset: [{ id: 1, person: w.owner.id, item: 'Groceries' }],
      columns: [{ name: 'id', type: 'number' }, { name: 'person', type: 'user', constraints: { self: true } }, { name: 'item', type: 'string' }],
      access: 'readwrite', visibility: 'unlisted', title: 'people tab',
    });
    expect(await setDatasetPolicy({ tokenId: w.ta.id, userId: w.owner.id }, tab.id, viewersWritePolicy(), 0)).toMatchObject({ revision: 1 });
    const page = await create(w.ta.token, {
      visibility: 'unlisted', title: 'People',
      markup: `<Helmet><Import name="rows_data" src="ref:${tab.id}" /><Query name="rows">{\`select * from rows_data.rows\`}</Query><Import name="join_data" src="ref:${tab.id}" /><Mutation name="join">{\`insert into join_data.rows (id, person, item) select 2, $_me.id, 'Taxi'\`}</Mutation></Helmet><div><Button run="$join">Join</Button><DataTable data="$rows" /></div>`,
    });
    const res = await forkRoute(jreq(`/api/my/artifacts/${page.id}/fork`, 'POST', undefined, undefined, w.cookie), params(page.id));
    expect(res.status, await res.clone().text()).toBe(201);
    const copy = (await getArtifactById((await res.json()).id))!;
    const copied = copy.source!.match(/ref:([A-Za-z0-9]+)/)![1]!;
    expect(copied).not.toBe(tab.id);
    const ds = (await getArtifactById(copied))!;
    expect(ds.user_id).toBe(w.bob.id);
    expect(await loadDatasetRows(ds)).toEqual([{ id: 1, person: w.owner.id, item: 'Groceries' }]);
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

/** A page that writes TWO of someone else's datasets and reads a third. */
async function twoWriters() {
  const ta = await mintToken('a'); const owner = await createUser({ email: 'two-owner@x.com' }); await claimToken(owner.id, ta.token);
  const tb = await mintToken('b'); const bob = await createUser({ email: 'two-bob@x.com' }); await claimToken(bob.id, tb.token);
  const expenses = await create(ta.token, { dataset: [{ id: 1, item: 'Groceries' }], access: 'readwrite', visibility: 'unlisted', title: 'expenses' });
  const people = await create(ta.token, { dataset: [{ id: 1, name: 'Ada' }], access: 'readwrite', visibility: 'unlisted', title: 'people' });
  const rates = await create(ta.token, { dataset: [{ code: 'USD', rate: 1 }], visibility: 'unlisted', title: 'rates' });
  const page = await create(ta.token, {
    visibility: 'unlisted', title: 'Two writers',
    markup: `<Helmet><Import name="rows_data" src="ref:${expenses.id}" /><Query name="rows">{\`select * from rows_data.rows\`}</Query>`
      + `<Import name="rates_data" src="ref:${rates.id}" /><Query name="rates">{\`select * from rates_data.rows\`}</Query>`
      + `<Import name="spend_data" src="ref:${expenses.id}" /><Mutation name="spend">{\`insert into spend_data.rows (id, item) select 2, 'Taxi'\`}</Mutation>`
      + `<Import name="join_data" src="ref:${people.id}" /><Mutation name="join">{\`insert into join_data.rows (id, name) select 2, 'Grace'\`}</Mutation></Helmet>`
      + '<div><Button run="$spend">Spend</Button><DataTable data="$rows" /></div>',
  });
  const cookie = await agentCookie([tb.id]);
  sessionUser.id = bob.id; sessionUser.email = bob.email;
  return { ta, tb, owner, bob, expenses, people, rates, page, cookie };
}

describe('a page that writes two foreign datasets', () => {
  it('copies both, leaves the read-only one shared, and lists the new ids in meta.refs', async () => {
    const w = await twoWriters();
    const res = await forkRoute(jreq(`/api/my/artifacts/${w.page.id}/fork`, 'POST', undefined, undefined, w.cookie), params(w.page.id));
    expect(res.status, await res.clone().text()).toBe(201);
    const copy = (await getArtifactById((await res.json()).id))!;
    const refs = (copy.meta.refs as Array<{ id: string }>).map((r) => r.id);
    expect(refs).toContain(w.rates.id);
    expect(refs).not.toContain(w.expenses.id);
    expect(refs).not.toContain(w.people.id);
    expect(refs).toHaveLength(3);
    const copies = refs.filter((id) => id !== w.rates.id);
    for (const id of copies) expect((await getArtifactById(id))!.user_id).toBe(w.bob.id);
    // Titles identify WHICH original each copy came from — both, once each.
    const from = await Promise.all(copies.map(async (id) => (await getArtifactById(id))!.forked_from));
    expect([...from].sort()).toEqual([w.expenses.id, w.people.id].sort());
    // The one dataset that is only READ is still the original's: a copy would
    // have frozen a live source the moment somebody forked the page.
    expect((await getArtifactById(w.rates.id))!.user_id).toBe(w.owner.id);
    expect(await ownedBy(w.bob.id)).toBe(3);
  });

  it('the dry run lists both, in the order the page writes them', async () => {
    const w = await twoWriters();
    const res = await forkRoute(jreq(`/api/my/artifacts/${w.page.id}/fork`, 'POST', { dry_run: true }, undefined, w.cookie), params(w.page.id));
    expect(res.status, await res.clone().text()).toBe(200);
    expect((await res.json()).datasets).toEqual([{ id: w.expenses.id, title: 'expenses' }, { id: w.people.id, title: 'people' }]);
  });

  it('the quota counts the page PLUS its copies, and a refusal creates nothing', async () => {
    const w = await twoWriters();
    // Two copies and a page is three rows; a cap of two must refuse the whole
    // act rather than take the first dataset and stop.
    setArtifactQuotaForTests(2);
    const res = await forkRoute(jreq(`/api/my/artifacts/${w.page.id}/fork`, 'POST', undefined, undefined, w.cookie), params(w.page.id));
    expect(res.status, await res.clone().text()).toBe(403);
    expect((await res.json()).error).toBe('quota_exceeded');
    expect(await ownedBy(w.bob.id)).toBe(0);
  });

  it('a failure on the SECOND copy rolls the first one back: one transaction, nothing half-done', async () => {
    const w = await twoWriters();
    fault.claims = 0; fault.onClaim = 2;
    await expect(forkRoute(jreq(`/api/my/artifacts/${w.page.id}/fork`, 'POST', undefined, undefined, w.cookie), params(w.page.id)))
      .rejects.toThrow('injected failure mid-transaction');
    expect(await ownedBy(w.bob.id)).toBe(0);
  });
});
