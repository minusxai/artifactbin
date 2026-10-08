/**
 * THE VIEWER OVERLAY DOOR, beyond the seeds (app/a/[id]/viewer): the answer never carries a
 * shared-scope table even when the run computed one on the way, a dataset the guest is refused is the
 * guest's refusal and the admitted reader's rows, the write checks are the reader's own, and a
 * document's owner through the agent cookie is admitted exactly as the query door admits them.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { agentCookie, useAppHarness, request, setSession } from '@/__tests__/harness';
import { POST as createArtifactRoute } from '@/app/api/artifacts/route';
import { GET as viewerRoute } from '@/app/a/[id]/viewer/route';
import { POST as queryRoute } from '@/app/a/[id]/query/route';
import { POST as mutateRoute } from '@/app/a/[id]/mutate/route';
import { createFetchTransport } from '@/lib/story-runtime/fetch-transport';
import { getArtifactById } from '@/lib/artifacts';
import { loadDatasetRows } from '@/lib/story/datasets/dataset-store';
import { mintAccountToken as mintToken } from '@/__tests__/harness';
import { claimToken, createUser, ensureUsername } from '@/lib/accounts';
import { drainPreparedPageWarmups } from '@/lib/story/prepared/prepared-page.server';
import type { ViewerOverlay } from '@/lib/compiled-page/contract';

const sessionUser = { id: '', email: '' };
useAppHarness();
beforeEach(() => setSession(() => (sessionUser.id ? { user: { id: sessionUser.id, email: sessionUser.email || null } } : null)));
const params = (id: string) => ({ params: Promise.resolve({ id }) });
const asSession = (u: { id: string; email: string } | null) => { sessionUser.id = u?.id ?? ''; sessionUser.email = u?.email ?? ''; };
beforeEach(() => asSession(null));

async function owner() {
  const user = await ensureUsername(await createUser({ email: `mxmx_test_overlay_${Math.random().toString(36).slice(2, 8)}@example.com` }));
  const t = await mintToken('overlay', user.id); await claimToken(user.id, t.token);
  return { user, token: t.token, tokenId: t.id };
}
async function create(token: string, body: Record<string, unknown>): Promise<string> {
  const made = await createArtifactRoute(request('/api/artifacts', { method: 'POST', token, json: body }));
  if (made.status !== 201) throw new Error(await made.text());
  await drainPreparedPageWarmups();
  return ((await made.json()) as { id: string }).id;
}
const overlayOf = async (id: string, init: Parameters<typeof request>[1] = {}) => {
  const res = await viewerRoute(request(`/a/${id}/viewer`, init), params(id));
  expect(res.status, await res.clone().text()).toBe(200);
  return (await res.json()) as ViewerOverlay;
};

describe('GET /a/:id/viewer — what never leaves it', () => {
  it('answers a viewer query that reads a shared one with the viewer table alone', async () => {
    const who = await owner();
    const id = await create(who.token, { visibility: 'public', markup: '<Helmet><Value name="rows" type="table" value={[{"n":1},{"n":2}]} /><Query name="total">{`select sum(n) as total from rows`}</Query><Query name="mine">{`select total, coalesce($_me.id, \'guest\') as who from total`}</Query></Helmet><p><Number data="$total" col="total" /></p><DataTable data="$mine" height="120px" />' });
    asSession({ id: who.user.id, email: who.user.email ?? '' });
    const overlay = await overlayOf(id);
    expect(Object.keys(overlay.results.tables)).toEqual(['mine']);
    expect(Object.keys(overlay.results.errors)).toEqual([]);
    expect(overlay.results.tables.mine).toMatchObject({ rows: [{ total: 3, who: who.user.id }] });
  });

  it('answers a query over a private dataset with the refusal for a guest and the rows for its owner', async () => {
    const who = await owner();
    const ds = await create(who.token, { visibility: 'private', dataset: [{ n: 5 }] });
    const id = await create(who.token, { visibility: 'public', markup: `<Helmet><Import name="d" src="ref:${ds}" /><Query name="secret">{\`select n from d.rows\`}</Query><Query name="open">{\`select 1 as one\`}</Query></Helmet><DataTable data="$secret" height="120px" /><DataTable data="$open" height="120px" />` });
    const guest = await overlayOf(id);
    expect(guest.viewer).toBeNull();
    expect(Object.keys({ ...guest.results.tables, ...guest.results.errors })).toEqual(['secret']);
    expect(guest.results.tables.secret).toBeUndefined();
    asSession({ id: who.user.id, email: who.user.email ?? '' });
    const mine = await overlayOf(id);
    expect(Object.keys(mine.results.tables)).toEqual(['secret']);
    expect(mine.results.tables.secret).toMatchObject({ rows: [{ n: 5 }] });
  });

  it('carries this reader\'s write checks, and only the viewer-scope tables, beside a mutation', async () => {
    const who = await owner();
    const ds = await create(who.token, { visibility: 'public', dataset: [{ choice: 'ramen' }], access: 'readwrite' });
    const id = await create(who.token, { visibility: 'public', markup: `<Helmet><Value name="choice" type="string" default="tacos" /><Import name="d" src="ref:${ds}" /><Query name="tally">{\`select count(*) as n from d.rows\`}</Query><Mutation name="vote">{\`insert into d.rows (choice) values ($choice)\`}</Mutation></Helmet><Button run="$vote">Vote</Button><Number data="$tally" col="n" />` });
    asSession({ id: who.user.id, email: who.user.email ?? '' });
    const overlay = await overlayOf(id);
    expect(overlay.results.tables).toEqual({});
    const door = (await (await queryRoute(request(`/a/${id}/query`, { method: 'POST', json: { values: {} } }), params(id))).json()) as { mutationAccess?: Record<string, string | null> };
    expect(overlay.results.mutationAccess).toEqual(door.mutationAccess);
    expect(Object.keys(overlay.results.mutationAccess ?? {})).toEqual(['vote']);
  });

  it('admits exactly whom the query door admits for a private document: its owner, not a guest or another account or cookie', async () => {
    const who = await owner();
    const stranger = await owner();
    const id = await create(who.token, { visibility: 'private', markup: '<Helmet><Query name="me">{`select coalesce($_me.id, \'guest\') as who`}</Query></Helmet><DataTable data="$me" height="120px" />' });
    const both = async (init: Parameters<typeof request>[1] = {}) => [
      (await viewerRoute(request(`/a/${id}/viewer`, init), params(id))).status,
      (await queryRoute(request(`/a/${id}/query`, { method: 'POST', json: { values: {} }, ...init }), params(id))).status,
    ];
    expect(await both()).toEqual([404, 404]);
    expect(await both({ cookie: await agentCookie([stranger.tokenId]) })).toEqual([404, 404]);
    asSession({ id: stranger.user.id, email: stranger.user.email ?? '' });
    expect(await both()).toEqual([404, 404]);
    asSession({ id: who.user.id, email: who.user.email ?? '' });
    expect(await both()).toEqual([200, 200]);
    const overlay = await overlayOf(id);
    expect(overlay.viewer?.id).toBe(who.user.id);
    expect(overlay.results.tables.me).toMatchObject({ rows: [{ who: who.user.id }] });
  });
});

describe('an island page\'s writes reach the document\'s mutate door', () => {
  /**
   * The browser, as far as a write is concerned: a same-origin request with `credentials: 'same-origin'`
   * carries the reader's cookie and an Origin header; `omit` carries neither. Everything after that is the
   * real transport and the real route.
   */
  const browser = (cookie: string) => async (url: string, init: RequestInit = {}) => {
    const withSession = init.credentials !== 'omit';
    const path = new URL(url, 'http://localhost:3000').pathname;
    const id = path.split('/')[2]!;
    const req = request(path, { method: init.method ?? 'GET', body: init.body as BodyInit, headers: init.headers as Record<string, string>, ...(withSession ? { cookie, origin: 'same' as const } : {}) });
    return mutateRoute(req, params(id));
  };

  it('a signed-in page writes as its reader and the write lands; a guest page\'s write is anonymous and refused', async () => {
    const who = await owner();
    const ds = await create(who.token, { dataset: [{ choice: 'ramen' }], access: 'readwrite' });
    const id = await create(who.token, { visibility: 'private', markup: `<Helmet><Value name="choice" type="string" default="tacos" /><Import name="d" src="ref:${ds}" /><Mutation name="vote">{\`insert into d.rows (choice) values ($choice)\`}</Mutation></Helmet><Button run="$vote">Vote</Button>` });
    const cookie = await agentCookie([who.tokenId]);
    const signedIn = createFetchTransport(`/a/${id}/query`, browser(cookie), `/a/${id}/mutate`, { session: true });
    await expect(signedIn.mutate!({ mutation: 'vote', args: { choice: 'udon' } })).resolves.toMatchObject({ dataset: ds });
    expect(await loadDatasetRows((await getArtifactById(ds))!)).toEqual([{ choice: 'ramen' }, { choice: 'udon' }]);

    const guest = createFetchTransport(`/a/${id}/query`, browser(cookie), `/a/${id}/mutate`);
    await expect(guest.mutate!({ mutation: 'vote', args: { choice: 'soba' } })).rejects.toThrow();
    expect((await getArtifactById(ds))!.version).toBe(2);
  });
});
