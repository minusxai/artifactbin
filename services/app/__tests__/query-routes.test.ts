/**
 * The query endpoints behind the runtime store's transports:
 *  - GET  /a/<id>/query?q=<JSON QueryRequest> — the DOCUMENT's own path: the
 *    sandboxed top-level document fetches its re-runs itself. Answered with
 *    the ANONYMOUS read ACL — it never reads a cookie — and CORS `*`, so it
 *    can only ever return what an unauthenticated fetch gets (public/unlisted).
 *  - POST /a/<id>/query — the READER path inside the owner's shell (the page
 *    relays for the frame, with its session): re-run a stored document's
 *    queries with the reader's values, behind the same read ACL as the page.
 *  - POST /api/query — the OWNER path (the editor running a DRAFT): the
 *    caller's own datasets, bearer or session, nothing persisted.
 */
import { describe, expect, it } from 'vitest';
import { agentCookie, useAppHarness, request } from '@/__tests__/harness';
import { GET as queryGet, POST as queryRoute } from '@/app/a/[id]/query/route';
import { POST as draftQueryRoute } from '@/app/api/query/route';
import { POST as createArtifactRoute } from '@/app/api/artifacts/route';
import { mintToken } from '@/lib/tokens';
import { claimToken, createUser } from '@/lib/users';

const BASE = 'http://localhost:3000';
useAppHarness();
const params = <T extends Record<string, string>>(p: T) => ({ params: Promise.resolve(p) });
const create = async (token: string, body: Record<string, unknown>) =>
  (await createArtifactRoute(request('/api/artifacts', { method: 'POST', token: token, json: body }))).json();

const ROWS = [{ region: 'EU', revenue: 837 }, { region: 'NA', revenue: 1200 }, { region: 'EU', revenue: 3 }];
const DOC = (ds: string) =>
  '<Helmet><Value name="region" type="string" /><Value name="min" type="number" default={0} />' +
  `<Query name="sales">{\`select region, sum(revenue) revenue from ref_${ds} where ($region is null or region = $region) and revenue >= $min group by 1 order by 1\`}</Query>` +
  `<Query name="regions">{\`select distinct region from ref_${ds} order by 1\`}</Query>` +
  '</Helmet><div><select value="$region" options="$regions" /><Question data="$sales" viz={{"kind":"table"}} /></div>';

