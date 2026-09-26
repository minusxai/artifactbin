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
import { GET as pageRoute } from '@/app/api/page/artifact/[id]/route';
import { HOLD_MAX_ROWS } from '@/lib/story/placement';
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
  `<Import name="sales_data" src="ref:${ds}" /><Query name="sales">{\`select region, sum(revenue) revenue from sales_data.rows where ($region is null or region = $region) and revenue >= $min group by 1 order by 1\`}</Query>` +
  `<Import name="regions_data" src="ref:${ds}" /><Query name="regions">{\`select distinct region from regions_data.rows order by 1\`}</Query>` +
  '</Helmet><div><select value="$region" options="$regions" /><Question data="$sales" viz={{"kind":"table"}} /></div>';

describe('POST /a/<id>/query (reader path)', () => {
  it('rejects guessed query selectors rather than silently running every query', async () => {
    const t = await mintToken('t');
    const ds = (await create(t.token, { dataset: ROWS })).id;
    const doc = (await create(t.token, { markup: DOC(ds) })).id;
    for (const selector of [{ name: 'sales' }, { query: 'sales' }, { sql: 'select 1' }]) {
      const post = await queryRoute(request(`/a/${doc}/query`, { method: 'POST', json: selector }), params({ id: doc }));
      const get = await queryGet(request(`/a/${doc}/query?q=${encodeURIComponent(JSON.stringify(selector))}`), params({ id: doc }));
      for (const res of [post, get]) {
        expect(res.status).toBe(400);
        expect(await res.json()).toMatchObject({ error: 'unknown_query_fields', details: [expect.stringContaining('"only"')] });
      }
    }
  });

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
     * only the account session, so the document painted and then every bound
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
    expect(body.errors.sales).toMatch(new RegExp(`ref:${foreign}`));
  });

  it('requires a credential and a markup body', async () => {
    const t = await mintToken('t');
    expect((await draftQueryRoute(request('/api/query', { method: 'POST', json: { markup: '<p>x</p>' } }))).status).toBe(401);
    expect((await draftQueryRoute(request('/api/query', { method: 'POST', token: t.token, json: {} }))).status).toBe(400);
  });

  it('a draft that declares nothing answers empty; a draft whose Helmet is malformed answers 400 with the grammar errors', async () => {
    const t = await mintToken('t');
    const empty = await draftQueryRoute(request('/api/query', { method: 'POST', token: t.token, json: { markup: '<p>x</p>' } }));
    expect(await empty.json()).toEqual({ tables: {}, errors: {}, flow: null });
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

it('draft validation gives the same actionable JSX diagnostics as publishing', async () => {
  const t = await mintToken('draft-syntax');
  const res = await draftQueryRoute(request('/api/query', {method:'POST',token:t.token,json:{markup:'<Question viz={"kind":"vega-lite","spec":{"mark":"bar"}} />'}}));
  expect(res.status).toBe(400);
  const body = await res.json();
  expect(body.error).toBe('invalid_jsx');
  expect(body.details[0].message).toContain('missing its object opening brace');
  expect(body.details[0].snippet).toContain('▶');
});

/*
 * HOLDING AN IMPORT: the reader's page runs a query itself when it holds every
 * import the query reads, and it fetches each with one request through the
 * same two doors. What it may hold is decided for the door's own viewer: the
 * document must read the import, AND the reader must be allowed the dataset's
 * rows themselves — a public document's RESULTS over a private dataset are not
 * the private rows. The island names what may be held; the door re-decides
 * every time and never names a ref, only an import the document declares.
 */
/*
 * NAMING WHO THE PAGE'S OWN RESULTS SHOW. A query the page runs itself was
 * never run by the server, so nobody sent the cards for the people its rows
 * name. The page asks for them — `{people:[ids]}` — through the same two doors,
 * and the door names only whom the server-side run could have named for THIS
 * viewer: the viewer themselves (the session door), and the people in a user
 * column of an import this viewer may hold whole, projected as a person by one
 * of the document's queries. Anyone else is simply absent, however they were
 * asked for.
 */
describe('naming the people a page computed', () => {
  const session = (user: { id: string; email: string | null }) => ({ credential: 'session' as const, userId: user.id, email: user.email ?? '', emailVerified: true });
  const named = async (doc: string, ids: string[], init: { actor?: ReturnType<typeof session> } = {}) => {
    const [get, post] = await Promise.all([
      queryGet(request(`/a/${doc}/query?q=${encodeURIComponent(JSON.stringify({ people: ids }))}`, init), params({ id: doc })),
      queryRoute(request(`/a/${doc}/query`, { method: 'POST', ...init, json: { people: ids } }), params({ id: doc })),
    ]);
    const read = async (res: Response) => {
      expect(res.status).toBe(200);
      expect(res.headers.get('cache-control')).toBe('no-store');
      return Object.keys(((await res.json()) as { people: Record<string, unknown> }).people).sort();
    };
    return { get: await read(get), post: await read(post) };
  };
  const users = async (...names: string[]) => Promise.all(names.map((name) => createUser({ email: `mxmx_test_people_${name}@example.com`, name })));

  it('names the people in a held import a query projects, to anyone who may hold it, and nobody else', async () => {
    const t = await mintToken('t');
    const [alice, bob, carol, dave] = await users('alice', 'bob', 'carol', 'dave');
    const who = { dataset: [{ id: 1, who: alice!.id }, { id: 2, who: bob!.id }], columns: [{ name: 'who', type: 'user' }] };
    const ds = (await create(t.token, who)).id;
    // Dave is in a user column no query shows as a person: the server would never have named him.
    const hidden = (await create(t.token, { dataset: [{ id: 1, who: dave!.id }], columns: [{ name: 'who', type: 'user' }] })).id;
    const doc = (await create(t.token, { visibility: 'public', markup:
      `<Helmet><Import name="tasks" src="ref:${ds}" /><Query name="owners">{\`select who from tasks.rows\`}</Query>` +
      `<Import name="other" src="ref:${hidden}" /><Query name="counted">{\`select count(who) as n from other.rows\`}</Query></Helmet><DataTable data="$owners" />` })).id;
    const answer = await named(doc, [alice!.id, bob!.id, carol!.id, dave!.id, 'usr_missing']);
    expect(answer).toEqual({ get: [alice!.id, bob!.id].sort(), post: [alice!.id, bob!.id].sort() });
    const res = await queryRoute(request(`/a/${doc}/query`, { method: 'POST', json: { people: [alice!.id] } }), params({ id: doc }));
    expect(await res.json()).toEqual({ people: { [alice!.id]: { name: 'alice', handle: null, image: null } } });
  });

  it('never names the people in a dataset the reader may not hold, though the document reads it for them', async () => {
    const t = await mintToken('owner');
    const owner = await createUser({ email: 'mxmx_test_people_owner@example.com', name: 'owner' });
    await claimToken(owner.id, t.token);
    const [erin] = await users('erin');
    const ds = (await create(t.token, { dataset: [{ id: 1, who: erin!.id }], columns: [{ name: 'who', type: 'user' }], visibility: 'private', access: 'read' })).id;
    const doc = (await create(t.token, { visibility: 'public', markup: `<Helmet><Import name="tasks" src="ref:${ds}" /><Query name="owners">{\`select who from tasks.rows\`}</Query></Helmet><DataTable data="$owners" />` })).id;
    expect(await named(doc, [erin!.id])).toEqual({ get: [], post: [] });
    // The owner may hold the rows, so the session door names Erin — and the owner themselves; the GET door reads no credential.
    expect(await named(doc, [erin!.id, owner.id], { actor: session(owner) })).toEqual({ get: [], post: [erin!.id, owner.id].sort() });
  });

  it('takes a bounded list of ids that travels alone', async () => {
    const t = await mintToken('t');
    const ds = (await create(t.token, { dataset: ROWS })).id;
    const doc = (await create(t.token, { markup: DOC(ds) })).id;
    for (const bad of [{ people: 'usr_1' }, { people: [3] }, { people: ['usr_1'], only: ['sales'] }, { people: Array.from({ length: 1001 }, (_, i) => `usr_${i}`) }]) {
      const res = await queryRoute(request(`/a/${doc}/query`, { method: 'POST', json: bad }), params({ id: doc }));
      expect(res.status).toBe(400);
    }
  });
});

describe('holding an import', () => {
  const hold = (doc: string, name: string, init: { cookie?: string } = {}) => Promise.all([
    queryGet(request(`/a/${doc}/query?q=${encodeURIComponent(JSON.stringify({ hold: name }))}`), params({ id: doc })),
    queryRoute(request(`/a/${doc}/query`, { method: 'POST', ...init, json: { hold: name } }), params({ id: doc })),
  ]);
  const island = async (doc: string, init: { token?: string; cookie?: string } = {}) =>
    ((await (await pageRoute(request(`/api/page/artifact/${doc}`, init), params({ id: doc }))).json()) as { surface: { runtime: { data: { dataflow?: { hold?: string[] } } } } }).surface.runtime.data.dataflow;

  it('answers every row of a readable import through both doors, past the display window, and names it on the island', async () => {
    const t = await mintToken('t');
    const rows = Array.from({ length: 1500 }, (_, i) => ({ region: i % 2 ? 'EU' : 'NA', revenue: i }));
    const ds = (await create(t.token, { dataset: rows })).id;
    const doc = (await create(t.token, { markup: DOC(ds) })).id;
    for (const res of await hold(doc, 'sales_data')) {
      expect(res.status).toBe(200);
      expect(res.headers.get('cache-control')).toBe('no-store');
      const body = (await res.json()) as { tables: Record<string, { rows: unknown[]; columns: unknown[] }> };
      expect(body.tables.rows!.rows).toEqual(rows);
      expect(body.tables.rows!.columns).toEqual([{ name: 'region', type: 'string' }, { name: 'revenue', type: 'number' }]);
    }
    expect((await island(doc))?.hold).toEqual(['sales_data', 'regions_data']);
  });

  it('never hands a reader the rows of a dataset they may not read, though the document reads it for them', async () => {
    const t = await mintToken('owner');
    const owner = await createUser({ email: 'hold-owner@example.com' });
    await claimToken(owner.id, t.token);
    // A dataset without read grants: the document reads it by its owner's reach, whoever is reading.
    const ds = (await create(t.token, { dataset: ROWS, visibility: 'private', access: 'read' })).id;
    const doc = (await create(t.token, { markup: DOC(ds), visibility: 'public' })).id;
    // The document's results are public…
    const run = await queryGet(request(`/a/${doc}/query?q=${encodeURIComponent(JSON.stringify({ only: ['sales'] }))}`), params({ id: doc }));
    expect(((await run.json()) as { tables: Record<string, { rows: unknown[] }> }).tables.sales!.rows).toHaveLength(2);
    // …the private rows are not: a reader who may not read the dataset holds nothing, through either door.
    for (const res of await hold(doc, 'sales_data')) {
      expect(res.status).toBe(404);
      const text = await res.text();
      expect(text).not.toContain('837');
      expect(JSON.parse(text)).toEqual({ error: 'not_holdable' });
    }
    expect((await island(doc))?.hold).toEqual([]);
    // Their owner may hold them: the session door answers the owner's own credential.
    const cookie = await agentCookie([t.id]);
    const [, owners] = await hold(doc, 'sales_data', { cookie });
    expect(owners.status).toBe(200);
    expect((await island(doc, { cookie }))?.hold).toEqual(['sales_data', 'regions_data']);
  });

  it('holds only what the document imports, by import name — never a ref, never an undeclared name', async () => {
    const t = await mintToken('t');
    const ds = (await create(t.token, { dataset: ROWS })).id;
    const doc = (await create(t.token, { markup: DOC(ds) })).id;
    for (const name of [ds, `ref:${ds}`, 'sales', 'nope']) {
      for (const res of await hold(doc, name)) expect(res.status).toBe(404);
    }
    for (const bad of [{ hold: 3 }, { hold: 'sales_data', only: ['sales'] }]) {
      const res = await queryRoute(request(`/a/${doc}/query`, { method: 'POST', json: bad }), params({ id: doc }));
      expect(res.status).toBe(400);
    }
  });

  it('refuses an import past the hold cap: its queries stay on the server', async () => {
    const t = await mintToken('t');
    const ds = (await create(t.token, { dataset: Array.from({ length: HOLD_MAX_ROWS + 1 }, (_, n) => ({ n })) })).id;
    const doc = (await create(t.token, { markup: `<Helmet><Import name="big" src="ref:${ds}" /><Query name="total">{\`select count(*) as n from big.rows\`}</Query></Helmet><p>big</p>` })).id;
    for (const res of await hold(doc, 'big')) expect(res.status).toBe(404);
    expect((await island(doc))?.hold).toEqual([]);
  });
});
