// DESTINATION: services/app/__tests__/viewer-route.test.ts
/**
 * THE VIEWER OVERLAY DOOR (docs/phase2-architecture.md §4.2, §6; contract ViewerOverlay): after paint,
 * `GET /a/:id/viewer` answers what only this reader decides — their identity, the `viewer`-scope
 * queries at the page's values, the imports they may hold — with the same admission and the same run
 * as `POST /a/:id/query`. Never a shared-scope result (those are the snapshot's), never a 200 for a
 * document the reader may not read.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { agentCookie, useAppHarness, request, setSession } from '@/__tests__/harness';
import { POST as createArtifactRoute } from '@/app/api/artifacts/route';
import { GET as viewerRoute } from '@/app/a/[id]/viewer/route';
import { POST as queryRoute } from '@/app/a/[id]/query/route';
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
  const user = await ensureUsername(await createUser({ email: `mxmx_test_viewer_${Math.random().toString(36).slice(2, 8)}@example.com` }));
  const t = await mintToken('viewer', user.id); await claimToken(user.id, t.token);
  return { user, token: t.token, tokenId: t.id };
}
async function publish(token: string, body: Record<string, unknown>): Promise<string> {
  const made = await createArtifactRoute(request('/api/artifacts', { method: 'POST', token, json: { visibility: 'public', ...body } }));
  if (made.status !== 201) throw new Error(await made.text());
  await drainPreparedPageWarmups();
  return ((await made.json()) as { id: string }).id;
}
const MIXED = '<Helmet><Value name="rows" type="table" value={[{"n":1},{"n":2}]} /><Query name="total">{`select sum(n) as total from rows`}</Query><Query name="me">{`select coalesce($_me.id, \'guest\') as who`}</Query></Helmet><p><Number data="$total" col="total" /></p><DataTable data="$me" height="120px" />';

describe('GET /a/:id/viewer', () => {
  it('answers the viewer-scope queries for the session viewer, exactly as the query route does, and only those', async () => {
    const who = await owner();
    const id = await publish(who.token, { markup: MIXED });
    asSession({ id: who.user.id, email: who.user.email ?? '' });
    const res = await viewerRoute(request(`/a/${id}/viewer`, { origin: 'same' }), params(id));
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(res.headers.get('access-control-allow-origin')).toBeNull();
    const overlay = (await res.json()) as ViewerOverlay;
    expect(overlay.viewer?.id).toBe(who.user.id);
    expect(Object.keys(overlay.results.tables)).toEqual(['me']);
    const answer = (await (await queryRoute(request(`/a/${id}/query`, { method: 'POST', json: { values: {} } }), params(id))).json()) as { tables: Record<string, unknown> };
    expect(overlay.results.tables.me).toEqual(answer.tables.me);
    expect(Array.isArray(overlay.hold)).toBe(true);
  });

  it('answers a guest with no identity and the guest\'s viewer-scope rows', async () => {
    const who = await owner();
    const id = await publish(who.token, { markup: MIXED });
    const overlay = (await (await viewerRoute(request(`/a/${id}/viewer`), params(id))).json()) as ViewerOverlay;
    expect(overlay.viewer).toBeNull();
    expect(overlay.results.tables.me).toMatchObject({ rows: [{ who: 'guest' }] });
  });

  it('answers an opaque-origin frame anonymously despite owner credentials, and CORS-opens only that response', async () => {
    const who = await owner();
    const ds = await publish(who.token, { dataset: [{ choice: 'ramen' }] });
    const id = await publish(who.token, { markup: `<Helmet><Import name="d" src="ref:${ds}" /><Query name="me">{\`select coalesce($_me.id, 'guest') as who\`}</Query><Mutation name="vote">{\`insert into d.rows (choice) values ('tacos')\`}</Mutation></Helmet><DataTable data="$me" height="120px" />` });
    asSession({ id: who.user.id, email: who.user.email ?? '' });

    const res = await viewerRoute(request(`/a/${id}/viewer`, {
      origin: 'null', token: who.token, cookie: await agentCookie([who.tokenId]),
    }), params(id));
    expect(res.status).toBe(200);
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
    expect(res.headers.get('cache-control')).toBe('no-store');
    const overlay = (await res.json()) as ViewerOverlay;
    expect(overlay.viewer).toBeNull();
    expect(overlay.results.tables.me).toMatchObject({ rows: [{ who: 'guest' }] });
    expect(overlay.results.mutationAccess?.vote).toEqual(expect.any(String));
  });

  it('keeps an owner credential on an opaque-origin request from disclosing a private document', async () => {
    const who = await owner();
    const id = await publish(who.token, { visibility: 'private', markup: MIXED });
    asSession({ id: who.user.id, email: who.user.email ?? '' });

    const res = await viewerRoute(request(`/a/${id}/viewer`, {
      origin: 'null', token: who.token, cookie: await agentCookie([who.tokenId]),
    }), params(id));
    expect(res.status).toBe(404);
    expect(res.headers.get('access-control-allow-origin')).toBeNull();
    expect(await res.json()).toMatchObject({ error: 'not_found' });
  });

  it('runs at the page\'s $ values from the query string', async () => {
    const who = await owner();
    const id = await publish(who.token, { markup: '<Helmet><Value name="who" type="string" default="x" /><Query name="me">{`select $who || coalesce($_me.id, \'\') as who`}</Query></Helmet><DataTable data="$me" height="120px" />' });
    const overlay = (await (await viewerRoute(request(`/a/${id}/viewer?$who=y`), params(id))).json()) as ViewerOverlay;
    expect(overlay.results.tables.me).toMatchObject({ rows: [{ who: 'y' }] });
  });

  it('is the uniform 404 for a document the reader may not read, and for a document with no viewer-scope query', async () => {
    const who = await owner();
    const secret = await publish(who.token, { visibility: 'private', markup: MIXED });
    expect((await viewerRoute(request(`/a/${secret}/viewer`), params(secret))).status).toBe(404);
    const plain = await publish(who.token, { markup: '<Helmet><Value name="rows" type="table" value={[{"n":1}]} /><Query name="total">{`select sum(n) as total from rows`}</Query></Helmet><p><Number data="$total" col="total" /></p>' });
    const res = await viewerRoute(request(`/a/${plain}/viewer`), params(plain));
    expect(res.status).toBe(200);
    expect(((await res.json()) as ViewerOverlay).results.tables).toEqual({});
  });
});