describe('POST /a/<id>/query (reader path)', () => {
  it('re-runs the requested queries with the given values over a public document', async () => {
    const t = await mintToken('t');
    const ds = (await create(t.token, { dataset: ROWS })).id;
    const doc = (await create(t.token, { markup: DOC(ds) })).id;
    const res = await queryRoute(request(`/a/${doc}/query`, { method: 'POST', json: { values: { region: 'NA' }, only: ['sales'] } }), params({ id: doc }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { tables: Record<string, { rows: unknown[] }>; errors: Record<string, string> };
    expect(body.tables.sales.rows).toEqual([{ region: 'NA', revenue: 1200 }]);
    expect(body.errors).toEqual({});
  });

  it('runs everything when `only` is absent, ignores undeclared values, defaults the rest', async () => {
    const t = await mintToken('t');
    const ds = (await create(t.token, { dataset: ROWS })).id;
    const doc = (await create(t.token, { markup: DOC(ds) })).id;
    const res = await queryRoute(request(`/a/${doc}/query`, { method: 'POST', json: { values: { bogus: 1 } } }), params({ id: doc }));
    const body = (await res.json()) as { tables: Record<string, { rows: unknown[] }> };
    expect(body.tables.sales.rows).toEqual([{ region: 'EU', revenue: 840 }, { region: 'NA', revenue: 1200 }]);
    expect(body.tables.regions.rows).toEqual([{ region: 'EU' }, { region: 'NA' }]);
  });

  it('answers the uniform 404 for a private document without a session, and for an unknown id', async () => {
    const t = await mintToken('t');
    const user = await createUser({ email: 'owner@x.com' });
    await claimToken(user.id, t.token);
    const ds = (await create(t.token, { dataset: ROWS })).id;
    const doc = (await create(t.token, { markup: DOC(ds), visibility: 'private' })).id;
    const res = await queryRoute(request(`/a/${doc}/query`, { method: 'POST', json: { values: {} } }), params({ id: doc }));
    expect(res.status).toBe(404);
    const nope = await queryRoute(request('/a/zzzzzz/query', { method: 'POST', json: { values: {} } }), params({ id: 'zzzzzz' }));
    expect(nope.status).toBe(404);
  });

  it('answers the browser credential the PAGE was served under — the agent cookie, not only an account session', async () => {
    /*
     * The split-viewer failure, one layer in. A browser whose only credential
     * is the agent-session cookie naming a CLAIMED token is an owner
     * everywhere else — the proxy hands it the shell, /raw serves it the
     * document — because those resolve `sessionActor`. This route resolved
     * only the NextAuth session, so the document painted and then every bound
     * control died against a 404 on the first change.
     */
    const t = await mintToken('t');
    const user = await createUser({ email: 'owner2@x.com' });
    await claimToken(user.id, t.token);
    const ds = (await create(t.token, { dataset: ROWS })).id;
    const doc = (await create(t.token, { markup: DOC(ds), visibility: 'private' })).id;

    const cookie = await agentCookie([t.id]);
    const res = await queryRoute(request(`/a/${doc}/query`, { method: 'POST', cookie: cookie, json: { values: { region: 'NA' }, only: ['sales'] } }), params({ id: doc }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { tables: Record<string, { rows: unknown[] }> };
    expect(body.tables.sales.rows).toEqual([{ region: 'NA', revenue: 1200 }]);
  });

  it('rejects a malformed body, and answers a document with no declarations honestly', async () => {
    const t = await mintToken('t');
    const ds = (await create(t.token, { dataset: ROWS })).id;
    const doc = (await create(t.token, { markup: DOC(ds) })).id;
    const bad = await queryRoute(request(`/a/${doc}/query`, { method: 'POST', json: { values: { region: { nested: true } } } }), params({ id: doc }));
    expect(bad.status).toBe(400);
    const plain = (await create(t.token, { markup: '<p>plain</p>' })).id;
    const res = await queryRoute(request(`/a/${plain}/query`, { method: 'POST', json: { values: {} } }), params({ id: plain }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ tables: {}, errors: {} });
  });
});

describe('POST /a/<id>/query — a page of one query', () => {
  it('reads a sorted window and reports the total; a bad page shape is 400', async () => {
    const t = await mintToken('t');
    const ds = (await create(t.token, { dataset: ROWS })).id;
    const doc = (await create(t.token, { markup: DOC(ds) })).id;
    const res = await queryRoute(request(`/a/${doc}/query`, { method: 'POST', json: { values: {}, page: { name: 'sales', offset: 1, limit: 1, sort: { col: 'revenue', dir: 'desc' } } } }), params({ id: doc }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { tables: Record<string, { rows: unknown[]; totalRows?: number }> };
    expect(body.tables.sales.rows).toEqual([{ region: 'EU', revenue: 840 }]);
    expect(body.tables.sales.totalRows).toBe(2);
    const bad = await queryRoute(request(`/a/${doc}/query`, { method: 'POST', json: { page: { name: 'sales', offset: -1, limit: 0 } } }), params({ id: doc }));
    expect(bad.status).toBe(400);
  });
});

describe('POST /api/query (owner path — a draft)', () => {
  it('runs a draft over the caller\'s own datasets, bearer-authed', async () => {
    const t = await mintToken('t');
    const ds = (await create(t.token, { dataset: ROWS })).id;
    const res = await draftQueryRoute(request('/api/query', { method: 'POST', token: t.token, json: { markup: DOC(ds), values: { region: 'EU' } } }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { tables: Record<string, { rows: unknown[] }>; errors: Record<string, string> };
    expect(body.tables.sales.rows).toEqual([{ region: 'EU', revenue: 840 }]);
  });

  it('runs a draft under the BROWSER\'s agent-session cookie (anonymous owner editing their own doc)', async () => {
    const t = await mintToken('t');
    const ds = (await create(t.token, { dataset: ROWS })).id;
    const cookie = await agentCookie([t.id]);
    const res = await draftQueryRoute(request('/api/query', { method: 'POST', cookie: cookie, origin: BASE, json: { markup: DOC(ds), values: { region: 'EU' } } }));
    expect(res.status).toBe(200);
    expect(((await res.json()) as { tables: Record<string, { rows: unknown[] }> }).tables.sales.rows).toEqual([{ region: 'EU', revenue: 840 }]);
  });

  it('refuses a cross-site cookie call, and never blocks a bearer agent', async () => {
    const t = await mintToken('t');
    const ds = (await create(t.token, { dataset: ROWS })).id;
    const cookie = await agentCookie([t.id]);
    expect((await draftQueryRoute(request('/api/query', { method: 'POST', cookie: cookie, origin: 'https://evil.example', json: { markup: DOC(ds) } }))).status).toBe(403);
    expect((await draftQueryRoute(request('/api/query', { method: 'POST', token: t.token, json: { markup: DOC(ds) } }))).status).toBe(200);
  });

  it('a PRIVATE dataset of another owner reads as a missing table — never as data', async () => {
    // Public/unlisted foreign datasets resolve now (refs-readable.test.ts);
    // private is the boundary that must hold in the draft path too.
    const mine = await mintToken('mine');
    const owner = await createUser({ email: 'query-owner@example.com' });
    const theirs = await mintToken('theirs');
    await claimToken(owner.id, theirs.token);
    const foreign = (await create(theirs.token, { dataset: ROWS, visibility: 'private' })).id;
    const res = await draftQueryRoute(request('/api/query', { method: 'POST', token: mine.token, json: { markup: DOC(foreign) } }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { tables: Record<string, unknown>; errors: Record<string, string> };
    expect(body.tables.sales).toBeUndefined();
    expect(body.errors.sales).toMatch(new RegExp(`ref_${foreign}`));
  });

  it('requires a credential and a markup body', async () => {
    const t = await mintToken('t');
    expect((await draftQueryRoute(request('/api/query', { method: 'POST', json: { markup: '<p>x</p>' } }))).status).toBe(401);
    expect((await draftQueryRoute(request('/api/query', { method: 'POST', token: t.token, json: {} }))).status).toBe(400);
  });

  it('a draft that declares nothing answers empty; a draft whose Helmet is malformed answers 400 with the grammar errors', async () => {
    const t = await mintToken('t');
    const empty = await draftQueryRoute(request('/api/query', { method: 'POST', token: t.token, json: { markup: '<p>x</p>' } }));
    expect(await empty.json()).toEqual({ tables: {}, errors: {} });
    const bad = await draftQueryRoute(request('/api/query', { method: 'POST', token: t.token, json: { markup: '<Helmet><Value name="n" type="number" default="lots" /></Helmet><p>x</p>' } }));
    expect(bad.status).toBe(400);
    expect(JSON.stringify(await bad.json())).toMatch(/default/);
  });
});

describe('GET /a/<id>/query?q= (the document fetches for itself)', () => {
  const getReq = (path: string, cookie?: string) => new Request(`${BASE}${path}`, { headers: cookie ? { Cookie: cookie } : {} });
  const q = (r: unknown) => encodeURIComponent(JSON.stringify(r));

  it('re-runs the requested queries with the given values over a public document, CORS-open', async () => {
    const t = await mintToken('t');
    const ds = (await create(t.token, { dataset: ROWS })).id;
    const doc = (await create(t.token, { markup: DOC(ds) })).id;
    const res = await queryGet(getReq(`/a/${doc}/query?q=${q({ values: { region: 'NA' }, only: ['sales'] })}`), params({ id: doc }));
    expect(res.status).toBe(200);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    const body = (await res.json()) as { tables: Record<string, { rows: unknown[] }>; errors: Record<string, string> };
    expect(body.tables.sales.rows).toEqual([{ region: 'NA', revenue: 1200 }]);
    expect(body.errors).toEqual({});
  });

  it('reads a page of one query through the same parameter', async () => {
    const t = await mintToken('t');
    const ds = (await create(t.token, { dataset: ROWS })).id;
    const doc = (await create(t.token, { markup: DOC(ds) })).id;
    const res = await queryGet(getReq(`/a/${doc}/query?q=${q({ page: { name: 'regions', offset: 1, limit: 1 } })}`), params({ id: doc }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { tables: Record<string, { rows: unknown[] }> };
    expect(body.tables.regions.rows).toEqual([{ region: 'NA' }]);
  });

  it('answers an unlisted document too — the reader needed no credential for the page either', async () => {
    const t = await mintToken('t');
    const ds = (await create(t.token, { dataset: ROWS })).id;
    const doc = (await create(t.token, { markup: DOC(ds), visibility: 'unlisted' })).id;
    expect((await queryGet(getReq(`/a/${doc}/query?q=${q({})}`), params({ id: doc }))).status).toBe(200);
  });

  it('is CREDENTIAL-BLIND: a private document is the uniform 404 even when the owner\'s own session cookie rides along', async () => {
    // The route authorizes as an anonymous viewer by construction — that is
    // what makes `Access-Control-Allow-Origin: *` safe. A cookie arriving here
    // (it should not: the document's origin is opaque and both cookies are
    // SameSite=Lax) must change nothing.
    const user = await createUser({ email: 'getowner@example.com' });
    const t = await mintToken('t', user.id);
    const ds = (await create(t.token, { dataset: ROWS })).id;
    const doc = (await create(t.token, { markup: DOC(ds), visibility: 'private' })).id;
    const cookie = await agentCookie([t.id]);
    // The POST (relay) path admits this very cookie — the contrast is the point.
    expect((await queryRoute(request(`/a/${doc}/query`, { method: 'POST', cookie: cookie, origin: BASE, json: {} }), params({ id: doc }))).status).toBe(200);
    expect((await queryGet(getReq(`/a/${doc}/query?q=${q({})}`, cookie), params({ id: doc }))).status).toBe(404);
    expect((await queryGet(getReq(`/a/${doc}/query?q=${q({})}`), params({ id: doc }))).status).toBe(404);
    expect((await queryGet(getReq(`/a/zzzzzz/query?q=${q({})}`), params({ id: 'zzzzzz' }))).status).toBe(404);
  });

  it('refuses a missing or malformed q, and the same bad shapes the POST refuses', async () => {
    const t = await mintToken('t');
    const ds = (await create(t.token, { dataset: ROWS })).id;
    const doc = (await create(t.token, { markup: DOC(ds) })).id;
    expect((await queryGet(getReq(`/a/${doc}/query`), params({ id: doc }))).status).toBe(400);
    expect((await queryGet(getReq(`/a/${doc}/query?q=not-json`), params({ id: doc }))).status).toBe(400);
    expect((await queryGet(getReq(`/a/${doc}/query?q=${q([1, 2])}`), params({ id: doc }))).status).toBe(400);
    const bad = await queryGet(getReq(`/a/${doc}/query?q=${q({ values: { region: { nested: true } } })}`), params({ id: doc }));
    expect(bad.status).toBe(400);
    expect((await bad.json()).error).toBe('invalid_values');
  });
});
